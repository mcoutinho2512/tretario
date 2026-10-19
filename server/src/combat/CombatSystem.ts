/**
 * CONFRONTO no servidor (rodada 9) — sistema ÚNICO, sem Colyseus, dirigido por dados (public/gameplay/combat.json).
 * A sala só liga mensagens/tick/entrada (bloco `// rodada 9 — confronto`) e fornece o `CombatHost` (estado do mundo).
 *
 * Pedido `cbt {a, h, seq}` (só intenção + orientação; alvo/dano/posição enviados pelo cliente são IGNORADOS):
 *   taxa (maxRequestsPerS) → capacidade `combat.act` → ação válida (combo resolvido aqui) → veículo/trio → estado
 *   físico (e no ar) → item na mão → stamina → recuperação/cooldown →
 *   aceita: gasta stamina, agenda preparação → janela ATIVA → recuperação no relógio do servidor; `cbt_act` à AOI.
 * Janela ativa (no início e, sem acerto, no fim): posição do atacante NO SERVIDOR naquele instante; candidatos SÓ
 * pela grade espacial (host.forEachNear); alcance + folga, arco + folga, parede (checkPath), estado do alvo (esquiva
 * = 'dodged'), política (src/combat/policy.ts: evento/consentimento/proteção de retorno — rodada 12: não há área de
 * paz) → impacto: condição,
 * empurrão (knockback), CAMBALEANDO ou CAÍDO (queda/ragdoll existentes; condição 0 sempre derruba).
 * Bonecos de treino: alvos do servidor (não são jogadores), sempre aceitam golpe.
 * Regeneração de stamina/condição; `cbt_self` (≤ 5 Hz, só quando muda) para o dono; fx no NetPlayer só na troca.
 */
import { checkPath } from '../../../src/net/authority';
import type { WallGrid } from '../../../src/physics/walls';
import { CombatTable, inArc, inDummyArea } from '../../../src/combat/data';
import { FX, PHYS, type CombatActionDefinition, type CombatDenial, type CombatDummyDefinition, type CombatDummyWire, type CombatHitEvent, type PhysState } from '../../../src/combat/types';
import { combatAllowed, normalizeZonePolicy, type CombatConsent, type CombatEventRules, type CombatParty, type ZoneCombatPolicy } from '../../../src/combat/policy';
import type { GameplayEvent } from '../../../src/gameplay/events';

/** o que o sistema precisa ver de um jogador (montado pela sala a partir do estado autoritativo) */
export interface CombatActorView {
  x: number; z: number; heading: number;
  status: number; vehicle: string; platform: string;
  mode: 'pacifico' | 'interacao';
  /** item na mão (id de src/social/props.ts; 0 = mãos vazias) */
  prop: number;
  /** proteção de retorno até (ms) — a mesma imunidade das quedas antigas (Actor.immuneUntil) */
  immuneUntil: number;
  nid: number;
}

