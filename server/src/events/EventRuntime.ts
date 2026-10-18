/**
 * EVENT RUNTIME (rodada 9) — agenda e máquina de estados dos eventos agendados do mundo, sem Colyseus.
 *
 *  agenda      lê `agenda` do EventDef atual; ocorrências recorrentes no relógio do SERVIDOR (src/events/recurrence.ts)
 *  estados     SCHEDULED → REGISTRATION → STARTING → ACTIVE → FINISHED; CANCELLED se o mínimo de inscritos (humanos)
 *              não é atingido no início (minParticipants 0 = acontece mesmo vazio: NPCs mantêm vivo)
 *  inscrição   evt_join/evt_leave: estado, capacidade, groupRules.allowed (chave por igualdade), uma inscrição viva
 *              por PARTICIPANTE; o runner do formato pode negar (corrida: 'veiculo')
 *  identidade  a inscrição é da chave de participante (`u:<conta>`; sem conta `s:<sessão>` — a mesma ideia de autor do
 *              chat), não da conexão: chave → sessão atual. Login duplicado (takeOver da sala) chama `attach(nova)`
 *              → a inscrição e o estado do runner (checkpoints, acompanhamento, lado) passam para a sessão nova, sem
 *              duplicar. Reconexão pelo token do Colyseus mantém o sessionId: `reconnected` só reenvia agenda/estado
 *  graça       queda com graça de reconexão MANTÉM a inscrição (a entidade fica no mundo); só a saída de vez
 *              (`gone`, chamado no onLeave da sala — graça vencida ou saída) desiste (forfeit). `gone` de uma sessão
 *              que já não é a atual da chave (substituída) não mexe na inscrição
 *  retenção    instância encerrada (FINISHED/CANCELLED) larga runner, inscritos e acompanhantes na hora; guarda só o
 *              resumo (`results`: linhas posição/tempo/status, placar, nº de conclusões, nº de inscritos) pela janela
 *              `recentMs` da agenda (ENCERRADOS RECENTEMENTE) e depois some. XP/progressão já foi gravado pelo
 *              ProgressionService via gameplay (event_complete/race_finish) — nada aqui é persistido
 *  mensagens   `agenda {list}` a todos ao entrar e quando muda (≤ 1 Hz) · `evt_pts` (concentrações) idem · `evt_res`
 *  gameplay    event_join ao inscrever; event_complete (ctx.complete) e race_finish (runner de corrida)
 *  confronto   combatEventFor(sid) → CombatEventRules da instância ATIVA de confronto em que está inscrito;
 *              zonePolicy(zone) → política do evento ATIVO nas suas zonas (ScheduledEventDef.combatPolicy)
 */
import type { AgendaEntry, EventJoinDenial, EventState, ScheduledEventDef } from '../../../src/events/schedule';
import type { EventPointWire, EventResultRow } from '../../../src/events/schedule';
import type { CombatEventRules, ZoneCombatPolicy } from '../../../src/combat/policy';
import { instanceId, occurrencesAround, timeState, type OccurrenceTimes } from '../../../src/events/recurrence';
import { resolvePoint } from '../../../src/events/route';
import type { EventHost, EventInstance, EventRallyPoint, EventRunner, RunnerContext } from './runner';
import { RUNNERS } from './runners';

const ORDER: EventState[] = ['SCHEDULED', 'REGISTRATION', 'STARTING', 'ACTIVE', 'FINISHED'];
const LIVE: ReadonlySet<EventState> = new Set(['REGISTRATION', 'STARTING', 'ACTIVE']);

/** resumo guardado de uma instância encerrada (pela janela recente da agenda) */
export interface EventResults { rows: EventResultRow[]; score?: Record<string, number>; completed: number; count: number }

interface Live {
  inst: EventInstance;
  times: OccurrenceTimes;
  runner: EventRunner | null;
  /** encerrada: só o resumo (runner/inscritos já soltos) */
  results: EventResults | null;
  ctx: RunnerContext;
  watchers: Set<string>;
  /** CANCELLED/FINISHED decidido pelo runtime (antes do horário) */
  forced: boolean;
  endedAt: number;
}

