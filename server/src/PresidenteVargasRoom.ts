/**
 * Sala da Presidente Vargas — servidor AUTORITATIVO (desenvolvimento/local).
 *
 *  posição      cliente propõe; servidor valida velocidade por modo, limites e PAREDES (colisão 2D) e corrige
 *  veículos     registro no servidor; entrar/sair validados; 1 ocupante por veículo; posição vem do ocupante validado
 *  interação    modo por jogador (política do evento); empurrão e impacto de veículo validados aqui
 *  mundo        relógio global e semente. SEM trânsito NPC: a Pres. Vargas está fechada para o evento — só veículos
 *               de jogadores (carro, moto, bicicleta, patinete), estacionados até alguém usar
 *  interesse    grade espacial (SpatialGrid) + StateView por cliente: os AOI_MAX jogadores mais próximos a ≤ AOI_RADIUS
 *               com estado completo (20 Hz); o resto da área vai como multidão compacta ("crowd", 2 Hz). Veículos também pela grade
 *  rede adversa PV_JITTER / PV_LOSS (ms / 0–1) além de COLYSEUS_LATENCY (RTT nativo)
 */
import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { WorldState, NetPlayer, NetVehicle } from './state.ts';
import { loadWorld, type ServerWorld } from './world.ts';
import { BODIES, NET_ACCESSORIES, MAX_SPEED, sanitizeColor, sanitizeName, type JoinOptions, type MoveMode } from '../../src/net/protocol.ts';
import { validateMoveInWorld } from '../../src/net/authority.ts';
import { RULES, STATUS, VEHICLE_BOX, VEHICLE_STATE, canPush, canEnter, impactAllowed, knockdownOutcome, shouldResetVehicle, vehicleBlock, vehicleImpact, unpackMove, type Actor, type Mode, type VehicleKind } from '../../src/net/rules.ts';
import { metrics } from './metrics.ts';
import { SpatialGrid, selectInterest, selectInterestSlots, InterestScratch, makeSlotView, type SlotView } from '../../src/net/spatialGrid.ts';
import { CrowdTable } from '../../src/net/crowdCodec.ts';

const AOI_RADIUS = Number(process.env.PV_AOI ?? 220); // m — jogadores/veículos visíveis
/** histerese da AOI: entra a ≤ R, sai só além de R × AOI_HYST */
const AOI_HYST = 1.15;
/** máximo de jogadores com estado completo (StateView) por cliente — os mais próximos. 0 = sem limite */
const AOI_MAX = Number(process.env.PV_AOI_MAX ?? 48);
/** multidão distante: frequência (Hz) e máximo de entradas por mensagem */
const CROWD_HZ = Number(process.env.PV_CROWD_HZ ?? 2);
const TICK_MS = 100; // simulação a 10 Hz
/** AOI e multidão são FATIADAS entre ticks (cada cliente no seu tick: slot % fatias): sem picos de custo */
const AOI_SLICES = 2; // cada cliente a cada 2 ticks = 5 Hz (antes: todos juntos a 4 Hz)
const CROWD_SLICES = Math.max(1, Math.round(1000 / TICK_MS / Math.max(0.1, CROWD_HZ)));
const CROWD_MAX = Number(process.env.PV_CROWD_MAX ?? 600);
/** limite pedido pelo cliente (aparelho fraco pede menos), entre 8 e AOI_MAX; 0 = sem limite */
const clientCap = (req: unknown) => {
  const n = typeof req === 'number' && Number.isFinite(req) ? Math.round(req) : 0;
  if (AOI_MAX <= 0) return n > 0 ? Math.max(8, n) : 0;
  return n > 0 ? Math.max(8, Math.min(AOI_MAX, n)) : AOI_MAX;
};
const BODY_INDEX: Record<string, number> = Object.fromEntries(BODIES.map((b, i) => [b, i]));
/** veículo abandonado longe da vaga volta para ela após este tempo (ms) sem ninguém por perto */
const VEH_RESET_MS = Number(process.env.PV_VEH_RESET_MS ?? RULES.vehicleResetMs);
const SIM_JITTER = Number(process.env.PV_JITTER ?? 0);
const SIM_LOSS = Number(process.env.PV_LOSS ?? 0);

