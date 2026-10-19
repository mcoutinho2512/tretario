/**
 * Rodada 12 — VEÍCULO PESSOAL no cliente (docs/PERSONAL_VEHICLES.md). "Selecionou → aparece": a barra de ações
 * (Veículos), o inventário (VEÍCULOS) e o acesso rápido chamam `request(kind)` — nada de "o mais próximo está a 83 m".
 *
 *  online   `pveh_req {kind, seq}` → o SERVIDOR escolhe o ponto, cria o NetVehicle (owner = eu) e monta. A resposta
 *           `pveh_ok` já traz id/tipo/pose: a instância é criada NA HORA (não espera o patch do estado) e, montado, entra
 *           pelo mesmo `mountLocal` do `enter_ok` — a animação de montagem da rodada 10 continua. `pveh_denied` →
 *           aviso curto. A troca de tipo chega como `exit_ok` (desceu com segurança) + `pveh_ok {replaced}`.
 *  remotos  o veículo pessoal de outro chega pelo estado (onAdd com `owner`) → mesma instância/modelo das vagas;
 *           some pelo onRemove (o servidor o apagou ou saiu da área de interesse). Só o dono usa (sem prompt de E).
 *  offline  o mesmo `findPersonalSpawn` contra a colisão local; some depois de despawnIdleMs sem o dono.
 */
import type { RideableInstance, RideableKind, RideableSystem } from './Rideable';
import { PERSONAL_AUTOMOUNT_MAX_M, PERSONAL_DENY_TEXT, PERSONAL_KINDS, PERSONAL_LABEL, PERSONAL_RULES, isPersonalKind, type PersonalDenyReason, type PersonalKind, type PersonalVehicleOk } from './personal';
import { entryDistance, findPersonalSpawn, type SpawnObstacles, type SpawnWorld } from './personalSpawn';

export interface PersonalClientHost {
  online(): boolean;
  /** envia `pveh_req` (NetworkClient.requestPersonal) */
  send(kind: PersonalKind): void;
  selfId(): string;
  rideables: RideableSystem;
  player(): { x: number; z: number; heading: number };
  riding(): RideableInstance | null;
  /** em cima do trio / caído / desenhando: não pede */
  busy(): string | null;
  mountLocal(it: RideableInstance): void;
  dismountLocal(): void;
  /** desce do veículo atual pelo caminho normal (online: `exit`) */
  exit(): void;
  /** offline: chão/paredes e obstáculos locais */
  world(): SpawnWorld;
  obstacles(x: number, z: number): SpawnObstacles;
  flash(msg: string): void;
  /** destaca um ponto (minimapa) — carro que surgiu na pista sem montar */
  showTarget(x: number, z: number, label: string): void;
}

export class PersonalVehicleClient {
  /** o meu veículo pessoal (pelo servidor/local) */
  active: { id: string; kind: PersonalKind } | null = null;
  private pending: { kind: PersonalKind; t0: number } | null = null;
  private localSeq = 0;
  private idleSince = 0;
  /** QA: tempos (ms) seleção → resposta e → montado, por tipo */
  readonly stats = { requests: 0, ok: 0, denied: {} as Record<string, number>, ignored: 0, last: null as null | { kind: string; okMs: number; mounted: boolean; d: number; id: string }, log: [] as { kind: string; okMs: number; mounted: boolean; d: number }[] };

  constructor(private h: PersonalClientHost) {}

  label(k: string) { return PERSONAL_LABEL[k as PersonalKind] ?? k; }
  kinds() { return PERSONAL_KINDS; }
  /** montado no meu pessoal deste tipo? */
  ridingKind(): PersonalKind | null {
    const r = this.h.riding();
    return r && this.active && r.state.id === this.active.id ? this.active.kind : null;
  }

  /** selecionou → aparece (o mesmo tipo de novo, montado: desce — como guardar o item) */
  toggle(kind: string) {
    if (!isPersonalKind(kind)) return;
    if (this.ridingKind() === kind) { this.h.exit(); return; }
    this.request(kind);
  }

  request(kind: string) {
    if (!isPersonalKind(kind)) return;
    const now = performance.now();
    if (this.pending && now - this.pending.t0 < 1500) { this.stats.ignored++; return; } // um pedido por vez
    const busy = this.h.busy();
    if (busy) { this.h.flash(busy); return; }
    const r = this.h.riding();
    if (r && (!this.active || r.state.id !== this.active.id)) { this.h.flash('Desça do veículo primeiro (E)'); return; }
    this.stats.requests++;
    this.pending = { kind, t0: now };
    if (this.h.online()) { this.h.send(kind); return; }
    this.localSpawn(kind);
  }