export interface RuntimeOptions {
  /** origem da recorrência (ms); testes/QA deslocam para começar "agora" */
  epoch?: number;
  /** quanto tempo uma instância encerrada continua na agenda (ms) */
  recentMs?: number;
  /** intervalo mínimo entre envios de agenda/pontos (ms) */
  minSendMs?: number;
  clock?: () => number;
}

export type JoinResult = { ok: true } | { ok: false; r: EventJoinDenial };

export class EventRuntime {
  private live = new Map<string, Live>();
  /** chave de participante → instância em que está inscrito */
  private memberOf = new Map<string, string>();
  /** chave de participante → sessão atual · sessão → chave (só de inscritos) */
  private sess = new Map<string, string>();
  private keyOf = new Map<string, string>();
  private prot = new Map<string, number>();
  private agendaSig = '';
  private agendaAt = -1e15;
  private agendaDirty = true;
  private lastNow = Date.now();
  private ptsSig = '';
  private ptsAt = -1e15;
  private ptsList: EventPointWire[] = [];
  private readonly epoch: number;
  private readonly recentMs: number;
  private readonly minSendMs: number;
  private readonly clock: () => number;
  stats = { instances: 0, agendaSends: 0, ptsSends: 0, joins: 0, denials: 0, cancelled: 0, finished: 0, rebinds: 0 };

  constructor(readonly defs: readonly ScheduledEventDef[], private host: EventHost, private axis: readonly [number, number][], opts: RuntimeOptions = {}) {
    this.epoch = opts.epoch ?? 0;
    this.recentMs = opts.recentMs ?? 10 * 60_000;
    this.minSendMs = opts.minSendMs ?? 1000;
    this.clock = opts.clock ?? Date.now;
  }

  // ---------------------------------------------------------------- ciclo
  tick(now = this.clock(), dtMs = 100) {
    for (const def of this.defs) {
      for (const o of occurrencesAround(def, now, this.epoch, this.recentMs)) {
        const id = instanceId(def.id, o.startsAt);
        if (this.live.has(id) || timeState(o, now) === 'FINISHED') continue; // ocorrência já passada no boot: não inventa histórico
        this.create(def, o, id);
      }
    }
    for (const L of this.live.values()) {
      this.advance(L, now);
      const st = L.inst.state;
      if (L.runner && (st === 'STARTING' || st === 'ACTIVE')) L.runner.tick(L.ctx, now, dtMs);
    }
    for (const [id, L] of this.live) if ((L.inst.state === 'FINISHED' || L.inst.state === 'CANCELLED') && now > L.endedAt + this.recentMs) this.live.delete(id);
    for (const [sid, until] of this.prot) if (until <= now) { this.prot.delete(sid); this.host.protect?.(sid, 0); }
    for (const [sid, at] of this.helloAgain) if (now >= at) { this.helloAgain.delete(sid); this.hello(sid); this.helloAgain.delete(sid); this.resume(sid); }
    // agenda de outros sistemas (debate) muda sozinha: a assinatura em sendAgenda evita reenvio sem mudança
    this.lastNow = now;
    if (this.host.extraAgenda) this.agendaDirty = true;
    this.sendAgenda(now);
    this.sendPoints(now);
  }

  private create(def: ScheduledEventDef, o: OccurrenceTimes, id: string) {
    const inst: EventInstance = {
      inst: id, def, state: 'SCHEDULED', opensAt: o.opensAt, countdownAt: o.countdownAt, startsAt: o.startsAt, endsAt: o.endsAt,
      members: new Set(), completed: new Set(), zone: def.zones?.[0] ?? '',
    };
    const watchers = new Set<string>();
    const L: Live = { inst, times: o, runner: null, results: null, watchers, forced: false, endedAt: 0, ctx: null as unknown as RunnerContext };
    L.ctx = {
      inst, host: this.hostProxy, watchers, axis: this.axis,
      point: (p) => resolvePoint(this.axis, p),
      now: () => this.clock(),
      complete: (sid) => this.complete(L, sid),
      finish: () => this.finish(L, this.clock()),
      sendMembers: (type, msg) => { for (const sid of new Set([...inst.members, ...watchers])) this.host.send(sid, type, msg); },
    };
    const f = RUNNERS.get(def.format);
    L.runner = f ? f(def) : null;
    this.live.set(id, L);
    this.stats.instances++;
    this.agendaDirty = true;
  }

