/**
 * ProgressionService (rodada 9) — missões, conquistas, XP/nível e recompensas, AUTORIDADE do servidor, sem Colyseus.
 *
 *  entrada     assina o barramento de gameplay (server/src/gameplay/bus.ts): só eventos emitidos pelo servidor a partir
 *              de estado aceito. O cliente nunca informa XP, progresso nem conclusão (só `mission_track`/`prog_seen`,
 *              preferências de UI)
 *  regras      objetivo = `on` + `where` + count/sumField (src/progression/engine.ts); missões aparecem aos poucos
 *              (requires/minLevel); recompensa (xp/unlock/title) UMA vez: conclusão marcada antes de pagar, itens por
 *              par único (memória + banco) — repetir os mesmos eventos não duplica nada
 *  anti-farm   XP SÓ de objetivo/missão/conquista e conclusão de evento (esta com retorno decrescente por evento/dia).
 *              Chat/emote/item/grafite/golpe NÃO dão XP por quantidade; contam para objetivos com teto por minuto
 *              (EVENT_CAPS). Distância chega em lotes ≥ 10 m e só soma em objetivo (nunca vira fluxo de XP)
 *  saída       `prog` (estado completo) ao entrar e a cada mudança, no máximo 2 Hz; `prog_ev` (notícia) — só ao DONO
 *  gravação    por conta (userId), em LOTES: marca suja → a cada `flushMs`, na saída/queda/fim da graça/desligamento.
 *              Visitante/anônimo/conta de teste: só memória da sessão (`persistent: false`)
 *  sessões     estado por CONTA: reconexão e login duplicado (sessão nova assume) reaproveitam o mesmo estado em
 *              memória — nada se perde entre a saída da antiga e a entrada da nova
 */
import type { GameplayEnvelope, GameplayEvent, GameplayEventType } from '../../../src/gameplay/events';
import type { MissionProgress, PlayerProgression, ProgressionMessage, ProgressionNotice, Reward } from '../../../src/progression/types';
import {
  allDone, levelBounds, levelForXp, levelUnlocks, matchesObjective, missionVisible, objectiveDone, objectiveIncrement, objectiveTarget,
  rewardXp, type ProgressionCatalog,
} from '../../../src/progression/engine';
import type { ItemEntitlements } from '../../../src/characters/unlocks';
import type { DataStore, ProgressionRecord, ProgressionSave } from '../data/types';

/** teto por minuto de eventos que CONTAM para objetivos/conquistas (spam além disso é ignorado; nenhum dá XP direto) */
export const EVENT_CAPS: Partial<Record<GameplayEventType, number>> = {
  chat: 3, graffiti: 2, action: 8, prop: 8, combat_action: 20, combat_dodge: 10, dummy_knockdown: 6, debate_react: 6, debate_turn: 6,
  vehicle_enter: 8, trio_board: 4, rally_visit: 4, zone_enter: 30, event_join: 6, event_complete: 6, race_finish: 6,
};
/** conclusão de evento agendado: XP com retorno decrescente por evento por dia (UTC) e teto diário */
export const EVENT_XP = { base: 40, decay: 0.5, perEventPerDay: 4, dailyMax: 200 } as const;
export const PROG_LIMITS = { sendMs: 500, flushMs: 15_000, orphanMs: 30_000, queueMax: 200, seenMax: 16 } as const;

export interface ProgressionObserver {
  missionStarted?(id: string): void;
  missionCompleted?(id: string): void;
  achievement?(id: string): void;
  levelUp?(level: number): void;
}

export interface ProgressionDeps {
  catalog: ProgressionCatalog;
  store: Pick<DataStore, 'progression'> | null;
  send: (sid: string, type: 'prog' | 'prog_ev', msg: ProgressionMessage | ProgressionNotice) => void;
  flushMs?: number;
  observer?: ProgressionObserver;
}

