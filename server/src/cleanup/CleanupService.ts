/**
 * Limpeza periódica de registros EFÊMEROS vencidos (rodada 8.1) — inventário completo em docs/DATABASE.md.
 *  - banco: Session vencida/revogada há mais de CLEANUP_SESSION_GRACE_MINUTES; VerificationCode vencido/usado há mais
 *    de CLEANUP_CODE_GRACE_MINUTES (nunca menos que a validade do código: o "mais recente" de cada finalidade nunca
 *    some antes de um código mais antigo também ter vencido — ver auth/codes.ts)
 *  - memória do processo: tickets de entrada nunca consumidos, chaves de limite de taxa esquecidas (`sweepers`)
 *  - NUNCA: AuditLog, ModerationAction, Report, Payment, AccountAccess (auditoria/histórico)
 * Lotes de CLEANUP_BATCH (findMany ids → deleteMany por ids: idempotente entre instâncias — quem chega depois apaga 0),
 * repetidos até um lote apagar 0 ou estourar CLEANUP_MAX_RUN_MS. Uma execução por vez no processo (guarda em voo);
 * a primeira roda alguns segundos depois do início, sem bloquear a subida (timers com unref).
 * Log: UMA linha só com contagens — nunca token, hash, código, senha ou e-mail. Métricas só para o operador
 * (`npm run dev:cleanup`), fora do endpoint público de métricas.
 */
import type { DataStore } from '../data/types';
import { CODE_TTL_MS } from '../auth/codes';

export interface CleanupConfig {
  intervalMs: number;
  /** atraso da primeira execução depois de start() */
  firstDelayMs: number;
  sessionGraceMs: number;
  codeGraceMs: number;
  batch: number;
  maxRunMs: number;
}

export interface CleanupRunMetrics {
  startedAt: string;
  expiredSessionsDeleted: number;
  expiredOtpDeleted: number;
  expiredTicketsDeleted: number;
  rateLimitKeysDeleted: number;
  batches: number;
  durationMs: number;
  /** parou pelo limite de tempo (sobrou trabalho para a próxima) */
  truncated: boolean;
  /** mensagem curta do erro (sem dados do pedido) */
  error?: string;
}

export interface CleanupTotals { runs: number; errors: number; expiredSessionsDeleted: number; expiredOtpDeleted: number; expiredTicketsDeleted: number; rateLimitKeysDeleted: number }

/** limpeza de um mapa em memória: devolve quantos itens removeu */
export interface Sweeper { kind: 'tickets' | 'rateLimit'; sweep(now: number): number }

const num = (v: string | undefined, d: number, min = 0) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= min ? n : d; };

/** configuração das variáveis de ambiente (minutos); CLEANUP_INTERVAL_MINUTES=0 desliga o agendamento */
export function cleanupConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CleanupConfig {
  return {
    intervalMs: num(env.CLEANUP_INTERVAL_MINUTES, 10) * 60_000,
    firstDelayMs: num(env.CLEANUP_FIRST_DELAY_MS, 5_000),
    sessionGraceMs: num(env.CLEANUP_SESSION_GRACE_MINUTES, 60) * 60_000,
    codeGraceMs: num(env.CLEANUP_CODE_GRACE_MINUTES, 60) * 60_000,
    batch: Math.floor(num(env.CLEANUP_BATCH, 500, 1)),
    maxRunMs: num(env.CLEANUP_MAX_RUN_MS, 30_000, 1),
  };
}