let WORLD: ServerWorld | null = null;
const world = () => (WORLD ??= loadWorld());

interface PlayerRT {
  actor: Actor;
  last: { x: number; y: number; z: number; t: number; seq: number };
  view: StateView;
  /** jogadores na vista (por slot) */
  inView: SlotView;
  vehInView: Set<string>;
  rest: { x: number; z: number } | null;
  pendingIn: number; // processamento ordenado com jitter simulado
  /** id numérico curto (mensagem "crowd") */
  nid: number;
  /** jogadores na área mas fora do limite AOI_MAX (do último cálculo de AOI), mais próximos primeiro */
  overflow: number[];
  /** slot na grade espacial (inteiro pequeno, reaproveitado) */
  slot: number;
  /** limite de detalhados deste cliente (pedido no join, ≤ AOI_MAX) */
  aoiCap: number;
  /** nids cuja aparência este cliente já recebeu pela mensagem "crowd" */
  crowdKnown: Set<number>;
}

export class PresidenteVargasRoom extends Room<{ state: WorldState }> {
  maxClients = Number(process.env.PV_MAX_CLIENTS ?? 600);
  maxMessagesPerSecond = 60;
  state = new WorldState();
  private rt = new Map<string, PlayerRT>();
  private clients2 = new Map<string, Client>();
  /** vaga original e ociosidade de cada veículo (só servidor) */
  private vehRT = new Map<string, { spawnX: number; spawnZ: number; spawnHeading: number; idleSince: number; vslot: number }>();
  /** grade espacial dos veículos (AOI e retorno à vaga) */
  private vgrid = new SpatialGrid(AOI_RADIUS / 2);
  private vehIds: string[] = [];
  private vehAcc = 0;
  private interactionPolicy: 'pacifico' | 'opcional' = 'opcional';
  private spawn = { x: -580, z: 280, heading: 1.75 };
  private tickN = 0;
  private crowdTable = new CrowdTable();
  private crowdSlots = new Int32Array(1024);
  /** grade espacial dos jogadores (reconstruída a cada tick): AOI, candidatos de impacto */
  private grid = new SpatialGrid(AOI_RADIUS / 2);
  private scratch = new InterestScratch();
  private aoiAdd: number[] = [];
  private aoiRem: number[] = [];
  /** slot → sessionId (slots livres = '') */
  private slotIds: string[] = [];
  /** slot → nid (mensagem "crowd") */
  private slotNid: number[] = [];
  private freeSlots: number[] = [];
  private nextNid = 1;
  private nids = new Set<number>();

  messages = {
    move: (client: Client, raw: unknown) => this.withNet(client, true, () => this.onMove(client, raw)),
    ping: (client: Client, t0: number) => client.send('pong', [t0, Date.now()]),
    mode: (client: Client, m: Mode) => this.onMode(client, m),
    enter: (client: Client, m: { id: string; seq?: number } | string) => this.withNet(client, false, () => this.onEnter(client, typeof m === 'string' ? m : m?.id, typeof m === 'object' ? m?.seq : undefined)),
    exit: (client: Client, m?: { seq?: number }) => this.withNet(client, false, () => this.onExit(client, m?.seq)),
    push: (client: Client, target: string) => this.withNet(client, false, () => this.onPush(client, target)),
    appearance: (client: Client, opts: Partial<JoinOptions>) => {
      const p = this.state.players.get(client.sessionId);
      if (p && opts) this.applyAppearance(p, opts);
    },
  };

