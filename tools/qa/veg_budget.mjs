/**
 * Orçamento da vegetação nas poses da passada de fidelidade: triângulos por LOD (antes do culling) e contagem.
 * uso: BASE=http://localhost:5182 node tools/qa/veg_budget.mjs [quality=high]
 */
import puppeteer from 'puppeteer-core';

const quality = process.argv[2] ?? 'high';
const base = process.env.BASE ?? 'http://localhost:5173';
const SHOTS = {
  B: "__pv.teleport(-540, 255, 2.0); __pv.camera(2.0 + Math.PI, 0.12, 5.5)",
  C: "__pv.setShot('central')",
  D: "__pv.setShot('avenue')",
  F: "__pv.setShot('candelaria')",
  G: "__pv.setShot('mid')",
};
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const t0 = Date.now();
await page.goto(`${base}/?autostart=1&welcome=0&quality=${quality}&time=10:30`);
await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
console.log('load', Date.now() - t0, 'ms');
for (const [k, js] of Object.entries(SHOTS)) {
  await page.evaluate(`window.__pv.hud(false); ${js.replaceAll('__pv', 'window.__pv')}`);
  await new Promise((r) => setTimeout(r, 3000));
  console.log(k, JSON.stringify(await page.evaluate(() => window.__pvVeg?.budget())));
}
await browser.close();
