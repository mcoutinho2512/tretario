/**
 * Saúde e status (rodada 9.1, deploy/CONTRACT.md) — porta da API (PORT+1), atrás do Nginx:
 *   GET /health/live      público   {ok:true} — o processo responde
 *   GET /health/ready     público   {ok} — banco responde (`SELECT 1`, 2 s; só com PostgreSQL) e a sala aceita entradas; 503 se não
 *   GET /api/status       público   {online, protocol, version} — nada de infraestrutura
 *   GET /internal/health  INTERNO   header `x-admin-token` = PV_ADMIN_TOKEN (o Nginx nega a rota de fora): uptime, build,
 *                                   banco, jogadores/espectadores/salas, tick, atraso do event loop, memória, WebSockets
 * Degradação (banco fora, event loop atrasado, tick lento) vira log `health.degraded` na TRANSIÇÃO (não a cada leitura).
 */
import { timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { router } from './router.ts';
import { services } from '../services.ts';
import { PROTOCOL_VERSION } from '../../../src/net/protocol.ts';
import { buildInfo, shortCommit } from '../buildInfo.ts';
import { liveWorlds } from '../presence/publicMetrics.ts';
import { metrics } from '../metrics.ts';
import { Backoff, ipKey } from '../auth/rateLimit.ts';
import { log } from '../log.ts';

/** estado do processo, preenchido por server/src/index.ts */
export const runtime = {
  startedAt: Date.now(),
  /** sala definida e escutando; false antes de subir e durante o desligamento */
  accepting: false,
  shuttingDown: false,
  /** WebSockets abertos (transporte) */
  wsCount: (): number => 0,
};

const DB_TIMEOUT_MS = 2000;

/** `SELECT 1` com prazo; null = sem banco a conferir (memória) */
export async function dbCheck(): Promise<{ ok: boolean; ms: number; error?: string } | null> {
  let store;
  try { store = services().store; } catch { return { ok: false, ms: 0, error: 'servicos_nao_iniciados' }; }
  if (!store.ping) return null;
  const t0 = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([store.ping(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('tempo_esgotado')), DB_TIMEOUT_MS); })]);
    return { ok: true, ms: +(performance.now() - t0).toFixed(1) };
  } catch (e) {
    return { ok: false, ms: +(performance.now() - t0).toFixed(1), error: (e as Error).message === 'tempo_esgotado' ? 'tempo_esgotado' : 'falha' };
  } finally { clearTimeout(timer); }
}

// atraso do event loop: histograma contínuo, janela trocada a cada leitura do /internal/health ou a cada 30 s
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let loopWin = { meanMs: 0, p99Ms: 0, maxMs: 0 };
function rollLoop() {
  const ns = 1e6;
  loopWin = { meanMs: +(loop.mean / ns || 0).toFixed(1), p99Ms: +(loop.percentile(99) / ns || 0).toFixed(1), maxMs: +(loop.max / ns || 0).toFixed(1) };
  loop.reset();
  return loopWin;
}

function counts() {
  const now = Date.now();
  let players = 0, spectators = 0, bots = 0;
  for (const w of liveWorlds) { const c = w.counts(now); players += c.players; spectators += c.spectators; bots += c.bots; }
  return { players, spectators, bots, rooms: liveWorlds.size };
}

// ------------------------------------------------------------------ degradação (log na transição)
let degraded = new Set<string>();
async function watch() {
  if (runtime.shuttingDown) return;
  const db = await dbCheck();
  const lw = rollLoop();
  const m = metrics.sample('health-watch');
  const now = new Set<string>();
  if (db && !db.ok) now.add('db');
  if (lw.p99Ms > 250) now.add('event_loop');
  if (m.tickMaxMs > 150) now.add('tick');
  for (const k of now) if (!degraded.has(k)) log.warn('health.degraded', `degradado: ${k}`, { check: k, dbMs: db?.ms ?? null, loopP99Ms: lw.p99Ms, tickMaxMs: m.tickMaxMs });
  for (const k of degraded) if (!now.has(k)) log.info('health.recovered', `recuperado: ${k}`, { check: k });
  degraded = now;
}
setInterval(() => void watch(), 30_000).unref();

// ------------------------------------------------------------------ rotas
router.add('GET', '/health/live', () => ({ body: { ok: true } }));

router.add('GET', '/health/ready', async () => {
  const db = await dbCheck();
  const ok = runtime.accepting && !runtime.shuttingDown && (db === null || db.ok);
  return { status: ok ? 200 : 503, body: { ok } };
});

router.add('GET', '/api/status', () => ({ body: { online: runtime.accepting && !runtime.shuttingDown, protocol: PROTOCOL_VERSION, version: shortCommit() } }));

const badToken = new Backoff({ free: 5, baseMs: 2000, maxMs: 10 * 60_000, forgetMs: 60 * 60_000 });
function tokenOk(got: unknown): boolean {
  const want = process.env.PV_ADMIN_TOKEN ?? '';
  if (!want || typeof got !== 'string' || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

router.add('GET', '/internal/health', async (req) => {
  const k = ipKey(req.ip);
  if (badToken.wait(k) > 0) { log.rate('internal_health'); return { status: 429, body: { error: 'muitas_tentativas' } }; }
  if (!tokenOk(req.headers['x-admin-token'])) { badToken.fail(k); return { status: 401, body: { error: 'nao_autorizado' } }; }
  badToken.reset(k);
  const [db, mem] = [await dbCheck(), process.memoryUsage()];
  const b = buildInfo(), m = metrics.sample('internal-health'), c = counts();
  return {
    body: {
      ok: runtime.accepting && !runtime.shuttingDown && (db === null || db.ok),
      uptimeS: Math.round((Date.now() - runtime.startedAt) / 1000),
      version: shortCommit(), commit: b.commit, buildTime: b.buildTime, protocol: PROTOCOL_VERSION, node: process.version,
      db: db === null ? { kind: 'memory' } : { kind: 'postgresql', ok: db.ok, latencyMs: db.ms, ...(db.error ? { error: db.error } : {}) },
      ...c,
      websockets: runtime.wsCount(),
      tick: { avgMs: m.tickAvgMs, maxMs: m.tickMaxMs, patchAvgMs: m.patchAvgMs, patchMaxMs: m.patchMaxMs },
      eventLoop: { ...rollLoop(), utilization: m.elu },
      memory: { heapUsedMB: +(mem.heapUsed / 1e6).toFixed(1), heapTotalMB: +(mem.heapTotal / 1e6).toFixed(1), rssMB: +(mem.rss / 1e6).toFixed(1) },
      degraded: [...degraded],
      shuttingDown: runtime.shuttingDown,
    },
  };
});

/** limpeza do limitador (CleanupService) */
export function sweepHealthLimits(now = Date.now()): number { return badToken.sweep(now); }
