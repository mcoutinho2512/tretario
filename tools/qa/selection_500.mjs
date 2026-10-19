/**
 * Rodada 11 — custo da seleção 3D (hover/clique do InteractionSystem) com 500 entidades: 500 bots (server/tools/bots.ts,
 * cenário dense: elipse de ~60 × 20 m no eixo) num servidor de TESTE (porta PV_SEL_PORT ou 3712) e o cliente no meio
 * deles, mouse passeando pelo canvas. Mede por quadro: ms do hover (projeção dos candidatos + escolha), ms da coleta,
 * candidatos (média/máx), projeções por quadro; e o custo de um clique (`pick`). Grava docs/screenshots/round11/selection_500.json.
 * uso: node tools/qa/selection_500.mjs [baseUrl]   (Vite: npx vite --port 5201 --strictPort)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5201';
const PORT = Number(process.env.PV_SEL_PORT ?? 3712);
const N = Number(process.env.PV_SEL_BOTS ?? 500);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 225 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
let bots = null, browser = null;
const killAll = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } try { if (bots) process.kill(-bots.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', killAll);
const M = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = M.pvAxis[11], b = M.pvAxis[12];
const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
try {
  bots = spawn('npx', ['tsx', 'tools/bots.ts', String(N), '240', `ws://127.0.0.1:${PORT}`, 'dense'], { cwd: 'server', stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 720 } });
  const p = await browser.newPage();
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=Medidor&spawn=${cx.toFixed(1)},${cz.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
  await p.evaluate((x, z) => { window.__pvProg?.tp(x, z); window.__pv.teleport(x, z, 0); }, cx, cz);
  // espera a multidão: remotos detalhados (corpo) perto + multidão distante
  let st = null;
  for (let i = 0; i < 90; i++) {
    st = await p.evaluate(() => ({ remotes: window.__pv.metrics().net?.remotes ?? 0, far: window.__pv.metrics().crowd?.farNet ?? 0 }));
    if (st.remotes + st.far >= N * 0.9) break;
    await w(1000);
  }
  console.log('multidão no cliente:', st);
  await p.evaluate(() => window.__pv.camera(0.3, 0.32, 7));
  await w(2000);
  await p.evaluate(() => { window.__pv.ixPerfReset(); window.__pv.takeFrames(); });
  for (let i = 0; i < 80; i++) { await p.mouse.move(200 + (i % 10) * 90, 250 + Math.floor(i / 10) * 45); await w(120); }
  const perf = (await p.evaluate(() => window.__pv.ix())).perf;
  const persons = await p.evaluate(() => window.__pv.ix().cands.filter((c) => c.type === 'person').length);
  const click = await p.evaluate(() => {
    const t0 = performance.now(); let hits = 0;
    for (let i = 0; i < 5000; i++) if (window.__pv.ixPick(200 + (i % 25) * 36, 200 + (Math.floor(i / 25) % 10) * 36)) hits++;
    return { ms: (performance.now() - t0) / 5000, hits };
  });
  const fr = await p.evaluate(() => window.__pv.takeFrames());
  const fps = fr.length ? +(1000 / (fr.reduce((s, x) => s + x, 0) / fr.length)).toFixed(1) : null;
  const out = { bots: N, ...st, personCandsNow: persons, ...perf, pickMsPerClick: +click.ms.toFixed(4), pickHits: click.hits, fps, when: new Date().toISOString() };
  writeFileSync('docs/screenshots/round11/selection_500.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  try { await browser?.close(); } catch { /* */ }
  killAll();
  process.exit(process.exitCode ?? 0);
}