  onCreate(options: { eventId?: string } = {}) {
    const W = world();
    const ev = typeof options.eventId === 'string' && W.events.has(options.eventId) ? options.eventId : (process.env.PV_EVENT ?? W.defaultEvent);
    this.state.eventId = ev;
    this.interactionPolicy = W.events.get(ev)?.interaction === 'pacifico' ? 'pacifico' : 'opcional';
    this.state.seed = Number(process.env.PV_SEED ?? 20261015) >>> 0;
    const sp = W.manifest.spawn;
    this.spawn = { x: sp.p[0], z: sp.p[1], heading: Math.atan2(Math.cos(sp.yaw), Math.sin(sp.yaw)) };
    // veículos utilizáveis (mesmos ids do cliente)
    const allowed = new Set((W.events.get(ev)?.vehicles ?? []).map((v) => v.kind));
    for (const s of W.manifest.vehicleSpawns ?? []) {
      if (allowed.size && !allowed.has(s.kind)) continue;
      const v = new NetVehicle();
      v.kind = s.kind; v.x = s.x; v.z = s.z; v.y = 0; v.heading = s.heading; v.speed = 0; v.occupant = ''; v.state = VEHICLE_STATE.AVAILABLE;
      this.state.vehicles.set(s.id, v);
      this.vehRT.set(s.id, { spawnX: s.x, spawnZ: s.z, spawnHeading: s.heading, idleSince: Date.now(), vslot: this.vehIds.length });
      this.vehIds.push(s.id);
    }
    this.rebuildVehicleGrid();
    this.patchRate = 50; // 20 Hz
    this.setSimulationInterval((dt) => this.tick(dt), 100); // 10 Hz
    const kinds: Record<string, number> = {};
    this.state.vehicles.forEach((v) => { kinds[v.kind] = (kinds[v.kind] ?? 0) + 1; });
    console.log(`[room] ${this.roomId} evento=${ev} (interação: ${this.interactionPolicy}) sem trânsito NPC · veículos ${JSON.stringify(kinds)} AOI=${AOI_RADIUS} m`);
  }

  /** mede a codificação/envio dos patches (StateView por cliente): é o custo que cresce com a multidão */
  broadcastPatch() {
    const t0 = performance.now();
    const r = super.broadcastPatch();
    metrics.patch(performance.now() - t0);
    return r;
  }

  // ---------------------------------------------------------------- rede adversa (dev)
  private withNet(client: Client, droppable: boolean, fn: () => void) {
    metrics.msgIn(client.sessionId);
    if (!SIM_JITTER && !SIM_LOSS) return fn();
    if (droppable && Math.random() < SIM_LOSS) return; // perde (movimento: o próximo compensa)
    const r = this.rt.get(client.sessionId);
    const due = Math.max(Date.now() + Math.random() * SIM_JITTER, r?.pendingIn ?? 0); // TCP: preserva ordem
    if (r) r.pendingIn = due;
    setTimeout(fn, due - Date.now());
  }

  // ---------------------------------------------------------------- ciclo
  private tick(dtMs: number) {
    const t0 = performance.now();
    const now = Date.now();
    const dt = dtMs / 1000;
    this.state.serverTime = now;
    void dt;
    // recuperação de quedas
    for (const [id, r] of this.rt) {
      const p = this.state.players.get(id);
      if (!p) continue;
      if (p.status === STATUS.DOWN && now >= (r.actor.lastDown ?? 0) + RULES.downMs) { p.status = STATUS.GETUP; r.actor.status = STATUS.GETUP; }
      if (p.status === STATUS.GETUP && now >= (r.actor.lastDown ?? 0) + RULES.downMs + RULES.getupMs) {
        p.status = STATUS.OK; r.actor.status = STATUS.OK;
        r.actor.immuneUntil = now + RULES.immuneMs;
        if (r.rest) { r.last = { x: r.rest.x, y: 0, z: r.rest.z, t: now, seq: r.last.seq }; r.rest = null; }
      }
    }
    // grade espacial (O(N)) — base de todas as consultas de vizinhança
    this.rebuildGrid();
    // área de interesse (fatiada: cada cliente a 5 Hz) e multidão distante (fatiada: cada cliente a CROWD_HZ)
    this.tickN++;
    this.updateInterest(this.tickN % AOI_SLICES, AOI_SLICES);
    if (CROWD_HZ > 0) { const tc = performance.now(); this.sendCrowd(this.tickN % CROWD_SLICES, CROWD_SLICES); metrics.crowd(performance.now() - tc); }
    // veículos: grade (AOI) e retorno à vaga dos abandonados (1 Hz)
    this.vehAcc += dtMs;
    if (this.vehAcc >= 1000) { this.vehAcc = 0; this.rebuildVehicleGrid(); this.resetAbandoned(now); }
    metrics.tick(performance.now() - t0, this.state.players.size);
  }

