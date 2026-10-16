/**
 * Sala da Presidente Vargas — servidor AUTORITATIVO (desenvolvimento/local).
 *
 *  posição      cliente propõe; servidor valida velocidade por modo, limites e PAREDES (colisão 2D) e corrige
 *  veículos     registro no servidor; entrar/sair validados; 1 ocupante por veículo; posição vem do ocupante validado
 *  interação    modo por jogador (política do evento); empurrão e impacto de veículo validados aqui
 *  mundo        relógio global, semente, semáforos (função do relógio) e trânsito GLOBAL simulado aqui
 *  interesse    StateView por cliente (jogadores/veículos a ≤ AOI_RADIUS); trânsito só da área do cliente
 *  rede adversa PV_JITTER / PV_LOSS (ms / 0–1) além de COLYSEUS_LATENCY (RTT nativo)
 */
import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { WorldState, NetPlayer, NetVehicle } from './state.ts';
import { loadWorld, type ServerWorld } from './world.ts';
import { BODIES, NET_ACCESSORIES, MAX_SPEED, sanitizeColor, sanitizeName, type JoinOptions, type MoveMode } from '../../src/net/protocol.ts';
import { validateMoveInWorld } from '../../src/net/authority.ts';
import { RULES, STATUS, canPush, canEnter, knockdownOutcome, vehicleImpact, unpackMove, type Actor, type Mode } from '../../src/net/rules.ts';
import { TrafficSim } from '../../src/traffic/TrafficSim.ts';
import { SignalController } from '../../src/traffic/SignalController.ts';
import { metrics } from './metrics.ts';

const AOI_RADIUS = Number(process.env.PV_AOI ?? 220); // m — jogadores/veículos visíveis
const TRAFFIC_RADIUS = 380; // m — trânsito enviado a cada cliente
const TRAFFIC_HZ = 2;
const TRAFFIC_POP = Number(process.env.PV_TRAFFIC ?? 220);
const SIM_JITTER = Number(process.env.PV_JITTER ?? 0);
const SIM_LOSS = Number(process.env.PV_LOSS ?? 0);

let WORLD: ServerWorld | null = null;
const world = () => (WORLD ??= loadWorld());

interface PlayerRT {
  actor: Actor;
  last: { x: number; y: number; z: number; t: number; seq: number };
  view: StateView;
  inView: Set<string>;
  vehInView: Set<string>;
  rest: { x: number; z: number } | null;
  pendingIn: number; // processamento ordenado com jitter simulado
}