interface PState {
  key: string;
  userId: string | null;
  persistent: boolean;
  xp: number; level: number;
  completed: Map<string, number>;
  achievements: Map<string, number>;
  /** item → fonte (inclui títulos como "title:<texto>") */
  grants: Map<string, string>;
  active: Map<string, MissionProgress>;
  /** conquistas: progresso persistente / só da sessão */
  ach: Map<string, Record<string, number>>;
  sessAch: Map<string, Record<string, number>>;
  seen: Set<string>;
  tracked: string | null;
  evx: { d: string; total: number; per: Record<string, number> };
  /** direitos vivos (o MESMO Set vai para validateAction/validateProp e validateAppearance) */
  ent: Set<string>;
  sids: Set<string>;
  caps: Map<string, number[]>;
  pending: { completed: ProgressionSave['completed']; achievements: ProgressionSave['achievements']; grants: ProgressionSave['grants'] };
  dirty: boolean; saving: Promise<void> | null; lastSave: number;
  sendPending: boolean; lastSend: number;
  loading: Promise<void> | null; queue: GameplayEnvelope[];
  orphanSince: number;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export class ProgressionService {
  private states = new Map<string, PState>();
  private bySid = new Map<string, PState>();
  readonly stats = { events: 0, capped: 0, writes: 0, writeErrors: 0, sent: 0, notices: 0, xpGranted: 0 };
  private flushMs: number;

  constructor(private deps: ProgressionDeps) { this.flushMs = deps.flushMs ?? PROG_LIMITS.flushMs; }

  get catalog() { return this.deps.catalog; }

  /** assinante do barramento */
  readonly listener = (e: GameplayEnvelope) => this.onEvent(e);

  // ------------------------------------------------------------------ ciclo de vida
  /** carrega (ou reaproveita) a conta antes da entrada: direitos para validar a aparência já no onAuth */
  async preload(userId: string, now = Date.now()): Promise<ItemEntitlements> {
    const st = this.ensure(`u:${userId}`, userId, true, now);
    await st.loading;
    return { items: st.ent };
  }

  /** conexão entra no mundo como jogador. `persistent` = conta real (não visitante/anônimo/teste) */
  join(sid: string, info: { userId: string | null; persistent: boolean }, now = Date.now()): ItemEntitlements {
    const persistent = info.persistent && !!info.userId && !!this.deps.store;
    const st = this.ensure(persistent ? `u:${info.userId}` : `s:${sid}`, persistent ? info.userId : null, persistent, now);
    st.sids.add(sid);
    this.bySid.set(sid, st);
    // sessão nova: conquistas "da sessão" recomeçam só quando é a ÚNICA conexão (reconexão/troca mantém)
    if (st.sids.size === 1) st.sessAch.clear();
    // estado completo no próximo tick (a conexão já está registrada na sala); carregando: ao terminar
    st.sendPending = true; st.lastSend = 0;
    return { items: st.ent };
  }

  /** queda (graça): grava já o que estiver sujo — a conexão pode não voltar */
  drop(sid: string) { const st = this.bySid.get(sid); if (st) void this.flush(st); }

  /** saída definitiva (saiu, graça vencida, sessão substituída): grava e solta quando não sobra conexão */
  leave(sid: string, now = Date.now()) {
    const st = this.bySid.get(sid);
    if (!st) return;
    this.bySid.delete(sid);
    st.sids.delete(sid);
    if (st.sids.size) return;
    st.orphanSince = now;
    if (st.persistent) void this.flush(st);
    else this.states.delete(st.key); // visitante: some com a sessão
  }

  /** desligamento: grava tudo */
  async flushAll() { await Promise.all([...this.states.values()].map((st) => this.flush(st))); }

  /** 10 Hz pela sala: envio ≤ 2 Hz, gravação em lote, despejo de contas sem conexão */
  tick(now = Date.now()) {
    for (const st of this.states.values()) {
      if (st.sendPending && now - st.lastSend >= PROG_LIMITS.sendMs) this.sendFull(st, undefined, now);
      if (st.persistent && st.dirty && !st.saving && now - st.lastSave >= this.flushMs) void this.flush(st, now);
      if (!st.sids.size && !st.dirty && !st.saving && !st.loading && now - st.orphanSince >= PROG_LIMITS.orphanMs) this.states.delete(st.key);
    }
  }

  // ------------------------------------------------------------------ consultas
  entitlementsOf(sid: string): ItemEntitlements { return { items: this.bySid.get(sid)?.ent ?? new Set() }; }
  /** direitos de uma conta carregada aqui (API de aparência: a recompensa vale mesmo antes da gravação) */
  entitlementsOfUser(userId: string): ReadonlySet<string> | null { const st = this.states.get(`u:${userId}`); return st && !st.loading ? st.ent : null; }
  snapshot(sid: string): PlayerProgression | null { const st = this.bySid.get(sid); return st && !st.loading ? this.wire(st) : null; }
  isPersistent(sid: string) { return !!this.bySid.get(sid)?.persistent; }
  get size() { return this.states.size; }

  // ------------------------------------------------------------------ preferências de UI (cliente)
  track(sid: string, raw: unknown) {
    const st = this.bySid.get(sid), id = (raw as { id?: unknown } | null)?.id;
    if (!st || st.loading || typeof id !== 'string') return;
    const next = st.active.has(id) ? id : null;
    if (next === st.tracked) return;
    st.tracked = next; st.dirty = true; st.sendPending = true;
  }

  seen(sid: string, raw: unknown) {
    const st = this.bySid.get(sid), k = (raw as { k?: unknown } | null)?.k;
    if (!st || st.loading || typeof k !== 'string' || !/^[a-z_]{1,24}$/.test(k) || st.seen.has(k) || st.seen.size >= PROG_LIMITS.seenMax) return;
    st.seen.add(k); st.dirty = true; st.sendPending = true;
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e: GameplayEnvelope) {
    const st = this.bySid.get(e.sid);
    if (!st) return;
    if (st.loading) { if (st.queue.length < PROG_LIMITS.queueMax) st.queue.push(e); return; }
    this.apply(st, e.ev, e.at);
  }

  private apply(st: PState, ev: GameplayEvent, at: number) {
    this.stats.events++;
    if (!this.capOk(st, ev.type, at)) { this.stats.capped++; return; }
    let changed = false;
    // missões ativas (cópia: concluir abre outras no meio do laço)
    for (const mp of [...st.active.values()]) {
      const def = this.deps.catalog.missions.find((m) => m.id === mp.missionId);
      if (!def) continue;
      for (const o of def.objectives) {
        if (objectiveDone(o, mp.values) || !matchesObjective(o, ev)) continue;
        const inc = objectiveIncrement(o, ev);
        if (inc <= 0) continue;
        mp.values[o.id] = Math.min(objectiveTarget(o), (mp.values[o.id] ?? 0) + inc);
        changed = true;
        if (objectiveDone(o, mp.values) && def.objectives.length > 1) this.notice(st, { kind: 'objective', id: `${def.id}.${o.id}`, label: o.label });
      }
      if (allDone(def.objectives, mp.values)) this.completeMission(st, def.id, at);
    }
    // conquistas
    for (const a of this.deps.catalog.achievements) {
      if (st.achievements.has(a.id)) continue;
      const map = a.session ? st.sessAch : st.ach;
      for (const o of a.objectives) {
        if (!matchesObjective(o, ev)) continue;
        const vals = map.get(a.id) ?? {};
        if (objectiveDone(o, vals)) continue;
        const inc = objectiveIncrement(o, ev);
        if (inc <= 0) continue;
        vals[o.id] = Math.min(objectiveTarget(o), (vals[o.id] ?? 0) + inc);
        map.set(a.id, vals);
        changed = true;
      }
      if (allDone(a.objectives, map.get(a.id))) this.unlockAchievement(st, a.id, at);
    }
    // conclusão de evento agendado: XP decrescente por evento/dia (participar em si não dá XP)
    if (ev.type === 'event_complete') changed = this.eventXp(st, ev.eventId, at) || changed;
    if (changed) { st.dirty = true; st.sendPending = true; }
  }

  private capOk(st: PState, type: GameplayEventType, at: number): boolean {
    const cap = EVENT_CAPS[type];
    if (!cap) return true;
    const list = st.caps.get(type) ?? [];
    while (list.length && at - list[0] > 60_000) list.shift();
    if (list.length >= cap) return false;
    list.push(at);
    st.caps.set(type, list);
    return true;
  }

  private eventXp(st: PState, eventId: string, at: number): boolean {
    const d = day(at);
    if (st.evx.d !== d) st.evx = { d, total: 0, per: {} };
    const n = (st.evx.per[eventId] ?? 0) + 1;
    st.evx.per[eventId] = n;
    if (n > EVENT_XP.perEventPerDay) return true;
    const xp = Math.min(Math.round(EVENT_XP.base * EVENT_XP.decay ** (n - 1)), EVENT_XP.dailyMax - st.evx.total);
    if (xp <= 0) return true;
    st.evx.total += xp;
    this.addXp(st, xp);
    this.notice(st, { kind: 'reward', id: `event:${eventId}`, label: 'Evento concluído', xp });
    return true;
  }

  private completeMission(st: PState, id: string, at: number) {
    if (st.completed.has(id)) { st.active.delete(id); return; } // idempotente: nunca paga duas vezes
    const def = this.deps.catalog.missions.find((m) => m.id === id)!;
    st.completed.set(id, at);
    st.active.delete(id);
    if (st.tracked === id) st.tracked = null;
    st.pending.completed.push({ missionId: id, at: new Date(at) });
    this.deps.observer?.missionCompleted?.(id);
    this.notice(st, { kind: 'mission', id, label: def.title, xp: rewardXp(def.rewards) });
    this.pay(st, def.rewards, `mission:${id}`, at);
    this.refreshActive(st, at);
    st.dirty = true; st.sendPending = true;
  }

  private unlockAchievement(st: PState, id: string, at: number) {
    if (st.achievements.has(id)) return;
    const def = this.deps.catalog.achievements.find((a) => a.id === id)!;
    st.achievements.set(id, at);
    st.ach.delete(id); st.sessAch.delete(id);
    st.pending.achievements.push({ achievementId: id, at: new Date(at) });
    this.deps.observer?.achievement?.(id);
    this.notice(st, { kind: 'achievement', id, label: def.title, xp: rewardXp(def.rewards) });
    this.pay(st, def.rewards, `achievement:${id}`, at);
    st.dirty = true; st.sendPending = true;
  }

  private pay(st: PState, rewards: readonly Reward[], source: string, at: number) {
    for (const r of rewards) {
      if (r.kind === 'xp' && r.amount) this.addXp(st, r.amount);
      else if (r.kind === 'unlock' && r.item) this.grant(st, r.item, source, at);
      else if (r.kind === 'title' && r.title) this.grant(st, `title:${r.title}`, source, at);
    }
  }

  private grant(st: PState, item: string, source: string, at: number) {
    if (st.grants.has(item)) return; // par único (userId, item)
    st.grants.set(item, source);
    st.pending.grants.push({ item, source, at: new Date(at) });
    if (!item.startsWith('title:')) st.ent.add(item);
    const label = item.startsWith('title:') ? `Título: ${item.slice(6)}` : this.deps.catalog.rewards.find((r) => r.item === item)?.label ?? item;
    this.notice(st, { kind: 'reward', id: item, label, item });
  }

  private addXp(st: PState, n: number) {
    st.xp += n;
    this.stats.xpGranted += n;
    const lv = levelForXp(this.deps.catalog.levels, st.xp);
    while (st.level < lv) {
      st.level++;
      this.deps.observer?.levelUp?.(st.level);
      this.notice(st, { kind: 'level', id: 'level', label: `Nível ${st.level}`, level: st.level });
      for (const it of levelUnlocks(this.deps.catalog, st.level)) if (!st.ent.has(it)) {
        st.ent.add(it);
        const def = this.deps.catalog.rewards.find((r) => r.item === it);
        if (def?.level === st.level) this.notice(st, { kind: 'reward', id: it, label: def.label, item: it });
      }
    }
    this.refreshActive(st, Date.now());
  }

  /** missões que passaram a ser visíveis (requisitos/nível) entram como ativas */
  private refreshActive(st: PState, at: number) {
    for (const m of this.deps.catalog.missions) {
      if (st.active.has(m.id) || !missionVisible(m, st.completed, st.level)) continue;
      st.active.set(m.id, { missionId: m.id, values: {}, startedAt: at });
      this.deps.observer?.missionStarted?.(m.id);
    }
  }

  // ------------------------------------------------------------------ estado e mensagens
  private ensure(key: string, userId: string | null, persistent: boolean, now: number): PState {
    let st = this.states.get(key);
    if (st) return st;
    st = {
      key, userId, persistent, xp: 0, level: 1, completed: new Map(), achievements: new Map(), grants: new Map(), active: new Map(),
      ach: new Map(), sessAch: new Map(), seen: new Set(), tracked: null, evx: { d: '', total: 0, per: {} }, ent: new Set(levelUnlocks(this.deps.catalog, 1)),
      sids: new Set(), caps: new Map(), pending: { completed: [], achievements: [], grants: [] },
      dirty: false, saving: null, lastSave: now, sendPending: false, lastSend: 0, loading: null, queue: [], orphanSince: now,
    };
    this.states.set(key, st);
    const s = st;
    if (persistent && userId && this.deps.store) {
      s.loading = this.deps.store.progression.load(userId)
        .then((rec) => { if (rec) this.hydrate(s, rec); })
        .catch((e) => console.warn(`[progressão] falha ao carregar ${userId.slice(0, 8)}…: ${(e as Error).message}`))
        .finally(() => {
          s.loading = null;
          this.refreshActive(s, Date.now());
          for (const e of s.queue.splice(0)) this.apply(s, e.ev, e.at);
          s.sendPending = true;
        });
    } else this.refreshActive(st, now);
    return st;
  }

  private hydrate(st: PState, rec: ProgressionRecord) {
    const cat = this.deps.catalog;
    st.xp = Math.max(0, rec.xp | 0);
    st.level = levelForXp(cat.levels, st.xp);
    for (const c of rec.completed) st.completed.set(c.missionId, +c.completedAt);
    for (const a of rec.achievements) st.achievements.set(a.achievementId, +a.unlockedAt);
    for (const g of rec.grants) { st.grants.set(g.item, g.source); if (!g.item.startsWith('title:')) st.ent.add(g.item); }
    for (const it of levelUnlocks(cat, st.level)) st.ent.add(it);
    const d = (rec.data ?? {}) as { active?: MissionProgress[]; ach?: Record<string, Record<string, number>>; seen?: string[]; tracked?: string | null; evx?: PState['evx'] };
    for (const mp of Array.isArray(d.active) ? d.active : []) {
      const def = cat.missions.find((m) => m.id === mp?.missionId);
      if (!def || st.completed.has(def.id)) continue;
      const values: Record<string, number> = {};
      for (const o of def.objectives) { const v = Number(mp.values?.[o.id]); if (Number.isFinite(v) && v > 0) values[o.id] = Math.min(objectiveTarget(o), v); }
      st.active.set(def.id, { missionId: def.id, values, startedAt: Number(mp.startedAt) || Date.now() });
    }
    for (const [id, vals] of Object.entries(d.ach ?? {})) if (!st.achievements.has(id) && cat.achievements.some((a) => a.id === id && !a.session)) st.ach.set(id, { ...vals });
    for (const k of Array.isArray(d.seen) ? d.seen.slice(0, PROG_LIMITS.seenMax) : []) if (typeof k === 'string') st.seen.add(k);
    st.tracked = typeof d.tracked === 'string' ? d.tracked : null;
    if (d.evx && typeof d.evx.d === 'string') st.evx = { d: d.evx.d, total: Number(d.evx.total) || 0, per: { ...(d.evx.per ?? {}) } };
  }

  private async flush(st: PState, now = Date.now()): Promise<void> {
    if (!st.persistent || !st.userId || !this.deps.store) return;
    if (st.saving) { await st.saving; if (!st.dirty) return; }
    if (st.loading) await st.loading;
    if (!st.dirty) return;
    const p = st.pending;
    const snap: ProgressionSave = {
      xp: st.xp, level: st.level,
      data: { v: 1, active: [...st.active.values()], ach: Object.fromEntries(st.ach), seen: [...st.seen], tracked: st.tracked, evx: st.evx },
      completed: p.completed, achievements: p.achievements, grants: p.grants,
    };
    st.pending = { completed: [], achievements: [], grants: [] };
    st.dirty = false;
    st.lastSave = now;
    st.saving = this.deps.store.progression.save(st.userId, snap)
      .then(() => { this.stats.writes++; })
      .catch((e) => {
        // volta para a fila: a próxima passada tenta de novo (os pares únicos tornam a repetição inócua)
        this.stats.writeErrors++;
        st.pending.completed.unshift(...snap.completed); st.pending.achievements.unshift(...snap.achievements); st.pending.grants.unshift(...snap.grants);
        st.dirty = true;
        console.warn(`[progressão] falha ao gravar: ${(e as Error).message}`);
      })
      .finally(() => { st.saving = null; });
    await st.saving;
  }

  private wire(st: PState): PlayerProgression {
    const b = levelBounds(this.deps.catalog.levels, st.level);
    return {
      level: st.level, xp: st.xp, xpLevel: b.cur, xpNext: b.next,
      completedMissions: [...st.completed.keys()], achievements: [...st.achievements.keys()],
      unlocks: [...st.ent], titles: [...st.grants.keys()].filter((k) => k.startsWith('title:')).map((k) => k.slice(6)),
      active: [...st.active.values()].map((m) => ({ missionId: m.missionId, values: { ...m.values }, startedAt: m.startedAt })),
      tracked: st.tracked, seen: [...st.seen],
    };
  }

  private sendFull(st: PState, only?: string, now = Date.now()) {
    if (st.loading) return;
    const msg: ProgressionMessage = { p: this.wire(st), persistent: st.persistent };
    for (const sid of only ? [only] : st.sids) { this.deps.send(sid, 'prog', msg); this.stats.sent++; }
    if (!only) { st.sendPending = false; st.lastSend = now; }
  }

  private notice(st: PState, n: ProgressionNotice) {
    this.stats.notices++;
    for (const sid of st.sids) this.deps.send(sid, 'prog_ev', n);
  }
}