  private rebuildVehicleGrid() {
    this.vgrid.clear();
    this.state.vehicles.forEach((v, id) => { const rt = this.vehRT.get(id); if (rt) this.vgrid.insert(rt.vslot, v.x, v.z); });
  }

  /** veículo deixado longe da vaga, sem ninguém por perto há VEH_RESET_MS → RESETTING (1 s) → volta à vaga, AVAILABLE */
  private resetAbandoned(now: number) {
    this.state.vehicles.forEach((v, id) => {
      const rt = this.vehRT.get(id);
      if (!rt) return;
      if (v.state === VEHICLE_STATE.RESETTING) {
        v.x = rt.spawnX; v.z = rt.spawnZ; v.heading = rt.spawnHeading; v.speed = 0; v.y = 0;
        v.state = VEHICLE_STATE.AVAILABLE; rt.idleSince = now;
        console.log(`[room] veículo ${id} voltou para a vaga`);
        return;
      }
      let nearest = Infinity;
      this.grid.forEachInRadius(v.x, v.z, RULES.vehicleResetClearM, (_sl, d) => { nearest = Math.min(nearest, d); });
      if (shouldResetVehicle({ occupant: v.occupant, x: v.x, z: v.z, spawnX: rt.spawnX, spawnZ: rt.spawnZ, idleSince: rt.idleSince }, now, nearest, VEH_RESET_MS)) {
        v.state = VEHICLE_STATE.RESETTING;
      }
    });
  }

  private rebuildGrid() {
    this.grid.clear();
    for (const r of this.rt.values()) { const p = this.state.players.get(r.actor.id); if (p) this.grid.insert(r.slot, p.x, p.z); }
  }

  /**
   * Área de interesse por cliente via grade espacial: só visita as células a ≤ R × histerese (não N×N).
   * Mesma regra de antes (entra a ≤ R, sai além de R × 1,15) + limite AOI_MAX dos mais próximos;
   * quem fica de fora do limite vai para a multidão distante.
   */
  private updateInterest(phase = 0, slices = 1, only?: string) {
    const t0 = performance.now();
    for (const [id, r] of this.rt) {
      if (only ? id !== only : r.slot % slices !== phase) continue;
      const me = this.state.players.get(id);
      if (!me) continue;
      selectInterestSlots(this.grid, r.slot, me.x, me.z, r.inView, { radius: AOI_RADIUS, hysteresis: AOI_HYST, cap: r.aoiCap }, this.scratch, this.aoiAdd, this.aoiRem, r.overflow);
      for (const sl of this.aoiAdd) { const p = this.state.players.get(this.slotIds[sl]); if (p) r.view.add(p); }
      for (const sl of this.aoiRem) { const p = this.state.players.get(this.slotIds[sl]); if (p) r.view.remove(p); }
      // veículos: mesma grade espacial (só células próximas); o do próprio jogador fica sempre
      const vc: { item: string; d: number }[] = [];
      this.vgrid.forEachInRadius(me.x, me.z, AOI_RADIUS * AOI_HYST, (vs, d) => vc.push({ item: this.vehIds[vs], d }));
      const vr = selectInterest({ candidates: vc, inView: r.vehInView, radius: AOI_RADIUS, hysteresis: AOI_HYST, always: me.vehicle ? new Set([me.vehicle]) : undefined });
      for (const vid of vr.add) { const v = this.state.vehicles.get(vid); if (v) { r.view.add(v); r.vehInView.add(vid); } }
      for (const vid of vr.remove) { const v = this.state.vehicles.get(vid); if (v) r.view.remove(v); r.vehInView.delete(vid); }
    }
    metrics.aoi(performance.now() - t0);
  }

