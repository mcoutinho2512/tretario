/**
 * Rodada 12 — VEÍCULO PESSOAL no servidor (docs/PERSONAL_VEHICLES.md). "Selecionou → aparece".
 *
 * Sem sistema paralelo: o veículo criado é um NetVehicle comum em `state.vehicles` (mesma AOI, mesmo movimento,
 * mesma montagem/saída segura da rodada 10), com `owner` = sessionId do dono. Este módulo NÃO conhece o Colyseus —
 * a sala entrega um `PersonalHost` (criar/remover veículo, montar/desmontar pelo MESMO caminho do `enter`/`exit`,
 * obstáculos por perto). Por isso o mesmo `spawnPersonalVehicle(ownerId, kind, at)` serve para os personagens
 * autônomos (rodada 12, agente C) — sem taxa, mas com as mesmas validações de chão/paredes/corpos.
 *
 *  política   1 pessoal ativo por dono; pedir outro tipo remove o anterior (dono a bordo: desmonta com segurança
 *             antes); mesmo tipo de novo = o atual (monta se estiver perto, senão troca de lugar = novo surgimento)
 *  uso        SÓ o dono usa (outros recebem `enter_denied 'pessoal'`) — sem roubo, sem "vaga" para disputar
 *  taxa       ≥ minIntervalMs entre aceitos e ≤ burstPer10s pedidos em 10 s (todos contam, até os inválidos)
 *  ciclo      sem o dono a bordo por despawnIdleMs → some; dono saiu de vez (graça vencida, sessão substituída) → some
 *             na hora; na graça de reconexão fica (o dono volta montado — rodada 10); nada é persistido
 */
import { PERSONAL_AUTOMOUNT_MAX_M, PERSONAL_ID_PREFIX, PERSONAL_KINDS, PERSONAL_RULES, isPersonalKind, type PersonalDenyReason, type PersonalKind, type PersonalVehicleDenied, type PersonalVehicleOk } from '../../../src/vehicles/personal';
import { entryDistance, findPersonalSpawn, type SpawnObstacles, type SpawnWorld } from '../../../src/vehicles/personalSpawn';

/** quem pede (jogador ou autônomo) como o servidor o tem */
export interface PersonalActor { x: number; z: number; heading: number; status: number; vehicle: string; platform: string }

export interface PersonalHost {
  now(): number;
  /** tipos que o evento atual permite (null/vazio = todos) */
  allowedKinds(): ReadonlySet<string> | null;
  /** entidade (state.players) — null = não existe */
  actor(sid: string): PersonalActor | null;
  /** é espectador (sem corpo)? */
  isSpectator(sid: string): boolean;
  world: SpawnWorld;
  /** veículos, corpos (sem `selfSid`) e objetos a ≤ r */
  obstacles(x: number, z: number, r: number, selfSid: string): SpawnObstacles;
  addVehicle(id: string, kind: PersonalKind, x: number, z: number, heading: number, owner: string): void;
  removeVehicle(id: string): void;
  /** ocupante atual do veículo ('' livre; undefined = não existe) */
  occupant(id: string): string | undefined;
  /** monta pelo MESMO caminho do `enter` (estado, missão `vehicle_enter`, posição) */
  mount(sid: string, id: string, seq?: number): void;
  /** desmonta pelo MESMO caminho do `exit` (saída segura); devolve onde ficou */
  dismount(sid: string, seq?: number): { x: number; z: number } | null;
}

export type PersonalResult = ({ ok: true } & PersonalVehicleOk & { d: number; ms: number }) | ({ ok: false } & PersonalVehicleDenied);

interface Active { id: string; kind: PersonalKind; owner: string; idleSince: number | null; createdAt: number }

const IDLE_MS = Number(process.env.PV_PVEH_IDLE_MS ?? PERSONAL_RULES.despawnIdleMs);
/** raio de busca de obstáculos (m): o maior anel + o veículo maior */
const OBST_R = Math.max(...PERSONAL_KINDS.map((k) => PERSONAL_RULES.spawnMaxDist[k])) + 6;