export interface CombatHost {
  actor(sid: string): CombatActorView | undefined;
  /** jogadores perto (grade espacial — nunca todos contra todos) */
  forEachNear(x: number, z: number, r: number, fn: (sid: string) => void): void;
  walls: WallGrid | null;
  zoneOf(sid: string): string | null;
  zoneDef(id: string | null): { combatPolicy?: ZoneCombatPolicy } | undefined;
  /** consentimento (zones.json `combatConsent`; ausente = 'both', a regra antiga) */
  consent?: CombatConsent;
  groupKey(sid: string): string | null;
  /** tipo do prop pelo id (src/social/props.ts PropKind; agente B acrescenta barra/spray) */
  propKind(propId: number): string | undefined;
  can(sid: string): boolean;
  send(sid: string, type: string, msg: unknown): void;
  /** para quem tem `subject` na área de interesse (StateView) — e o próprio */
  sendAoi(subject: string, type: string, msg: unknown, also?: string): void;
  /** para quem está a ≤ r de (x, z) (bonecos) */
  sendNear(x: number, z: number, r: number, type: string, msg: unknown): void;
  setStatus(sid: string, st: number): void;
  setFx(sid: string, fx: number): void;
  /** desloca o jogador (servidor decide; já validado contra paredes) */
  place(sid: string, x: number, z: number): void;
  /** queda pelo caminho existente (knock + ragdoll no cliente, levantar no tick da sala) */
  knockdown(sid: string, fromX: number, fromZ: number, dist: number, strength: number, by: string, kind: 'push' | 'combat'): void;
  emit(sid: string, ev: GameplayEvent): void;
  airborne(sid: string): boolean;
  /** relógio do servidor (testes: relógio falso) */
  now(): number;
  /** agenda `update` para o instante exato da janela ativa (sala: setTimeout; testes: nada) */
  schedule?(ms: number): void;
  /** medição (sala → métricas): tempo de cada validação de janela ativa e pedidos */
  onResolve?(ms: number): void;
  onRequest?(ok: boolean): void;
}

interface Pending { def: CombatActionDefinition; h: number; t0: number; activeAt: number; activeEnd: number; phase: 0 | 1 | 2; hits: number; done: Set<string> | null }

interface Fighter {
  stamina: number; condition: number;
  spentAt: number; hitAt: number;
  req: number[]; spamAt: number;
  busyUntil: number;
  last: { id: number; activeEnd: number } | null;
  cd: Map<number, number>;
  dodgeUntil: number; staggerUntil: number; disorientUntil: number; engagedUntil: number;
  downAt: number;
  pending: Pending | null;
  fx: number;
  sent: { st: number; cd: number; fx: number }; sentAt: number;
}

interface Dummy { def: CombatDummyDefinition; st: PhysState; cond: number; until: number; hitAt: number; known: Set<string>; dirty: boolean }

/** área de treino de boneco: zona virtual com política COMBAT (só onde a zona real é CONTESTED) */
const TRAINING = 'treino:';
const ENGAGED_MS = 6000;
const SELF_MIN_MS = 200; // cbt_self ≤ 5 Hz
const DUMMY_VIEW_M = 90;

export type CombatRequestResult = { ok: true; action: CombatActionDefinition } | { ok: false; reason: CombatDenial | 'cap' };

export class CombatSystem {
  private f = new Map<string, Fighter>();
  /** só quem tem algo correndo (fôlego/condição abaixo do máximo, fx, queda, golpe pendente) passa pelo tick */
  private hot = new Set<string>();
  private dummies: Dummy[];
  /** evento de confronto ATIVO em que o jogador está inscrito (agente D liga; padrão: nenhum) */
  combatEventFor: (sid: string) => CombatEventRules | null = () => null;
  private dummyAcc = 0;
  /** medição: pedidos, negativas por motivo, resoluções (tempo de validação de acerto) */
  readonly stats = { requests: 0, accepted: 0, denied: {} as Record<string, number>, resolves: 0, resolveMs: 0, resolveMaxMs: 0, candidates: 0, hits: 0, dodged: 0, blocked: 0, dummyHits: 0 };

  constructor(readonly table: CombatTable, private host: CombatHost) {
    this.dummies = table.dummies.map((def) => ({ def, st: PHYS.NORMAL, cond: def.conditionMax, until: 0, hitAt: 0, known: new Set(), dirty: false }));
  }

  get tuning() { return this.table.tuning; }
  /** maior deslocamento de esquiva da tabela */
  private get dashM() { return this._dash ??= Math.max(0, ...this.table.data.actions.map((a) => a.dashM ?? 0)); }
  private _dash: number | undefined;

