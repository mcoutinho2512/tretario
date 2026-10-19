/**
 * Rodada 12 — HOST SIMULADO (sem Colyseus) para testes e para a ferramenta de humanização (server/tools/
 * autonomous_report.ts). Usa as MESMAS regras puras da sala: validateMove/validateMoveInWorld (velocidade + paredes),
 * validateAction/applyAction (ações sociais), validateProp, canEnter (veículos) e o CombatSystem DE VERDADE (stamina,
 * cooldown, alcance, arco, política, quedas). Relógio próprio (avança por `advance`), humanos roteirizados.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentLook, AutonomousHost, EntityState, Hotspot, HumanView, VehicleView } from './host';
import type { WallGrid } from '../../../src/physics/walls';
import { validateMoveInWorld } from '../../../src/net/authority';
import { MAX_SPEED, validateMove, type MoveMode } from '../../../src/net/protocol';
import { canEnter, RULES, STATUS, VEHICLE_STATE } from '../../../src/net/rules';
import { applyAction, applyProp, cancelsOnMove, onceFinished, validateAction, validateProp, type ActionActor } from '../../../src/social/actionRules';
import { CombatSystem } from '../combat/CombatSystem';
import { CombatTable, parseCombatData } from '../../../src/combat/data';
import { PROP_BY_ID } from '../../../src/social/props';
import { RALLY_SHAPE } from '../../../src/social/rally';

export interface SimEntity {
  id: string; nid: number; human: boolean; look?: AgentLook;
  x: number; z: number; heading: number; speed: number; loco: number; status: number; vehicle: string;
  last: { x: number; y: number; z: number; t: number }; social: ActionActor; downAt: number; rest: { x: number; z: number } | null; look_: number;
}

export interface SimHostOptions {
  walls?: WallGrid | null;
  bounds?: [number, number, number, number];
  axis?: [number, number][];
  hotspots?: Hotspot[];
  vehicles?: { id: string; kind: string; x: number; z: number; heading: number }[];
  /** relógio inicial (ms) */
  t0?: number;
}

export class SimHost implements AutonomousHost {
  t: number;
  readonly ents = new Map<string, SimEntity>();
  readonly vehicles = new Map<string, VehicleView>();
  private nextNid = 1;
  private hs: Hotspot[];
  readonly bounds: readonly [number, number, number, number];
  readonly axis: readonly (readonly [number, number])[];
  readonly cs: CombatSystem;
  /** o sistema de autônomos ligado (mensagens de "conexão" e eventos de confronto) */
  sys: { onSelfMessage(id: string, type: string, msg: unknown): void; onCombat(kind: 'act' | 'hit', by: number, tgt: number, r: string, now?: number): void } | null = null;
  /** HUMANO acertou um autônomo (a sala chama dyn.onAggression) */
  onHumanHit: ((by: string, target: string, x: number, z: number) => void) | null = null;
  readonly log = { moves: 0, corrections: 0, acts: 0, actDenied: 0, enters: 0, exits: 0, combatOk: 0, combatDenied: 0, knocks: 0, spawns: 0, despawns: 0, impactsOnHumans: 0, reasons: {} as Record<string, number> };