export class PersonalVehicles {
  private byOwner = new Map<string, Active>();
  private byId = new Map<string, Active>();
  private rate = new Map<string, { times: number[]; lastOk: number }>();
  private seq = 0;
  readonly stats = { requests: 0, ok: 0, denied: {} as Record<string, number>, spawned: 0, removed: 0, idleRemoved: 0, maxActive: 0 };
  /** QA: últimos resultados */
  readonly recent: { sid: string; kind: string; ok: boolean; reason?: string; d?: number; ms?: number }[] = [];

  constructor(private h: PersonalHost) {}

  get size() { return this.byId.size; }
  ownerOf(id: string): string | undefined { return this.byId.get(id)?.owner; }
  activeOf(owner: string): { id: string; kind: PersonalKind } | undefined { const a = this.byOwner.get(owner); return a ? { id: a.id, kind: a.kind } : undefined; }
  isPersonal(id: string) { return this.byId.has(id); }

  /** pedido pela mensagem `pveh_req` (taxa + validações + surgimento + montagem) */
  request(sid: string, raw: unknown): PersonalResult {
    const now = this.h.now();
    this.stats.requests++;
    const m = (raw && typeof raw === 'object' ? raw : {}) as { kind?: unknown; seq?: unknown };
    const kindTxt = typeof m.kind === 'string' ? m.kind.slice(0, 16) : '';
    // taxa ANTES de qualquer trabalho: spam (até de tipo inválido) custa um push num vetor
    const rt = this.rate.get(sid) ?? { times: [], lastOk: -1e12 };
    this.rate.set(sid, rt);
    while (rt.times.length && now - rt.times[0] > 10_000) rt.times.shift();
    rt.times.push(now);
    if (rt.times.length > PERSONAL_RULES.burstPer10s || now - rt.lastOk < PERSONAL_RULES.minIntervalMs) return this.deny(sid, kindTxt, 'taxa');
    if (this.h.isSpectator(sid)) return this.deny(sid, kindTxt, 'espectador');
    if (!isPersonalKind(m.kind)) return this.deny(sid, kindTxt, 'tipo');
    const seq = typeof m.seq === 'number' && Number.isFinite(m.seq) ? m.seq : undefined;
    const r = this.spawnPersonalVehicle(sid, m.kind, undefined, { seq });
    if (r.ok) rt.lastOk = now;
    return r;
  }

  /**
   * FUNÇÃO REUTILIZÁVEL (jogadores e autônomos): cria o veículo pessoal de `ownerId` perto de `at` (padrão: a posição
   * do dono), remove o anterior e, se a entrada ficar perto, monta. Sem taxa — quem chama decide a frequência.
   */
  spawnPersonalVehicle(ownerId: string, kind: PersonalKind, at?: { x: number; z: number; heading: number }, opts: { seq?: number; mount?: boolean } = {}): PersonalResult {
    const t0 = performance.now();
    if (!isPersonalKind(kind)) return this.deny(ownerId, String(kind), 'tipo');
    const allowed = this.h.allowedKinds();
    if (allowed && allowed.size && !allowed.has(kind)) return this.deny(ownerId, kind, 'evento');
    let a = this.h.actor(ownerId);
    if (!a) return this.deny(ownerId, kind, 'estado');
    if (a.status !== 0) return this.deny(ownerId, kind, 'caido');
    if (a.platform) return this.deny(ownerId, kind, 'estado');
    const prev = this.byOwner.get(ownerId);
    // em veículo do MUNDO (ou de outro): primeiro desça — só o próprio pessoal é trocado daqui
    if (a.vehicle && a.vehicle !== prev?.id) return this.deny(ownerId, kind, 'estado');
    // o mesmo tipo e já montado nele: nada a fazer
    if (prev && prev.kind === kind && a.vehicle === prev.id) {
      const v = this.h.actor(ownerId)!;
      return this.okResult(ownerId, prev, v.x, v.z, v.heading, true, undefined, 0, t0);
    }
    // dono a bordo do anterior (outro tipo): desmonta com segurança ANTES (o novo nasce perto de onde ele desceu)
    let from = at ?? { x: a.x, z: a.z, heading: a.heading };
    if (prev && a.vehicle === prev.id) {
      const out = this.h.dismount(ownerId, opts.seq);
      a = this.h.actor(ownerId);
      if (!a) return this.deny(ownerId, kind, 'estado');
      if (out && !at) from = { x: out.x, z: out.z, heading: a.heading };
    }
    const obs = this.h.obstacles(from.x, from.z, OBST_R, ownerId);
    // o anterior não conta como obstáculo (vai sumir)
    if (prev && obs.vehicles) obs.vehicles = obs.vehicles.filter((v) => !(v as { id?: string }).id || (v as { id?: string }).id !== prev.id);
    const spot = findPersonalSpawn(kind, from, this.h.world, obs);
    if (!spot.ok) return this.deny(ownerId, kind, 'sem_lugar');
    let replaced: string | undefined;
    if (prev) { replaced = prev.id; this.remove(prev.id); }
    const id = `${PERSONAL_ID_PREFIX}${(++this.seq).toString(36)}`;
    const act: Active = { id, kind, owner: ownerId, idleSince: this.h.now(), createdAt: this.h.now() };
    this.byOwner.set(ownerId, act); this.byId.set(id, act);
    this.h.addVehicle(id, kind, spot.x, spot.z, spot.heading, ownerId);
    this.stats.spawned++;
    this.stats.maxActive = Math.max(this.stats.maxActive, this.byId.size);
    const near = entryDistance(kind, spot, from.x, from.z) <= PERSONAL_AUTOMOUNT_MAX_M;
    const mounted = (opts.mount ?? PERSONAL_RULES.autoMount[kind]) && near;
    if (mounted) { this.h.mount(ownerId, id, opts.seq); act.idleSince = null; }
    return this.okResult(ownerId, act, spot.x, spot.z, spot.heading, mounted, replaced, spot.d, t0);
  }