  // ---------------------------------------------------------------- entrada / saída
  join(sid: string) {
    const t = this.tuning;
    this.f.set(sid, {
      stamina: t.staminaMax, condition: t.conditionMax, spentAt: 0, hitAt: 0, req: [], spamAt: 0, busyUntil: 0, last: null, cd: new Map(),
      dodgeUntil: 0, staggerUntil: 0, disorientUntil: 0, engagedUntil: 0, downAt: 0, pending: null, fx: 0, sent: { st: t.staminaMax, cd: t.conditionMax, fx: 0 }, sentAt: 0,
    });
    this.hot.add(sid); // proteção de entrada (fx)
  }
  /** algo mudou fora do sistema (proteção ao reentrar): volta ao tick */
  wake(sid: string) { if (this.f.has(sid)) this.hot.add(sid); }
  leave(sid: string) { this.f.delete(sid); this.hot.delete(sid); for (const d of this.dummies) d.known.delete(sid); }
  /** proteção de retorno (entrou, reconectou) */
  protectMsFrom(now: number) { return now + this.tuning.protectMs; }

  // ---------------------------------------------------------------- pedido
  request(sid: string, m: unknown): CombatRequestResult {
    const now = this.host.now();
    const t = this.tuning;
    const F = this.f.get(sid);
    this.stats.requests++;
    if (!F) { if (this.host.can(sid)) return this.deny(sid, 0, 'estado', now); this.count('cap'); this.host.send(sid, 'denied', { cap: 'combat.act' }); return { ok: false, reason: 'cap' }; }
    // taxa: janela de 1 s
    while (F.req.length && now - F.req[0] >= 1000) F.req.shift();
    if (F.req.length >= t.maxRequestsPerS) return this.deny(sid, 0, 'spam', now, F);
    F.req.push(now);
    if (!this.host.can(sid)) { this.count('cap'); this.host.send(sid, 'denied', { cap: 'combat.act' }); return { ok: false, reason: 'cap' }; }
    // só a intenção: {a, h}. Qualquer outro campo (alvo, dano, posição) é ignorado
    const o = (m ?? {}) as { a?: unknown; h?: unknown };
    const a = typeof o.a === 'number' && Number.isInteger(o.a) ? o.a : -1;
    const h = typeof o.h === 'number' && Number.isFinite(o.h) ? o.h : NaN;
    const me = this.host.actor(sid);
    if (!me || a < 0 || !Number.isFinite(h)) return this.deny(sid, a, 'acao_invalida', now);
    const def = this.table.resolve(a, F.last, now);
    if (!def) return this.deny(sid, a, 'acao_invalida', now);
    if (me.vehicle || me.platform) return this.deny(sid, a, 'em_veiculo', now);
    const st = this.physOf(sid, me, F, now);
    if (!this.table.stateAllowed(def, st) || this.host.airborne(sid)) return this.deny(sid, a, 'estado', now);
    // rodada 12: não há área de paz — o golpe válido SEMPRE sai e anima para todos; o impacto é que pode ser
    // bloqueado na janela ativa (proteção de retorno, regras de evento, consentimento) — nunca "nada acontece"
    if (!this.table.itemOk(def, me.prop ? this.host.propKind(me.prop) : undefined)) return this.deny(sid, a, 'sem_item', now);
    if (F.stamina < def.staminaCost) return this.deny(sid, a, 'stamina', now);
    const combo = def.comboOf !== undefined;
    if ((now < F.busyUntil && !(combo && F.last && now >= F.last.activeEnd - 60)) || now < (F.cd.get(def.id) ?? 0)) return this.deny(sid, a, 'cooldown', now);
    // aceito
    this.stats.accepted++;
    this.host.onRequest?.(true);
    F.stamina -= def.staminaCost; F.spentAt = now;
    const activeAt = now + def.windupMs, activeEnd = activeAt + def.activeMs;
    F.busyUntil = activeEnd + def.recoveryMs;
    F.cd.set(def.id, now + def.cooldownMs);
    F.last = { id: def.id, activeEnd };
    F.engagedUntil = now + ENGAGED_MS;
    const hh = Math.atan2(Math.sin(h), Math.cos(h));
    this.host.sendAoi(sid, 'cbt_act', { by: me.nid, a: def.id, h: Math.round(hh * 1000) / 1000, t: now });
    this.host.emit(sid, { type: 'combat_action', key: def.key });
    if (def.kind === 'dodge') this.dodge(sid, me, F, def, hh, now);
    else { F.pending = { def, h: hh, t0: now, activeAt, activeEnd, phase: 0, hits: 0, done: null }; this.host.schedule?.(def.windupMs); }
    this.refresh(sid, F, now, true);
    return { ok: true, action: def };
  }

