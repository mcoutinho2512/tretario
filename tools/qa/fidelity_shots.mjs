/**
 * Capturas comparáveis da passada de fidelidade (rodada 5): mesmas poses, horário fixo, HUD oculto.
 *   A personagem close-up · B personagem na Pres. Vargas · C Central · D avenida
 *   E Palácio Duque de Caxias · F Candelária · G veículos e pedestres
 * uso (com `npm run dev`): node tools/qa/fidelity_shots.mjs <pasta-saida> [quality=high] [hora=10:30]
 * Grava <pasta>/<A..G>.jpg e <pasta>/metrics.json (métricas por captura).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots/fidelity';
const quality = process.argv[3] ?? 'high';
const time = process.argv[4] ?? '10:30';
const base = process.env.BASE ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const SHOTS = {
  A: "__pv.teleport(-560, 262, 2.2); __pv.portrait(1.5)",
  B: "__pv.teleport(-540, 255, 2.0); __pv.camera(2.0 + Math.PI, 0.12, 5.5)",
  C: "__pv.setShot('central')",
  D: "__pv.setShot('avenue')",
  E: "__pv.teleport(-430, 230, 3.14); __pv.camera(3.14, 0.16, 60)",
  F: "__pv.setShot('candelaria')",
  G: "__pv.setShot('mid')",
};
const only = (process.env.ONLY ?? Object.keys(SHOTS).join('')).split('');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.now();
await page.goto(`${base}/?autostart=1&welcome=0&quality=${quality}&time=${time}`);
await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
const loadMs = Date.now() - t0;
const metrics = { quality, time, loadMs, shots: {} };
for (const k of only) {
  await page.evaluate(`window.__pv.hud(false); ${SHOTS[k].replaceAll('__pv', 'window.__pv')}`);
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 4500)));
  const samples = [];
  for (let i = 0; i < 6; i++) { samples.push(await page.evaluate(() => window.__pv.metrics())); await new Promise((r) => setTimeout(r, 250)); }
  const avg = (f) => +(samples.reduce((s, x) => s + (x[f] ?? 0), 0) / samples.length).toFixed(2);
  metrics.shots[k] = { cpuMs: avg('cpuMs'), gpuMs: avg('gpuMs'), calls: Math.round(avg('calls')), triangles: Math.round(avg('triangles')), heapMB: samples.at(-1).heapMB, textures: samples.at(-1).textures, geometries: samples.at(-1).geometries };
  await page.screenshot({ path: `${OUT}/${k}.jpg`, type: 'jpeg', quality: 86 });
  console.log(k, JSON.stringify(metrics.shots[k]));
}
metrics.errors = errors;
writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2));
console.log('load', loadMs, 'ms', errors.length ? `ERROS: ${errors.join(' | ')}` : '');
await browser.close();
