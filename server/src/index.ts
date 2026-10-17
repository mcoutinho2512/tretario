/**
 * Servidor multiplayer de DESENVOLVIMENTO. Escuta só em localhost por padrão.
 * NÃO fazer deploy sem autorização (ver docs/MULTIPLAYER.md).
 *
 * Variáveis: PORT (2567) · HOST (127.0.0.1) · COLYSEUS_LATENCY (RTT simulado, ms) · PV_JITTER (ms) · PV_LOSS (0–1)
 *            PV_METRICS=1 (log a cada 5 s) · PV_EVENT · PV_SEED · PV_AOI (m) · PV_VEH_RESET_MS (retorno à vaga)
 *            rodada 8: DATABASE_URL (PostgreSQL local, server/.env) · PV_STORE=memory · PV_ALLOW_ANON_PLAYERS=1 · API em PORT+1 (/api/*)
 *            grafite: PV_GRAFFITI_FILE · PV_GRAFFITI_STORE=memory · PV_GRAFFITI_TTL_MS · PV_GRAFFITI_REPORTS · PV_ADMIN_TOKEN (docs/GRAFFITI.md)
 */
import './env.ts'; // PRIMEIRO: server/.env antes de qualquer módulo ler process.env
import './polyfills.ts'; // WebSocket global (reconexão do Colyseus no Node 20)
import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PresidenteVargasRoom } from './PresidenteVargasRoom.ts';
import { ROOM_NAME } from '../../src/net/protocol.ts';
import { metrics } from './metrics.ts';
import { initServices } from './services.ts';
import './data/prisma.ts'; // registra o PrismaDataStore (usado quando DATABASE_URL existe e PV_STORE != memory)
import { seedEvents } from './events/seed.ts';
import { router } from './http/router.ts';
import './http/routes.ts'; // registra as rotas da API (/api/*)

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '127.0.0.1';

const svc = await initServices().catch((e) => {
  console.error(`[services] banco inacessível (${(e as Error).message}). Suba com \`docker compose up -d db\` ou rode com PV_STORE=memory.`);
  process.exit(1);
});
// grupos dos eventos (public/events/*.json) espelhados no banco: EventMembership sempre aponta para um grupo válido
console.log(`[services] ${await seedEvents(svc.store)} eventos sincronizados no banco`);
const server = new Server({ transport: new WebSocketTransport() });
server.define(ROOM_NAME, PresidenteVargasRoom);
await server.listen(port, host);
console.log(`[pv3d-server] ws://${host}:${port} · sala "${ROOM_NAME}" (desenvolvimento)`);
if (process.env.COLYSEUS_LATENCY) console.log(`[pv3d-server] latência simulada (RTT): ${process.env.COLYSEUS_LATENCY} ms`);
if (process.env.PV_JITTER || process.env.PV_LOSS) console.log(`[pv3d-server] jitter ${process.env.PV_JITTER ?? 0} ms · perda ${process.env.PV_LOSS ?? 0}`);

// métricas: GET http://127.0.0.1:<PORT+1>/metrics
setInterval(() => {
  const m = metrics.sample();
  if (process.env.PV_METRICS === '1' && m.players) console.log('[metrics]', JSON.stringify(m));
}, 5000);
// HTTP próprio (porta PORT+1): API da rodada 8 (/api/* — contas, sessão, perfil, eventos; o Vite faz proxy para cá
// em desenvolvimento, então para o navegador é a MESMA origem do jogo e o cookie HttpOnly funciona) e métricas
createServer(async (req, res) => {
  if (await router.handle(req, res)) return;
  if (req.url?.startsWith('/metrics')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(metrics.sample('http')));
  } else { res.writeHead(404); res.end(); }
}).listen(port + 1, host);
