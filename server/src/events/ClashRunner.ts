/**
 * CONFRONTO ENTRE GRUPOS (rodada 9, protótipo configurável) — tudo por DADOS (ScheduledEventDef.clash/groupRules):
 *  grupos      groupRules.allowed (chaves dos grupos do evento, ≥ 2), só comparadas por igualdade; a ORDEM só escolhe
 *              o ponto de retorno (respawn[i]) — nenhuma regra favorece um grupo
 *  zonas       clash.zones; durante a instância ATIVA o CombatSystem (agente A) recebe combatEventFor(sid) com
 *              friendlyFire dos dados (padrão false) e a zona vira combatPolicy do evento (CONTESTED)
 *  pontos      segurar a área (holdArea: só um grupo dentro → pointsPerHoldSecond/s) + derrubadas NO evento
 *              (onKnockdown chamado pelo combate; derrubar alguém do próprio grupo nunca pontua)
 *  retorno     derrubado volta ao ponto de retorno do seu grupo ao levantar, com proteção protectMs
 *  recompensa  participação (presença nas zonas do confronto ≥ metade do tempo ativo) → event_complete; NUNCA por golpe
 */
import type { GroupClashSpec, EventResultRow } from '../../../src/events/schedule';
import type { CombatEventRules } from '../../../src/combat/policy';
import type { EventRunner, RunnerContext } from './runner';

const EVAL_MS = 1000;
/** fração do tempo ativo presente nas zonas do confronto para contar participação */
export const CLASH_PRESENCE = 0.5;

export class ClashRunner implements EventRunner {
  readonly format = 'confronto_grupos';
  readonly lateJoin = true;
  private score = new Map<string, number>();
  private presence = new Map<string, number>();
  private kd = new Map<string, number>();
  private pendingReturn = new Set<string>();
  private evalAt = 0;
  private hold: string | null = null;
  private sig = '';
  private names = new Map<string, { name: string; group: string }>();

  constructor(readonly spec: GroupClashSpec, readonly groups: readonly string[], readonly friendlyFire: boolean) {
    for (const g of groups) this.score.set(g, 0);
  }

  onJoin(ctx: RunnerContext, sid: string) {
    const p = ctx.host.participant(sid);
    if (!p || p.groupKey === null || !this.groups.includes(p.groupKey)) return 'grupo' as const;
    this.names.set(sid, { name: p.name, group: p.groupKey });
    return null;
  }

  onLeave(_ctx: RunnerContext, sid: string) { this.pendingReturn.delete(sid); }

  start(ctx: RunnerContext) { this.evalAt = ctx.now(); }

  combat(ctx: RunnerContext): CombatEventRules {
    return { eventId: ctx.inst.inst, zones: [...this.spec.zones], friendlyFire: this.friendlyFire };
  }

  /** derrubada entre inscritos da instância (CombatSystem → EventRuntime.onKnockdown) */
  onKnockdown(_ctx: RunnerContext, attacker: string, target: string) {
    const a = this.names.get(attacker)?.group, t = this.names.get(target)?.group;
    if (a === undefined || t === undefined) return;
    if (a !== t) {
      this.score.set(a, (this.score.get(a) ?? 0) + this.spec.pointsPerKnockdown);
      this.kd.set(attacker, (this.kd.get(attacker) ?? 0) + 1);
    }
    this.pendingReturn.add(target);
  }

  private respawnOf(ctx: RunnerContext, group: string) {
    const i = Math.max(0, this.groups.indexOf(group));
    const wp = this.spec.respawn[i] ?? this.spec.respawn[0];
    return wp ? ctx.point(wp) : null;
  }

  tick(ctx: RunnerContext, now: number) {
    if (ctx.inst.state !== 'ACTIVE') return;
    // retorno: quem foi derrubado volta ao ponto do grupo assim que levanta (estado do servidor), protegido
    for (const sid of [...this.pendingReturn]) {
      const p = ctx.host.participant(sid);
      if (!p) { this.pendingReturn.delete(sid); continue; }
      if (p.status !== 0) continue;
      const g = this.names.get(sid)?.group;
      const pt = g ? this.respawnOf(ctx, g) : null;
      if (pt) ctx.host.teleport?.(sid, pt.x, pt.z);
      ctx.host.protect?.(sid, now + this.spec.protectMs);
      this.pendingReturn.delete(sid);
    }
    if (now - this.evalAt < EVAL_MS) return;
    const dt = (now - this.evalAt) / 1000;
    this.evalAt = now;
    const inArea = new Map<string, number>();
    const h = this.spec.holdArea ? { ...ctx.point(this.spec.holdArea.at), r: this.spec.holdArea.radius } : null;
    for (const sid of ctx.inst.members) {
      const p = ctx.host.participant(sid), g = this.names.get(sid)?.group;
      if (!p || p.dropped || g === undefined) continue;
      const z = ctx.host.zoneOf(sid);
      if (z !== null && this.spec.zones.includes(z)) this.presence.set(sid, (this.presence.get(sid) ?? 0) + dt);
      if (h && p.status === 0 && !p.vehicleKind && (p.x - h.x) ** 2 + (p.z - h.z) ** 2 <= h.r * h.r) inArea.set(g, (inArea.get(g) ?? 0) + 1);
    }
    // segurar a área: só um grupo presente pontua; disputada (dois ou mais) ninguém pontua
    this.hold = inArea.size === 1 ? [...inArea.keys()][0] : null;
    if (this.hold !== null) this.score.set(this.hold, (this.score.get(this.hold) ?? 0) + this.spec.pointsPerHoldSecond * dt);
    const score = Object.fromEntries([...this.score].map(([g, v]) => [g, Math.round(v)]));
    const sig = JSON.stringify(score) + this.hold;
    if (sig !== this.sig) {
      this.sig = sig;
      ctx.sendMembers('clash', { inst: ctx.inst.inst, score, hold: this.hold, t: now - ctx.inst.startsAt, endsAt: ctx.inst.endsAt });
    }
  }

  end(ctx: RunnerContext, reason: 'finished' | 'cancelled') {
    if (reason === 'cancelled') return;
    const activeS = Math.max(1, (ctx.inst.endsAt - ctx.inst.startsAt) / 1000);
    for (const sid of ctx.inst.members) if ((this.presence.get(sid) ?? 0) >= activeS * CLASH_PRESENCE) ctx.complete(sid);
    const score = Object.fromEntries([...this.score].map(([g, v]) => [g, Math.round(v)]));
    // empate = mesma posição (1 + grupos com mais pontos)
    const rows: EventResultRow[] = [...this.groups].sort((a, b) => score[b] - score[a]).map((g) => ({ name: g, group: g, rank: 1 + this.groups.filter((o) => score[o] > score[g]).length, timeMs: 0, status: 'ok' }));
    ctx.sendMembers('evt_result', { inst: ctx.inst.inst, format: this.format, rows, score });
  }

  state() {
    return { score: Object.fromEntries([...this.score].map(([g, v]) => [g, +v.toFixed(1)])), hold: this.hold, presence: Object.fromEntries([...this.presence].map(([s, v]) => [s, +v.toFixed(1)])), knockdowns: Object.fromEntries(this.kd), pendingReturn: [...this.pendingReturn] };
  }
}