export class PresidenteVargasRoom extends Room<{ state: WorldState }> {
  maxClients = 200;
  maxMessagesPerSecond = 60;
  state = new WorldState();
  private rt = new Map<string, PlayerRT>();
  private clients2 = new Map<string, Client>();
  private traffic!: TrafficSim;
  private signals!: SignalController;
  private interactionPolicy: 'pacifico' | 'opcional' = 'opcional';
  private spawn = { x: -580, z: 280, heading: 1.75 };
  private trafficAcc = 0;
  private aoiAcc = 0;

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
      v.kind = s.kind; v.x = s.x; v.z = s.z; v.y = 0; v.heading = s.heading; v.speed = 0; v.occupant = '';
      this.state.vehicles.set(s.id, v);
    }
    // trânsito global determinístico pela semente + semáforos pelo relógio do servidor
    this.signals = new SignalController(W.traffic.junctions);
    this.traffic = new TrafficSim(W.traffic.lanes, this.state.seed);
    this.traffic.signals = (j, ph) => this.signals.state(j, ph);
    this.traffic.populateGlobal(TRAFFIC_POP);
    this.patchRate = 50; // 20 Hz
    this.setSimulationInterval((dt) => this.tick(dt), 100); // 10 Hz
    console.log(`[room] ${this.roomId} evento=${ev} (interação: ${this.interactionPolicy}) trânsito=${this.traffic.vehicles.length} veículos AOI=${AOI_RADIUS} m`);
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
    this.signals.setTime(now / 1000);
    // trânsito: obstáculos = jogadores a pé e veículos utilizáveis (parados ou dirigidos)
    const obstacles: { x: number; z: number; r: number }[] = [];
    this.state.players.forEach((p) => { if (!p.vehicle) obstacles.push({ x: p.x, z: p.z, r: 0.9 }); });
    this.state.vehicles.forEach((v) => { if (v.kind === 'car') obstacles.push({ x: v.x, z: v.z, r: 1.6 }); });
    this.traffic.step(dt, obstacles, true);
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
    // área de interesse (4 Hz)
    this.aoiAcc += dtMs;
    if (this.aoiAcc >= 250) { this.aoiAcc = 0; this.updateInterest(); }
    // trânsito por área de interesse (2 Hz)
    this.trafficAcc += dtMs;
    if (this.trafficAcc >= 1000 / TRAFFIC_HZ) {
      this.trafficAcc = 0;
      for (const [id, c] of this.clients2) {
        const p = this.state.players.get(id);
        if (!p) continue;
        if (SIM_LOSS && Math.random() < SIM_LOSS) continue;
        const buf = this.traffic.packAround(p.x, p.z, TRAFFIC_RADIUS);
        c.send('traffic', buf);
      }
    }
    metrics.tick(performance.now() - t0, this.state.players.size);
  }

  private updateInterest() {
    for (const [id, r] of this.rt) {
      const me = this.state.players.get(id);
      if (!me) continue;
      this.state.players.forEach((p, pid) => {
        const near = pid === id || Math.hypot(p.x - me.x, p.z - me.z) <= AOI_RADIUS;
        const has = r.inView.has(pid);
        if (near && !has) { r.view.add(p); r.inView.add(pid); }
        else if (!near && has && Math.hypot(p.x - me.x, p.z - me.z) > AOI_RADIUS * 1.15) { r.view.remove(p); r.inView.delete(pid); } // histerese
      });
      this.state.vehicles.forEach((v, vid) => {
        const near = Math.hypot(v.x - me.x, v.z - me.z) <= AOI_RADIUS || v.occupant === id;
        const has = r.vehInView.has(vid);
        if (near && !has) { r.view.add(v); r.vehInView.add(vid); }
        else if (!near && has && Math.hypot(v.x - me.x, v.z - me.z) > AOI_RADIUS * 1.15) { r.view.remove(v); r.vehInView.delete(vid); }
      });
    }
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
    this.state.players.set(client.sessionId, p);
    const view = new StateView();
    client.view = view;
    const r: PlayerRT = {
      actor: { id: client.sessionId, x: p.x, z: p.z, heading: p.heading, mode: 'pacifico', status: 0, vehicle: '', immuneUntil: 0, lastActionAt: -1e12, actionTimes: [], lastDown: 0 },
      last: { x: p.x, y: p.y, z: p.z, t: Date.now(), seq: -1 },
      view, inView: new Set(), vehInView: new Set(), rest: null, pendingIn: 0,
    };
    this.rt.set(client.sessionId, r);
    this.clients2.set(client.sessionId, client);
    this.updateInterest();
    client.send('spawn', { x: p.x, y: p.y, z: p.z, heading: p.heading, sessionId: client.sessionId, policy: this.interactionPolicy, seed: this.state.seed });
    metrics.join(client.sessionId);
    console.log(`[room] entrou ${client.sessionId} (${p.name}, ${p.body}) — total ${this.state.players.size}`);
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p?.vehicle) {
      const v = this.state.vehicles.get(p.vehicle);
      if (v) { v.occupant = ''; v.speed = 0; }
    }
    this.state.players.delete(client.sessionId);
    this.rt.delete(client.sessionId);
    this.clients2.delete(client.sessionId);
    for (const r of this.rt.values()) r.inView.delete(client.sessionId);
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
      if (veh.kind === 'car') this.checkImpacts(client.sessionId, { x: res.x, z: res.z, px: prevX, pz: prevZ, heading: m.heading, speed: measured });
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
    const v = this.state.vehicles.get(p.vehicle);
    p.vehicle = ''; r.actor.vehicle = '';
    if (v) {
      v.occupant = ''; v.speed = 0;
      // sai pelo lado esquerdo (motorista); se houver parede, pelo direito; senão no lugar
      const side = v.kind === 'car' ? 1.6 : 0.9;
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

  private checkImpacts(driverId: string, car: { x: number; z: number; px: number; pz: number; heading: number; speed: number }) {
    const d = this.rt.get(driverId);
    if (!d || d.actor.mode !== 'interacao') return; // motorista também precisa estar em modo interação
    const now = Date.now();
    for (const [id, r] of this.rt) {
      if (id === driverId) continue;
      const a = r.actor;
      if (a.mode !== 'interacao' || a.status !== STATUS.OK || a.vehicle || now < a.immuneUntil) continue;
      const hit = vehicleImpact(car, { x: a.x, z: a.z });
      if (hit.hit) this.knockdown(id, car.x - Math.sin(car.heading) * 3, car.z - Math.cos(car.heading) * 3, hit.strength, 'impact', driverId, hit.strength);
    }
  }
}
