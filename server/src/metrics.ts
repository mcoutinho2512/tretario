/**
 * Métricas de desenvolvimento do servidor: bytes/mensagens por segundo (via instrumentação do `ws`),
 * custo do tick, memória. Impressas a cada 5 s com PV_METRICS=1 e expostas em GET /metrics (JSON).
 */
import WebSocket from 'ws';

let bytesOut = 0, bytesIn = 0, msgsOut = 0, msgsIn = 0;
let players = 0;
let corrections = 0, denials = 0, knocks = 0, impacts = 0;
let snapshot: Record<string, number> = {};
/** cada consumidor (log interno, GET /metrics) tem a SUA janela — um não zera a do outro */
interface Win { t: number; bytesOut: number; bytesIn: number; msgsOut: number; msgsIn: number; tickMs: number; ticks: number; maxTick: number }
const windows = new Map<string, Win>();
const win = (k: string): Win => {
  let w = windows.get(k);
  if (!w) windows.set(k, (w = { t: Date.now(), bytesOut, bytesIn, msgsOut, msgsIn, tickMs: 0, ticks: 0, maxTick: 0 }));
  return w;
};

// instrumenta envios e recebimentos do servidor WebSocket
const proto = (WebSocket as unknown as { prototype: { send: (...a: unknown[]) => void } }).prototype;
const origSend = proto.send;
proto.send = function (this: unknown, data: unknown, ...rest: unknown[]) {
  const n = data instanceof ArrayBuffer ? data.byteLength : ArrayBuffer.isView(data) ? (data as ArrayBufferView).byteLength : typeof data === 'string' ? Buffer.byteLength(data) : 0;
  bytesOut += n; msgsOut++;
  return origSend.call(this, data, ...rest);
};

const origEmit = (WebSocket as unknown as { prototype: { emit: (...a: unknown[]) => boolean } }).prototype.emit;
(WebSocket as unknown as { prototype: { emit: (...a: unknown[]) => boolean } }).prototype.emit = function (this: unknown, ev: unknown, data: unknown, ...rest: unknown[]) {
  if (ev === 'message') {
    const n = data instanceof ArrayBuffer ? data.byteLength : ArrayBuffer.isView(data) ? (data as ArrayBufferView).byteLength : Array.isArray(data) ? data.reduce((s: number, b: Buffer) => s + b.byteLength, 0) : typeof data === 'string' ? Buffer.byteLength(data) : 0;
    bytesIn += n;
  }
  return origEmit.call(this, ev, data, ...rest);
};

export const metrics = {
  rawIn(n: number) { bytesIn += n; },
  msgIn(_id: string) { msgsIn++; },
  tick(ms: number, p: number) { for (const w of windows.values()) { w.tickMs += ms; w.ticks++; w.maxTick = Math.max(w.maxTick, ms); } players = p; },
  join(_id: string) {},
  leave(_id: string) {},
  correction() { corrections++; },
  denied() { denials++; },
  knock(kind: string) { if (kind === 'impact') impacts++; else knocks++; },
  /** calcula taxas desde a última chamada DESTE consumidor (`key`) */
  sample(key = 'log') {
    const w = win(key);
    const now = Date.now();
    const dt = (now - w.t) / 1000 || 1;
    const mem = process.memoryUsage();
    const dOut = bytesOut - w.bytesOut, dIn = bytesIn - w.bytesIn;
    snapshot = {
      players,
      bytesOutPerSec: Math.round(dOut / dt),
      bytesInPerSec: Math.round(dIn / dt),
      msgsOutPerSec: Math.round((msgsOut - w.msgsOut) / dt),
      msgsInPerSec: Math.round((msgsIn - w.msgsIn) / dt),
      bytesOutPerPlayerPerSec: players ? Math.round(dOut / dt / players) : 0,
      bytesInPerPlayerPerSec: players ? Math.round(dIn / dt / players) : 0,
      tickAvgMs: w.ticks ? +(w.tickMs / w.ticks).toFixed(3) : 0,
      tickMaxMs: +w.maxTick.toFixed(3),
      heapMB: +(mem.heapUsed / 1e6).toFixed(1),
      rssMB: +(mem.rss / 1e6).toFixed(1),
      corrections, denials, knocks, impacts,
    };
    Object.assign(w, { t: now, bytesOut, bytesIn, msgsOut, msgsIn, tickMs: 0, ticks: 0, maxTick: 0 });
    return snapshot;
  },
  get last() { return snapshot; },
};
