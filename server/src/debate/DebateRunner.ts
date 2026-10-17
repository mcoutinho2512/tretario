/**
 * PALCO DE DEBATE em TEXTO (rodada 9) — runner do formato 'debate', SEM Colyseus (testável sem rede:
 * tests/debateRunner.test.ts). Forma do runner de eventos: start / tick / end / onJoin / onLeave / state. A sala só
 * repassa mensagens e dá ganchos (posições, vizinhos, envio, pipeline de texto do chat). Regras: src/events/debate.ts
 * · docs/DEBATES.md.
 *
 *  fila        `dbt_queue {inst, on}` — capacidade `debate.speak` (suspenso/banido/espectador não), perto do palco;
 *              ordem decidida AQUI (chegada), teto DEBATE_RULES.queueMax. Lugares: [orador, próximos da fila…]
 *  turno       turnSeconds dos DADOS (DebateSpec); acaba no tempo ou quando o orador passa a vez (`on:false`)
 *  falas       `dbt_say {inst, text}` só do orador do turno, pelo MESMO pipeline do chat (ChatService.screen:
 *              caracteres, textModeration, anti-flood por autor); vão a quem assiste, menos quem mutou o autor
 *  reações     `dbt_react {inst, r}` — capacidade `debate.react`, quem assiste, reactionsPerMin por autor; contagem
 *              AGREGADA por turno ("reações da plateia"), nunca votação/resultado
 *  plateia     quem está a ≤ aoiRadius do palco (recalculado a 1 Hz pela grade da sala) + quem abriu o painel
 *              (`dbt_watch`), + fila/orador. Estado `dbt` só para ela, na mudança e no máximo a 2 Hz
 *  denúncia    `dbt_report {id, category, details?}` → Report DEBATE_LINE com a cópia do servidor (anel de 15 min)
 */
import type { DebateReaction, DebateSpec, ScheduledEventDef } from '../../../src/events/schedule';
import { DEBATE_REACTIONS, DEBATE_RULES, REACTION_ACTION, debateSeats, type DebateDenial, type DebateLine, type DebateMe, type DebateStateWire } from '../../../src/events/debate';
import { REPORT_CATEGORIES, type ChatRejection, type ReportCategory } from '../../../src/chat/protocol';
import { textModeration } from '../../../src/moderation/text';
import { can, type Capability } from '../../../src/access/policy';
import type { AccessState, WorldRole } from '../../../src/identity/types';
import type { GameplayEvent } from '../../../src/gameplay/events';
import type { DataStore } from '../data/types';
import { CHAT_SERVER } from '../chat/ChatService';

export interface DebateWho { nick: string; nid: number; state: AccessState; role: WorldRole; userId: string | null }

export interface DebateHooks {
  send(sid: string, type: string, msg: unknown): void;
  /** identidade ATUAL (a releitura do banco pode suspender alguém no meio do turno) */
  who(sid: string): DebateWho | undefined;
  /** posição autoritativa do jogador (espectador: undefined) */
  pos(sid: string): { x: number; z: number } | undefined;
  /** conexões (jogadores e espectadores) a ≤ r de (x, z) — grade da sala */
  near(x: number, z: number, r: number, fn: (sid: string) => void): void;
  /** pipeline de texto do chat (ChatService.screen) com a capacidade do canal */
  screen(sid: string, text: unknown, cap: Capability, now: number): { ok: true; text: string; key: string } | { ok: false; reason: ChatRejection; retryMs: number };
  /** chave de autor (conta/conexão) e mute por identidade (ChatService) */
  keyOf(sid: string): string | null;
  mutes(viewer: string, authorKey: string): boolean;
  emit?(sid: string, ev: GameplayEvent, now: number): void;
  /** gesto do personagem ao reagir (ação social existente, validada pela sala) */
  gesture?(sid: string, actionKey: string): void;
  log?(m: string): void;
}

export interface DebateRunnerOptions {
  store?: Pick<DataStore, 'reports'> | null;
  eventId?: string;
}

interface Kept { line: DebateLine; authorKey: string; authorUserId: string | null; authorSid: string; to: Set<string>; reporters: Set<string> }