  private deny(sid: string, a: number, reason: CombatDenial, now: number, F?: Fighter): CombatRequestResult {
    this.count(reason);
    // spam: no máximo uma negativa por segundo (o próprio aviso não vira inundação)
    if (reason === 'spam') { if (F && now - F.spamAt < 1000) return { ok: false, reason }; if (F) F.spamAt = now; }
    this.host.send(sid, 'cbt_denied', { a, reason });
    return { ok: false, reason };
  }
  private count(r: string) { this.stats.denied[r] = (this.stats.denied[r] ?? 0) + 1; this.host.onRequest?.(false); }

  /** estado físico efetivo (status do NetPlayer + cambaleio deste sistema) */
  private physOf(_sid: string, me: CombatActorView, F: Fighter, now: number): PhysState {
    if (me.status === PHYS.STAGGERED && F.staggerUntil <= now) return PHYS.NORMAL;
    return me.status as PhysState;
  }

  private get consent(): CombatConsent { return this.host.consent ?? 'both'; }

  private zonePolicy = (zone: string | null): ZoneCombatPolicy => {
    if (zone?.startsWith(TRAINING)) return 'COMBAT';
    return normalizeZonePolicy(this.host.zoneDef(zone)?.combatPolicy);
  };

  private party(sid: string, a: CombatActorView, ev?: CombatEventRules | null): CombatParty {
    let zone = this.host.zoneOf(sid);
    const def = this.host.zoneDef(zone);
    // área de treino (boneco) vale como COMBAT dentro de zona CONTESTED (mecânica de evento)
    if (normalizeZonePolicy(def?.combatPolicy) !== 'COMBAT') { const d = inDummyArea(this.table.dummies, a.x, a.z); if (d) zone = TRAINING + d.key; }
    const rules = ev === undefined ? this.combatEventFor(sid) : ev;
    return { zone, mode: a.mode, groupKey: this.host.groupKey(sid), combatEventId: rules?.eventId ?? '', protectedUntil: a.immuneUntil };
  }

  // ---------------------------------------------------------------- esquiva
  private dodge(sid: string, me: CombatActorView, F: Fighter, def: CombatActionDefinition, h: number, now: number) {
    F.dodgeUntil = now + (def.iFramesMs ?? 0);
    // esquiva tira do cambaleio (é a saída permitida: allowedStates)
    if (F.staggerUntil > now) { F.staggerUntil = now; this.host.setStatus(sid, PHYS.NORMAL); }
    const d = def.dashM ?? 0;
    if (d > 0) {
      const to = { x: me.x + Math.sin(h) * d, z: me.z + Math.cos(h) * d };
      const pc = this.host.walls ? checkPath(this.host.walls, me, to, 'foot', 0.6) : { x: to.x, z: to.z };
      this.host.place(sid, pc.x, pc.z);
    }
  }

  // ---------------------------------------------------------------- tick (10 Hz) + agendado
  update(dtMs = 100) {
    const now = this.host.now();
    for (const sid of this.hot) {
      const F = this.f.get(sid);
      if (!F) { this.hot.delete(sid); continue; }
      if (F.pending) this.advance(sid, F, now);
      this.refresh(sid, F, now, false, dtMs);
    }
    this.dummyAcc += dtMs;
    this.updateDummies(now, this.dummyAcc >= 1000);
    if (this.dummyAcc >= 1000) this.dummyAcc = 0;
  }

