/**
 * CORRIDA DE BICICLETA / PATINETE (rodada 9) — o MESMO runner para os dois (RaceSpec.vehicle). Tudo no servidor:
 *  inscrição   só montado no veículo do tipo certo (estado do servidor, não do cliente) → senão 'veiculo'
 *  largada     STARTING = contagem; `race_def` (largada, checkpoints, grade indicativa) aos inscritos e acompanhantes
 *  progresso   cada movimento ACEITO de um inscrito é testado contra o PRÓXIMO checkpoint (segmento × raio): pular um
 *              checkpoint não conta; a pé ou em outro veículo não avança; voltas; chegada = cruzar a largada no fim
 *  anti-trapaça velocidade já presa por MAX_SPEED na validação do movimento; salto entre dois movimentos aceitos maior
 *              que o teto do veículo (+ folga) → DQ 'teleporte'; correções 'too_fast' acima do limite → DQ 'correcoes';
 *              teto de tempo → 'dnf'
 *  resultado   posição e tempo pelo relógio do servidor; race_finish + event_complete para quem chega; `evt_result`
 * Nenhuma mensagem do cliente informa checkpoint ou chegada.
 */
import type { RaceSpec, RaceProgress, RaceDefMessage, EventResultRow } from '../../../src/events/schedule';
import { segmentHitsCircle, type P2 } from '../../../src/events/route';
import { MAX_SPEED } from '../../../src/net/protocol';
import type { EventRallyPoint, EventRunner, RunnerContext } from './runner';

/** correções 'too_fast' toleradas numa corrida (rede ruim gera algumas; trapaça gera muitas) */
export const RACE_MAX_CORRECTIONS = 6;
/** folga (m) além do teto do veículo entre dois movimentos aceitos (montar a ≤ 3,5 m da bicicleta, jitter) */
export const RACE_JUMP_SLACK_M = 6;
const PROGRESS_MS = 500;

interface Racer {
  sid: string;
  name: string;
  step: number;
  last: { x: number; z: number; t: number } | null;
  corr: number;
  finishMs: number | null;
  rank: number;
  status: 'ok' | 'dnf' | 'dq';
  reason?: string;
}

interface Geo { start: P2 & { r: number }; cps: (P2 & { r: number })[]; grid: { x: number; z: number; heading: number }[]; watch: P2 }

export class RaceRunner implements EventRunner {
  readonly format = 'corrida';
  readonly lateJoin = false;
  private g: Geo | null = null;
  private racers = new Map<string, Racer>();
  private finished = 0;
  private sentAt = 0;
  private boardAt = 0;

  constructor(private npc: number, readonly spec: RaceSpec) {}

  private geo(ctx: RunnerContext): Geo {
    if (this.g) return this.g;
    const s = ctx.point(this.spec.start.at);
    const cps = this.spec.checkpoints.map((c) => ({ ...ctx.point(c.at), r: c.radius }));
    const first = cps[0] ?? s;
    const len = Math.hypot(first.x - s.x, first.z - s.z) || 1;
    const dx = (first.x - s.x) / len, dz = (first.z - s.z) / len;
    const grid: Geo['grid'] = [];
    for (let i = 0; i < Math.min(16, ctx.inst.def.capacity); i++) {
      const row = Math.floor(i / 2), col = i % 2 ? 1 : -1;
      grid.push({ x: s.x - dx * (4 + row * 4) - dz * col * 2, z: s.z - dz * (4 + row * 4) + dx * col * 2, heading: Math.atan2(dx, dz) });
    }
    const off = this.spec.start.radius + 10;
    const watch = this.spec.watchArea ? ctx.point(this.spec.watchArea) : { x: s.x - dz * off, z: s.z + dx * off };
    return (this.g = { start: { ...s, r: this.spec.start.radius }, cps, grid, watch });
  }

  get steps() { return Math.max(1, this.spec.laps) * this.spec.checkpoints.length + 1; }

  private target(step: number): P2 & { r: number } {
    const g = this.g!, n = g.cps.length;
    return step < Math.max(1, this.spec.laps) * n ? g.cps[step % n] : g.start;
  }