export type DebateResult = { ok: true } | { ok: false; reason: DebateDenial; retryMs?: number };

const ZERO = (): Record<DebateReaction, number> => ({ aplauso: 0, positiva: 0, negativa: 0 });

export class DebateRunner {
  readonly spec: DebateSpec;
  readonly seatsAt: { x: number; z: number }[];
  inst: string | null = null;
  private topicIdx = 0;
  private queue: string[] = [];
  private speaker: string | null = null;
  private spoke = false;
  private turnEndsAt = 0;
  private gapUntil = 0;
  private turn = 0;
  private reactions = ZERO();
  private nextAt = 0;
  /** plateia: perto (1 Hz) ∪ assistindo pelo painel ∪ fila/orador */
  private nearSet = new Set<string>();
  private watching = new Set<string>();
  private audience = new Set<string>();
  private reactTimes = new Map<string, number[]>();
  private reportTimes = new Map<string, number[]>();
  private watchAcc = new Map<string, number>();
  private kept = new Map<string, Kept>();
  private recent: { line: DebateLine; authorKey: string }[] = [];
  private me = new Map<string, string>();
  private nextId = 1;
  private dirty = true;
  private lastSent = 0;
  private lastRefresh = 0;
  private store: DebateRunnerOptions['store'];
  private eventId: string;
  /** QA/métricas */
  stats = { states: 0, stateBytes: 0, lines: 0, denied: 0, reactions: 0, reactDenied: 0, reports: 0, turns: 0 };

  constructor(readonly def: ScheduledEventDef, readonly spot: { x: number; z: number; heading: number }, private hooks: DebateHooks, o: DebateRunnerOptions = {}) {
    if (!def.debate) throw new Error(`evento ${def.id} sem DebateSpec`);
    this.spec = def.debate;
    this.seatsAt = debateSeats(spot, Math.max(1, this.spec.seats));
    this.store = o.store ?? null;
    this.eventId = o.eventId ?? '';
  }

  // ------------------------------------------------------------------ ciclo (forma dos runners de evento)
  start(inst: string, now = Date.now()) {
    if (this.inst === inst) return;
    this.inst = inst;
    this.queue = []; this.speaker = null; this.turn = 0; this.reactions = ZERO(); this.recent = []; this.gapUntil = now;
    // tema: rodízio estável pela instância (mesma instância → mesmo tema em qualquer processo)
    let h = 0; for (const c of inst) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    this.topicIdx = this.spec.topics.length ? h % this.spec.topics.length : 0;
    this.dirty = true;
    this.lastRefresh = 0;
  }

  end(now = Date.now(), nextAt = 0) {
    if (this.speaker) this.endTurn(now);
    this.inst = null;
    this.queue = []; this.speaker = null;
    this.nextAt = nextAt;
    this.dirty = true;
    this.flushMe();
  }

  /** próximo início (fora de um debate) — só exibição */
  setNext(at: number) { if (this.nextAt !== at) { this.nextAt = at; if (!this.inst) this.dirty = true; } }

  onJoin(_sid: string) { /* a plateia é pela proximidade (próximo refresh) ou pelo painel */ }

  onLeave(sid: string, now = Date.now()) {
    this.watching.delete(sid); this.nearSet.delete(sid); this.audience.delete(sid); this.me.delete(sid); this.watchAcc.delete(sid);
    const qi = this.queue.indexOf(sid);
    if (qi >= 0) { this.queue.splice(qi, 1); this.dirty = true; this.flushMe(); }
    if (this.speaker === sid) this.endTurn(now);
  }

  tick(now = Date.now()) {
    if (now - this.lastRefresh >= 1000) { const dt = this.lastRefresh ? Math.min(2, (now - this.lastRefresh) / 1000) : 0; this.lastRefresh = now; this.refresh(now, dt); }
    if (this.inst) {
      if (this.speaker && now >= this.turnEndsAt) this.endTurn(now);
      if (!this.speaker && this.queue.length && now >= this.gapUntil) this.nextTurn(now);
    }
    if (this.dirty && now - this.lastSent >= 1000 / DEBATE_RULES.stateHz) this.broadcastState(now);
  }