  /** só as janelas ativas vencidas (chamado no instante exato pela sala) */
  resolveDue() {
    const now = this.host.now();
    for (const sid of this.hot) { const F = this.f.get(sid); if (F?.pending) this.advance(sid, F, now); }
  }

  private advance(sid: string, F: Fighter, now: number) {
    const p = F.pending!;
    const me = this.host.actor(sid);
    // caiu/cambaleou/entrou em veículo durante a preparação: a ação some
    if (!me || me.vehicle || me.platform || (me.status !== PHYS.NORMAL && !(me.status === PHYS.STAGGERED && F.staggerUntil <= now))) { F.pending = null; return; }
    if (p.phase === 0 && now >= p.activeAt) { p.phase = 1; this.resolve(sid, me, F, p, now); if (p.hits) { F.pending = null; return; } this.host.schedule?.(Math.max(0, p.activeEnd - now)); }
    if (p.phase === 1 && now >= p.activeEnd) { p.phase = 2; this.resolve(sid, me, F, p, now); F.pending = null; }
  }

  /** janela ativa: candidatos da grade → alcance/arco/parede/estado/política → impacto */
  private resolve(sid: string, me: CombatActorView, F: Fighter, p: Pending, now: number) {
    const t0 = performance.now();
    const def = p.def, t = this.tuning;
    const reach = def.range + t.rangeSlackM;
    // quem está esquivando conta como alvo até o alcance + o deslocamento da esquiva (o golpe era nele: 'dodged')
    const dodgeReach = reach + this.dashM;
    const max = Math.max(1, def.maxTargets ?? 1);
    const found: { sid: string; a: CombatActorView; d: number }[] = [];
    this.host.forEachNear(me.x, me.z, dodgeReach + 1.2, (o) => { // grade do tick anterior: folga para quem andou
      if (o === sid || p.done?.has(o)) return;
      this.stats.candidates++;
      const a = this.host.actor(o);
      if (!a || a.vehicle || a.platform) return;
      if (a.status === PHYS.KNOCKED_DOWN || a.status === PHYS.GETTING_UP || a.status === PHYS.RAGDOLL) return;
      const d = Math.hypot(a.x - me.x, a.z - me.z);
      const dodging = (this.f.get(o)?.dodgeUntil ?? 0) > now;
      if (d > (dodging ? dodgeReach : reach) || !inArc(me.x, me.z, p.h, a.x, a.z, def.arcDeg + (dodging ? 50 : 0), t.arcSlackDeg)) return;
      if (this.host.walls && checkPath(this.host.walls, me, a, 'foot', 1.0).blocked) return;
      found.push({ sid: o, a, d });
    });
    found.sort((x, y) => x.d - y.d);
    const ev = this.combatEventFor(sid);
    const pa = this.party(sid, me, ev);
    for (const c of found.slice(0, max)) {
      const T = this.f.get(c.sid);
      if (!T) continue;
      (p.done ??= new Set()).add(c.sid); // cada alvo é decidido uma vez por golpe (início/fim da janela)
      const dx0 = c.a.x - me.x, dz0 = c.a.z - me.z, l = Math.hypot(dx0, dz0);
      const dx = l > 0.05 ? dx0 / l : Math.sin(p.h), dz = l > 0.05 ? dz0 / l : Math.cos(p.h);
      const base = { by: me.nid, tgt: c.a.nid, a: def.id, dx: r3(dx), dz: r3(dz) };
      if (T.dodgeUntil > now) {
        this.stats.dodged++;
        p.hits++;
        this.host.sendAoi(c.sid, 'cbt_hit', { ...base, r: 'dodged', st: c.a.status as PhysState } satisfies CombatHitEvent, sid);
        this.host.emit(c.sid, { type: 'combat_dodge' });
        continue;
      }
      const pol = combatAllowed(this.zonePolicy, pa, this.party(c.sid, c.a), ev, now, this.consent);
      if (!pol.ok) {
        this.stats.blocked++;
        // só os dois envolvidos (não polui a AOI)
        const hit: CombatHitEvent = { ...base, r: 'blocked', st: c.a.status as PhysState };
        this.host.send(sid, 'cbt_hit', hit); this.host.send(c.sid, 'cbt_hit', hit);
        continue;
      }
      p.hits++;
      this.impact(sid, me, F, c.sid, c.a, T, def, dx, dz, now, base);
    }
    if (p.hits < max) this.hitDummies(sid, me, F, p, now, max - p.hits);
    const ms = performance.now() - t0;
    this.stats.resolves++; this.stats.resolveMs += ms; this.stats.resolveMaxMs = Math.max(this.stats.resolveMaxMs, ms);
    this.host.onResolve?.(ms);
  }

