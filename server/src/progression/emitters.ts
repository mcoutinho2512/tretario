/**
 * Emissores de gameplay do agente C (rodada 9): `distance`, `rally_visit`, `action`, `prop`, `vehicle_enter`,
 * `trio_board`, `graffiti`, `chat`. A sala chama UMA linha nos caminhos de ACEITE (onMove/onAct/onProp/onEnter/onBoard,
 * gf_new ok, chat ok) — aqui fica a regra, sem Colyseus:
 *  distance     soma o deslocamento ACEITO por modo e emite em lotes ≥ 10 m; salto maior que a velocidade máxima do
 *               modo (teleporte de QA, correção, queda) não conta
 *  rally_visit  permanência ≥ RALLY_DWELL_MS dentro do anel de uma concentração (palco, caminhão, trio, carro de som —
 *               mesmas formas de src/social/rally.ts RALLY_SHAPE); uma vez por estadia (sair e voltar conta de novo,
 *               com o teto por minuto do ProgressionService)
 */
import type { GameplayBus } from '../gameplay/bus';
import type { GameplayEvent } from '../../../src/gameplay/events';
import { ACTION_BY_ID } from '../../../src/social/actions';
import { PROP_BY_ID } from '../../../src/social/props';
import { MAX_SPEED } from '../../../src/net/protocol';
import { RALLY_SHAPE } from '../../../src/social/rally';

export const DISTANCE_BATCH_M = 10;
export const RALLY_DWELL_MS = Number(process.env.PV_RALLY_DWELL_MS ?? 8000);
type DistMode = Extract<GameplayEvent, { type: 'distance' }>['mode'];
const DIST_MODES: ReadonlySet<string> = new Set(['foot', 'bicycle', 'scooter', 'car', 'moto']);

export class DistanceMeter {
  private acc = new Map<string, Map<DistMode, number>>();
  /** passo aceito; devolve o lote a emitir (≥ batch) ou null */
  add(sid: string, mode: string, meters: number, dtS: number, batch = DISTANCE_BATCH_M): { mode: DistMode; meters: number } | null {
    if (!DIST_MODES.has(mode) || !(meters > 0)) return null;
    const vmax = MAX_SPEED[mode as DistMode] ?? MAX_SPEED.foot;
    if (meters > vmax * Math.max(0.05, Math.min(1.5, dtS)) * 1.5 + 1) return null; // salto: não é caminhada
    let m = this.acc.get(sid);
    if (!m) this.acc.set(sid, (m = new Map()));
    const v = (m.get(mode as DistMode) ?? 0) + meters;
    if (v < batch) { m.set(mode as DistMode, v); return null; }
    m.set(mode as DistMode, 0);
    return { mode: mode as DistMode, meters: Math.round(v * 10) / 10 };
  }
  forget(sid: string) { this.acc.delete(sid); }
}

export interface RallyRing { id: string; kind: string; x: number; z: number; radius: number }

export class RallyDwell {
  private st = new Map<string, { ring: string; since: number; done: boolean }>();
  constructor(private dwellMs = RALLY_DWELL_MS) {}
  /** posição do jogador agora; devolve o tipo da concentração quando completa a permanência */
  update(sid: string, x: number, z: number, rings: readonly RallyRing[], now: number): string | null {
    let hit: RallyRing | null = null, best = Infinity;
    for (const r of rings) { const d = Math.hypot(r.x - x, r.z - z); if (d <= r.radius && d < best) { best = d; hit = r; } }
    const cur = this.st.get(sid);
    if (!hit) { if (cur) this.st.delete(sid); return null; }
    if (!cur || cur.ring !== hit.id) { this.st.set(sid, { ring: hit.id, since: now, done: false }); return null; }
    if (cur.done || now - cur.since < this.dwellMs) return null;
    cur.done = true;
    return hit.kind;
  }
  forget(sid: string) { this.st.delete(sid); }
}

/** anéis das concentrações: fixos (palco, caminhões de evento) + veículos de evento onde estão agora */
export function rallyRings(spots: readonly { kind: string; x: number; z: number; heading: number }[], vehicles: Iterable<{ id: string; kind: string; x: number; z: number }>): RallyRing[] {
  const out: RallyRing[] = [];
  spots.forEach((sp, i) => {
    if (sp.kind === 'stage') { const S = RALLY_SHAPE.stage; out.push({ id: `stage${i}`, kind: 'stage', x: sp.x + Math.sin(sp.heading) * S.front, z: sp.z + Math.cos(sp.heading) * S.front, radius: S.radius }); }
    else if (sp.kind === 'truck') out.push({ id: `truck${i}`, kind: 'event', x: sp.x, z: sp.z, radius: RALLY_SHAPE.truck.radius });
  });
  for (const v of vehicles) if (v.kind === 'trio' || v.kind === 'soundcar') out.push({ id: v.id, kind: v.kind, x: v.x, z: v.z, radius: RALLY_SHAPE[v.kind].radius });
  return out;
}

/** a sala chama estes métodos nos caminhos de aceite (uma linha cada) */
export class GameplayEmitters {
  readonly dist = new DistanceMeter();
  readonly rally = new RallyDwell();
  private rallyAcc = 0;
  constructor(private bus: GameplayBus) {}

  moved(sid: string, mode: string, meters: number, dtS: number, now = Date.now()) {
    const b = this.dist.add(sid, mode, meters, dtS);
    if (b) this.bus.emit(sid, { type: 'distance', mode: b.mode, meters: b.meters }, now);
  }
  action(sid: string, actId: unknown, now = Date.now()) {
    const d = typeof actId === 'number' ? ACTION_BY_ID.get(actId) : undefined;
    if (d) this.bus.emit(sid, { type: 'action', key: d.key, category: d.category }, now);
  }
  prop(sid: string, propId: unknown, now = Date.now()) {
    const p = typeof propId === 'number' ? PROP_BY_ID.get(propId) : undefined;
    if (p) this.bus.emit(sid, { type: 'prop', kind: p.kind, ...(p.designSlot ? { slot: p.designSlot } : {}) }, now);
  }
  vehicle(sid: string, kind: string, now = Date.now()) { this.bus.emit(sid, { type: 'vehicle_enter', kind }, now); }
  trio(sid: string, now = Date.now()) { this.bus.emit(sid, { type: 'trio_board' }, now); }
  graffiti(sid: string, ok: boolean, now = Date.now()) { if (ok) this.bus.emit(sid, { type: 'graffiti' }, now); }
  chat(sid: string, ok: boolean, now = Date.now()) { if (ok) this.bus.emit(sid, { type: 'chat' }, now); }

  /** 1 Hz (acumulado pelo tick): permanência nas concentrações */
  tick(dtMs: number, players: () => Iterable<{ sid: string; x: number; z: number }>, rings: () => RallyRing[], now = Date.now()) {
    this.rallyAcc += dtMs;
    if (this.rallyAcc < 1000) return;
    this.rallyAcc = 0;
    const rs = rings();
    if (!rs.length) return;
    for (const p of players()) { const k = this.rally.update(p.sid, p.x, p.z, rs, now); if (k) this.bus.emit(p.sid, { type: 'rally_visit', kind: k }, now); }
  }

  forget(sid: string) { this.dist.forget(sid); this.rally.forget(sid); }
}