  /** `pveh_ok` / `pveh_denied` */
  onServer(ok: boolean, m: Partial<PersonalVehicleOk> & { reason?: string; kind?: string }) {
    const t0 = this.pending?.t0 ?? performance.now();
    this.pending = null;
    if (!ok || !m.id || !isPersonalKind(m.kind)) {
      const reason = (m.reason ?? 'tipo') as PersonalDenyReason;
      this.stats.denied[reason] = (this.stats.denied[reason] ?? 0) + 1;
      this.h.flash(PERSONAL_DENY_TEXT[reason] ?? 'Veículo indisponível');
      return;
    }
    if (m.replaced && m.replaced !== m.id && this.h.riding()?.state.id !== m.replaced) this.h.rideables.removeDynamic(m.replaced);
    const it = this.h.rideables.addDynamic(m.id, m.kind as RideableKind, m.x ?? 0, m.z ?? 0, m.heading ?? 0, this.h.selfId());
    if (!it) return;
    it.state.x = m.x ?? it.state.x; it.state.z = m.z ?? it.state.z; it.state.heading = m.heading ?? it.state.heading;
    this.active = { id: m.id, kind: m.kind };
    this.done(m.kind, it, !!m.mounted, t0);
  }

  /** estado do servidor: veículos que surgem (o meu ou de outros) */
  onVehicle(id: string, v: { kind: string; x: number; z: number; heading: number; owner?: string }) {
    if (!v.owner || this.h.rideables.byId.has(id)) return;
    if (!isPersonalKind(v.kind)) return;
    this.h.rideables.addDynamic(id, v.kind, v.x, v.z, v.heading, v.owner);
    if (v.owner === this.h.selfId()) this.active = { id, kind: v.kind };
  }

  /** saiu da vista / apagado no servidor */
  onGone(id: string) {
    if (!this.h.rideables.isDynamic(id)) return;
    if (this.h.riding()?.state.id === id) return; // ainda montado (reconexão): o servidor manda de novo
    this.h.rideables.removeDynamic(id);
    if (this.active?.id === id) this.active = null;
  }

  /** offline: some sem o dono a bordo (o servidor faz o mesmo online) */
  frame() {
    if (this.h.online() || !this.active) return;
    const now = performance.now();
    if (this.ridingKind()) { this.idleSince = now; return; }
    if (now - this.idleSince > PERSONAL_RULES.despawnIdleMs) { this.h.rideables.removeDynamic(this.active.id); this.active = null; }
  }

  private localSpawn(kind: PersonalKind) {
    const t0 = this.pending?.t0 ?? performance.now();
    this.pending = null;
    const prev = this.active;
    if (prev && this.h.riding()?.state.id === prev.id) this.h.dismountLocal();
    const p = this.h.player();
    const spot = findPersonalSpawn(kind, p, this.h.world(), this.h.obstacles(p.x, p.z));
    if (!spot.ok) { this.stats.denied.sem_lugar = (this.stats.denied.sem_lugar ?? 0) + 1; this.h.flash(PERSONAL_DENY_TEXT.sem_lugar); return; }
    if (prev) this.h.rideables.removeDynamic(prev.id);
    const id = `pveh_local_${++this.localSeq}`;
    const it = this.h.rideables.addDynamic(id, kind, spot.x, spot.z, spot.heading, this.h.selfId());
    if (!it) return;
    this.active = { id, kind };
    this.idleSince = performance.now();
    const mounted = PERSONAL_RULES.autoMount[kind] && entryDistance(kind, spot, p.x, p.z) <= PERSONAL_AUTOMOUNT_MAX_M;
    this.done(kind, it, mounted, t0);
  }

  private done(kind: PersonalKind, it: RideableInstance, mounted: boolean, t0: number) {
    const okMs = performance.now() - t0;
    const p = this.h.player();
    const d = Math.hypot(it.state.x - p.x, it.state.z - p.z);
    this.stats.ok++;
    this.stats.last = { kind, okMs: +okMs.toFixed(1), mounted, d: +d.toFixed(2), id: it.state.id };
    this.stats.log.push({ kind, okMs: +okMs.toFixed(1), mounted, d: +d.toFixed(2) });
    if (this.stats.log.length > 40) this.stats.log.shift();
    if (mounted) { this.h.mountLocal(it); this.h.flash(`${this.label(kind)} disponível`); }
    else {
      this.h.showTarget(it.state.x, it.state.z, `${kind === 'car' || kind === 'scooter' ? 'Seu' : 'Sua'} ${this.label(kind).toLowerCase()}`);
      this.h.flash(`${this.label(kind)} disponível — ali do lado (${d < 6 ? 'aqui' : `${Math.round(d)} m`}): E para entrar`);
    }
  }
}
