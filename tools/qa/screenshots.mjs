/**
 * Screenshots de validação (Chrome local via puppeteer-core).
 * Uso: node tools/qa/screenshots.mjs [baseUrl] [quality] [time]
 * Gera screenshots/<shot>.png e imprime métricas de cada ponto.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const quality = process.argv[3] ?? 'high';
const time = process.argv[4] ?? '16:30';
const shots = (process.env.SHOTS ?? 'central,avenue,mid,candelaria').split(',');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync('screenshots', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: process.env.HEADFUL ? false : 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`${base}/?autostart=1&welcome=0&quality=${quality}&time=${time}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
const loadMs = Date.now() - t0;
const results = { quality, time, loadMs, shots: {} };
for (const s of shots) {
  await page.evaluate((n) => { window.__pv.setShot(n); window.__pv.hud(s_hud()); function s_hud(){ return true; } }, s);
  await new Promise((r) => setTimeout(r, 4500));
  const m = await page.evaluate(() => window.__pv.metrics());
  await page.screenshot({ path: `screenshots/${s}${process.env.SUFFIX ?? ''}.png` });
  results.shots[s] = m;
  console.log(s, JSON.stringify(m));
}
writeFileSync(`screenshots/metrics_${quality}${process.env.SUFFIX ?? ''}.json`, JSON.stringify(results, null, 2));
console.log('load ms', loadMs);
console.log(logs.filter((l) => !/DevTools|Download the React/.test(l)).slice(0, 30).join('\n'));
await browser.close();
