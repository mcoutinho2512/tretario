/**
 * Teste de carga progressivo: sobe UM servidor dedicado (porta 2620 ou PV_LOADTEST_PORT, PV_TEST=1) e roda
 * cenários de 50 → 100 → 250 → 500 bots, DENSOS (todos numa elipse de ~60 m — a manifestação) e ESPALHADOS
 * (ao longo dos 2 km da avenida). Os bots são divididos em vários processos (≤ BOTS_PER_PROC cada) para que o
 * gerador de carga não seja o gargalo.
 *
 * Mede, numa janela de `segundos` depois que todos entraram:
 *   servidor  tick de simulação (média/máx), patches (média/máx), AOI (média/máx), CPU do processo (% de 1 núcleo),
 *             utilização do event loop, heap/RSS (pico), bytes/s e mensagens/s totais
 *   clientes  bytes/s e mensagens/s por cliente, jogadores visíveis (detalhados + multidão distante), correções
 *
 * uso: npx tsx tools/loadtest.ts [segundos=20] [cenários=50d,100d,250d,500d,50s,100s,250s,500s]
 *      (d = denso, s = espalhado; p.ex. "100d,500d")
 * saída: docs/screenshots/loadtest.json (+ tabela no terminal)
 * Variáveis repassadas ao servidor: PV_AOI, PV_AOI_MAX, PV_CROWD_HZ, etc.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SECS = Number(process.argv[2] ?? 20);
const LIST = (process.argv[3] ?? '50d,100d,250d,500d,50s,100s,250s,500s').split(',').map((s) => ({ n: parseInt(s, 10), dense: s.endsWith('d') }));
const PORT = Number(process.env.PV_LOADTEST_PORT ?? 2620);
const BOTS_PER_PROC = Number(process.env.BOTS_PER_PROC ?? 100);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const srv = spawn('npx', ['tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), PV_METRICS: '0', PV_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let ready = false;
srv.stdout!.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) ready = true; });
srv.stderr!.on('data', (d) => process.stderr.write(`[srv] ${d}`));
const killAll = (procs: ChildProcess[] = []) => {
  for (const p of procs) { try { process.kill(-(p.pid as number), 'SIGTERM'); } catch { /* */ } }
  try { process.kill(-(srv.pid as number), 'SIGTERM'); } catch { /* */ }
};
let live: ChildProcess[] = [];
process.on('exit', () => killAll(live));
process.on('SIGINT', () => { killAll(live); process.exit(130); });
for (let i = 0; i < 150 && !ready; i++) await w(200);
if (!ready) { console.error('servidor não subiu'); killAll(); process.exit(1); }
const metrics = async () => (await (await fetch(`http://127.0.0.1:${PORT + 1}/metrics`)).json()) as Record<string, number>;

const rows: Record<string, unknown>[] = [];
for (const sc of LIST) {
  const nProcs = Math.ceil(sc.n / BOTS_PER_PROC);
  const procs: ChildProcess[] = [];
  const outs: string[] = [];
  const readyP: Promise<void>[] = [];
  const doneP: Promise<void>[] = [];
  const tJoin = Date.now();
  for (let k = 0; k < nProcs; k++) {
    const n = Math.min(BOTS_PER_PROC, sc.n - k * BOTS_PER_PROC);
    const p = spawn('npx', ['tsx', 'tools/bots.ts', String(n), String(SECS), `ws://127.0.0.1:${PORT}`, sc.dense ? 'dense' : 'spread', `--offset=${k * BOTS_PER_PROC}`, `--total=${sc.n}`, '--wait-go', '--hold', ...(process.env.BOTS_SOCIAL ? [`--social=${process.env.BOTS_SOCIAL}`] : [])], { stdio: ['pipe', 'pipe', 'inherit'], detached: true });
    procs.push(p);
    outs.push('');
    const rl = createInterface({ input: p.stdout! });
    readyP.push(new Promise((res) => rl.on('line', (l) => { if (l.trim() === 'READY') res(); })));
    doneP.push(new Promise((res) => rl.on('line', (l) => { if (l.startsWith('{')) { outs[k] = l; res(); } })));
  }
  live = procs;
  await Promise.all(readyP);
  const joinS = (Date.now() - tJoin) / 1000;
  await w(3000); // estabiliza (AOI, primeiros patches completos)
  await metrics(); // zera a janela do servidor
  for (const p of procs) p.stdin!.write('go\n');
  // amostras intermediárias (pico de memória/CPU fica na janela do servidor)
  await Promise.all(doneP);
  const s = await metrics();
  for (const p of procs) p.stdin!.write('bye\n');
  await Promise.all(procs.map((p) => new Promise((res) => { p.on('exit', res); setTimeout(res, 15000); })));
  live = [];
  const bots = outs.filter(Boolean).map((o) => JSON.parse(o));
  const nb = bots.reduce((a, b) => a + b.bots, 0) || 1;
  const wavg = (f: (b: any) => number) => bots.reduce((a, b) => a + f(b) * b.bots, 0) / nb;
  const row = {
    bots: nb, cenario: sc.dense ? 'denso' : 'espalhado', entrada_s: +joinS.toFixed(1),
    srv_tick_ms: s.tickAvgMs, srv_tick_max_ms: s.tickMaxMs, srv_aoi_ms: s.aoiAvgMs, srv_aoi_max_ms: s.aoiMaxMs, srv_crowd_ms: s.crowdAvgMs,
    srv_patch_ms: s.patchAvgMs, srv_patch_max_ms: s.patchMaxMs,
    srv_cpu_pct: s.cpuPct, srv_elu: s.elu, srv_heap_MB: s.heapMB, srv_rss_pico_MB: s.rssPeakMB,
    srv_out_KBps: +(s.bytesOutPerSec / 1024).toFixed(1), srv_in_KBps: +(s.bytesInPerSec / 1024).toFixed(1),
    srv_msgs_out_s: s.msgsOutPerSec, srv_msgs_in_s: s.msgsInPerSec,
    cli_in_KBps: +(wavg((b) => b.perClient.bytesInPerSec) / 1024).toFixed(2), cli_out_KBps: +(wavg((b) => b.perClient.bytesOutPerSec) / 1024).toFixed(2),
    cli_msgs_in_s: +wavg((b) => b.perClient.msgsInPerSec).toFixed(1),
    visiveis_medio: +wavg((b) => b.visiblePlayers.avg).toFixed(1), detalhados_medio: +wavg((b) => b.visiblePlayers.detailedAvg).toFixed(1),
    visiveis_max: Math.max(...bots.map((b) => b.visiblePlayers.max)),
    correcoes: bots.reduce((a, b) => a + b.corrections, 0),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  await w(3000);
}
mkdirSync('../docs/screenshots', { recursive: true });
const tag = process.env.PV_LOADTEST_TAG ? `_${process.env.PV_LOADTEST_TAG}` : '';
writeFileSync(`../docs/screenshots/loadtest${tag}.json`, JSON.stringify(rows, null, 2));
console.table(rows.map((r) => ({ bots: r.bots, cen: r.cenario, tick: r.srv_tick_ms, tickMax: r.srv_tick_max_ms, patch: r.srv_patch_ms, patchMax: r.srv_patch_max_ms, cpu: r.srv_cpu_pct, elu: r.srv_elu, rss: r.srv_rss_pico_MB, outKBps: r.srv_out_KBps, cliKBps: r.cli_in_KBps, vis: r.visiveis_medio, det: r.detalhados_medio })));
killAll();
process.exit(0);