  private impact(sid: string, me: CombatActorView, F: Fighter, tsid: string, ta: CombatActorView, T: Fighter, def: CombatActionDefinition, dx: number, dz: number, now: number, base: Omit<CombatHitEvent, 'r' | 'st'>) {
    const im = def.impact;
    this.stats.hits++;
    T.condition = Math.max(0, T.condition - im.condition);
    T.hitAt = now;
    T.engagedUntil = F.engagedUntil = now + ENGAGED_MS;
    if (im.disorientMs) T.disorientUntil = Math.max(T.disorientUntil, now + im.disorientMs);
    T.pending = null; // golpe recebido interrompe a preparação do alvo
    let st: PhysState = ta.status as PhysState, kb = 0;
    if (T.condition <= 0 || im.state === 'KNOCKED_DOWN') {
      st = PHYS.KNOCKED_DOWN;
      T.downAt = now; T.staggerUntil = 0;
      this.host.knockdown(tsid, me.x, me.z, Math.max(1.2, im.knockback), 1 + im.knockback / 2, sid, def.kind === 'push' ? 'push' : 'combat');
    } else if (im.state === 'STAGGERED' || im.knockback > 0) {
      if (im.knockback > 0) {
        const to = { x: ta.x + dx * im.knockback, z: ta.z + dz * im.knockback };
        const pc = this.host.walls ? checkPath(this.host.walls, ta, to, 'foot', 0.6) : { x: to.x, z: to.z };
        kb = Math.hypot(pc.x - ta.x, pc.z - ta.z);
        this.host.place(tsid, pc.x, pc.z);
      }
      if (im.state === 'STAGGERED') { st = PHYS.STAGGERED; T.staggerUntil = now + (im.staggerMs ?? 400); this.host.setStatus(tsid, PHYS.STAGGERED); }
    }
    this.host.sendAoi(tsid, 'cbt_hit', { ...base, r: 'hit', st, ...(kb ? { kb: r3(kb) } : {}) } satisfies CombatHitEvent, sid);
    this.refresh(tsid, T, now, true);
  }

