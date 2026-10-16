/**
 * Bots de carga: N clientes reais (SDK Colyseus) enviando movimento a 15 Hz e decodificando o estado como um
 * cliente de verdade. Mede o que cada cliente RECEBE e ENVIA (bytes/s, mensagens/s), correções e jogadores
 * visíveis (detalhados via StateView + multidão distante via mensagem "crowd").
 *
 * uso: npx tsx tools/bots.ts <N> <segundos> [ws://127.0.0.1:2567] [cenário] [opções]
 *   cenário  0 | spawn  perto do spawn (padrão; servidor normal)
 *            1 | spread espalhados ao longo da avenida (requer servidor PV_TEST=1)
 *            dense      todos numa elipse de ~60 m × 20 m no eixo da avenida — o caso real da manifestação (PV_TEST=1)
 *   opções   --offset=K   índice do primeiro bot (vários processos dividem a mesma multidão)
 *            --total=T    tamanho total da multidão (para distribuir posições entre processos)
 *            --wait-go    entra, imprime "READY" e só começa a medir ao receber "go" na entrada padrão
 *            --hold       depois de medir, espera "bye" na entrada padrão antes de sair (o pai coordena)
 *
 * Movimento de multidão: caminhada lenta (0,5–1,4 m/s), paradas de 1–6 s, pequenas variações de rumo,
 * e volta para a área da concentração quando sai dela. Ao receber correção do servidor (parede), muda de rumo.
 */