  /** host com a proteção rastreada aqui (expira no tick; a sala só liga/desliga o bit) */
  private hostProxy: EventHost = new Proxy({} as EventHost, {
    get: (_t, k: keyof EventHost) => {
      if (k === 'protect') return (sid: string, until: number) => { if (until > 0) this.prot.set(sid, until); else this.prot.delete(sid); this.host.protect?.(sid, until); };
      const v = this.host[k];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(this.host) : v;
    },
  });

  /** avança pelos estados do horário, um de cada vez (cada transição tem seu efeito) */
  private advance(L: Live, now: number) {
    if (L.forced) return;
    const target = ORDER.indexOf(timeState(L.times, now));
    for (let i = ORDER.indexOf(L.inst.state); i < target && !L.forced; i++) {
      const next = ORDER[i + 1];
      if (next === 'ACTIVE') {
        const min = L.inst.def.minParticipants ?? 0;
        if (min > 0 && L.inst.members.size < min) { this.cancel(L, now); return; }
      }
      if (next === 'FINISHED') { this.finish(L, now); return; }
      L.inst.state = next;
      this.agendaDirty = true;
      if (next === 'STARTING') L.runner?.prepare?.(L.ctx);
      if (next === 'ACTIVE') L.runner?.start(L.ctx);
    }
  }

  private finish(L: Live, now: number) {
    if (L.forced || L.inst.state === 'FINISHED' || L.inst.state === 'CANCELLED') return;
    L.forced = true;
    L.inst.state = 'FINISHED';
    L.inst.endsAt = Math.min(L.inst.endsAt, now);
    L.endedAt = now;
    this.stats.finished++;
    L.runner?.end(L.ctx, 'finished');
    this.release(L, true);
  }

  private cancel(L: Live, now: number) {
    L.forced = true;
    L.inst.state = 'CANCELLED';
    L.endedAt = now;
    this.stats.cancelled++;
    L.runner?.end(L.ctx, 'cancelled');
    this.release(L, false);
  }

  /** encerrou: solta as inscrições e todo o estado vivo; fica só o resumo (retenção: cabeçalho) */
  private release(L: Live, finished: boolean) {
    const r = finished ? L.runner?.results?.(L.ctx) ?? null : null;
    L.results = { rows: r?.rows ?? [], ...(r?.score ? { score: r.score } : {}), completed: L.inst.completed.size, count: L.inst.members.size };
    for (const sid of L.inst.members) { const k = this.keyOf.get(sid); if (k && this.memberOf.get(k) === L.inst.inst) this.unbind(k); }
    L.inst.members.clear(); L.inst.completed.clear(); L.watchers.clear();
    L.runner = null;
    this.agendaDirty = true;
  }

  // ---------------------------------------------------------------- identidade (chave de participante → sessão)
  private keyFor(sid: string) { return this.keyOf.get(sid) ?? this.host.participantKey?.(sid) ?? `s:${sid}`; }
  private instOf(sid: string) { const k = this.keyOf.get(sid); return k ? this.memberOf.get(k) : undefined; }
  private unbind(k: string) { const s = this.sess.get(k); this.memberOf.delete(k); this.sess.delete(k); if (s !== undefined && this.keyOf.get(s) === k) this.keyOf.delete(s); }

  /**
   * sessão nova de jogador (onJoin da sala, ANTES do takeOver): se a chave dela (conta) tem inscrição viva noutra
   * sessão, a inscrição e o estado do runner passam para esta — o participante é o mesmo, a contagem não muda
   */
  attach(sid: string) {
    const k = this.host.participantKey?.(sid) ?? `s:${sid}`;
    const old = this.sess.get(k);
    if (old === undefined || old === sid) return;
    const L = this.live.get(this.memberOf.get(k) ?? '');
    if (L) {
      const swap = (set: Set<string>) => { if (set.delete(old)) set.add(sid); };
      swap(L.inst.members); swap(L.inst.completed);
      L.runner?.rebind?.(L.ctx, old, sid);
    }
    for (const l of this.live.values()) if (l.watchers.delete(old)) l.watchers.add(sid);
    const p = this.prot.get(old);
    if (p !== undefined) { this.prot.delete(old); this.prot.set(sid, p); }
    this.keyOf.delete(old); this.keyOf.set(sid, k); this.sess.set(k, sid);
    this.helloAgain.delete(old);
    this.helloAgain.set(sid, this.clock() + 1500); // agenda (joined) e estado do runner de novo, com os ouvintes prontos
    this.stats.rebinds++;
    this.agendaDirty = true;
  }

