/**
 * SOAK DE CÂMERAS (rodada 8.1): N minutos (padrão 20) de um ESPECTADOR trocando de câmera sem parar — livre, Central,
 * Campo de Santana, Candelária, trio/palco, aérea — e subindo/descendo com a roda (passa por NEAR/MID/FAR/AGGREGATE),
 * com bots espalhados pela avenida inteira. Mede a PRÓPRIA página do espectador: heap PÓS-GC (CDP) e GPU (livro-razão,
 * ?mem=1) a cada SOAK_SAMPLE_S (60 s). Mesma análise do soak.mjs (inclinação total / primeiros / últimos minutos).
 *
 * uso (com o dev server): node tools/qa/soak_camera.mjs [minutos=20] [tag=soak_camera] [bots=200]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const MIN = Number(process.argv[2] ?? 20);
const TAG = process.argv[3] ?? 'soak_camera';
const BOTS = Number(process.argv[4] ?? 200);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_SOAK_PORT ?? 2695);
const SAMPLE_S = Number(process.env.SOAK_SAMPLE_S ?? 60);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('screenshots/soak', { recursive: true });

const procs = [];
const start = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { cwd: 'server', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  procs.push(p);
  return p;
};
const cleanup = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const srv = start('npx', ['tsx', 'src/index.ts'], { PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_METRICS: '0' });
const log = [];
srv.stdout.on('data', (d) => log.push(d.toString()));
for (let i = 0; i < 150 && !log.join('').includes('[pv3d-server]'); i++) await w(200);
if (BOTS > 0) start('npx', ['tsx', 'tools/bots.ts', String(BOTS), String(MIN * 60 + 600), `ws://127.0.0.1:${PORT}`, 'spread', '--social=0.6', '--groups']);
await w(5000);

const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info'], defaultViewport: { width: 1280, height: 720 } });
const page = await b.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/?autostart=1&welcome=0&spectate=1&quality=medium&time=12:00&mem=1&mp=ws://127.0.0.1:${PORT}`);
await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
await w(3000);
const cdp = await page.createCDPSession();

const heap = async () => {
  for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage'); await w(300); }
  const u = await cdp.send('Runtime.getHeapUsage');
  const extra = await page.evaluate(() => {
    const x = window.__pv.metrics?.() ?? {};
    const sc = window.__pv.specCells?.() ?? null;
    return { gpuMB: window.__pv.memoryReport?.(false)?.ledger?.totalMB ?? null, fps: Math.round(x.fps ?? 0), calls: x.calls ?? 0, tier: sc?.tier ?? null, cells: sc?.cells ?? null, impostors: sc?.impostors?.drawn ?? null };
  }).catch(() => ({}));
  return { usedMB: +(u.usedSize / 1048576).toFixed(2), ...extra };
};

const key = (k) => page.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${k}`, key: String(k) })), k).catch(() => {});
const wheel = async (dy, n) => { await page.mouse.move(640, 360); for (let i = 0; i < n; i++) { await page.mouse.wheel({ deltaY: dy }); await w(120); } };
// ciclo: cada câmera fixa, aérea, e a livre subindo até o teto e descendo até o chão (troca de camada nos dois sentidos)
const steps = [
  () => key(2), () => key(3), () => key(4), () => key(5), () => key(6),
  async () => { await key(1); await wheel(400, 25); }, async () => { await wheel(-400, 25); },
  () => key(6), async () => { await key(4); await wheel(-300, 10); },
];

const t0 = Date.now();
const samples = [{ t: 0, ...(await heap()) }];
console.log(`[soak-cam] início: heap ${samples[0].usedMB} MB, GPU ${samples[0].gpuMB} MB`);
let k = 0, switches = 0, nextSample = SAMPLE_S * 1000;
while (Date.now() - t0 < MIN * 60_000) {
  await steps[k++ % steps.length]();
  switches++;
  await w(5000);
  if (Date.now() - t0 >= nextSample) {
    const s = { t: Math.round((Date.now() - t0) / 1000), ...(await heap()) };
    samples.push(s);
    nextSample += SAMPLE_S * 1000;
    console.log(`[soak-cam] ${(s.t / 60).toFixed(1)} min: heap ${s.usedMB} MB · GPU ${s.gpuMB} MB · ${s.fps} FPS · camada ${s.tier} · ${switches} trocas`);
  }
}
const slope = (from, to) => {
  const pts = samples.filter((s) => s.t / 60 >= from && s.t / 60 <= to);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.t / 60), ys = pts.map((p) => p.usedMB);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return +(num / den).toFixed(3);
};
const gpuVals = samples.map((s) => s.gpuMB).filter((x) => x !== null && x !== undefined);
const half = Math.max(5, Math.floor(MIN / 2));
const summary = {
  minutes: MIN, bots: BOTS, switches, samples: samples.length, errors: errors.slice(0, 10),
  heap: { first: samples[0].usedMB, last: samples.at(-1).usedMB, min: Math.min(...samples.map((s) => s.usedMB)), max: Math.max(...samples.map((s) => s.usedMB)) },
  // pós-aquecimento (a partir do 5º min): em soaks curtos a "metade final" pega só ruído (±1–2 MB entre amostras)
  slopeMBperMin: { total: slope(0, MIN), firstHalf: slope(0, half), lastHalf: slope(MIN - half, MIN), afterWarmup: slope(5, MIN) },
  gpu: { first: gpuVals[0] ?? null, last: gpuVals.at(-1) ?? null, max: gpuVals.length ? Math.max(...gpuVals) : null },
};
summary.verdict = summary.slopeMBperMin.afterWarmup !== null && Math.abs(summary.slopeMBperMin.afterWarmup) < 0.1 ? 'ESTÁVEL' : 'CONTINUA CRESCENDO — investigar';
writeFileSync(`screenshots/soak/${TAG}.json`, JSON.stringify({ summary, samples }, null, 1));
console.log(JSON.stringify(summary, null, 1));
await b.close();
cleanup();
process.exit(0);
