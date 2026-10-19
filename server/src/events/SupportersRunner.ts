/**
 * ENCONTRO DE TORCIDAS (rodada 10, formato `torcida`) — tudo por DADOS (ScheduledEventDef.supporters + supporters.json):
 *  concentrações  uma por torcida (`points[].group` = id dos dados) e um encontro comum (`meet`) para neutros/sem
 *                 torcida; viram RallyPoints com `sup` (NPCs simulados vestem as cores) e marcadores no minimapa
 *  participação   ficar perto da concentração da SUA torcida (ou do encontro comum; quem não tem concentração própria
 *                 vale em qualquer uma) por `presence` do tempo ativo → event_complete. Sem placar entre torcidas,
 *                 sem confronto: quem quiser confronto usa o formato `confronto_grupos` (CombatSystem + regras de evento)
 *  troca          a política de troca de torcida (changePolicy.deferDuringEventKinds contém `torcida`) deixa a troca
 *                 PENDENTE enquanto inscrito — a concentração "certa" de cada um não muda no meio do encontro
 * Nenhum ramo por torcida: ids só comparados por igualdade com os dados.
 */
import type { EventResultRow, SupportersMeetSpec } from '../../../src/events/schedule';
import { supIndex } from '../../../src/supporters/data';
import { supporters } from '../supporters/service';
import type { EventRallyPoint, EventRunner, RunnerContext } from './runner';

const EVAL_MS = 1000;
export const SUPPORTERS_PRESENCE = 0.5;

export class SupportersRunner implements EventRunner {
  readonly format = 'torcida';
  readonly lateJoin = true;
  private presence = new Map<string, number>();
  private evalAt = 0;
  /** presentes por concentração (agregado; nunca posição individual) */
  private here = new Map<string, number>();

  constructor(readonly spec: SupportersMeetSpec) {}

  onJoin() { return null; }
  onLeave() {}
  rebind(_ctx: RunnerContext, from: string, to: string) { if (this.presence.has(from)) { this.presence.set(to, this.presence.get(from)!); this.presence.delete(from); } }
  start(ctx: RunnerContext) { this.evalAt = ctx.now(); }

  private pts(ctx: RunnerContext) {
    return this.spec.points.map((p) => ({ group: p.group, r: p.radius, ...ctx.point(p.at) }));
  }

  tick(ctx: RunnerContext, now: number) {
    if (ctx.inst.state !== 'ACTIVE' || now - this.evalAt < EVAL_MS) return;
    const dt = (now - this.evalAt) / 1000;
    this.evalAt = now;
    const pts = this.pts(ctx);
    const meet = this.spec.meet ? { ...ctx.point(this.spec.meet.at), r: this.spec.meet.radius } : null;
    this.here.clear();
    for (const sid of ctx.inst.members) {
      const p = ctx.host.participant(sid);
      if (!p || p.dropped) continue;
      const own = pts.filter((q) => q.group === (p.supporter ?? null));
      // quem tem concentração própria conta só nela (ou no encontro comum); os demais em qualquer uma
      const targets = [...(own.length ? own : pts), ...(meet ? [{ group: '', ...meet }] : [])];
      const at = targets.find((q) => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 <= q.r * q.r);
      if (!at) continue;
      this.here.set(at.group, (this.here.get(at.group) ?? 0) + 1);
      this.presence.set(sid, (this.presence.get(sid) ?? 0) + dt);
    }
  }

  rally(ctx: RunnerContext): EventRallyPoint[] {
    const data = supporters();
    const out: EventRallyPoint[] = this.pts(ctx).map((q) => ({
      id: `${ctx.inst.inst}:${q.group}`, x: q.x, z: q.z, inner: 2, radius: q.r, strength: 0.8, crowd: this.spec.npcPerPoint ?? 30,
      sup: supIndex(data, q.group), label: data?.groups.find((g) => g.id === q.group)?.shortName,
    }));
    if (this.spec.meet) { const m = ctx.point(this.spec.meet.at); out.push({ id: `${ctx.inst.inst}:encontro`, x: m.x, z: m.z, inner: 2, radius: this.spec.meet.radius, strength: 0.6, crowd: Math.round((this.spec.npcPerPoint ?? 30) / 2) }); }
    return out;
  }

  end(ctx: RunnerContext, reason: 'finished' | 'cancelled') {
    if (reason === 'cancelled') return;
    const activeS = Math.max(1, (ctx.inst.endsAt - ctx.inst.startsAt) / 1000);
    const need = activeS * (this.spec.presence ?? SUPPORTERS_PRESENCE);
    for (const sid of ctx.inst.members) if ((this.presence.get(sid) ?? 0) >= need) ctx.complete(sid);
    ctx.sendMembers('evt_result', { inst: ctx.inst.inst, format: this.format, ...this.results() });
  }

  /** resumo: só participação (nenhuma classificação entre torcidas) */
  results(): { rows: EventResultRow[] } { return { rows: [] }; }

  state() {
    return { here: Object.fromEntries(this.here), presence: Object.fromEntries([...this.presence].map(([s, v]) => [s, +v.toFixed(1)])) };
  }
}