  // ---------------------------------------------------------------- estado contínuo
  /** regeneração, fim do cambaleio, rede de segurança da queda, fx e cbt_self */
  private refresh(sid: string, F: Fighter, now: number, force: boolean, dtMs = 0) {
    const t = this.tuning;
    const me = this.host.actor(sid);
    if (!me) return;
    if (dtMs > 0) {
      if (F.stamina < t.staminaMax && now - F.spentAt >= t.staminaRegenDelayMs) F.stamina = Math.min(t.staminaMax, F.stamina + (t.staminaRegenPerS * dtMs) / 1000);
      if (me.status === PHYS.NORMAL && F.condition < t.conditionMax && now - F.hitAt >= t.conditionRegenDelayMs) F.condition = Math.min(t.conditionMax, F.condition + (t.conditionRegenPerS * dtMs) / 1000);
    }
    if (me.status === PHYS.STAGGERED && F.staggerUntil <= now) this.host.setStatus(sid, PHYS.NORMAL);
    if (F.downAt) {
      if (me.status === PHYS.NORMAL) { F.downAt = 0; F.condition = t.conditionMax; force = true; } // levantou: condição volta
      else if (now - F.downAt > t.downMs + t.getupMs + 2000) { this.host.setStatus(sid, PHYS.NORMAL); F.downAt = 0; F.condition = t.conditionMax; force = true; } // segurança
    }
    const fx = (me.immuneUntil > now ? FX.PROTECTED : 0) | (F.dodgeUntil > now ? FX.DODGING : 0) | (F.disorientUntil > now ? FX.DISORIENTED : 0) | (F.engagedUntil > now ? FX.ENGAGED : 0);
    if (fx !== F.fx) { F.fx = fx; this.host.setFx(sid, fx); force = true; }
    const st = Math.round(F.stamina), cd = Math.round(F.condition), s = F.sent;
    if ((st !== s.st || cd !== s.cd || fx !== s.fx) && (force || now - F.sentAt >= SELF_MIN_MS)) {
      F.sent = { st, cd, fx }; F.sentAt = now;
      this.host.send(sid, 'cbt_self', { st, cd, fx });
    }
    const idle = !F.pending && !F.downAt && fx === 0 && me.status === PHYS.NORMAL && F.stamina >= t.staminaMax && F.condition >= t.conditionMax && st === F.sent.st && cd === F.sent.cd && fx === F.sent.fx;
    if (idle) this.hot.delete(sid); else this.hot.add(sid);
  }

  // ---------------------------------------------------------------- bonecos de treino
  private dummyWire(d: Dummy): CombatDummyWire { return [d.def.id, d.def.x, d.def.z, d.def.heading, d.st, Math.round(d.cond)]; }

  private hitDummies(sid: string, me: CombatActorView, F: Fighter, p: Pending, now: number, room: number) {
    const def = p.def, t = this.tuning;
    const reach = def.range + t.rangeSlackM + 0.25; // raio do boneco
    for (const d of this.dummies) {
      if (room <= 0) return;
      if (d.st === PHYS.KNOCKED_DOWN || d.st === PHYS.GETTING_UP) continue;
      const dist = Math.hypot(d.def.x - me.x, d.def.z - me.z);
      if (dist > reach || !inArc(me.x, me.z, p.h, d.def.x, d.def.z, def.arcDeg, t.arcSlackDeg)) continue;
      if (this.host.walls && checkPath(this.host.walls, me, d.def, 'foot', 1.0).blocked) continue;
      room--; p.hits++;
      this.stats.dummyHits++;
      F.engagedUntil = now + ENGAGED_MS;
      const im = def.impact;
      d.cond = Math.max(0, d.cond - Math.max(im.condition, im.disorientMs ? 4 : 0));
      d.hitAt = now;
      if (d.cond <= 0 || im.state === 'KNOCKED_DOWN') { d.st = PHYS.KNOCKED_DOWN; d.until = now + d.def.resetMs; this.host.emit(sid, { type: 'dummy_knockdown' }); }
      else { d.st = PHYS.STAGGERED; d.until = now + (im.staggerMs ?? 400); }
      const l = Math.max(0.05, dist);
      const hit: CombatHitEvent = { by: me.nid, tgt: d.def.id, a: def.id, r: 'hit', dx: r3((d.def.x - me.x) / l), dz: r3((d.def.z - me.z) / l), st: d.st, dummy: 1 };
      this.host.sendNear(d.def.x, d.def.z, DUMMY_VIEW_M, 'cbt_hit', hit);
      d.dirty = true;
    }
  }