  /** voltou pela reconexão (mesmo sessionId): agenda e estado do formato de novo (ex.: race_def) */
  reconnected(sid: string) { this.hello(sid); this.resume(sid); }

  private resume(sid: string) {
    const L = this.live.get(this.instOf(sid) ?? '');
    if (L && LIVE.has(L.inst.state)) L.runner?.watch?.(L.ctx, sid);
  }

  private complete(L: Live, sid: string) {
    if (!L.inst.members.has(sid) || L.inst.completed.has(sid)) return;
    L.inst.completed.add(sid);
    this.host.emit(sid, { type: 'event_complete', eventId: L.inst.def.id, format: L.inst.def.format });
    this.host.send(sid, 'evt_done', { inst: L.inst.inst });
  }

  // ---------------------------------------------------------------- inscrição
  private joinable(L: Live): boolean {
    const st = L.inst.state;
    return st === 'REGISTRATION' || st === 'STARTING' || (st === 'ACTIVE' && !!L.runner?.lateJoin);
  }

  /** evt_join — `allowed` = capacidade `event.join` da conexão (política central, decidida pela sala) */
  join(sid: string, inst: unknown, allowed = true): JoinResult {
    const r = this.tryJoin(sid, inst, allowed);
    if (!r.ok) this.stats.denials++;
    this.host.send(sid, 'evt_res', { inst: typeof inst === 'string' ? inst.slice(0, 80) : '', ...r });
    return r;
  }

  private tryJoin(sid: string, inst: unknown, allowed: boolean): JoinResult {
    if (!allowed) return { ok: false, r: 'sem_permissao' };
    const L = typeof inst === 'string' ? this.live.get(inst) : undefined;
    if (!L) return { ok: false, r: 'inexistente' };
    const key = this.keyFor(sid);
    if (this.memberOf.has(key)) return { ok: false, r: 'ja_inscrito' };
    if (!this.joinable(L)) return { ok: false, r: 'fechado' };
    const def = L.inst.def;
    if (L.inst.members.size >= def.capacity) return { ok: false, r: 'lotado' };
    const p = this.host.participant(sid);
    if (!p) return { ok: false, r: 'sem_permissao' };
    const allow = def.groupRules?.allowed;
    if (allow && (p.groupKey === null || !allow.includes(p.groupKey))) return { ok: false, r: 'grupo' };
    const deny = L.runner?.onJoin(L.ctx, sid) ?? null;
    if (deny) return { ok: false, r: deny };
    L.inst.members.add(sid);
    this.memberOf.set(key, L.inst.inst); this.sess.set(key, sid); this.keyOf.set(sid, key);
    this.stats.joins++;
    this.agendaDirty = true;
    this.host.emit(sid, { type: 'event_join', eventId: def.id, format: def.format });
    return { ok: true };
  }

  /** evt_leave — desistência pedida (sem `forfeit`: o runner decide se conta como DNF) */
  leave(sid: string, inst: unknown): boolean {
    const L = typeof inst === 'string' ? this.live.get(inst) : undefined;
    const ok = !!L && L.inst.members.has(sid) && this.drop(L, sid, false);
    this.host.send(sid, 'evt_res', { inst: typeof inst === 'string' ? inst.slice(0, 80) : '', ok, ...(ok ? {} : { r: 'inexistente' }) });
    return ok;
  }

  private drop(L: Live, sid: string, forfeit: boolean): boolean {
    L.inst.members.delete(sid);
    const k = this.keyOf.get(sid);
    if (k && this.memberOf.get(k) === L.inst.inst) this.unbind(k);
    this.agendaDirty = true;
    if (LIVE.has(L.inst.state)) L.runner?.onLeave(L.ctx, sid, forfeit);
    return true;
  }

  /** saiu do mundo de vez (graça vencida, saída): desiste de tudo. Sessão já substituída (attach) não tem chave aqui */
  gone(sid: string) {
    const inst = this.instOf(sid);
    const L = inst ? this.live.get(inst) : undefined;
    if (L) this.drop(L, sid, true);
    for (const l of this.live.values()) l.watchers.delete(sid);
    this.prot.delete(sid);
    this.helloAgain.delete(sid);
  }

