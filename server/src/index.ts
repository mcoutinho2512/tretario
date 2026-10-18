/**
 * Servidor multiplayer (jogo + API num processo só). Escuta só em 127.0.0.1 por padrão; em produção fica atrás do
 * Nginx (deploy/CONTRACT.md: /game/ → PORT, /api/ e /health/ → PORT+1).
 *
 * Variáveis: PORT (2567) · HOST (127.0.0.1) · COLYSEUS_LATENCY (RTT simulado, ms) · PV_JITTER (ms) · PV_LOSS (0–1)
 *            PV_METRICS=1 (log a cada 5 s) · PV_EVENT · PV_SEED · PV_AOI (m) · PV_VEH_RESET_MS (retorno à vaga)
 *            rodada 8: DATABASE_URL (PostgreSQL local, server/.env) · PV_STORE=memory · PV_ALLOW_ANON_PLAYERS=1 · API em PORT+1 (/api/*)
 *            limpeza: CLEANUP_INTERVAL_MINUTES (0 desliga) · CLEANUP_SESSION_GRACE_MINUTES · CLEANUP_CODE_GRACE_MINUTES · CLEANUP_BATCH (docs/DATABASE.md)
 *            grafite: PV_GRAFFITI_FILE · PV_GRAFFITI_STORE=memory · PV_GRAFFITI_TTL_MS · PV_GRAFFITI_REPORTS · PV_ADMIN_TOKEN (docs/GRAFFITI.md)
 *            rodada 9.1 (produção): NODE_ENV · PV_PUBLIC_ORIGIN · PV_TRUST_PROXY · PV_REGISTRATION · MAX_PLAYERS_PER_ROOM ·
 *            MAX_SPECTATORS_PER_ROOM · PV_JOIN_RATE_IP/USER · PV_LOG_FORMAT=json · PV_SHUTDOWN_MS (docs/SECURITY_PRODUCTION.md)
 */
import './env.ts'; // PRIMEIRO: server/.env antes de qualquer módulo ler process.env
import { productionProblems } from './prodGuard.ts';
import { log } from './log.ts';

// rodada 9.1 — travas de produção ANTES de abrir banco ou porta (chaves de teste, segredos fracos, cadastro sem beta)
{
  const g = productionProblems();
  for (const w of g.warnings) log.warn('startup', `aviso de produção: ${w}`);
  if (g.errors.length) {
    for (const e of g.errors) log.error('startup', `recusado em produção: ${e}`);
    process.exit(1);
  }
}

import './polyfills.ts'; // WebSocket global (reconexão do Colyseus no Node 20)
import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PresidenteVargasRoom, ROOM_CAPS, liveRooms } from './PresidenteVargasRoom.ts';
import { PROTOCOL_VERSION, ROOM_NAME } from '../../src/net/protocol.ts';
import { metrics } from './metrics.ts';
import { initServices } from './services.ts';
import './data/prisma.ts'; // registra o PrismaDataStore (usado quando DATABASE_URL existe e PV_STORE != memory)
import { seedEvents } from './events/seed.ts';
import { router } from './http/router.ts';
import './http/routes.ts'; // registra as rotas da API (/api/*)
import { runtime, sweepHealthLimits } from './http/health.ts';
import { CleanupService, liveMemorySweepers } from './cleanup/CleanupService.ts';
import { sweepAuthLimits } from './auth/routes.ts';
import { sweepProfileLimits } from './http/profile.ts';
import { buildInfo, shortCommit } from './buildInfo.ts';
import { registrationMode } from './auth/mail.ts';

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '127.0.0.1';
const prod = process.env.NODE_ENV === 'production';