  state(): DebateStateWire {
    const s = this.spec;
    const who = (sid: string | null) => (sid ? this.hooks.who(sid)?.nick ?? '—' : null);
    const seats: (string | null)[] = [who(this.speaker)];
    for (let i = 0; i < s.seats - 1; i++) seats.push(who(this.queue[i] ?? null));
    return {
      inst: this.inst ?? '', topic: this.inst ? s.topics[this.topicIdx] ?? '' : '', speaker: who(this.speaker), turnEndsAt: this.speaker ? this.turnEndsAt : 0,
      queue: this.queue.map((q) => who(q)!), reactions: { ...this.reactions },
      active: !!this.inst, nextAt: this.nextAt, seats, turn: this.turn, turns: s.turns, turnSeconds: s.turnSeconds,
      nid: this.speaker ? this.hooks.who(this.speaker)?.nid ?? 0 : 0,
    };
  }

  // ------------------------------------------------------------------ turnos
  private nextTurn(now: number) {
    // quem perdeu a permissão (suspenso na releitura) sai da fila antes de subir
    while (this.queue.length && !this.canSpeak(this.queue[0])) this.queue.shift();
    const sid = this.queue.shift();
    if (!sid) { this.dirty = true; this.flushMe(); return; }
    this.speaker = sid;
    this.spoke = false;
    this.turn++;
    this.turnEndsAt = now + this.spec.turnSeconds * 1000;
    this.reactions = ZERO();
    this.dirty = true;
    this.flushMe();
  }

  private endTurn(now: number) {
    const sid = this.speaker;
    if (!sid) return;
    if (this.spoke) { this.hooks.emit?.(sid, { type: 'debate_turn' }, now); this.stats.turns++; }
    this.speaker = null;
    this.gapUntil = now + DEBATE_RULES.gapMs;
    // fim dos turnos do tema: próximo tema (o debate segue enquanto a instância estiver ativa)
    if (this.turn >= this.spec.turns) { this.turn = 0; this.topicIdx = (this.topicIdx + 1) % Math.max(1, this.spec.topics.length); }
    this.dirty = true;
    this.flushMe();
  }

  private canSpeak(sid: string) { const w = this.hooks.who(sid); return !!w && can(w.state, 'debate.speak', w.role); }
  private canReact(sid: string) { const w = this.hooks.who(sid); return !!w && can(w.state, 'debate.react', w.role); }

  // ------------------------------------------------------------------ plateia (1 Hz)
  private refresh(now: number, dt: number) {
    const near = new Set<string>();
    this.hooks.near(this.spot.x, this.spot.z, DEBATE_RULES.aoiRadius, (sid) => near.add(sid));
    this.nearSet = near;
    const next = new Set<string>([...near, ...this.watching, ...this.queue]);
    if (this.speaker) next.add(this.speaker);
    for (const sid of next) if (!this.audience.has(sid)) this.greet(sid);
    for (const sid of this.audience) if (!next.has(sid)) { this.hooks.send(sid, 'dbt_bye', { inst: this.inst ?? '' }); this.me.delete(sid); this.watchAcc.delete(sid); }
    this.audience = next;
    // orador suspenso no meio do turno: o turno acaba
    if (this.speaker && !this.canSpeak(this.speaker)) this.endTurn(now);
    // assistir: segundos em lotes (só com debate em andamento e alguém falando)
    if (this.inst && this.speaker && dt > 0) {
      for (const sid of this.audience) {
        if (sid === this.speaker || !this.hooks.who(sid)) continue;
        const acc = (this.watchAcc.get(sid) ?? 0) + dt;
        if (acc >= DEBATE_RULES.watchBatchS) { this.hooks.emit?.(sid, { type: 'debate_watch', seconds: DEBATE_RULES.watchBatchS }, now); this.watchAcc.set(sid, acc - DEBATE_RULES.watchBatchS); }
        else this.watchAcc.set(sid, acc);
      }
    }
  }

  /** entrou na plateia: estado + últimas falas (sem as dos mutados) + posição pessoal */
  private greet(sid: string) {
    this.hooks.send(sid, 'dbt', this.state());
    for (const r of this.recent) if (!this.hooks.mutes(sid, r.authorKey)) this.hooks.send(sid, 'dbt_line', r.line);
    this.sendMe(sid, true);
  }