  /** remove o pessoal do dono (logout, sessão substituída, saída de vez); desmonta se ainda estiver nele */
  release(owner: string) {
    this.rate.delete(owner);
    const a = this.byOwner.get(owner);
    if (a) this.remove(a.id);
  }

  /** 1 Hz: some quem está sem o dono a bordo há despawnIdleMs (e quem perdeu o dono) */
  tick(now = this.h.now()) {
    for (const a of [...this.byId.values()]) {
      const occ = this.h.occupant(a.id);
      if (occ === undefined) { this.forget(a); continue; } // removido por fora
      if (!this.h.actor(a.owner)) { this.remove(a.id); continue; } // dono não existe mais
      if (occ === a.owner) { a.idleSince = null; continue; }
      if (a.idleSince === null) a.idleSince = now;
      if (now - a.idleSince >= IDLE_MS && !occ) { this.remove(a.id); this.stats.idleRemoved++; }
    }
  }

  /** o dono desceu (exit): começa a contar a ociosidade */
  onExit(owner: string, id: string) { const a = this.byId.get(id); if (a && a.owner === owner) a.idleSince = this.h.now(); }

  private remove(id: string) {
    const a = this.byId.get(id);
    if (!a) return;
    if (this.h.occupant(id)) { const occ = this.h.occupant(id)!; this.h.dismount(occ); }
    this.forget(a);
    this.h.removeVehicle(id);
    this.stats.removed++;
  }
  private forget(a: Active) {
    this.byId.delete(a.id);
    if (this.byOwner.get(a.owner) === a) this.byOwner.delete(a.owner);
  }

  private okResult(sid: string, a: Active, x: number, z: number, heading: number, mounted: boolean, replaced: string | undefined, d: number, t0: number): PersonalResult {
    const ms = performance.now() - t0;
    this.stats.ok++;
    this.log({ sid, kind: a.kind, ok: true, d: +d.toFixed(2), ms: +ms.toFixed(2) });
    return { ok: true, id: a.id, kind: a.kind, x: +x.toFixed(3), z: +z.toFixed(3), heading: +heading.toFixed(4), mounted, ...(replaced ? { replaced } : {}), d: +d.toFixed(2), ms: +ms.toFixed(2) };
  }
  private deny(sid: string, kind: string, reason: PersonalDenyReason): PersonalResult {
    this.stats.denied[reason] = (this.stats.denied[reason] ?? 0) + 1;
    this.log({ sid, kind, ok: false, reason });
    return { ok: false, kind, reason };
  }
  private log(e: PersonalVehicles['recent'][number]) { this.recent.push(e); if (this.recent.length > 64) this.recent.shift(); }
}