export class CleanupService {
  readonly cfg: CleanupConfig;
  lastRun: CleanupRunMetrics | null = null;
  readonly totals: CleanupTotals = { runs: 0, errors: 0, expiredSessionsDeleted: 0, expiredOtpDeleted: 0, expiredTicketsDeleted: 0, rateLimitKeysDeleted: 0 };
  private inFlight: Promise<CleanupRunMetrics> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private store: DataStore,
    private o: { sweepers?: Sweeper[]; config?: Partial<CleanupConfig>; now?: () => number; log?: (line: string) => void } = {},
  ) {
    this.cfg = { ...cleanupConfigFromEnv(), ...o.config };
  }

  private get now() { return this.o.now ?? Date.now; }

  /** agenda (não bloqueia): primeira execução em `firstDelayMs`, depois a cada `intervalMs`; 0 desliga */
  start(): this {
    if (this.cfg.intervalMs <= 0 || this.first || this.timer) return this;
    this.stopped = false;
    this.first = setTimeout(() => { this.first = null; void this.run(); }, this.cfg.firstDelayMs);
    this.first.unref?.();
    this.timer = setInterval(() => void this.run(), this.cfg.intervalMs);
    this.timer.unref?.();
    return this;
  }

  /** para o agendamento (encerramento do servidor); uma execução em voo termina sozinha */
  stop() {
    this.stopped = true;
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
  }

  /** uma passada; chamada concorrente no MESMO processo recebe a execução em voo (nunca sobrepõe) */
  run(): Promise<CleanupRunMetrics> {
    this.inFlight ??= this.pass().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  get running() { return this.inFlight !== null; }

  private async pass(): Promise<CleanupRunMetrics> {
    const t0 = this.now();
    const m: CleanupRunMetrics = {
      startedAt: new Date(t0).toISOString(), expiredSessionsDeleted: 0, expiredOtpDeleted: 0, expiredTicketsDeleted: 0, rateLimitKeysDeleted: 0,
      batches: 0, durationMs: 0, truncated: false,
    };
    try {
      // memória primeiro: síncrono e barato, não depende do banco estar no ar
      for (const s of this.o.sweepers ?? []) {
        const n = s.sweep(t0);
        if (s.kind === 'tickets') m.expiredTicketsDeleted += n; else m.rateLimitKeysDeleted += n;
      }
      const sessionCut = new Date(t0 - this.cfg.sessionGraceMs);
      const codeCut = new Date(t0 - Math.max(this.cfg.codeGraceMs, CODE_TTL_MS));
      m.expiredSessionsDeleted = await this.drain(m, t0, (lim) => this.store.sessions.deleteExpired(sessionCut, sessionCut, lim));
      if (!m.truncated) m.expiredOtpDeleted = await this.drain(m, t0, (lim) => this.store.codes.deleteExpired(codeCut, codeCut, lim));
    } catch (e) {
      m.error = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 160);
      this.totals.errors++;
    }
    m.durationMs = Math.round(this.now() - t0);
    this.lastRun = m;
    const t = this.totals;
    t.runs++;
    t.expiredSessionsDeleted += m.expiredSessionsDeleted; t.expiredOtpDeleted += m.expiredOtpDeleted;
    t.expiredTicketsDeleted += m.expiredTicketsDeleted; t.rateLimitKeysDeleted += m.rateLimitKeysDeleted;
    (this.o.log ?? ((l: string) => console.log(l)))(formatCleanupLine(m));
    return m;
  }

  /** lotes até um apagar 0 (outra instância pode ter levado parte do lote: só para quando não sobra nada) ou estourar o tempo */
  private async drain(m: CleanupRunMetrics, t0: number, del: (limit: number) => Promise<number>): Promise<number> {
    let total = 0;
    for (;;) {
      if (this.stopped && total > 0) { m.truncated = true; break; }
      const n = await del(this.cfg.batch);
      m.batches++;
      total += n;
      if (n === 0) break;
      if (this.now() - t0 >= this.cfg.maxRunMs) { m.truncated = true; break; }
    }
    return total;
  }

  /** visão do operador (CLI) */
  snapshot() { return { config: this.cfg, lastRun: this.lastRun, totals: { ...this.totals } }; }
}

/** linha de log: só números (nunca identificadores, hashes, códigos ou e-mails) */
export function formatCleanupLine(m: CleanupRunMetrics): string {
  return `[cleanup] sessões −${m.expiredSessionsDeleted} · códigos −${m.expiredOtpDeleted} · tickets −${m.expiredTicketsDeleted} · limites −${m.rateLimitKeysDeleted} · ${m.batches} lotes · ${m.durationMs} ms`
    + (m.truncated ? ' · parcial (limite de tempo)' : '') + (m.error ? ` · ERRO: ${m.error}` : '');
}
