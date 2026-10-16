/**
 * Matriz de navegadores (build de produção, servidor estilo produção, preset AUTOMÁTICO):
 * Chrome (sistema) · WebKit (motor do Safari, Playwright) · WebKit emulando iPhone · Firefox (Playwright).
 * Coleta: perfil detectado, preset, FPS/frame, draw calls, erros de console/página, captura.
 * ATENÇÃO: roda tudo NESTE Mac (GPU M5 Pro). Emulação de iPhone testa UA/toque/tela/detecção, não o hardware.
 * uso: npm run build && node tools/qa/browsers.mjs  → screenshots/browsers/*.jpg + browsers.json
 */
import { chromium, webkit, firefox, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = 4182, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['tools/qa/static_server.mjs', String(PORT)], { stdio: 'ignore', detached: true });
process.on('exit', () => { try { process.kill(-srv.pid); } catch { /* */ } });
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
mkdirSync('screenshots/browsers', { recursive: true });

const RUNS = [
  { name: 'Chrome (macOS)', type: chromium, launch: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal'] }, ctx: { viewport: { width: 1280, height: 720 } } },
  { name: 'WebKit / Safari (macOS)', type: webkit, launch: {}, ctx: { viewport: { width: 1280, height: 720 } } },
  { name: 'WebKit / Safari — iPhone 15 (emulado)', type: webkit, launch: {}, ctx: { ...devices['iPhone 15'] } },
  { name: 'Firefox (macOS)', type: firefox, launch: { firefoxUserPrefs: { 'webgl.force-enabled': true } }, ctx: { viewport: { width: 1280, height: 720 } } },
];
const out = [];
for (const run of RUNS) {
  const r = { browser: run.name, ok: false, errors: [] };
  let browser;
  try {
    browser = await run.type.launch({ headless: true, ...run.launch });
    const ctx = await browser.newContext(run.ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.errors.push(`pageerror: ${e.message}`.slice(0, 240)));
    page.on('console', (m) => { if (m.type() === 'error') r.errors.push(m.text().slice(0, 240)); });
    const t0 = Date.now();
    await page.goto(`${BASE}/?autostart=1&quality=auto&time=10:30`);
    await page.waitForFunction('window.__pvReady === true', null, { timeout: 240000 });
    r.loadS = +((Date.now() - t0) / 1000).toFixed(1);
    await page.waitForTimeout(6000);
    const s = [];
    for (let i = 0; i < 8; i++) { s.push(await page.evaluate(() => window.__pv.metrics())); await page.waitForTimeout(500); }
    const avg = (k) => +(s.reduce((a, x) => a + (x[k] ?? 0), 0) / s.length).toFixed(1);
    const last = s.at(-1);
    Object.assign(r, {
      ok: true, device: last.device, quality: last.quality, targetFps: last.targetFps, governor: last.governor,
      fps: avg('fps'), frameMs: avg('frameMs'), cpuMs: avg('cpuMs'), gpuMs: last.gpuMs, calls: Math.round(avg('calls')), trianglesK: Math.round(avg('triangles') / 1000),
      heapMB: last.heapMB, ua: await page.evaluate(() => navigator.userAgent),
      gl: await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return g ? String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'sem webgl2'; }),
    });
    await page.screenshot({ path: `screenshots/browsers/${run.name.replace(/[^a-z0-9]+/gi, '_')}.jpg`, quality: 80, type: 'jpeg' });
  } catch (e) {
    r.errors.push(String(e).slice(0, 300));
  }
  await browser?.close();
  console.log(JSON.stringify(r));
  out.push(r);
}
writeFileSync('screenshots/browsers/browsers.json', JSON.stringify(out, null, 2));
process.exit(0);