  private broadcastState(now: number) {
    this.dirty = false;
    this.lastSent = now;
    const st = this.state();
    this.stats.states++;
    this.stats.stateBytes += JSON.stringify(st).length;
    for (const sid of this.audience) this.hooks.send(sid, 'dbt', st);
  }

  private meOf(sid: string): DebateMe {
    const w = this.hooks.who(sid);
    const speak = !!w && can(w.state, 'debate.speak', w.role), react = !!w && can(w.state, 'debate.react', w.role);
    const why = speak ? undefined : !w ? 'sem_permissao' : w.role === 'spectator' ? 'espectador' : w.state === 'SUSPENDED' ? 'suspenso' : 'sem_licenca';
    return { inst: this.inst ?? '', pos: this.queue.indexOf(sid) + 1, speaking: this.speaker === sid, canSpeak: speak, canReact: react, ...(why ? { why } : {}) };
  }

  /** posição pessoal: só a quem mudou */
  private sendMe(sid: string, force = false) {
    const m = this.meOf(sid), k = JSON.stringify(m);
    if (!force && this.me.get(sid) === k) return;
    this.me.set(sid, k);
    this.hooks.send(sid, 'dbt_me', m);
  }
  private flushMe() { for (const sid of this.audience) this.sendMe(sid); for (const sid of this.queue) if (!this.audience.has(sid)) this.sendMe(sid); }

  // ------------------------------------------------------------------ mensagens
  private deny(sid: string, kind: string, reason: DebateDenial, retryMs = 0): DebateResult {
    this.stats.denied++;
    this.hooks.send(sid, 'dbt_denied', { kind, reason, retryMs });
    return { ok: false, reason, retryMs };
  }

  private sameInst(raw: { inst?: unknown }) { return !raw.inst || raw.inst === this.inst; }

  /** `dbt_watch {on}` — abrir o painel de longe (pela agenda) */
  watch(sid: string, raw: unknown): DebateResult {
    const m = (raw ?? {}) as { on?: unknown };
    if (!this.hooks.who(sid)) return this.deny(sid, 'watch', 'sem_permissao');
    if (m.on === false) { this.watching.delete(sid); this.lastRefresh = 0; return { ok: true }; }
    if (this.watching.size >= DEBATE_RULES.watchMax && !this.watching.has(sid)) return this.deny(sid, 'watch', 'lotado');
    this.watching.add(sid);
    if (!this.audience.has(sid)) { this.audience.add(sid); this.greet(sid); }
    return { ok: true };
  }

  /** `dbt_queue {inst, on}` — entrar/sair da fila; o orador com `on:false` passa a vez */
  queueReq(sid: string, raw: unknown, now = Date.now()): DebateResult {
    const m = (raw ?? {}) as { inst?: unknown; on?: unknown };
    if (!this.canSpeak(sid)) return this.deny(sid, 'queue', 'sem_permissao');
    if (!this.inst || !this.sameInst(m)) return this.deny(sid, 'queue', 'inativo');
    if (m.on === false) {
      if (this.speaker === sid) { this.endTurn(now); return { ok: true }; }
      const i = this.queue.indexOf(sid);
      if (i >= 0) { this.queue.splice(i, 1); this.dirty = true; this.flushMe(); }
      return { ok: true };
    }
    if (this.speaker === sid || this.queue.includes(sid)) { this.sendMe(sid, true); return { ok: true }; }
    const p = this.hooks.pos(sid);
    if (!p || Math.hypot(p.x - this.spot.x, p.z - this.spot.z) > DEBATE_RULES.queueRadius) return this.deny(sid, 'queue', 'longe');
    if (this.queue.length >= Math.min(DEBATE_RULES.queueMax, this.def.capacity || DEBATE_RULES.queueMax)) return this.deny(sid, 'queue', 'lotado');
    this.queue.push(sid);
    if (!this.audience.has(sid)) { this.audience.add(sid); this.greet(sid); }
    this.dirty = true;
    this.flushMe();
    if (!this.speaker && now >= this.gapUntil) this.nextTurn(now);
    return { ok: true };
  }

