/**
 * Capturas do HUD da rodada 8 (N–U) + custo medido do HUD/minimapa/rótulos.
 *
 * Sobe um servidor de TESTE próprio (PV_TEST=1, PV_STORE=memory, porta HUD_PORT=2750 → API 2751) e bots numa
 * concentração densa com vida social; abre o cliente (já rodando, p.ex. `PV_API=http://127.0.0.1:2751 npx vite
 * --port 5195 --strictPort`) no desktop (1600×900) e no celular (390×844, toque).
 *
 * uso: node tools/qa/hud_shots.mjs [baseUrl=http://localhost:5195] [bots=150]
 * saída: screenshots/round8/{N..U}_*.jpg (+ cópias em docs/screenshots/round8/) e docs/screenshots/round8/hud_metrics.json
 */
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const BOTS = Number(process.argv[3] ?? 150);
const PORT = Number(process.env.HUD_PORT ?? 2750);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'screenshots/round8', DOCS = 'docs/screenshots/round8';
mkdirSync(OUT, { recursive: true });
mkdirSync(DOCS, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));

const procs = new Set();
const start = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { cwd: 'server', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  procs.add(p);
  p.on('exit', () => procs.delete(p));
  return p;
};
const cleanup = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* já saiu */ } } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const server = start('npx', ['tsx', 'src/index.ts'], { PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_METRICS: '0' });
let up = false;
server.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 150 && !up; i++) await w(200);
if (!up) { console.error('servidor não subiu'); process.exit(1); }
for (let k = 0; k * 100 < BOTS; k++) {
  const n = Math.min(100, BOTS - k * 100);
  start('npx', ['tsx', 'tools/bots.ts', String(n), '3600', `ws://127.0.0.1:${PORT}`, 'dense', `--offset=${k * 100}`, `--total=${BOTS}`, '--social=0.5']);
}
await w(6000);

// concentração dos bots (server/tools/bots.ts: meio do trecho axis[11]→axis[12])
const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = m.pvAxis[11], b = m.pvAxis[12];
const C = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 };
const along = Math.atan2(b[0] - a[0], b[1] - a[1]);
const central = m.landmarks.find((l) => l.key === 'LANDMARK_CENTRAL').center;
const cand = m.landmarks.find((l) => l.key === 'LANDMARK_CANDELARIA').center;

