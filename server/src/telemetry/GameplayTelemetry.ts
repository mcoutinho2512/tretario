/**
 * Telemetria de GAMEPLAY (rodada 9) — só agregados, em memória, com uma linha JSON por período num arquivo local
 * (server/data/telemetry.jsonl; PV_TELEMETRY_FILE; PV_TELEMETRY_S). Nenhum serviço externo, nenhuma rota pública.
 * NADA privado: sem userId, sessionId, apelido, posição ou texto — só contadores e histogramas (duração da sessão,
 * atividades por sessão) para métricas futuras de retenção. Leitura: `npm run dev:telemetry` (server/tools/telemetry.ts).
 *
 * Cada linha traz os contadores do PERÍODO (deltas): somar as linhas dá o total, inclusive entre reinícios.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GameplayEnvelope } from '../../../src/gameplay/events';
import type { ProgressionObserver } from '../progression/ProgressionService';
import { log } from '../log';

export const DURATION_BUCKETS = [['<1min', 60e3], ['1-5min', 300e3], ['5-15min', 900e3], ['15-60min', 3600e3], ['60min+', Infinity]] as const;
export const ACTIVITY_BUCKETS = [['0', 0], ['1-4', 4], ['5-19', 19], ['20-99', 99], ['100+', Infinity]] as const;

export interface TelemetryCounters {
  sessionsStarted: number; sessionsEnded: number; sessionMsTotal: number; accountSessions: number; visitorSessions: number;
  missionsStarted: number; missionsCompleted: number; achievements: number; levelUps: number;
  eventsJoined: number; eventsCompleted: number; racesStarted: number; racesCompleted: number;
  debateWatchS: number; debateSessions: number; combatSessions: number;
  zonesVisited: Record<string, number>; gameplay: Record<string, number>;
  missionCompletions: Record<string, number>;
  duration: Record<string, number>; activity: Record<string, number>;
}

const empty = (): TelemetryCounters => ({
  sessionsStarted: 0, sessionsEnded: 0, sessionMsTotal: 0, accountSessions: 0, visitorSessions: 0,
  missionsStarted: 0, missionsCompleted: 0, achievements: 0, levelUps: 0,
  eventsJoined: 0, eventsCompleted: 0, racesStarted: 0, racesCompleted: 0,
  debateWatchS: 0, debateSessions: 0, combatSessions: 0,
  zonesVisited: {}, gameplay: {}, missionCompletions: {}, duration: {}, activity: {},
});
const inc = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
const COMBAT = new Set(['combat_action', 'combat_dodge', 'dummy_knockdown']);

export class GameplayTelemetry {
  /** totais desde a partida do processo */
  readonly total = empty();
  /** período atual (vai para o arquivo e zera) */
  private period = empty();
  private sessions = new Map<string, { start: number; activity: number; combat: boolean; debate: boolean }>();
  private lastLog = Date.now();
  readonly file: string | null;
  private periodMs: number;
  lines = 0;

  constructor(opts: { file?: string | null; periodS?: number } = {}) {
    this.file = opts.file ?? null;
    this.periodMs = Math.max(5, opts.periodS ?? 60) * 1000;
  }

  private add(fn: (c: TelemetryCounters) => void) { fn(this.total); fn(this.period); }

  readonly listener = (e: GameplayEnvelope) => {
    const ev = e.ev, s = this.sessions.get(e.sid);
    if (s) s.activity++;
    this.add((c) => {
      inc(c.gameplay, ev.type);
      if (ev.type === 'zone_enter') inc(c.zonesVisited, ev.zone);
      else if (ev.type === 'event_join') { c.eventsJoined++; if (ev.format === 'race') c.racesStarted++; }
      else if (ev.type === 'event_complete') c.eventsCompleted++;
      else if (ev.type === 'race_finish') c.racesCompleted++;
      else if (ev.type === 'debate_watch') c.debateWatchS += Math.max(0, Math.min(3600, ev.seconds || 0));
    });
    if (s && COMBAT.has(ev.type) && !s.combat) { s.combat = true; this.add((c) => c.combatSessions++); }
    if (s && ev.type === 'debate_watch' && !s.debate) { s.debate = true; this.add((c) => c.debateSessions++); }
  };

  readonly observer: ProgressionObserver = {
    missionStarted: () => this.add((c) => c.missionsStarted++),
    missionCompleted: (id) => this.add((c) => { c.missionsCompleted++; inc(c.missionCompletions, id); }),
    achievement: () => this.add((c) => c.achievements++),
    levelUp: () => this.add((c) => c.levelUps++),
  };

  sessionStart(sid: string, persistent: boolean, now = Date.now()) {
    if (this.sessions.has(sid)) return;
    this.sessions.set(sid, { start: now, activity: 0, combat: false, debate: false });
    this.add((c) => { c.sessionsStarted++; if (persistent) c.accountSessions++; else c.visitorSessions++; });
  }

  sessionEnd(sid: string, now = Date.now()) {
    const s = this.sessions.get(sid);
    if (!s) return;
    this.sessions.delete(sid);
    const ms = Math.max(0, now - s.start);
    const db = DURATION_BUCKETS.find(([, lim]) => ms < lim)![0], ab = ACTIVITY_BUCKETS.find(([, lim]) => s.activity <= lim)![0];
    this.add((c) => { c.sessionsEnded++; c.sessionMsTotal += ms; inc(c.duration, db); inc(c.activity, ab); });
  }

  get openSessions() { return this.sessions.size; }

  /** chamada pelo tick: grava a linha do período quando vence */
  maybeLog(now = Date.now()) { if (now - this.lastLog >= this.periodMs) void this.flush(now); }

  async flush(now = Date.now()) {
    const p = this.period;
    this.period = empty();
    const from = this.lastLog;
    this.lastLog = now;
    if (!this.file || !(p.sessionsStarted || p.sessionsEnded || Object.keys(p.gameplay).length)) return;
    const line = JSON.stringify({ v: 1, from: new Date(from).toISOString(), to: new Date(now).toISOString(), open: this.sessions.size, c: p }) + '\n';
    try { await mkdir(dirname(this.file), { recursive: true }); await appendFile(this.file, line); this.lines++; } catch (e) { log.warn('error', 'telemetria: falha ao gravar', { err: e as Error }); }
  }
}

/** soma linhas do arquivo (CLI) */
export function aggregate(lines: readonly string[]): { periods: number; from: string | null; to: string | null; c: TelemetryCounters } {
  const c = empty();
  let periods = 0, from: string | null = null, to: string | null = null;
  for (const l of lines) {
    let o: { from?: string; to?: string; c?: Partial<TelemetryCounters> };
    try { o = JSON.parse(l); } catch { continue; }
    if (!o?.c) continue;
    periods++;
    from ??= o.from ?? null; to = o.to ?? to;
    for (const [k, v] of Object.entries(o.c)) {
      const key = k as keyof TelemetryCounters;
      if (typeof v === 'number') (c[key] as number) += v;
      else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'number') inc(c[key] as Record<string, number>, kk, vv);
    }
  }
  return { periods, from, to, c };
}