  /** `dbt_say {inst, text}` — só o orador do turno; texto pelo pipeline do chat */
  say(sid: string, raw: unknown, now = Date.now()): DebateResult & { id?: string } {
    const m = (raw ?? {}) as { inst?: unknown; text?: unknown };
    if (!this.canSpeak(sid)) return this.deny(sid, 'say', 'sem_permissao');
    if (!this.inst || !this.sameInst(m)) return this.deny(sid, 'say', 'inativo');
    if (this.speaker !== sid || now >= this.turnEndsAt) return this.deny(sid, 'say', 'nao_e_sua_vez');
    const v = this.hooks.screen(sid, m.text, 'debate.speak', now);
    if (!v.ok) return this.deny(sid, 'say', v.reason === 'sem_grupo' ? 'invalido' : v.reason, v.retryMs);
    const w = this.hooks.who(sid)!;
    const line: DebateLine = { id: `d${(this.nextId++).toString(36)}`, inst: this.inst, nick: w.nick, nid: w.nid, text: v.text, t: now, turn: this.turn };
    const to = new Set<string>();
    for (const q of this.audience) { if (q !== sid && this.hooks.mutes(q, v.key)) continue; to.add(q); this.hooks.send(q, 'dbt_line', line); }
    if (!this.audience.has(sid)) { to.add(sid); this.hooks.send(sid, 'dbt_line', line); }
    this.spoke = true;
    this.stats.lines++;
    this.recent.push({ line, authorKey: v.key });
    if (this.recent.length > DEBATE_RULES.linesShown) this.recent.shift();
    this.kept.set(line.id, { line, authorKey: v.key, authorUserId: w.userId, authorSid: sid, to, reporters: new Set() });
    for (const [id, k] of this.kept) { if (this.kept.size <= DEBATE_RULES.keepMax && now - k.line.t <= DEBATE_RULES.keepMs) break; this.kept.delete(id); }
    return { ok: true, id: line.id };
  }

  /** `dbt_react {inst, r}` — plateia, limite por minuto, contagem agregada do turno */
  react(sid: string, raw: unknown, now = Date.now()): DebateResult {
    const m = (raw ?? {}) as { inst?: unknown; r?: unknown };
    const deny = (reason: DebateDenial, retryMs = 0) => { this.stats.reactDenied++; return this.deny(sid, 'react', reason, retryMs); };
    if (!this.canReact(sid)) return deny('sem_permissao');
    if (!this.inst || !this.sameInst(m) || !this.speaker) return deny('inativo');
    if (!DEBATE_REACTIONS.includes(m.r as DebateReaction)) return deny('invalido');
    if (!this.audience.has(sid)) return deny('nao_assiste');
    const key = this.hooks.keyOf(sid) ?? `s:${sid}`;
    const ts = (this.reactTimes.get(key) ?? []).filter((t) => now - t < 60_000);
    if (ts.length >= this.spec.reactionsPerMin) { this.reactTimes.set(key, ts); return deny('limite', 60_000 - (now - ts[0])); }
    ts.push(now); this.reactTimes.set(key, ts);
    const r = m.r as DebateReaction;
    this.reactions[r]++;
    this.stats.reactions++;
    this.dirty = true;
    this.hooks.emit?.(sid, { type: 'debate_react' }, now);
    const g = REACTION_ACTION[r];
    if (g) this.hooks.gesture?.(sid, g);
    return { ok: true };
  }

  /** mute por identidade feito no chat: esconde na hora as falas do alvo que o dono já recebeu */
  muted(ownerSids: string[], authorKey: string, on: boolean) {
    if (!on) return;
    for (const sid of ownerSids) {
      const ids: string[] = [];
      for (const k of this.kept.values()) if (k.authorKey === authorKey && k.to.has(sid)) ids.push(k.line.id);
      if (ids.length) this.hooks.send(sid, 'dbt_hide', { ids });
    }
  }

