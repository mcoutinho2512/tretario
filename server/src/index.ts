/**
 * Servidor multiplayer de DESENVOLVIMENTO. Escuta só em localhost por padrão.
 * NÃO fazer deploy sem autorização (ver docs/MULTIPLAYER.md).
 *
 * Variáveis: PORT (2567) · HOST (127.0.0.1) · COLYSEUS_LATENCY (RTT simulado, ms) · PV_JITTER (ms) · PV_LOSS (0–1)
 *            PV_METRICS=1 (log a cada 5 s) · PV_EVENT · PV_SEED · PV_TRAFFIC (população) · PV_AOI (m)
 */
import { createServer } from 'node:http';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PresidenteVargasRoom } from './PresidenteVargasRoom.ts';
import { ROOM_NAME } from '../../src/net/protocol.ts';
import { metrics } from './metrics.ts';

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '127.0.0.1';

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
createServer((req, res) => {
  if (req.url?.startsWith('/metrics')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(metrics.sample('http')));
  } else { res.writeHead(404); res.end(); }
}).listen(port + 1, host);