  /** evt_watch — acompanhar (marcadores/placar/resultado) sem se inscrever; espectadores também */
  watch(sid: string, inst: unknown, on = true) {
    const L = typeof inst === 'string' ? this.live.get(inst) : undefined;
    if (!L) return;
    if (!on) { L.watchers.delete(sid); return; }
    if (L.watchers.size >= 512 && !L.watchers.has(sid)) return;
    L.watchers.add(sid);
    L.runner?.watch?.(L.ctx, sid);
  }

  /** conexão nova: agenda e concentrações atuais */
  hello(sid: string, send: (type: string, msg: unknown) => void = (t, m) => this.host.send(sid, t, m)) {
    send('agenda', { list: this.agendaFor(sid) });
    if (this.ptsList.length) send('evt_pts', { list: this.ptsList });
    // o cliente pode ainda não ter registrado os ouvintes quando a sala responde no onJoin: repete uma vez (~1,5 s)
    this.helloAgain.set(sid, this.clock() + 1500);
  }
  private helloAgain = new Map<string, number>();

  // ---------------------------------------------------------------- ganchos da sala
  /** movimento ACEITO (posição final validada) de um jogador — só repassa a quem está inscrito numa instância viva */
  onMove(sid: string, x: number, z: number, mode: string, ok: boolean, reason: string, now = this.clock()) {
    const inst = this.instOf(sid);
    if (!inst) return;
    const L = this.live.get(inst);
    if (L?.runner?.onMove && (L.inst.state === 'STARTING' || L.inst.state === 'ACTIVE')) L.runner.onMove(L.ctx, sid, x, z, mode, ok, reason, now);
  }

  /** derrubada decidida pelo CombatSystem (agente A) — conta só entre inscritos da MESMA instância ativa */
  onKnockdown(attacker: string, target: string) {
    const inst = this.instOf(attacker);
    if (!inst || this.instOf(target) !== inst) return;
    const L = this.live.get(inst);
    if (L?.inst.state === 'ACTIVE') L.runner?.onKnockdown?.(L.ctx, attacker, target);
  }

  /** mensagens próprias de formato (debate: dbt_queue/dbt_say/dbt_react) — `inst` no corpo */
  message(sid: string, type: string, msg: unknown) {
    const inst = (msg as { inst?: unknown } | null)?.inst;
    const L = typeof inst === 'string' ? this.live.get(inst) : undefined;
    if (L && LIVE.has(L.inst.state)) L.runner?.onMessage?.(L.ctx, sid, type, msg);
  }

  /** regras de confronto para o CombatSystem: instância de confronto ATIVA com o jogador inscrito, ou null */
  combatEventFor(sid: string): CombatEventRules | null {
    const inst = this.instOf(sid);
    const L = inst ? this.live.get(inst) : undefined;
    if (!L || L.inst.state !== 'ACTIVE' || !L.runner?.combat) return null;
    return L.runner.combat(L.ctx);
  }

  /** política de confronto efetiva numa zona durante um evento ATIVO que a declara (null = a da zona) */
  zonePolicy(zone: string | null): ZoneCombatPolicy | null {
    if (!zone) return null;
    for (const L of this.live.values()) {
      const d = L.inst.def;
      if (L.inst.state === 'ACTIVE' && d.combatPolicy && (d.clash?.zones ?? d.zones ?? []).includes(zone)) return d.combatPolicy;
    }
    return null;
  }

  /** proteção de retorno (ms, relógio do servidor) posta por um runner — 0 = nenhuma */
  protectedUntil(sid: string): number { return this.prot.get(sid) ?? 0; }

  /** concentrações de eventos vivos (cliente: RallyPoint 'event'; servidor: ambiente das células do espectador) */
  rallies(): EventRallyPoint[] {
    const out: EventRallyPoint[] = [];
    for (const L of this.live.values()) if (L.runner?.rally && LIVE.has(L.inst.state)) out.push(...L.runner.rally(L.ctx));
    return out;
  }