  /** `dbt_report {id, category, details?}` → Report DEBATE_LINE com a cópia do servidor como evidência */
  async report(sid: string, raw: unknown, now = Date.now()): Promise<{ ok: boolean; id: string; r?: string }> {
    const m = (raw ?? {}) as { id?: unknown; category?: unknown; details?: unknown };
    const id = typeof m.id === 'string' ? m.id.slice(0, 16) : '';
    const res = (ok: boolean, r?: string) => { const out = { ok, id, ...(r ? { r } : {}) }; this.hooks.send(sid, 'dbt_report_res', out); return out; };
    const w = this.hooks.who(sid);
    if (!w || !can(w.state, 'report.create', w.role)) return res(false, 'sem_permissao');
    const k = this.kept.get(id);
    if (!k || now - k.line.t > DEBATE_RULES.keepMs || !k.to.has(sid)) return res(false, 'inexistente');
    const key = this.hooks.keyOf(sid) ?? `s:${sid}`;
    if (k.authorKey === key) return res(false, 'propria');
    if (k.reporters.has(key)) return res(false, 'repetida');
    const times = (this.reportTimes.get(key) ?? []).filter((t) => now - t < CHAT_SERVER.reportWindowMs);
    if (times.length >= CHAT_SERVER.reportMax) { this.reportTimes.set(key, times); return res(false, 'limite'); }
    times.push(now); this.reportTimes.set(key, times);
    k.reporters.add(key);
    const category: ReportCategory = REPORT_CATEGORIES.includes(m.category as ReportCategory) ? (m.category as ReportCategory) : 'OUTRO';
    const details = typeof m.details === 'string' ? textModeration.sanitize(m.details, 'chat').slice(0, CHAT_SERVER.reportDetailsMax) || null : null;
    const context: { text: string; t: number }[] = [];
    for (const o of this.kept.values()) if (o.authorKey === k.authorKey && o.line.id !== id && o.line.t <= k.line.t && o.line.inst === k.line.inst) context.push({ text: o.line.text, t: o.line.t });
    const evidence = {
      kind: 'debate', lineId: id, inst: k.line.inst, eventDef: this.def.id, topic: this.spec.topics[this.topicIdx] ?? '', turn: k.line.turn,
      text: k.line.text, at: new Date(k.line.t).toISOString(), authorNick: k.line.nick, authorUserId: k.authorUserId,
      ...(k.authorUserId ? {} : { authorConnection: k.authorSid }), recipients: k.to.size, context: context.slice(-3),
    };
    this.stats.reports++;
    let reportId = '—';
    if (this.store) {
      try {
        reportId = (await this.store.reports.create({
          reporterUserId: w.userId && !w.userId.startsWith('test:') ? w.userId : null, targetUserId: k.authorUserId && !k.authorUserId.startsWith('test:') ? k.authorUserId : null,
          targetType: 'DEBATE_LINE', targetRef: `debate:${k.line.inst}:${id}`, category, details, evidence, eventId: this.eventId || null, reportedNicknameAtTime: k.line.nick,
        })).id;
      } catch (e) { this.hooks.log?.(`falha ao gravar denúncia: ${(e as Error).message}`); return res(false, 'erro'); }
    }
    this.hooks.log?.(`denúncia ${reportId} (${category}) da fala ${id} por ${w.nick}`);
    return res(true);
  }

  // ------------------------------------------------------------------ limpeza / QA
  sweep(now = Date.now()): number {
    let n = 0;
    for (const [k, ts] of this.reactTimes) if (ts.every((t) => now - t >= 60_000)) { this.reactTimes.delete(k); n++; }
    for (const [k, ts] of this.reportTimes) if (ts.every((t) => now - t >= CHAT_SERVER.reportWindowMs)) { this.reportTimes.delete(k); n++; }
    for (const [id, k] of this.kept) { if (now - k.line.t <= DEBATE_RULES.keepMs) break; this.kept.delete(id); n++; }
    return n;
  }

  get speakerSid() { return this.speaker; }
  get queueSids(): readonly string[] { return this.queue; }
  get audienceSize() { return this.audience.size; }
  isAudience(sid: string) { return this.audience.has(sid); }
  info() { return { inst: this.inst, turn: this.turn, speaker: !!this.speaker, queue: this.queue.length, audience: this.audience.size, near: this.nearSet.size, watching: this.watching.size, kept: this.kept.size, ...this.stats }; }
}
