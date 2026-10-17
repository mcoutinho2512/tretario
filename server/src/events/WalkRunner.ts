/**
 * CAMINHADA COLETIVA (rodada 9): um LÍDER VIRTUAL anda pela rota (checkpoints no eixo da avenida, ex.: Central →
 * Candelária) a `paceMs`, a partir do início da instância — posição determinística pelo relógio do servidor.
 *  - o líder é uma concentração em movimento (RallyPoint kind 'event'): NPCs de ambiente (cliente, RallyCrowd)
 *    caminham junto, sem formação; o ambiente das células do espectador aéreo anda com ele (server/src/spectator)
 *  - participação = acompanhar (a pé, a ≤ followRadius do líder) uma fração da rota (`completeFraction`, padrão 0,6)
 *    medida pela distância que o líder andou enquanto você estava perto → event_complete
 *  - o líder chega ao fim: a instância termina pouco depois (dispersão)
 */
import type { WalkSpec } from '../../../src/events/schedule';
import { alongPolyline, cumulative, routePolyline, type P2 } from '../../../src/events/route';
import type { EventRallyPoint, EventRunner, RunnerContext } from './runner';

/** depois de o líder chegar, a concentração fica parada este tempo antes de encerrar (ms) */
const LINGER_MS = 20_000;
/** acompanhamento avaliado a 2 Hz (não por tick) */
const EVAL_MS = 500;

interface Follower { mine: number; lastSent: number }

export class WalkRunner implements EventRunner {
  readonly format = 'caminhada';
  readonly lateJoin = true;
  private spec: WalkSpec;
  private poly: P2[] | null = null;
  private cum: number[] = [];
  private total = 0;
  private leaderD = 0;
  private evalAt = 0;
  private sendAt = 0;
  private f = new Map<string, Follower>();
  private arrivedAt = 0;

  constructor(private npc: number, spec: WalkSpec) { this.spec = spec; }

  private geo(ctx: RunnerContext) {
    if (!this.poly) {
      this.poly = routePolyline(ctx.axis, this.spec.route.map((c) => c.at));
      this.cum = cumulative(this.poly);
      this.total = this.cum[this.cum.length - 1] ?? 0;
    }
    return this.poly;
  }

  /** distância do líder no instante (0 antes do início) */
  leaderAt(ctx: RunnerContext, now: number): { x: number; z: number; d: number } {
    const poly = this.geo(ctx);
    const st = ctx.inst.state;
    const d = st === 'ACTIVE' || st === 'FINISHED' ? Math.min(this.total, Math.max(0, (now - ctx.inst.startsAt) / 1000) * this.spec.paceMs) : 0;
    const p = alongPolyline(poly, this.cum, d);
    return { x: p.x, z: p.z, d };
  }

  get need() { return this.total * (this.spec.completeFraction ?? 0.6); }

  prepare(ctx: RunnerContext) { this.geo(ctx); }

  start(ctx: RunnerContext) { this.geo(ctx); this.leaderD = 0; this.evalAt = ctx.now(); }

  tick(ctx: RunnerContext, now: number) {
    if (ctx.inst.state !== 'ACTIVE') return;
    if (now - this.evalAt < EVAL_MS) return;
    const L = this.leaderAt(ctx, now);
    const delta = Math.max(0, L.d - this.leaderD);
    this.leaderD = L.d;
    this.evalAt = now;
    const r2 = this.spec.followRadius ** 2;
    const need = this.need;
    for (const sid of ctx.inst.members) {
      const p = ctx.host.participant(sid);
      let fo = this.f.get(sid);
      if (!fo) this.f.set(sid, (fo = { mine: 0, lastSent: 0 }));
      // acompanha: a pé (não em veículo nem em cima do trio), conectado, perto do líder
      if (p && !p.dropped && !p.vehicleKind && !p.onPlatform && (p.x - L.x) ** 2 + (p.z - L.z) ** 2 <= r2) fo.mine += delta;
      if (fo.mine >= need && !ctx.inst.completed.has(sid)) ctx.complete(sid);
      if (now - fo.lastSent >= 1000) {
        fo.lastSent = now;
        ctx.host.send(sid, 'walk', { inst: ctx.inst.inst, x: Math.round(L.x), z: Math.round(L.z), d: Math.round(L.d), total: Math.round(this.total), mine: Math.round(fo.mine), need: Math.round(need), ...(ctx.inst.completed.has(sid) ? { done: true } : {}) });
      }
    }
    if (now - this.sendAt >= 1000 && ctx.watchers.size) {
      this.sendAt = now;
      for (const sid of ctx.watchers) if (!ctx.inst.members.has(sid)) ctx.host.send(sid, 'walk', { inst: ctx.inst.inst, x: Math.round(L.x), z: Math.round(L.z), d: Math.round(L.d), total: Math.round(this.total), mine: 0, need: Math.round(need) });
    }
    if (L.d >= this.total) {
      if (!this.arrivedAt) this.arrivedAt = now;
      else if (now - this.arrivedAt >= LINGER_MS) ctx.finish();
    }
  }

  end() { /* participação já emitida durante a caminhada */ }

  onJoin() { return null; }

  onLeave(_ctx: RunnerContext, sid: string) { this.f.delete(sid); }

  state(ctx: RunnerContext) {
    const L = this.leaderAt(ctx, ctx.now());
    return { leader: { x: +L.x.toFixed(1), z: +L.z.toFixed(1) }, d: +L.d.toFixed(1), total: +this.total.toFixed(1), need: +this.need.toFixed(1), following: Object.fromEntries([...this.f].map(([s, f]) => [s, +f.mine.toFixed(1)])) };
  }

  rally(ctx: RunnerContext): EventRallyPoint[] {
    const L = this.leaderAt(ctx, ctx.now());
    const r = Math.max(8, this.spec.followRadius * 0.8);
    return [{ id: `walk:${ctx.inst.def.id}`, x: L.x, z: L.z, inner: 2, radius: r, strength: 1, crowd: this.npc }];
  }
}
