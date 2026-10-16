/**
 * Corrida longa (16 s, Shift+W): amostra a postura (cabeça − pelve; negativo = tronco tombado), altura da pelve e
 * pesos dos clipes, com screenshots. uso (com `npm run dev`): node tools/qa/run_probe.mjs <pasta> [corpo=homem]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const OUT = process.argv[2] ?? 'screenshots/tmp/run';
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 900, height: 600 } });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text().slice(0, 200)); });
await p.goto(`http://localhost:5173/?autostart=1&quality=high&time=10:30&avatar=${process.argv[3] ?? 'homem'}`);
await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
await p.evaluate(() => { window.__pv.hud(false); window.__pv.teleport(-540, 255, 2.0); });
await new Promise((r) => setTimeout(r, 6000));
await p.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', shiftKey: true })); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); });
if (process.env.SIDE) await p.evaluate(() => window.__pv.camera(2.0 + 1.57, 0.08, 4.5));
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < 16000) {
  const s = await p.evaluate(() => window.__pv.avatarProbe());
  console.log(((Date.now() - t0) / 1000).toFixed(1), 'spd', s.speed, 'head-pelvis', s.head != null ? (s.head - s.pelvis).toFixed(3) : '?', 'pelvis-g', (s.pelvis - s.ground).toFixed(3), 'lod', s.lod, JSON.stringify(s.w));
  if (i++ % 4 === 0) await p.screenshot({ path: `${OUT}/run_${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 70 });
  await new Promise((r) => setTimeout(r, 500));
}
await b.close();