  private def(ctx: RunnerContext): RaceDefMessage {
    const g = this.geo(ctx);
    const r1 = (p: P2 & { r: number }) => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), r: p.r });
    return { inst: ctx.inst.inst, vehicle: this.spec.vehicle, laps: Math.max(1, this.spec.laps), startsAt: ctx.inst.startsAt, timeLimitS: this.spec.timeLimitS, start: r1(g.start), cps: g.cps.map(r1), grid: g.grid.map((q) => ({ x: +q.x.toFixed(1), z: +q.z.toFixed(1), heading: +q.heading.toFixed(3) })) };
  }

  onJoin(ctx: RunnerContext, sid: string) {
    const p = ctx.host.participant(sid);
    if (!p || p.vehicleKind !== this.spec.vehicle) return 'veiculo' as const;
    this.racers.set(sid, { sid, name: p.name, step: 0, last: null, corr: 0, finishMs: null, rank: 0, status: 'ok' });
    ctx.host.send(sid, 'race_def', this.def(ctx));
    return null;
  }

  onLeave(ctx: RunnerContext, sid: string, forfeit: boolean) {
    const r = this.racers.get(sid);
    if (!r) return;
    // antes da largada: sai da lista; depois: DNF (fica no resultado)
    if (ctx.inst.state !== 'ACTIVE') { this.racers.delete(sid); return; }
    if (r.finishMs === null && r.status === 'ok') { r.status = 'dnf'; r.reason = forfeit ? 'saiu' : 'desistiu'; }
  }

  watch(ctx: RunnerContext, sid: string) { ctx.host.send(sid, 'race_def', this.def(ctx)); }

  prepare(ctx: RunnerContext) { ctx.sendMembers('race_def', this.def(ctx)); }

  start(ctx: RunnerContext) {
    this.geo(ctx);
    const now = ctx.now();
    // t "antigo": o 1º movimento depois da largada tem a mesma folga (dt ≤ 1,5 s) que a validação do servidor deu
    for (const r of this.racers.values()) {
      const p = ctx.host.participant(r.sid);
      r.last = p ? { x: p.x, z: p.z, t: now - 1500 } : null;
    }
  }

  private dq(r: Racer, reason: string) { r.status = 'dq'; r.reason = reason; }

  onMove(ctx: RunnerContext, sid: string, x: number, z: number, mode: string, ok: boolean, reason: string, now: number) {
    const r = this.racers.get(sid);
    if (!r || r.finishMs !== null || r.status !== 'ok') return;
    if (ctx.inst.state !== 'ACTIVE') { r.last = { x, z, t: now }; return; }
    // salto entre movimentos aceitos: a validação (validateMove) já prende cada movimento ao teto do modo; um salto
    // maior só vem de reposicionamento fora do movimento (troca de corpo/sessão, correção grosseira) → DQ
    const prev = r.last;
    if (prev) {
      const dt = Math.max(0.05, Math.min(1.5, (now - prev.t) / 1000));
      const cap = (MAX_SPEED as Record<string, number>)[mode] ?? MAX_SPEED.foot;
      if (Math.hypot(x - prev.x, z - prev.z) > cap * dt * 1.35 + 0.6 + RACE_JUMP_SLACK_M) { this.dq(r, 'teleporte'); this.progress(ctx, r, now); return; }
    }
    if (!ok && reason === 'too_fast' && ++r.corr > RACE_MAX_CORRECTIONS) { this.dq(r, 'correcoes'); this.progress(ctx, r, now); return; }
    r.last = { x, z, t: now };
    if (mode !== this.spec.vehicle || !prev) return; // só avança montado no veículo certo
    const tg = this.target(r.step);
    if (!segmentHitsCircle(prev, { x, z }, tg, tg.r)) return;
    r.step++;
    if (r.step >= this.steps) {
      r.finishMs = now - ctx.inst.startsAt;
      r.rank = ++this.finished;
      ctx.host.emit(sid, { type: 'race_finish', raceId: ctx.inst.inst, vehicle: this.spec.vehicle, rank: r.rank, timeMs: r.finishMs });
      ctx.complete(sid);
    }
    this.progress(ctx, r, now);
  }

  /** classificação: chegaram (tempo) → em prova (checkpoints, distância ao próximo) → DNF → DQ */
  ranking(): Racer[] {
    const w = (r: Racer) => (r.status === 'dq' ? 3 : r.status === 'dnf' ? 2 : r.finishMs !== null ? 0 : 1);
    const dist = (r: Racer) => { if (!r.last || !this.g) return Infinity; const t = this.target(r.step); return Math.hypot(r.last.x - t.x, r.last.z - t.z); };
    return [...this.racers.values()].sort((a, b) => w(a) - w(b) || (a.finishMs ?? 0) - (b.finishMs ?? 0) || b.step - a.step || dist(a) - dist(b) || a.sid.localeCompare(b.sid));
  }

  private progress(ctx: RunnerContext, r: Racer, now: number, rank?: number) {
    const n = Math.max(1, this.spec.checkpoints.length), laps = Math.max(1, this.spec.laps);
    const msg: RaceProgress & { status?: string; reason?: string } = {
      inst: ctx.inst.inst, cp: r.step, lap: Math.min(laps, Math.floor(r.step / n) + 1), rank: rank ?? (this.ranking().indexOf(r) + 1),
      total: this.racers.size, t: r.finishMs ?? (now - ctx.inst.startsAt), ...(r.finishMs !== null ? { finished: true } : {}),
      ...(r.status !== 'ok' ? { status: r.status, reason: r.reason } : {}),
    };
    ctx.host.send(r.sid, 'race', msg);
  }

  tick(ctx: RunnerContext, now: number) {
    if (now - this.sentAt < PROGRESS_MS) return;
    this.sentAt = now;
    const ranked = this.ranking();
    ranked.forEach((r, i) => { if (ctx.inst.members.has(r.sid)) this.progress(ctx, r, now, i + 1); });
    if (ctx.watchers.size && now - this.boardAt >= 1000) {
      this.boardAt = now;
      const board = { inst: ctx.inst.inst, t: now - ctx.inst.startsAt, rows: ranked.map((r, i) => ({ name: r.name, rank: i + 1, cp: r.step, status: r.status, ...(r.finishMs !== null ? { timeMs: r.finishMs } : {}) })) };
      for (const sid of ctx.watchers) ctx.host.send(sid, 'race_board', board);
    }
    if (ctx.inst.state !== 'ACTIVE') return;
    const over = now - ctx.inst.startsAt >= this.spec.timeLimitS * 1000;
    if (over) for (const r of this.racers.values()) if (r.finishMs === null && r.status === 'ok') { r.status = 'dnf'; r.reason = 'tempo'; }
    if (over || (this.racers.size > 0 && [...this.racers.values()].every((r) => r.finishMs !== null || r.status !== 'ok'))) ctx.finish();
  }

  end(ctx: RunnerContext, reason: 'finished' | 'cancelled') {
    if (reason === 'cancelled') return;
    const rows: EventResultRow[] = this.ranking().map((r, i) => ({ name: r.name, rank: i + 1, timeMs: r.finishMs ?? 0, status: r.finishMs !== null ? 'ok' : r.status === 'ok' ? 'dnf' : r.status, ...(r.reason ? { reason: r.reason } : {}) }));
    const msg = { inst: ctx.inst.inst, format: this.format, rows };
    for (const sid of new Set([...this.racers.keys(), ...ctx.inst.members, ...ctx.watchers])) ctx.host.send(sid, 'evt_result', msg);
  }

  state() {
    return { steps: this.steps, racers: this.ranking().map((r, i) => ({ sid: r.sid, name: r.name, rank: i + 1, step: r.step, corr: r.corr, status: r.status, reason: r.reason ?? null, timeMs: r.finishMs })) };
  }

  rally(ctx: RunnerContext): EventRallyPoint[] {
    if (!this.npc) return [];
    const w = this.geo(ctx).watch;
    return [{ id: `race:${ctx.inst.def.id}`, x: w.x, z: w.z, inner: 2, radius: 8, strength: 0.6, crowd: this.npc }];
  }
}