  /**
   * multidão distante: posições compactas (binário) dos jogadores na área mas fora do limite detalhado.
   * Cada jogador é codificado uma vez (tabela por slot); cada mensagem é só cópia de bytes.
   */
  private sendCrowd(phase: number, slices: number) {
    let any = false;
    for (const r of this.rt.values()) if (r.slot % slices === phase && (r.overflow.length || r.crowdKnown.size)) { any = true; break; }
    if (!any) return;
    for (const r of this.rt.values()) {
      const p = this.state.players.get(r.actor.id);
      if (p) this.crowdTable.set(r.slot, { nid: r.nid, x: p.x, y: p.y, z: p.z, heading: p.heading, speed: p.speed, body: BODY_INDEX[p.body] ?? 0, status: p.status, vehicle: !!p.vehicle, app: { skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom } });
    }
    for (const [id, r] of this.rt) {
      if (r.slot % slices !== phase) continue;
      const c = this.clients2.get(id);
      if (!c || (!r.overflow.length && !r.crowdKnown.size)) continue;
      if (this.crowdSlots.length < r.overflow.length) this.crowdSlots = new Int32Array(r.overflow.length * 2);
      let n = 0;
      for (const sl of r.overflow) {
        if (n >= CROWD_MAX) break;
        if (!this.slotIds[sl] || r.inView.has[sl]) continue;
        this.crowdSlots[n++] = sl;
      }
      if (SIM_LOSS && Math.random() < SIM_LOSS) continue;
      const known = r.crowdKnown;
      const slotNid = this.slotNid;
      const buf = this.crowdTable.build(this.crowdSlots, n, (sl) => {
        const nid = slotNid[sl];
        if (known.has(nid)) return false;
        known.add(nid);
        return true;
      });
      c.send('crowd', buf); // lista vazia também vai: o cliente remove quem saiu
      if (!n) known.clear();
    }
  }

  private allocSlot(id: string): number {
    const sl = this.freeSlots.length ? this.freeSlots.pop()! : this.slotIds.length;
    this.slotIds[sl] = id;
    return sl;
  }

  private allocNid(): number {
    for (let i = 0; i < 65535; i++) {
      const n = this.nextNid;
      this.nextNid = this.nextNid >= 65535 ? 1 : this.nextNid + 1;
      if (!this.nids.has(n)) { this.nids.add(n); return n; }
    }
    return 0;
  }