  constructor(private o: SimHostOptions = {}) {
    this.t = o.t0 ?? 1_000_000;
    this.bounds = o.bounds ?? [-2000, -2000, 2000, 2000];
    this.axis = o.axis ?? [[-1000, 0], [1000, 0]];
    this.hs = o.hotspots ?? [];
    for (const v of o.vehicles ?? []) this.vehicles.set(v.id, { ...v, occupant: '', state: VEHICLE_STATE.AVAILABLE });
    const data = parseCombatData(JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/gameplay/combat.json', import.meta.url)), 'utf8')));
    this.cs = new CombatSystem(new CombatTable(data), {
      actor: (sid) => { const e = this.ents.get(sid); return e ? { x: e.x, z: e.z, heading: e.heading, status: e.status, vehicle: e.vehicle, platform: '', mode: 'pacifico', prop: e.social.prop, immuneUntil: 0, nid: e.nid } : undefined; },
      forEachNear: (x, z, r, fn) => { for (const e of this.ents.values()) if (Math.hypot(e.x - x, e.z - z) <= r) fn(e.id); },
      walls: o.walls ?? null,
      zoneOf: () => 'SIM',
      zoneDef: () => ({ combatPolicy: 'COMBAT' as const }),
      consent: 'none',
      groupKey: () => null,
      propKind: (id) => PROP_BY_ID.get(id)?.kind,
      can: () => true,
      send: (sid, type, msg) => { if (!this.ents.get(sid)?.human) this.sys?.onSelfMessage(sid, type, msg); },
      sendAoi: (_s, type, msg) => this.combatMsg(type, msg),
      sendNear: () => {},
      setStatus: (sid, st) => { const e = this.ents.get(sid); if (e) e.status = st; },
      setFx: () => {},
      place: (sid, x, z) => { const e = this.ents.get(sid); if (e) { e.x = x; e.z = z; e.last = { ...e.last, x, z, t: this.t }; } },
      knockdown: (sid, fx, fz, d) => {
        const e = this.ents.get(sid); if (!e) return;
        const l = Math.hypot(e.x - fx, e.z - fz) || 1;
        e.status = STATUS.DOWN; e.downAt = this.t; e.speed = 0; e.rest = { x: e.x + ((e.x - fx) / l) * Math.min(d, 1.5), z: e.z + ((e.z - fz) / l) * Math.min(d, 1.5) };
        e.x = e.rest.x; e.z = e.rest.z; this.cs.onKnockdown(sid); this.log.knocks++;
        if (e.human) this.log.impactsOnHumans++;
      },
      emit: () => {},
      airborne: () => false,
      now: () => this.t,
    });
  }

  private combatMsg(type: string, msg: unknown) {
    const m = msg as { by?: number; tgt?: number; r?: string };
    if (type === 'cbt_act' && typeof m.by === 'number') this.sys?.onCombat('act', m.by, 0, '', this.t);
    else if (type === 'cbt_hit' && typeof m.by === 'number') {
      this.sys?.onCombat('hit', m.by, m.tgt ?? 0, m.r ?? 'hit', this.t);
      // como a sala: HUMANO acertou AUTÔNOMO → o diretor sabe (onAggression)
      if (m.r === 'hit' && this.onHumanHit) {
        let by: SimEntity | undefined, tg: SimEntity | undefined;
        for (const e of this.ents.values()) { if (e.nid === m.by) by = e; if (e.nid === m.tgt) tg = e; }
        if (by?.human && tg && !tg.human) this.onHumanHit(by.id, tg.id, tg.x, tg.z);
      }
    }
  }

  /** avança o relógio e as regras do mundo (quedas, ações `once`, confronto) — como o tick da sala */
  advance(ms: number) {
    this.t += ms;
    for (const e of this.ents.values()) {
      if (e.status === STATUS.DOWN && this.t >= e.downAt + RULES.downMs) e.status = STATUS.GETUP;
      if (e.status === STATUS.GETUP && this.t >= e.downAt + RULES.downMs + RULES.getupMs) { e.status = STATUS.OK; e.last = { x: e.x, y: 0, z: e.z, t: this.t }; }
      if (e.social.act && (e.status !== STATUS.OK || onceFinished(e.social, this.t))) { e.social.act = 0; e.social.actAt = this.t; }
    }
    this.cs.update(ms);
  }

  now() { return this.t; }
  clear(ax: number, az: number, bx: number, bz: number) { return !this.o.walls || this.o.walls.raycast(ax, 0.6, az, bx, 0.6, bz) >= 1; }
  hotspots() { return this.hs; }
  setHotspots(h: Hotspot[]) { this.hs = h; }

  // ---------------------------------------------------------------- humanos roteirizados
  addHuman(id: string, x: number, z: number, heading = 0): SimEntity {
    const e = this.entity(id, true, x, z, heading);
    this.cs.join(id);
    return e;
  }
  moveHuman(id: string, x: number, z: number, heading?: number) {
    const e = this.ents.get(id); if (!e || e.status !== 0) return;
    const d = Math.hypot(x - e.x, z - e.z);
    e.heading = heading ?? (d > 1e-3 ? Math.atan2(x - e.x, z - e.z) : e.heading);
    e.speed = d / 0.1; e.x = x; e.z = z;
  }
  humanAttack(id: string, action: number, heading: number) { return this.cs.request(id, { a: action, h: heading }).ok; }
  humans(): readonly HumanView[] {
    const out: HumanView[] = [];
    for (const e of this.ents.values()) if (e.human) out.push({ id: e.id, nid: e.nid, x: e.x, z: e.z, heading: e.heading, speed: e.speed, vehicle: !!e.vehicle, status: e.status });
    return out;
  }

  private entity(id: string, human: boolean, x: number, z: number, heading: number, look?: AgentLook): SimEntity {
    const e: SimEntity = { id, nid: this.nextNid++, human, look, x, z, heading, speed: 0, loco: 0, status: 0, vehicle: '', last: { x, y: 0, z, t: this.t }, social: { act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [], ent: {} }, downAt: 0, rest: null, look_: 0 };
    this.ents.set(id, e);
    return e;
  }

  // ---------------------------------------------------------------- AutonomousHost
  vehiclesNear(x: number, z: number, r: number, out: VehicleView[]) {
    out.length = 0;
    for (const v of this.vehicles.values()) if (Math.hypot(v.x - x, v.z - z) <= r) out.push(v);
    return out;
  }
  spawn(id: string, look: AgentLook, x: number, z: number, heading: number): number {
    if (this.ents.has(id)) return this.ents.get(id)!.nid;
    const e = this.entity(id, false, x, z, heading, look);
    if (look.prop && validateProp(e.social, look.prop, look.design, this.t).ok) applyProp(e.social, look.prop, look.design, this.t);
    this.cs.join(id);
    this.log.spawns++;
    return e.nid;
  }
  despawn(id: string) {
    const e = this.ents.get(id);
    if (!e) return;
    if (e.vehicle) { const v = this.vehicles.get(e.vehicle); if (v) { v.occupant = ''; v.state = VEHICLE_STATE.AVAILABLE; } }
    this.cs.leave(id); this.ents.delete(id); this.log.despawns++;
  }
  state(id: string): EntityState | undefined { const e = this.ents.get(id); return e ? { x: e.x, z: e.z, heading: e.heading, status: e.status, vehicle: e.vehicle, act: e.social.act, prop: e.social.prop } : undefined; }
  move(id: string, x: number, z: number, heading: number, speed: number, loco: number) {
    const e = this.ents.get(id);
    if (!e || e.status !== STATUS.OK) return { x: e?.x ?? x, z: e?.z ?? z, ok: false };
    const v = e.vehicle ? this.vehicles.get(e.vehicle) : undefined;
    const mode: MoveMode = v ? (v.kind as MoveMode) : 'foot';
    const msg = { x, y: 0, z, heading, speed, loco, mode, seq: 0 };
    const res = this.o.walls ? validateMoveInWorld(this.o.walls, e.last, msg, this.t) : validateMove(e.last, msg, this.t);
    if (e.social.act && cancelsOnMove(e.social.act, Math.hypot(res.x - e.x, res.z - e.z))) { e.social.act = 0; e.social.actAt = this.t; }
    e.x = res.x; e.z = res.z; e.heading = heading; e.speed = Math.min(Math.abs(speed), MAX_SPEED[mode]); e.loco = loco;
    e.last = { x: res.x, y: 0, z: res.z, t: this.t };
    if (v) { v.x = res.x; v.z = res.z; v.heading = heading; }
    this.log.moves++;
    if (!res.ok) { this.log.corrections++; const k = res.reason ?? '?'; this.log.reasons[k] = (this.log.reasons[k] ?? 0) + 1; }
    return { x: res.x, z: res.z, ok: res.ok };
  }
  act(id: string, a: number, _v: number) {
    const e = this.ents.get(id); if (!e) return false;
    const s = e.social; s.status = e.status; s.vehicle = e.vehicle;
    const v = validateAction(s, a, this.t);
    if (!v.ok) { this.log.actDenied++; return false; }
    applyAction(s, a, this.t); this.log.acts++;
    return true;
  }
  prop(id: string, p: number, d: number) {
    const e = this.ents.get(id); if (!e) return false;
    if (!validateProp(e.social, p, d, this.t).ok) return false;
    applyProp(e.social, p, d, this.t); return true;
  }
  look(id: string, nid: number) { const e = this.ents.get(id); if (e) e.look_ = nid; }
  enter(id: string, vid: string) {
    const e = this.ents.get(id), v = this.vehicles.get(vid);
    if (!e) return false;
    const c = canEnter({ x: e.x, z: e.z, status: e.status, vehicle: e.vehicle }, v ? { x: v.x, z: v.z, occupant: v.occupant, heading: v.heading, kind: v.kind } : undefined);
    if (!c.ok || !v || v.state === VEHICLE_STATE.RESETTING) return false;
    v.occupant = id; v.state = VEHICLE_STATE.OCCUPIED; e.vehicle = vid; e.social.act = 0;
    e.x = v.x; e.z = v.z; e.last = { x: v.x, y: 0, z: v.z, t: this.t };
    this.log.enters++;
    return true;
  }
  exit(id: string) {
    const e = this.ents.get(id); if (!e || !e.vehicle) return false;
    const v = this.vehicles.get(e.vehicle);
    e.vehicle = '';
    if (v) { v.occupant = ''; v.state = VEHICLE_STATE.AVAILABLE; e.x = v.x + Math.cos(v.heading) * 1.4; e.z = v.z - Math.sin(v.heading) * 1.4; }
    e.last = { x: e.x, y: 0, z: e.z, t: this.t };
    this.log.exits++;
    this.sys?.onSelfMessage(id, 'exit_ok', { x: e.x, z: e.z });
    return true;
  }
  combat_(id: string, a: number, h: number) { return this.cs.request(id, { a, h }).ok; }
  combat(id: string, a: number, h: number) { const ok = this.combat_(id, a, h); if (ok) this.log.combatOk++; else this.log.combatDenied++; return ok; }
}

/** pontos de concentração do manifesto (palco, caminhões, telões, spawn) — mesmos dados que a sala usa */
export function manifestHotspots(m: { eventSpots?: { id: string; kind: string; x: number; z: number; heading: number }[]; spawn?: { p: [number, number] } }): Hotspot[] {
  const out: Hotspot[] = [];
  for (const s of m.eventSpots ?? []) {
    if (s.kind === 'stage') { const S = RALLY_SHAPE.stage; out.push({ id: s.id, kind: 'stage', x: s.x + Math.sin(s.heading) * S.front, z: s.z + Math.cos(s.heading) * S.front, inner: S.inner, radius: S.radius, weight: 1.3, heading: s.heading }); }
    else if (s.kind === 'truck') { const T = RALLY_SHAPE.truck; out.push({ id: s.id, kind: 'truck', x: s.x, z: s.z, inner: T.inner, radius: T.radius, weight: 0.8 }); }
    else if (s.kind === 'screen') out.push({ id: s.id, kind: 'screen', x: s.x + Math.sin(s.heading) * 10, z: s.z + Math.cos(s.heading) * 10, inner: 4, radius: 14, weight: 0.6, heading: s.heading });
  }
  if (m.spawn) out.push({ id: 'spawn', kind: 'spawn', x: m.spawn.p[0], z: m.spawn.p[1], inner: 6, radius: 22, weight: 0.7 });
  return out;
}
