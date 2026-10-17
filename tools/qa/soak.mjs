/**
 * SOAK TEST (rodada 8): N minutos (padrão 60) de uso contínuo num Chrome real, medindo o heap PÓS-GC e a GPU (livro-razão)
 * periodicamente, para separar AQUECIMENTO DE CACHE (cresce e estabiliza) de VAZAMENTO (cresce ~linear).
 *
 * Sobe um servidor de TESTE próprio (PV_TEST=1, porta PV_SOAK_PORT ou 2690) com bots sociais (multidão da rede, ações,
 * bandeiras, cartazes) e entra como jogador. Ciclo de ~20 s por passo, alternando:
 *   zonas (Central → Campo de Santana → Centro → Rio Branco → Candelária) · perto/longe da multidão e do trio ·
 *   ações (dança, palmas, bandeira, cartaz) · pegar/largar itens · bicicleta (entra/anda/sai) · trio (sobe/desce) ·
 *   editor de pichação (abre/fecha) · chat (se existir: __pv.chat) · espectador (se existir: segunda página)
 * Amostra a cada AMOSTRA_S (120 s): CDP HeapProfiler.collectGarbage ×2 → Runtime.getHeapUsage; GPU pelo livro-razão
 * (?mem=1). Saída: screenshots/soak/<tag>.json + resumo (inclinação total, primeiros 20 min, últimos 30 min).
 *
 * uso (com o dev server): node tools/qa/soak.mjs [minutos=60] [tag=soak] [bots=60]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const MIN = Number(process.argv[2] ?? 60);
const TAG = process.argv[3] ?? 'soak';
const BOTS = Number(process.argv[4] ?? 60);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_SOAK_PORT ?? 2690);
const SAMPLE_S = Number(process.env.SOAK_SAMPLE_S ?? 120);
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
if (BOTS > 0) start('npx', ['tsx', 'tools/bots.ts', String(BOTS), String(MIN * 60 + 600), `ws://127.0.0.1:${PORT}`, 'spread', '--social=0.6']);
await w(4000);

const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const zones = JSON.parse(readFileSync('public/world/zones.json', 'utf8')).zones;
const axis = m.pvAxis;
const trio = m.vehicleSpawns.find((v) => v.kind === 'trio');

const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info'], defaultViewport: { width: 1280, height: 720 } });
const page = await b.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/?autostart=1&quality=high&time=12:00&mem=1&mp=ws://127.0.0.1:${PORT}&name=Soak&spawn=${trio.x - 30},${trio.z}`);
await page.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
const cdp = await page.createCDPSession();
// espectador simultâneo no MESMO mundo (rodada 8) — só a página do jogador é medida
let spec = null;
if (process.env.SOAK_SPECTATOR !== '0') {
  const b2 = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 800, height: 500 } });
  spec = await b2.newPage();
  await spec.goto(`${BASE}/?autostart=1&spectate=1&quality=low&time=12:00&mp=ws://127.0.0.1:${PORT}`).catch(() => {});
  await spec.waitForFunction('window.__pvReady === true', { timeout: 240000 }).catch(() => { spec = null; });
  process.on('exit', () => { void b2.close(); });
}

const heap = async () => {
  for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage'); await w(300); }
  const u = await cdp.send('Runtime.getHeapUsage');
  const gpu = await page.evaluate(() => window.__pv.memoryReport(false)?.ledger?.totalMB ?? null).catch(() => null);
  const mt = await page.evaluate(() => { const x = window.__pv.metrics(); return { fps: Math.round(x.fps), calls: x.calls, humans: x.crowd?.submitted ?? 0 }; });
  return { usedMB: +(u.usedSize / 1048576).toFixed(2), gpuMB: gpu, ...mt };
};

// ponto ao longo do eixo (fração t, deslocamento lateral)
const along = (t, side = 0) => {
  let total = 0; const seg = [];
  for (let i = 0; i < axis.length - 1; i++) { const l = Math.hypot(axis[i + 1][0] - axis[i][0], axis[i + 1][1] - axis[i][1]); seg.push(l); total += l; }
  let want = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const u = Math.min(1, want / seg[i]), dx = (axis[i + 1][0] - axis[i][0]) / seg[i], dz = (axis[i + 1][1] - axis[i][1]) / seg[i];
      return [axis[i][0] + (axis[i + 1][0] - axis[i][0]) * u - dz * side, axis[i][1] + (axis[i + 1][1] - axis[i][1]) * u + dx * side, Math.atan2(dx, dz)];
    }
    want -= seg[i];
  }
  return [axis[0][0], axis[0][1], 0];
};
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch((e) => ({ err: e.message }));

const steps = [
  // zonas e multidão
  ...zones.map((z) => async () => { const [x, zz, h] = along(z.anchor?.t ?? (z.from + z.to) / 2, 10); await ev((x, z, h) => window.__pv.teleport(x, z, h), x, zz, h); }),
  async () => { await ev((x, z) => window.__pv.teleport(x, z, 0), trio.x - 15, trio.z); await ev(() => window.__pv.act('dance_party')); },
  async () => { await ev(() => window.__pv.prop('flag_large', 'brasil')); await w(500); await ev(() => window.__pv.act('flag_wave')); await ev(() => window.__pv.press('KeyW', 4000)); },
  async () => { await ev(() => window.__pv.prop('sign_small', 'democracia')); await w(500); await ev(() => window.__pv.act('sign_raise')); },
  async () => { await ev(() => window.__pv.prop(null)); await ev(() => window.__pv.act('clap')); },
  // bicicleta: vai até a mais próxima, entra, anda, sai
  async () => {
    const v = await ev(() => { const p = window.__pv.metrics().player; return window.__pv.vehicles('all').filter((i) => i.kind === 'bicycle' && !i.occupant).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; });
    if (v && !v.err) {
      await ev((x, z) => window.__pv.teleport(x + 1.2, z, 0), v.x, v.z); await w(1500);
      await ev((id) => window.__pv.rawEnter(id), v.id); await w(1500);
      await ev(() => window.__pv.press('KeyW', 3000)); await w(3500);
      await ev(() => window.__pv.key('KeyE')); await w(1500);
    }
  },
  // trio: pé da escada, sobe, desce
  async () => {
    const ladder = await ev(() => window.__pv.vehicles('trio')[0]);
    if (ladder && !ladder.err) {
      await ev((x, z, h) => window.__pv.teleport(x - Math.sin(h) * 7.6, z - Math.cos(h) * 7.6, h), ladder.x, ladder.z, ladder.heading); await w(1500);
      await ev(() => window.__pv.key('KeyE')); await w(3000); await ev(() => window.__pv.act('arms_up')); await w(3000);
      await ev(() => window.__pv.key('KeyE')); await w(2000);
    }
  },
  // pichação: abre o editor numa superfície e fecha
  async () => {
    const s = await ev(() => { const p = window.__pv.metrics().player; return window.__pv.gf?.surfacesNear(p.x, p.z, 120)?.[0]; });
    if (s && !s.err) { await ev((f) => window.__pv.teleport(f[0], f[1], 0), s.front); await w(1500); await ev(() => window.__pv.gf.open()); await w(2500); await ev(() => window.__pv.gf.close()); }
  },
  // chat (rodada 8, se existir)
  async () => { await ev((t) => { const c = window.__pv.chat?.(); c?.type?.(t, 'geral'); }, `passando pela avenida ${Date.now() % 1000}`); },
  // espectador simultâneo (outra página): troca de câmera 1–6
  async () => { if (spec) await spec.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${k}`, key: String(k) })), 1 + (k % 6)).catch(() => {}); },
  // longe de tudo (descarrega multidão/LOD) e volta
  async () => { const [x, z, h] = along(0.05, 0); await ev((x, z, h) => window.__pv.teleport(x, z, h), x, z, h); },
];

const t0 = Date.now();
const samples = [{ t: 0, ...(await heap()) }];
console.log(`[soak] início: heap ${samples[0].usedMB} MB, GPU ${samples[0].gpuMB} MB`);
let k = 0, nextSample = SAMPLE_S * 1000;
while (Date.now() - t0 < MIN * 60_000) {
  await steps[k++ % steps.length]();
  await w(6000);
  if (Date.now() - t0 >= nextSample) {
    const s = { t: Math.round((Date.now() - t0) / 1000), ...(await heap()) };
    samples.push(s);
    nextSample += SAMPLE_S * 1000;
    console.log(`[soak] ${(s.t / 60).toFixed(1)} min: heap ${s.usedMB} MB · GPU ${s.gpuMB} MB · ${s.fps} FPS · ${s.humans} humanos`);
  }
}
// inclinação por mínimos quadrados (MB/min) num intervalo de minutos
const slope = (from, to) => {
  const pts = samples.filter((s) => s.t / 60 >= from && s.t / 60 <= to);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.t / 60), ys = pts.map((p) => p.usedMB);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return +(num / den).toFixed(3);
};
const gpuVals = samples.map((s) => s.gpuMB).filter((x) => x !== null);
const summary = {
  minutes: MIN, bots: BOTS, samples: samples.length, errors: errors.slice(0, 10),
  heap: { first: samples[0].usedMB, last: samples.at(-1).usedMB, min: Math.min(...samples.map((s) => s.usedMB)), max: Math.max(...samples.map((s) => s.usedMB)) },
  slopeMBperMin: { total: slope(0, MIN), first20: slope(0, 20), last30: slope(Math.max(0, MIN - 30), MIN) },
  gpu: { first: gpuVals[0] ?? null, last: gpuVals.at(-1) ?? null, max: gpuVals.length ? Math.max(...gpuVals) : null },
};
summary.verdict = summary.slopeMBperMin.last30 !== null && Math.abs(summary.slopeMBperMin.last30) < 0.1 ? 'ESTABILIZOU (aquecimento de cache)' : 'CONTINUA CRESCENDO — investigar';
writeFileSync(`screenshots/soak/${TAG}.json`, JSON.stringify({ summary, samples }, null, 1));
console.log(JSON.stringify(summary, null, 1));
await b.close();
cleanup();
process.exit(0);
