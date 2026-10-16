/**
 * Métricas de desenvolvimento do servidor: bytes/mensagens por segundo (via instrumentação do `ws`),
 * custo do tick, memória. Impressas a cada 5 s com PV_METRICS=1 e expostas em GET /metrics (JSON).
 */
import WebSocket from 'ws';

let bytesOut = 0, bytesIn = 0, msgsOut = 0, msgsIn = 0;
let tickMs = 0, ticks = 0, maxTick = 0;
let players = 0;
let corrections = 0, denials = 0, knocks = 0, impacts = 0;
let last = { t: Date.now(), bytesOut: 0, bytesIn: 0, msgsOut: 0, msgsIn: 0 };
let snapshot: Record<string, number> = {};

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
  tick(ms: number, p: number) { tickMs += ms; ticks++; maxTick = Math.max(maxTick, ms); players = p; },
  join(_id: string) {},
  leave(_id: string) {},
  correction() { corrections++; },
  denied() { denials++; },
  knock(kind: string) { if (kind === 'impact') impacts++; else knocks++; },
  /** calcula taxas desde a última chamada */
  sample() {
    const now = Date.now();
    const dt = (now - last.t) / 1000 || 1;
    const mem = process.memoryUsage();
    snapshot = {
      players,
      bytesOutPerSec: Math.round((bytesOut - last.bytesOut) / dt),
      bytesInPerSec: Math.round((bytesIn - last.bytesIn) / dt),
      msgsOutPerSec: Math.round((msgsOut - last.msgsOut) / dt),
      msgsInPerSec: Math.round((msgsIn - last.msgsIn) / dt),
      bytesOutPerPlayerPerSec: players ? Math.round((bytesOut - last.bytesOut) / dt / players) : 0,
      bytesInPerPlayerPerSec: players ? Math.round((bytesIn - last.bytesIn) / dt / players) : 0,
      tickAvgMs: ticks ? +(tickMs / ticks).toFixed(3) : 0,
      tickMaxMs: +maxTick.toFixed(3),
      heapMB: +(mem.heapUsed / 1e6).toFixed(1),
      rssMB: +(mem.rss / 1e6).toFixed(1),
      corrections, denials, knocks, impacts,
    };
    last = { t: now, bytesOut, bytesIn, msgsOut, msgsIn };
    tickMs = 0; ticks = 0; maxTick = 0;
    return snapshot;
  },
  get last() { return snapshot; },
};