  // ---------------------------------------------------------------- consultas (QA/testes/outros sistemas)
  instances(): EventInstance[] { return [...this.live.values()].map((l) => l.inst).sort((a, b) => a.startsAt - b.startsAt); }
  instanceOf(sid: string): EventInstance | null { const i = this.instOf(sid); return (i && this.live.get(i)?.inst) || null; }
  runnerState(inst: string): unknown { const L = this.live.get(inst); return L?.runner ? L.runner.state(L.ctx) : null; }
  /** resumo de uma instância encerrada (null enquanto viva ou depois da janela recente) */
  results(inst: string): EventResults | null { return this.live.get(inst)?.results ?? null; }
  /** QA/testes: tamanhos dos mapas por participante (retenção) */
  sizes() { return { live: this.live.size, members: this.memberOf.size, sessions: this.sess.size, keys: this.keyOf.size, prot: this.prot.size }; }
  get(inst: string): EventInstance | undefined { return this.live.get(inst)?.inst; }

  // ---------------------------------------------------------------- agenda
  private entries(): AgendaEntry[] {
    // por atividade: o encerramento mais recente, as vivas e a próxima
    const out: AgendaEntry[] = [];
    const byDef = new Map<string, Live[]>();
    for (const L of this.live.values()) { const a = byDef.get(L.inst.def.id) ?? []; a.push(L); byDef.set(L.inst.def.id, a); }
    for (const list of byDef.values()) {
      list.sort((a, b) => a.inst.startsAt - b.inst.startsAt);
      const ended = list.filter((l) => l.inst.state === 'FINISHED' || l.inst.state === 'CANCELLED');
      const live = list.filter((l) => LIVE.has(l.inst.state));
      const next = list.find((l) => l.inst.state === 'SCHEDULED');
      for (const L of [...ended.slice(-1), ...live, ...(next ? [next] : [])]) {
        const i = L.inst, d = i.def;
        out.push({ id: d.id, inst: i.inst, format: d.format, name: d.name, zone: i.zone, state: i.state, startsAt: i.startsAt, endsAt: i.endsAt, count: L.results?.count ?? i.members.size, capacity: d.capacity });
      }
    }
    for (const e of this.host.extraAgenda?.(this.lastNow) ?? []) out.push(e);
    return out.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
  }

  agendaFor(sid: string): AgendaEntry[] {
    const mine = this.instOf(sid);
    return this.entries().map((e) => (e.inst === mine ? { ...e, joined: true } : e));
  }

  private sendAgenda(now: number) {
    if (!this.agendaDirty || now - this.agendaAt < this.minSendMs) return;
    this.agendaDirty = false;
    const base = this.entries();
    const sig = JSON.stringify(base) + '|' + [...this.memberOf].map(([k, i]) => `${this.sess.get(k)}=${i}`).sort().join(',');
    if (sig === this.agendaSig) return;
    this.agendaSig = sig;
    this.agendaAt = now;
    this.stats.agendaSends++;
    const shared = { list: base };
    for (const sid of this.host.audience?.() ?? this.host.players()) {
      const mine = this.instOf(sid);
      this.host.send(sid, 'agenda', mine ? { list: base.map((e) => (e.inst === mine ? { ...e, joined: true } : e)) } : shared);
    }
  }

  private ptsCheck = -1e15;
  private sendPoints(now: number) {
    // avalia a 2 Hz; envia no máximo a cada minSendMs e só se mudou
    if (now - this.ptsAt < this.minSendMs || now - this.ptsCheck < 500) return;
    this.ptsCheck = now;
    const list: EventPointWire[] = [];
    for (const L of this.live.values()) {
      if (!L.runner?.rally || !LIVE.has(L.inst.state)) continue;
      for (const p of L.runner.rally(L.ctx)) list.push({ id: p.id, inst: L.inst.inst, x: Math.round(p.x), z: Math.round(p.z), inner: p.inner, radius: p.radius, strength: p.strength, crowd: p.crowd, label: L.inst.def.name });
    }
    const sig = JSON.stringify(list);
    if (sig === this.ptsSig) return;
    this.ptsSig = sig;
    this.ptsAt = now;
    this.ptsList = list;
    this.stats.ptsSends++;
    const msg = { list };
    for (const sid of this.host.audience?.() ?? this.host.players()) this.host.send(sid, 'evt_pts', msg);
  }
}