const metrics = {};
const shot = async (page, name) => {
  const f = `${OUT}/${name}.jpg`;
  await page.screenshot({ path: f, type: 'jpeg', quality: 82 });
  copyFileSync(f, `${DOCS}/${name}.jpg`);
  console.log('ok', name);
};
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  // ---------------------------------------------------------------- desktop, sem rede (zonas/minimapa)
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 900 });
    p.on('pageerror', (e) => console.log('ERRO', e.message));
    await p.goto(`${BASE}/?autostart=1&welcome=0&quality=medium&time=16:30`);
    await p.waitForFunction('window.__pvReady === true', { timeout: 120000 });
    await w(3000);
    // O — Central no minimapa (perto da estação, olhando para a torre)
    const sp = m.spawn.p;
    await p.evaluate((x, z, cx, cz) => { const v = window.__pv; const yaw = Math.atan2(cx - x, cz - z); v.teleport(x, z, yaw); v.camera(yaw, -0.05, 7); v.hudSet({ poke: true }); }, sp[0], sp[1], central[0], central[1]);
    await w(2500);
    await p.evaluate(() => window.__pv.hudSet({ poke: true }));
    await w(300);
    await shot(p, 'O_central_minimapa');
    // P — Campo de Santana: entra na zona e captura o aviso
    await p.evaluate(() => { window.__pv.teleport(-390, 215, 1.95); window.__pv.camera(1.95, 0.12, 7); });
    await w(2600);
    await shot(p, 'P_campo_de_santana_zona');
    metrics.zoneAfterP = (await p.evaluate(() => window.__pv.hudInfo())).zone;
    // Q — Candelária
    // ponto do eixo em t = 0,925 (já na zona da Candelária), olhando para a igreja
    await p.evaluate((cx, cz) => { const v = window.__pv; const x = 676.6, z = -178.0; const yaw = Math.atan2(cx - x, cz - z); v.teleport(x, z, yaw); v.camera(yaw, -0.12, 8); }, cand[0], cand[1]);
    await w(2600);
    await shot(p, 'Q_candelaria');
    metrics.zoneAfterQ = (await p.evaluate(() => window.__pv.hudInfo())).zone;
    await p.close();
  }
  // ---------------------------------------------------------------- desktop, com rede + bots (nomes, densidade)
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 900 });
    p.on('pageerror', (e) => console.log('ERRO', e.message));
    await p.goto(`${BASE}/?autostart=1&welcome=0&quality=medium&time=16:30&mp=ws://127.0.0.1:${PORT}&name=Repórter&spawn=${(C.x - 14 * Math.sin(along)).toFixed(1)},${(C.z - 14 * Math.cos(along)).toFixed(1)}`);
    await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 180000 });
    await p.evaluate((yaw) => { window.__pv.camera(yaw, 0.16, 6); window.__pv.hudSet({ poke: true }); }, along);
    await w(8000);
    await p.evaluate(() => window.__pv.hudSet({ poke: true }));
    await w(400);
    // R — manifestação com nomes próximos
    await shot(p, 'R_manifestacao_nomes');
    metrics.labels = (await p.evaluate(() => window.__pv.hudInfo())).labels;
    // S — HUD completo (sem esmaecer)
    await p.evaluate(() => window.__pv.hudSet({ poke: true, menu: true }));
    await w(500);
    await shot(p, 'S_hud_completo');
    await p.evaluate(() => window.__pv.hudSet({ menu: false, settings: true }));
    await w(400);
    await shot(p, 'S2_ajustes');
    await p.evaluate(() => window.__pv.hudSet({ settings: false }));
    // N — minimapa expandido (densidade da multidão)
    await p.evaluate(() => window.__pv.hudSet({ map: true }));
    await w(1500);
    await shot(p, 'N_minimapa');
    await p.evaluate(() => window.__pv.hudSet({ map: false }));
    // T — HUD esmaecido (andando) e HUD limpo (H)
    await p.evaluate(() => window.__pv.press('KeyW', 4000));
    await w(3800);
    await shot(p, 'T1_hud_recolhido_andando');
    await p.evaluate(() => window.__pv.hudSet({ clean: true }));
    await w(600);
    await shot(p, 'T_hud_limpo');
    await p.evaluate(() => window.__pv.hudSet({ clean: false, poke: true }));
    // custo: amostra 10 s
    await w(1000);
    const t0 = await p.evaluate(() => ({ ...window.__pv.hudInfo(), m: window.__pv.metrics() }));
    await w(10000);
    const t1 = await p.evaluate(() => ({ ...window.__pv.hudInfo(), m: window.__pv.metrics() }));
    metrics.desktop = {
      minimapDrawMs: t1.minimap.drawMs, densityMs: t1.minimap.densityMs, drawsPerSec: +((t1.minimap.draws - t0.minimap.draws) / 10).toFixed(1),
      densitySamplesPerSec: +((t1.minimap.samples - t0.minimap.samples) / 10).toFixed(2), densityTotal: t1.minimap.densityTotal, densityPeak: t1.minimap.densityPeak,
      labelDecisionsPerSec: +((t1.labels.decisions - t0.labels.decisions) / 10).toFixed(1), labelDecideMs: t1.labels.decideMs, labelsShown: t1.labels.shown, labelCandidates: t1.labels.candidates,
      labelTransformsPerSec: +((t1.labels.transforms - t0.labels.transforms) / 10).toFixed(1),
      textWrites: { before: t0.writes, after: t1.writes }, fps: t1.m.fps, cpuMs: t1.m.cpuMs, remotes: t1.m.net?.remotes, far: t1.m.crowd?.farNet,
    };
    await p.close();
  }
  // ---------------------------------------------------------------- celular (390×844, toque)
  {
    const p = await browser.newPage();
    await p.emulate(KnownDevices['iPhone 14']);
    p.on('pageerror', (e) => console.log('ERRO', e.message));
    await p.goto(`${BASE}/?autostart=1&welcome=0&quality=low&time=16:30&mp=ws://127.0.0.1:${PORT}&name=Celular&spawn=${(C.x - 16 * Math.sin(along)).toFixed(1)},${(C.z - 16 * Math.cos(along)).toFixed(1)}`);
    await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 180000 });
    await p.evaluate((yaw) => { window.__pv.camera(yaw, 0.18, 6); window.__pv.hudSet({ poke: true }); }, along);
    await w(7000);
    await p.evaluate(() => window.__pv.hudSet({ poke: true }));
    await w(400);
    await shot(p, 'U_mobile_hud');
    await p.evaluate(() => window.__pv.hudSet({ menu: true }));
    await w(400);
    await shot(p, 'U2_mobile_menu');
    await p.evaluate(() => window.__pv.hudSet({ menu: false, map: true }));
    await w(1200);
    await shot(p, 'U3_mobile_mapa');
    metrics.mobile = await p.evaluate(() => ({ hud: window.__pv.hudInfo(), touchButtons: [...document.querySelectorAll('.touch-btn')].filter((b) => !b.hidden).map((b) => b.textContent) }));
    await p.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${DOCS}/hud_metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
  cleanup();
}
process.exit(0);
