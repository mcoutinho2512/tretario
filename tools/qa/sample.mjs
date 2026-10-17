/** Amostra métricas ao longo do tempo: node tools/qa/sample.mjs quality seconds "<pose js>" */
import puppeteer from 'puppeteer-core';
const [quality = 'high', secs = '60', js = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:5173/?autostart=1&welcome=0&quality=${quality}&time=16:30`);
await page.waitForFunction('window.__pvReady === true', { timeout: 120000 });
if (js) await page.evaluate(js);
const rows = [];
for (let t = 0; t < Number(secs); t += 3) {
  await new Promise((r) => setTimeout(r, 3000));
  const m = await page.evaluate(() => window.__pv.metrics());
  rows.push(m);
  console.log(`t=${t + 3}s fps=${m.fps.toFixed(0)} peds=${m.pedestrians.active} crossing=${m.pedestrians.crossing} waiting=${m.pedestrians.waiting} npcVeh=${m.npcVehicles} playerVeh=${m.playerVehicles}`);
}
const maxCross = Math.max(...rows.map((r) => r.pedestrians.crossing));
console.log('max atravessando:', maxCross);
await browser.close();
