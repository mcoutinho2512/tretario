/**
 * Métricas de desenvolvimento do servidor: bytes/mensagens por segundo (via instrumentação do `ws`),
 * custo do tick, memória. Impressas a cada 5 s com PV_METRICS=1 e expostas em GET /metrics (JSON).
 */
import WebSocket from 'ws';
import { performance, type EventLoopUtilization } from 'node:perf_hooks';

let bytesOut = 0, bytesIn = 0, msgsOut = 0, msgsIn = 0;
let players = 0;
let corrections = 0, denials = 0, knocks = 0, impacts = 0;
let snapshot: Record<string, number> = {};
/** rodada 12 — autônomos: custo de IA por janela + contagens atuais (gauge) */
interface AiWin { ms: number; ticks: number; max: number; decisions: number; decideMs: number; moveMs: number; socialMs: number }
const aiWins = new Map<string, AiWin>();
let aiGauge = { population: 0, near: 0, mid: 0, far: 0, dormant: 0 };
export interface AiSource { population: number; lodCount: { NEAR: number; MID: number; FAR: number; DORMANT: number }; takeCost(): { decisions: number; decideMs: number; moveMs: number; socialMs: number } }
setInterval(() => metrics.rssPeak(), 1000).unref();
/** cada consumidor (log interno, GET /metrics) tem a SUA janela — um não zera a do outro */
interface Win {
  t: number; bytesOut: number; bytesIn: number; msgsOut: number; msgsIn: number; tickMs: number; ticks: number; maxTick: number;
  patchMs: number; patches: number; maxPatch: number; aoiMs: number; aois: number; maxAoi: number; crowdMs: number; crowds: number; combatMs: number; combats: number; maxCombat: number; hitMs: number; hits: number; maxHit: number; cbtReq: number; cbtOk: number;
  cpu: NodeJS.CpuUsage; elu: EventLoopUtilization; maxRss: number;
}
const windows = new Map<string, Win>();
const win = (k: string): Win => {
  let w = windows.get(k);
  if (!w) windows.set(k, (w = { t: Date.now(), bytesOut, bytesIn, msgsOut, msgsIn, tickMs: 0, ticks: 0, maxTick: 0, patchMs: 0, patches: 0, maxPatch: 0, aoiMs: 0, aois: 0, maxAoi: 0, crowdMs: 0, crowds: 0, combatMs: 0, combats: 0, maxCombat: 0, hitMs: 0, hits: 0, maxHit: 0, cbtReq: 0, cbtOk: 0, cpu: process.cpuUsage(), elu: performance.eventLoopUtilization(), maxRss: 0 }));
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
  /** codificação + envio dos patches de estado (StateView por cliente) — fora do tick de simulação */
  patch(ms: number) { for (const w of windows.values()) { w.patchMs += ms; w.patches++; w.maxPatch = Math.max(w.maxPatch, ms); } },
  /** recálculo da área de interesse (já incluído no tick) */
  aoi(ms: number) { for (const w of windows.values()) { w.aoiMs += ms; w.aois++; w.maxAoi = Math.max(w.maxAoi, ms); } },
  /** montagem e envio da multidão distante (já incluído no tick) */
  crowd(ms: number) { for (const w of windows.values()) { w.crowdMs += ms; w.crowds++; } },
  /** rodada 9: atualização do confronto no tick (janelas ativas/validação de acerto, regeneração, bonecos) */
  combat(ms: number) { for (const w of windows.values()) { w.combatMs += ms; w.combats++; w.maxCombat = Math.max(w.maxCombat, ms); } },
  /** validação de UMA janela ativa (candidatos da grade, alcance/arco/parede/política, impacto) */
  combatHit(ms: number) { for (const w of windows.values()) { w.hitMs += ms; w.hits++; w.maxHit = Math.max(w.maxHit, ms); } },
  combatReq(ok: boolean) { for (const w of windows.values()) { w.cbtReq++; if (ok) w.cbtOk++; } },
  /** pico de memória residente (amostrado a cada tick de métricas) */
  rssPeak() { const r = process.memoryUsage.rss(); for (const w of windows.values()) w.maxRss = Math.max(w.maxRss, r); },
  /** rodada 12 — um tick do sistema de autônomos (ms total) + decisões/partes desde a última chamada */
  ai(ms: number, src: AiSource) {
    const c = src.takeCost();
    aiGauge = { population: src.population, near: src.lodCount.NEAR, mid: src.lodCount.MID, far: src.lodCount.FAR, dormant: src.lodCount.DORMANT };
    for (const k of windows.keys()) {
      let w = aiWins.get(k);
      if (!w) aiWins.set(k, (w = { ms: 0, ticks: 0, max: 0, decisions: 0, decideMs: 0, moveMs: 0, socialMs: 0 }));
      w.ms += ms; w.ticks++; w.max = Math.max(w.max, ms); w.decisions += c.decisions; w.decideMs += c.decideMs; w.moveMs += c.moveMs; w.socialMs += c.socialMs;
    }
  },
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
    const cpu = process.cpuUsage(w.cpu);
    const elu = performance.eventLoopUtilization(w.elu);
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
      patchAvgMs: w.patches ? +(w.patchMs / w.patches).toFixed(3) : 0,
      patchMaxMs: +w.maxPatch.toFixed(3),
      aoiAvgMs: w.aois ? +(w.aoiMs / w.aois).toFixed(3) : 0,
      aoiMaxMs: +w.maxAoi.toFixed(3),
      crowdAvgMs: w.crowds ? +(w.crowdMs / w.crowds).toFixed(3) : 0,
      combatAvgMs: w.combats ? +(w.combatMs / w.combats).toFixed(4) : 0,
      combatMaxMs: +w.maxCombat.toFixed(3),
      hitValAvgMs: w.hits ? +(w.hitMs / w.hits).toFixed(4) : 0,
      hitValMaxMs: +w.maxHit.toFixed(3),
      hitValsPerSec: Math.round(w.hits / dt),
      cbtReqPerSec: Math.round(w.cbtReq / dt), cbtOkPerSec: Math.round(w.cbtOk / dt),
      /** CPU do processo (user+system) em % de UM núcleo, e utilização do event loop (0–1) */
      cpuPct: +(((cpu.user + cpu.system) / 1000 / (dt * 1000)) * 100).toFixed(1),
      elu: +elu.utilization.toFixed(3),
      heapMB: +(mem.heapUsed / 1e6).toFixed(1),
      rssPeakMB: +(Math.max(w.maxRss, mem.rss) / 1e6).toFixed(1),
      rssMB: +(mem.rss / 1e6).toFixed(1),
      corrections, denials, knocks, impacts,
    };
    // rodada 12 — autônomos (NUNCA contam em `players`): custo de IA por tick e por parte, decisões/s, ativos por LOD
    {
      const a = aiWins.get(key) ?? { ms: 0, ticks: 0, max: 0, decisions: 0, decideMs: 0, moveMs: 0, socialMs: 0 };
      Object.assign(snapshot, {
        aiMs: a.ticks ? +(a.ms / a.ticks).toFixed(4) : 0, aiMaxMs: +a.max.toFixed(3),
        aiDecideMs: a.ticks ? +(a.decideMs / a.ticks).toFixed(4) : 0, aiMoveMs: a.ticks ? +(a.moveMs / a.ticks).toFixed(4) : 0, aiSocialMs: a.ticks ? +(a.socialMs / a.ticks).toFixed(4) : 0,
        aiDecisionsPerSec: Math.round(a.decisions / dt),
        autonomousPopulation: aiGauge.population, autonomousActive: aiGauge.near + aiGauge.mid + aiGauge.far,
        autonomousNear: aiGauge.near, autonomousMid: aiGauge.mid, autonomousFar: aiGauge.far, autonomousDormant: aiGauge.dormant,
      });
      aiWins.set(key, { ms: 0, ticks: 0, max: 0, decisions: 0, decideMs: 0, moveMs: 0, socialMs: 0 });
    }
    Object.assign(w, { t: now, bytesOut, bytesIn, msgsOut, msgsIn, tickMs: 0, ticks: 0, maxTick: 0, patchMs: 0, patches: 0, maxPatch: 0, aoiMs: 0, aois: 0, maxAoi: 0, crowdMs: 0, crowds: 0, combatMs: 0, combats: 0, maxCombat: 0, hitMs: 0, hits: 0, maxHit: 0, cbtReq: 0, cbtOk: 0, cpu: process.cpuUsage(), elu: performance.eventLoopUtilization(), maxRss: 0 });
    return snapshot;
  },
  get last() { return snapshot; },
};
