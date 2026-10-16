/**
 * Bots de carga: N clientes reais (SDK Colyseus) andando pela Pres. Vargas, enviando movimento a 15 Hz.
 * Mede o que cada cliente RECEBE e ENVIA (bytes/s, mensagens/s), correções e jogadores visíveis (AOI).
 *
 * uso: npx tsx tools/bots.ts <N> <segundos> [ws://127.0.0.1:2567] [espalhar=1]
 */
import WebSocket from 'ws';
import { Client, Callbacks } from '@colyseus/sdk';
import { ROOM_NAME, NET_TICK_HZ } from '../../src/net/protocol.ts';
import { packMove } from '../../src/net/rules.ts';
import { readFileSync } from 'node:fs';

const N = Number(process.argv[2] ?? 5);
const SECS = Number(process.argv[3] ?? 20);
const ENDPOINT = process.argv[4] ?? 'ws://127.0.0.1:2567';
const SPREAD = process.argv[5] === '1';

// contadores por socket (instrumentação do ws no processo dos bots)
const stats = new Map<unknown, { in: number; out: number; mIn: number; mOut: number }>();
const st = (ws: unknown) => stats.get(ws) ?? (stats.set(ws, { in: 0, out: 0, mIn: 0, mOut: 0 }), stats.get(ws)!);
const P = (WebSocket as any).prototype;
const oSend = P.send, oEmit = P.emit;
P.send = function (d: any, ...r: any[]) { const s = st(this); s.out += d?.byteLength ?? d?.length ?? 0; s.mOut++; return oSend.call(this, d, ...r); };
P.emit = function (ev: string, d: any, ...r: any[]) { if (ev === 'message') { const s = st(this); s.in += d?.byteLength ?? d?.length ?? 0; s.mIn++; } return oEmit.call(this, ev, d, ...r); };

const manifest = JSON.parse(readFileSync(new URL('../../public/world/manifest.json', import.meta.url), 'utf8'));
const axis: [number, number][] = manifest.pvAxis;

interface Bot { room: any; x: number; z: number; h: number; seq: number; corrections: number; visible: number; trafficMsgs: number }
const bots: Bot[] = [];

async function startBot(i: number) {
  const client = new Client(ENDPOINT);
  const ax = axis[Math.floor((i / Math.max(1, N - 1)) * (axis.length - 1))];
  const room = await client.joinOrCreate(ROOM_NAME, {
    name: `bot${i}`, body: (['homem', 'mulher', 'idoso', 'idosa'] as const)[i % 4], skin: 0xc68b62, hair: 0x222222, top: 0x2f6f8f, bottom: 0x2c3a52, shoes: 0xeeeeee,
    ...(SPREAD ? { testSpawn: { x: ax[0], z: ax[1] } } : {}), // espalhado ao longo da avenida (requer servidor PV_TEST=1)
  });
  const b: Bot = { room, x: 0, z: 0, h: Math.random() * Math.PI * 2, seq: 0, corrections: 0, visible: 0, trafficMsgs: 0 };
  room.onMessage('spawn', (s: any) => {
    b.x = s.x; b.z = s.z;

  });
  room.onMessage('correct', (c: number[]) => { b.x = c[0]; b.z = c[2]; b.corrections++; b.h += Math.PI * (0.5 + Math.random()); });
  room.onMessage('traffic', () => { b.trafficMsgs++; });
  for (const t of ['pong', 'knock', 'action', 'enter_ok', 'enter_denied', 'exit_ok', 'mode_ok', 'mode_denied', 'push_denied']) room.onMessage(t, () => {});
  const cb = Callbacks.get(room as any) as any;
  cb.onAdd('players', () => { b.visible++; });
  cb.onRemove('players', () => { b.visible--; });
  bots.push(b);
}

const t0 = Date.now();
for (let i = 0; i < N; i++) { await startBot(i); await new Promise((r) => setTimeout(r, 40)); }
const startStats = new Map([...stats].map(([k, v]) => [k, { ...v }]));
const tStart = Date.now();
const dt = 1 / NET_TICK_HZ;
const timer = setInterval(() => {
  for (const b of bots) {
    const tg = (b as any).target as [number, number] | undefined;
    if (tg && Math.hypot(tg[0] - b.x, tg[1] - b.z) > 5) b.h = Math.atan2(tg[0] - b.x, tg[1] - b.z) + (Math.random() - 0.5) * 0.4;
    else if (Math.random() < 0.02) b.h += (Math.random() - 0.5) * 2;
    const sp = tg ? 5.0 : 1.6;
    b.x += Math.sin(b.h) * sp * dt; b.z += Math.cos(b.h) * sp * dt;
    b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: b.h, speed: sp, loco: sp > 3 ? 2 : 1, seq: ++b.seq }));
  }
}, dt * 1000);

await new Promise((r) => setTimeout(r, SECS * 1000));
clearInterval(timer);
const secs = (Date.now() - tStart) / 1000;
let inB = 0, outB = 0, mIn = 0, mOut = 0;
for (const [k, v] of stats) { const s0 = startStats.get(k) ?? { in: 0, out: 0, mIn: 0, mOut: 0 }; inB += v.in - s0.in; outB += v.out - s0.out; mIn += v.mIn - s0.mIn; mOut += v.mOut - s0.mOut; }
const vis = bots.map((b) => b.visible);
const res = {
  bots: N, seconds: +secs.toFixed(1), spread: SPREAD,
  perClient: {
    bytesInPerSec: Math.round(inB / secs / N), bytesOutPerSec: Math.round(outB / secs / N),
    msgsInPerSec: +(mIn / secs / N).toFixed(1), msgsOutPerSec: +(mOut / secs / N).toFixed(1),
  },
  visiblePlayers: { min: Math.min(...vis), max: Math.max(...vis), avg: +(vis.reduce((a, c) => a + c, 0) / N).toFixed(1) },
  corrections: bots.reduce((s, b) => s + b.corrections, 0),
  trafficSnapshotsPerBot: +(bots.reduce((s, b) => s + b.trafficMsgs, 0) / N / secs).toFixed(2),
  joinMs: tStart - t0,
};
console.log(JSON.stringify(res));
for (const b of bots) await b.room.leave();
process.exit(0);