import WebSocket from 'ws';
import { Client, Callbacks } from '@colyseus/sdk';
import { ROOM_NAME, NET_TICK_HZ } from '../../src/net/protocol.ts';
import { packMove } from '../../src/net/rules.ts';
import { decodeCrowd } from '../../src/net/crowdCodec.ts';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`));
const flagNum = (k: string, d: number) => { const f = flag(k); return f && f.includes('=') ? Number(f.split('=')[1]) : d; };
const N = Number(args[0] ?? 5);
const SECS = Number(args[1] ?? 20);
const ENDPOINT = args[2] ?? 'ws://127.0.0.1:2567';
const SCEN = args[3] === '1' ? 'spread' : args[3] === 'dense' ? 'dense' : args[3] === 'spread' ? 'spread' : 'spawn';
const OFFSET = flagNum('offset', 0);
const TOTAL = flagNum('total', N);
const WAIT_GO = !!flag('wait-go');
const HOLD = !!flag('hold');

// contadores por socket (instrumentação do ws no processo dos bots)
const stats = new Map<unknown, { in: number; out: number; mIn: number; mOut: number }>();
const st = (ws: unknown) => stats.get(ws) ?? (stats.set(ws, { in: 0, out: 0, mIn: 0, mOut: 0 }), stats.get(ws)!);
const P = (WebSocket as any).prototype;
const oSend = P.send, oEmit = P.emit;
P.send = function (d: any, ...r: any[]) { const s = st(this); s.out += d?.byteLength ?? d?.length ?? 0; s.mOut++; return oSend.call(this, d, ...r); };
P.emit = function (ev: string, d: any, ...r: any[]) { if (ev === 'message') { const s = st(this); s.in += d?.byteLength ?? d?.length ?? 0; s.mIn++; } return oEmit.call(this, ev, d, ...r); };

const manifest = JSON.parse(readFileSync(new URL('../../public/world/manifest.json', import.meta.url), 'utf8'));
const axis: [number, number][] = manifest.pvAxis;

/** centro da concentração: meio do trecho longo do eixo (pista larga, sem prédios a menos de ~25 m) */
const DENSE = (() => {
  const a = axis[11], b = axis[12];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, ux: (b[0] - a[0]) / len, uz: (b[1] - a[1]) / len, along: 60, across: 20 };
})();
const inDense = (x: number, z: number) => {
  const dx = x - DENSE.x, dz = z - DENSE.z;
  const u = dx * DENSE.ux + dz * DENSE.uz, v = -dx * DENSE.uz + dz * DENSE.ux;
  return (u / DENSE.along) ** 2 + (v / DENSE.across) ** 2;
};

// gerador determinístico por bot (cenas reproduzíveis)
function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

interface Bot {
  room: any; x: number; z: number; h: number; seq: number; corrections: number; detailed: number; far: number; crowdMsgs: number; trafficMsgs: number;
  speed: number; cruise: number; pause: number; home: { x: number; z: number }; r: () => number;
}
const bots: Bot[] = [];

function spawnPoint(gi: number, r: () => number): { x: number; z: number } | undefined {
  if (SCEN === 'spread') { const ax = axis[Math.floor((gi / Math.max(1, TOTAL - 1)) * (axis.length - 1))]; return { x: ax[0] + (r() - 0.5) * 8, z: ax[1] + (r() - 0.5) * 8 }; }
  if (SCEN === 'dense') {
    // ponto uniforme na elipse (raiz do raio)
    const a = r() * Math.PI * 2, k = Math.sqrt(r()) * 0.95;
    const u = Math.cos(a) * k * DENSE.along, v = Math.sin(a) * k * DENSE.across;
    return { x: DENSE.x + u * DENSE.ux - v * DENSE.uz, z: DENSE.z + u * DENSE.uz + v * DENSE.ux };
  }
  return undefined;
}

async function startBot(i: number) {
  const gi = OFFSET + i;
  const r = rng(gi * 7919 + 13);
  const client = new Client(ENDPOINT);
  const sp = spawnPoint(gi, r);
  const room = await client.joinOrCreate(ROOM_NAME, {
    name: `bot${gi}`, body: (['homem', 'mulher', 'idoso', 'idosa'] as const)[gi % 4],
    skin: [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d][(gi >> 2) % 4], hair: 0x222222,
    top: [0xc0392b, 0x2f6f8f, 0xf1c40f, 0x27ae60, 0xffffff, 0x8e44ad][gi % 6], bottom: 0x2c3a52, shoes: 0xeeeeee,
    ...(sp ? { testSpawn: sp } : {}),
  });
  const b: Bot = {
    room, x: sp?.x ?? 0, z: sp?.z ?? 0, h: r() * Math.PI * 2, seq: 0, corrections: 0, detailed: 0, far: 0, crowdMsgs: 0, trafficMsgs: 0,
    speed: 0, cruise: 0.5 + r() * 0.9, pause: r() * 3, home: sp ?? { x: 0, z: 0 }, r,
  };
  room.onMessage('spawn', (s: any) => { b.x = s.x; b.z = s.z; if (!sp) b.home = { x: s.x, z: s.z }; });
  room.onMessage('correct', (c: number[]) => { b.x = c[0]; b.z = c[2]; b.corrections++; b.h += Math.PI * (0.5 + b.r()); });
  room.onMessage('traffic', () => { b.trafficMsgs++; });
  room.onMessage('crowd', (buf: Uint8Array) => { b.crowdMsgs++; b.far = decodeCrowd(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).length; });
  for (const t of ['pong', 'knock', 'action', 'enter_ok', 'enter_denied', 'exit_ok', 'mode_ok', 'mode_denied', 'push_denied']) room.onMessage(t, () => {});
  const cb = Callbacks.get(room as any) as any;
  cb.onAdd('players', () => { b.detailed++; });
  cb.onRemove('players', () => { b.detailed--; });
  bots.push(b);
}

/** um passo de "multidão": anda devagar, para às vezes, varia o rumo, volta para a concentração */
function stepBot(b: Bot, dt: number) {
  if (b.pause > 0) { b.pause -= dt; b.speed = Math.max(0, b.speed - dt * 2); }
  else {
    b.speed += (b.cruise - b.speed) * Math.min(1, dt * 2);
    if (b.r() < dt * 0.12) b.pause = 1 + b.r() * 5; // para (conversa, olha, espera)
    if (b.r() < dt * 0.5) b.h += (b.r() - 0.5) * 1.2;
  }
  if (SCEN === 'dense') {
    if (inDense(b.x, b.z) > 1) b.h = Math.atan2(DENSE.x - b.x, DENSE.z - b.z) + (b.r() - 0.5) * 0.8;
  } else if (Math.hypot(b.x - b.home.x, b.z - b.home.z) > 40) b.h = Math.atan2(b.home.x - b.x, b.home.z - b.z) + (b.r() - 0.5) * 0.8;
  b.x += Math.sin(b.h) * b.speed * dt; b.z += Math.cos(b.h) * b.speed * dt;
  b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: b.h, speed: b.speed, loco: b.speed > 0.05 ? 1 : 0, seq: ++b.seq }));
}

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  try { await startBot(i); } catch (e) { console.error(`[bots] bot ${OFFSET + i} falhou: ${(e as Error).message}`); }
  await new Promise((r) => setTimeout(r, 15));
}
const joinMs = Date.now() - t0;
const dt = 1 / NET_TICK_HZ;
const timer = setInterval(() => { for (const b of bots) stepBot(b, dt); }, dt * 1000);

const stdinLines = createInterface({ input: process.stdin });
const waitLine = (word: string) => new Promise<void>((res) => stdinLines.on('line', (l) => { if (l.trim() === word) res(); }));
if (WAIT_GO) { console.log('READY'); await waitLine('go'); } else await new Promise((r) => setTimeout(r, 2000));

const startStats = new Map([...stats].map(([k, v]) => [k, { ...v }]));
const tStart = Date.now();
// visíveis: amostra a cada segundo (média da janela)
const visSamples: number[] = [], detSamples: number[] = [];
const vt = setInterval(() => { for (const b of bots) { visSamples.push(b.detailed + b.far); detSamples.push(b.detailed); } }, 1000);
await new Promise((r) => setTimeout(r, SECS * 1000));
clearInterval(vt);
const secs = (Date.now() - tStart) / 1000;
let inB = 0, outB = 0, mIn = 0, mOut = 0;
for (const [k, v] of stats) { const s0 = startStats.get(k) ?? { in: 0, out: 0, mIn: 0, mOut: 0 }; inB += v.in - s0.in; outB += v.out - s0.out; mIn += v.mIn - s0.mIn; mOut += v.mOut - s0.mOut; }
const n = Math.max(1, bots.length);
const avg = (a: number[]) => (a.length ? +(a.reduce((s, c) => s + c, 0) / a.length).toFixed(1) : 0);
const vis = bots.map((b) => b.detailed + b.far);
const res = {
  bots: bots.length, seconds: +secs.toFixed(1), scenario: SCEN,
  perClient: {
    bytesInPerSec: Math.round(inB / secs / n), bytesOutPerSec: Math.round(outB / secs / n),
    msgsInPerSec: +(mIn / secs / n).toFixed(1), msgsOutPerSec: +(mOut / secs / n).toFixed(1),
  },
  totals: { bytesIn: inB, bytesOut: outB, msgsIn: mIn, msgsOut: mOut },
  visiblePlayers: { min: Math.min(...vis), max: Math.max(...vis), avg: avg(visSamples), detailedAvg: avg(detSamples) },
  corrections: bots.reduce((s, b) => s + b.corrections, 0),
  crowdMsgsPerBot: +(bots.reduce((s, b) => s + b.crowdMsgs, 0) / n / secs).toFixed(2),
  trafficSnapshotsPerBot: +(bots.reduce((s, b) => s + b.trafficMsgs, 0) / n / secs).toFixed(2),
  joinMs,
};
console.log(JSON.stringify(res));
if (HOLD) await waitLine('bye');
clearInterval(timer);
await Promise.all(bots.map((b) => b.room.leave().catch(() => {})));
process.exit(0);