  // ---------------------------------------------------------------- jogadores
  private applyAppearance(p: NetPlayer, o: Partial<JoinOptions>) {
    p.body = (BODIES as readonly string[]).includes(o.body as string) ? (o.body as string) : (p.body || 'homem');
    p.skin = sanitizeColor(o.skin, p.skin || 0xb98a68);
    p.hair = sanitizeColor(o.hair, p.hair || 0x1d1714);
    p.top = sanitizeColor(o.top, p.top || 0x2f6f8f);
    p.bottom = sanitizeColor(o.bottom, p.bottom || 0x2c3a52);
    p.shoes = sanitizeColor(o.shoes, p.shoes || 0xe8e8e2);
    p.accessory = (NET_ACCESSORIES as readonly string[]).includes(o.accessory as string) ? (o.accessory as string) : (p.accessory || 'nenhum');
    p.acc = sanitizeColor(o.acc, p.acc || 0x222222);
    if (o.name !== undefined) p.name = sanitizeName(o.name);
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new NetPlayer();
    p.name = sanitizeName(options?.name);
    this.applyAppearance(p, options ?? {});
    const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 5;
    p.x = this.spawn.x + Math.cos(a) * rr;
    p.z = this.spawn.z + Math.sin(a) * rr;
    // spawn nunca dentro de parede: se o ponto sorteado cruza parede a partir do spawn, usa o spawn
    if (world().walls.raycast(this.spawn.x, 0.6, this.spawn.z, p.x, 0.6, p.z) < 1) { p.x = this.spawn.x; p.z = this.spawn.z; }
    // modo de TESTE (PV_TEST=1, nunca em produção): spawn escolhido para cenas reproduzíveis de QA.
    // As regras de autoridade continuam idênticas a partir daí.
    const ts = options?.testSpawn;
    if (process.env.PV_TEST === '1' && ts && Number.isFinite(ts.x) && Number.isFinite(ts.z)) { p.x = ts.x; p.z = ts.z; }
    p.y = 0; p.heading = this.spawn.heading; p.loco = 0; p.vehicle = ''; p.interaction = 'pacifico'; p.status = STATUS.OK;
    p.nid = this.allocNid();
    this.state.players.set(client.sessionId, p);
    const view = new StateView();
    client.view = view;
    const r: PlayerRT = {
      actor: { id: client.sessionId, x: p.x, z: p.z, heading: p.heading, mode: 'pacifico', status: 0, vehicle: '', immuneUntil: 0, lastActionAt: -1e12, actionTimes: [], lastDown: 0 },
      last: { x: p.x, y: p.y, z: p.z, t: Date.now(), seq: -1 },
      view, inView: makeSlotView(), vehInView: new Set(), rest: null, pendingIn: 0,
      nid: p.nid, overflow: [], crowdKnown: new Set(), slot: this.allocSlot(client.sessionId),
      aoiCap: clientCap(options?.aoiMax),
    };
    this.slotNid[r.slot] = p.nid;
    this.rt.set(client.sessionId, r);
    this.clients2.set(client.sessionId, client);
    this.grid.insert(r.slot, p.x, p.z);
    this.updateInterest(0, 1, client.sessionId); // só o novo cliente; os demais o encontram na sua fatia
    client.send('spawn', { x: p.x, y: p.y, z: p.z, heading: p.heading, sessionId: client.sessionId, policy: this.interactionPolicy, seed: this.state.seed });
    metrics.join(client.sessionId);
    console.log(`[room] entrou ${client.sessionId} (${p.name}, ${p.body}) — total ${this.state.players.size}`);
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p?.vehicle) {
      const v = this.state.vehicles.get(p.vehicle);
      if (v) { v.occupant = ''; v.speed = 0; v.state = VEHICLE_STATE.AVAILABLE; const rt = this.vehRT.get(p.vehicle); if (rt) rt.idleSince = Date.now(); }
    }
    const leaving = this.rt.get(client.sessionId);
    if (leaving) {
      const { nid, slot } = leaving;
      if (nid) this.nids.delete(nid);
      // slot e nid podem ser reaproveitados: ninguém pode continuar "vendo" o antigo dono
      for (const r of this.rt.values()) {
        r.crowdKnown.delete(nid);
        if (r.inView.has[slot]) { r.inView.has[slot] = 0; r.inView.list = r.inView.list.filter((x) => x !== slot); }
      }
      this.grid.remove(slot);
      this.slotIds[slot] = '';
      this.freeSlots.push(slot);
    }
    this.state.players.delete(client.sessionId);
    this.rt.delete(client.sessionId);
    this.clients2.delete(client.sessionId);
    metrics.leave(client.sessionId);
    console.log(`[room] saiu ${client.sessionId} — total ${this.state.players.size}`);
  }

  private onMove(client: Client, raw: unknown) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    const m = unpackMove(raw);
    if (!p || !r || !m) return;
    if (m.seq <= r.last.seq) return; // fora de ordem/duplicada
    if (p.status !== STATUS.OK) { r.last.seq = m.seq; return; } // caído: servidor ignora (posição de repouso é do servidor)
    const veh = p.vehicle ? this.state.vehicles.get(p.vehicle) : undefined;
    const mode: MoveMode = veh ? (veh.kind as MoveMode) : 'foot'; // modo vem do SERVIDOR, não do cliente
    const now = Date.now();
    const res = validateMoveInWorld(world().walls, r.last, { ...m, mode }, now);
    const dtS = Math.max(0.05, (now - r.last.t) / 1000);
    const measured = Math.hypot(res.x - r.last.x, res.z - r.last.z) / dtS;
    const prevX = r.last.x, prevZ = r.last.z;
    if (veh) {
      // MODO PACÍFICO: veículo não atravessa nem derruba ninguém — para antes de encostar (validado aqui)
      const blk = this.vehicleBlockers(client.sessionId, veh.kind as VehicleKind, prevX, prevZ, res.x, res.z);
      if (blk.length) {
        const b = vehicleBlock(veh.kind as VehicleKind, { x: prevX, z: prevZ }, { x: res.x, z: res.z }, m.heading, blk);
        if (b.blocked) { res.x = b.x; res.z = b.z; res.ok = false; res.reason = 'bloqueado'; }
      }
    }
    p.x = res.x; p.y = res.y; p.z = res.z;
    p.heading = m.heading;
    p.speed = Math.min(Math.abs(m.speed), MAX_SPEED[mode]);
    p.loco = Math.max(0, Math.min(4, m.loco | 0));
    r.actor.x = res.x; r.actor.z = res.z; r.actor.heading = m.heading;
    r.last = { x: res.x, y: res.y, z: res.z, t: now, seq: m.seq };
    if (!res.ok) {
      client.send('correct', [res.x, res.y, res.z, m.seq, res.reason ?? '']);
      metrics.correction();
    }
    if (veh) {
      veh.x = res.x; veh.z = res.z; veh.y = res.y; veh.heading = m.heading; veh.speed = measured;
      if (veh.kind === 'car' || veh.kind === 'moto') {
        const box = VEHICLE_BOX[veh.kind as VehicleKind];
        this.checkImpacts(client.sessionId, { x: res.x, z: res.z, px: prevX, pz: prevZ, heading: m.heading, speed: measured, len: box.len, width: box.width });
      }
    }
  }

  private onMode(client: Client, m: Mode) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    if (!p || !r || (m !== 'pacifico' && m !== 'interacao')) return;
    if (m === 'interacao' && this.interactionPolicy === 'pacifico') { client.send('mode_denied', 'evento_pacifico'); return; }
    if (p.status !== STATUS.OK) { client.send('mode_denied', 'estado'); return; }
    p.interaction = m; r.actor.mode = m;
    client.send('mode_ok', m);
  }

  // ---------------------------------------------------------------- veículos
  private onEnter(client: Client, id: string, seq?: number) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    const v = typeof id === 'string' ? this.state.vehicles.get(id) : undefined;
    if (!p || !r) return;
    const c = canEnter({ x: r.last.x, z: r.last.z, status: p.status, vehicle: p.vehicle }, v ? { x: v.x, z: v.z, occupant: v.occupant, heading: v.heading, kind: v.kind } : undefined);
    if (!c.ok) { client.send('enter_denied', { id, reason: c.reason }); metrics.denied(); console.log(`[room] entrar negado ${client.sessionId} → ${JSON.stringify(id)}: ${c.reason}`); return; }
    v!.occupant = client.sessionId;
    v!.state = VEHICLE_STATE.OCCUPIED;
    p.vehicle = id;
    r.actor.vehicle = id;
    // o ocupante "assume" a posição do veículo (autoritativa)
    // movimentos a pé ainda em trânsito (seq ≤ seq do pedido) passam a ser descartados
    r.last = { x: v!.x, y: v!.y, z: v!.z, t: Date.now(), seq: Math.max(r.last.seq, Number.isFinite(seq) ? (seq as number) : r.last.seq) };
    p.x = v!.x; p.z = v!.z;
    client.send('enter_ok', { id, x: v!.x, z: v!.z, heading: v!.heading });
    console.log(`[room] ${client.sessionId} entrou em ${id}`);
  }

  private onExit(client: Client, seq?: number) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    if (!p || !r || !p.vehicle) return;
    const vid = p.vehicle;
    const v = this.state.vehicles.get(vid);
    p.vehicle = ''; r.actor.vehicle = '';
    if (v) {
      v.occupant = ''; v.speed = 0; v.state = VEHICLE_STATE.AVAILABLE;
      const vrt = this.vehRT.get(vid);
      if (vrt) vrt.idleSince = Date.now();
      // sai pelo lado esquerdo (motorista); se houver parede, pelo direito; senão no lugar
      const side = v.kind === 'car' ? 1.6 : v.kind === 'moto' ? 1.0 : 0.9;
      const cands = [[-Math.cos(v.heading), Math.sin(v.heading)], [Math.cos(v.heading), -Math.sin(v.heading)]];
      let out = { x: v.x, z: v.z };
      for (const [dx, dz] of cands) {
        const t = { x: v.x + dx * side, z: v.z + dz * side };
        if (world().walls.raycast(v.x, 0.6, v.z, t.x, 0.6, t.z) >= 1) { out = t; break; }
      }
      p.x = out.x; p.z = out.z;
      r.last = { x: out.x, y: 0, z: out.z, t: Date.now(), seq: Math.max(r.last.seq, Number.isFinite(seq) ? (seq as number) : r.last.seq) };
      client.send('exit_ok', { x: out.x, z: out.z });
    }
  }

  // ---------------------------------------------------------------- interação física
  private knockdown(targetId: string, fromX: number, fromZ: number, distance: number, kind: 'push' | 'impact', by: string, strength: number) {
    const tp = this.state.players.get(targetId);
    const tr = this.rt.get(targetId);
    if (!tp || !tr) return;
    const out = knockdownOutcome({ x: fromX, z: fromZ }, { x: tr.last.x, z: tr.last.z }, distance, world().walls, tp.heading);
    const now = Date.now();
    tp.status = STATUS.DOWN; tr.actor.status = STATUS.DOWN; tr.actor.lastDown = now;
    tr.rest = { x: out.rx, z: out.rz };
    tp.x = out.rx; tp.z = out.rz; tp.speed = 0;
    this.broadcast('knock', { target: targetId, by, kind, dx: out.dx, dz: out.dz, strength, rx: out.rx, rz: out.rz, downMs: RULES.downMs, getupMs: RULES.getupMs });
    metrics.knock(kind);
    console.log(`[room] queda (${kind}) ${targetId} por ${by} força ${strength.toFixed(1)}`);
  }

  private onPush(client: Client, targetId: string) {
    const r = this.rt.get(client.sessionId);
    const t = typeof targetId === 'string' ? this.rt.get(targetId) : undefined;
    if (!r) return;
    const now = Date.now();
    const v = canPush(r.actor, t?.actor, now, world().walls);
    if (!v.ok) { client.send('push_denied', v.reason); metrics.denied(); console.log(`[room] empurrão negado ${client.sessionId} → ${targetId}: ${v.reason}`); return; }
    r.actor.lastActionAt = now;
    r.actor.actionTimes = [...r.actor.actionTimes.filter((x) => now - x < RULES.rateWindowMs), now];
    this.broadcast('action', { by: client.sessionId, type: 'push', target: targetId });
    this.knockdown(targetId, r.actor.x, r.actor.z, RULES.pushDistance, 'push', client.sessionId, 1);
  }

  /**
   * jogadores a pé que BLOQUEIAM este veículo: todos, exceto quando o atropelamento é permitido (motorista e alvo em
   * modo interação, alvo de pé e sem imunidade, e só carro/moto). Candidatos pela grade espacial.
   */
  private vehicleBlockers(driverId: string, kind: VehicleKind, px: number, pz: number, x: number, z: number) {
    const d = this.rt.get(driverId);
    const now = Date.now();
    const out: { x: number; z: number }[] = [];
    const reach = Math.hypot(x - px, z - pz) / 2 + VEHICLE_BOX[kind].len / 2 + 2;
    this.grid.forEachInRadius((x + px) / 2, (z + pz) / 2, reach, (sl) => {
      const id = this.slotIds[sl];
      if (id === driverId) return;
      const a = this.rt.get(id)?.actor;
      if (!a || a.vehicle) return;
      const canHit = (kind === 'car' || kind === 'moto') && !!d && impactAllowed(d.actor.mode, a.mode) && a.status === STATUS.OK && now >= a.immuneUntil;
      if (!canHit) out.push({ x: a.x, z: a.z });
    });
    return out;
  }

  private checkImpacts(driverId: string, car: { x: number; z: number; px: number; pz: number; heading: number; speed: number; len?: number; width?: number }) {
    const d = this.rt.get(driverId);
    if (!d || d.actor.mode !== 'interacao') return; // motorista também precisa estar em modo interação
    const now = Date.now();
    // candidatos pela grade: círculo que cobre o trajeto do tick (anti-tunelamento) + caixa do carro + folga
    const mx = (car.x + car.px) / 2, mz = (car.z + car.pz) / 2;
    const reach = Math.hypot(car.x - car.px, car.z - car.pz) / 2 + 6;
    const cands: string[] = [];
    this.grid.forEachInRadius(mx, mz, reach, (sl) => cands.push(this.slotIds[sl]));
    for (const id of cands) {
      const r = this.rt.get(id);
      if (!r || id === driverId) continue;
      const a = r.actor;
      if (a.mode !== 'interacao' || a.status !== STATUS.OK || a.vehicle || now < a.immuneUntil) continue;
      const hit = vehicleImpact(car, { x: a.x, z: a.z });
      if (hit.hit) this.knockdown(id, car.x - Math.sin(car.heading) * 3, car.z - Math.cos(car.heading) * 3, hit.strength, 'impact', driverId, hit.strength);
    }
  }
}