const svc = await initServices().catch((e) => {
  log.error('startup', `banco inacessível (${(e as Error).message}). Suba com \`docker compose up -d db\` ou rode com PV_STORE=memory.`);
  process.exit(1);
});
// grupos dos eventos (public/events/*.json) espelhados no banco: EventMembership sempre aponta para um grupo válido
log.info('services', `${await seedEvents(svc.store)} eventos sincronizados no banco`);
// desligamento gracioso é NOSSO (abaixo, ≤ 15 s): o do Colyseus sairia antes de gravar banco/arquivos
const transport = new WebSocketTransport();
const server = new Server({ transport, gracefullyShutdown: false, greet: !log.json } as ConstructorParameters<typeof Server>[0]); // sem banner no JSON
server.define(ROOM_NAME, PresidenteVargasRoom);
await server.listen(port, host);
runtime.wsCount = () => (transport as unknown as { wss?: { clients?: Set<unknown> } }).wss?.clients?.size ?? 0;
runtime.accepting = true;
const b = buildInfo();
// a linha "[pv3d-server]" é o sinal de pronto dos testes/QA (saída legível); em JSON vai como evento startup
log.info(log.json ? 'startup' : 'pv3d-server', `ws://${host}:${port} · sala "${ROOM_NAME}"${prod ? '' : ' (desenvolvimento)'}`, {
  port, apiPort: port + 1, protocol: PROTOCOL_VERSION, version: shortCommit(), buildTime: b.buildTime, env: process.env.NODE_ENV ?? 'development',
  store: svc.store.kind, registration: registrationMode(), maxPlayers: ROOM_CAPS.players, maxSpectators: ROOM_CAPS.spectators, node: process.version,
});
// limpeza de efêmeros vencidos (sessões, códigos, tickets, limites): primeira passada alguns segundos depois, sem
// bloquear a subida; timers com unref; para no encerramento gracioso
const cleanup = new CleanupService(svc.store, {
  sweepers: [
    { kind: 'tickets', sweep: (now) => svc.tickets.sweep(now) },
    { kind: 'rateLimit', sweep: (now) => sweepAuthLimits(now) + sweepProfileLimits(now) + sweepHealthLimits(now) + [...liveMemorySweepers].reduce((n, c) => n + c.sweep(now), 0) },
  ],
}).start();
if (process.env.COLYSEUS_LATENCY) log.info('pv3d-server', `latência simulada (RTT): ${process.env.COLYSEUS_LATENCY} ms`);
if (process.env.PV_JITTER || process.env.PV_LOSS) log.info('pv3d-server', `jitter ${process.env.PV_JITTER ?? 0} ms · perda ${process.env.PV_LOSS ?? 0}`);

// métricas: GET http://127.0.0.1:<PORT+1>/metrics
const metricsTimer = setInterval(() => {
  const m = metrics.sample();
  if (process.env.PV_METRICS === '1' && m.players) console.log('[metrics]', JSON.stringify(m));
}, 5000);
// HTTP próprio (porta PORT+1): API (/api/* — contas, sessão, perfil, eventos; o Vite/Nginx faz proxy para cá, então
// para o navegador é a MESMA origem do jogo e o cookie HttpOnly funciona), /health/*, /internal/health e métricas
const api = createServer(async (req, res) => {
  if (await router.handle(req, res)) return;
  if (req.url?.startsWith('/metrics')) {
    // interno (o Nginx nega /metrics); CORS aberto só em desenvolvimento (painéis locais)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(prod ? {} : { 'Access-Control-Allow-Origin': '*' }) });
    res.end(JSON.stringify(metrics.sample('http')));
  } else { res.writeHead(404); res.end(); }
}).listen(port + 1, host);

// ------------------------------------------------------------------ desligamento gracioso (SIGTERM do systemd)
/**
 * 1. para de aceitar entradas (onAuth recusa; /health/ready → 503) · 2. avisa as salas (`server_restarting`: o cliente
 * mostra RECONECTANDO e entra de novo sozinho quando o novo processo subir) · 3. fecha as salas (onDispose grava
 * progressão, grafites e telemetria) · 4. para limpeza/timers · 5. fecha a API e o banco ($disconnect) · sai com 0.
 * Prazo total PV_SHUTDOWN_MS (14 s; o systemd mata em 20 s): estourou → sai com 1 (registrado).
 */
const SHUTDOWN_MS = Number(process.env.PV_SHUTDOWN_MS ?? 14_000);
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  const t0 = Date.now();
  runtime.shuttingDown = true; runtime.accepting = false;
  log.info('shutdown', `${signal}: encerrando (prazo ${SHUTDOWN_MS} ms)`, { signal, rooms: liveRooms.size, websockets: runtime.wsCount() });
  const hard = setTimeout(() => { log.error('shutdown', 'prazo estourado — saída forçada', { ms: Date.now() - t0 }); process.exit(1); }, SHUTDOWN_MS);
  hard.unref();
  try {
    for (const r of liveRooms) r.announceShutdown();
    await new Promise((r) => setTimeout(r, 400)); // o aviso sai antes do fechamento
    await server.gracefullyShutdown(false); // fecha salas (onDispose grava tudo) e o transporte
    cleanup.stop();
    clearInterval(metricsTimer);
    await new Promise<void>((r) => api.close(() => r()));
    await svc.store.close(); // prisma $disconnect
    log.info('shutdown', 'encerrado', { ms: Date.now() - t0 });
    clearTimeout(hard);
    process.exit(0);
  } catch (e) {
    log.error('shutdown', 'falha no encerramento', { err: e as Error, ms: Date.now() - t0 });
    process.exit(1);
  }
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (e) => { log.error('error', 'exceção não tratada', { err: e, stack: e?.stack?.split('\n').slice(1, 6).join(' | ') }); void shutdown('uncaughtException'); });
process.on('unhandledRejection', (e) => { log.error('error', 'promessa rejeitada sem tratamento', { err: e instanceof Error ? e : String(e) }); });