  private updateDummies(now: number, scan: boolean) {
    for (const d of this.dummies) {
      // cambaleio → normal; caído → levantando (0,8 s) → normal com condição cheia
      if (d.st === PHYS.STAGGERED && now >= d.until) { d.st = PHYS.NORMAL; d.dirty = true; }
      else if (d.st === PHYS.KNOCKED_DOWN && now >= d.until) { d.st = PHYS.GETTING_UP; d.until = now + 800; d.dirty = true; }
      else if (d.st === PHYS.GETTING_UP && now >= d.until) { d.st = PHYS.NORMAL; d.cond = d.def.conditionMax; d.dirty = true; }
      if (d.st === PHYS.NORMAL && d.cond < d.def.conditionMax && now - d.hitAt > 4000) { d.cond = d.def.conditionMax; d.dirty = true; }
      if (d.dirty) { d.dirty = false; this.host.sendNear(d.def.x, d.def.z, DUMMY_VIEW_M, 'cbt_dummy', this.dummyWire(d)); }
      if (!scan) continue;
      // 1 Hz: quem chegou perto recebe o estado; quem saiu é esquecido (recebe de novo ao voltar)
      const near = new Set<string>();
      this.host.forEachNear(d.def.x, d.def.z, DUMMY_VIEW_M, (sid) => { near.add(sid); if (!d.known.has(sid)) { d.known.add(sid); this.host.send(sid, 'cbt_dummy', this.dummyWire(d)); } });
      for (const sid of d.known) if (!near.has(sid)) d.known.delete(sid);
    }
  }

  // ---------------------------------------------------------------- compatibilidade / consulta
  /**
   * `push` antigo (F, alvo escolhido pelo cliente, regras canPush da rodada 5): continua aceito, mas o IMPACTO vem
   * da definição EMPURRÃO desta tabela (mesma queda, mesmo levantar/proteção).
   */
  /** empurrão antigo (`push`, tecla F): mesma política dos golpes (zona + evento + estado + proteção) — antes do impacto */
  pushPolicy(sid: string, tsid: string): { ok: true } | { ok: false; reason: string } {
    const me = this.host.actor(sid), ta = this.host.actor(tsid);
    if (!me || !ta) return { ok: false, reason: 'alvo_invalido' };
    const ev = this.combatEventFor(sid);
    return combatAllowed(this.zonePolicy, this.party(sid, me, ev), this.party(tsid, ta, ev), ev, this.host.now(), this.consent);
  }

  legacyPushImpact(sid: string, tsid: string) {
    const def = this.table.byKey.get('empurrao');
    const me = this.host.actor(sid), ta = this.host.actor(tsid), T = this.f.get(tsid), F = this.f.get(sid);
    if (!def || !me || !ta || !T || !F) return;
    const now = this.host.now();
    const dx0 = ta.x - me.x, dz0 = ta.z - me.z, l = Math.hypot(dx0, dz0);
    const dx = l > 0.05 ? dx0 / l : Math.sin(me.heading), dz = l > 0.05 ? dz0 / l : Math.cos(me.heading);
    this.host.emit(sid, { type: 'combat_action', key: def.key });
    this.impact(sid, me, F, tsid, ta, T, def, dx, dz, now, { by: me.nid, tgt: ta.nid, a: def.id, dx: r3(dx), dz: r3(dz) });
  }

  /** caiu por outro motivo (veículo): condição volta ao levantar, preparação cancelada */
  onKnockdown(sid: string) { const F = this.f.get(sid); if (F) { F.downAt = this.host.now(); F.pending = null; F.staggerUntil = 0; this.hot.add(sid); } }

  /** QA/testes */
  fighter(sid: string) {
    const F = this.f.get(sid);
    return F ? { stamina: F.stamina, condition: F.condition, fx: F.fx, busyUntil: F.busyUntil, pending: F.pending?.def.key ?? null, dodgeUntil: F.dodgeUntil, staggerUntil: F.staggerUntil } : null;
  }
  dummy(id: number) { const d = this.dummies.find((x) => x.def.id === id); return d ? { st: d.st, cond: d.cond } : null; }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
