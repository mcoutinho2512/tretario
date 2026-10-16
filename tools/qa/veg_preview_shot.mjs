/** Captura da prévia da vegetação. uso: BASE=http://localhost:5182 node tools/qa/veg_preview_shot.mjs <saida.jpg> "lod=0&dist=75" */
import puppeteer from 'puppeteer-core';

const [out = 'screenshots/tmp/veg.jpg', qs = ''] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:5173';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 700 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERRO', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log(m.type(), m.text()); });
await page.goto(`${base}/tools/qa/veg_preview.html?${qs}`);
await page.waitForFunction('window.__vegReady', { timeout: 60000 });
console.log(JSON.stringify(await page.evaluate(() => window.__vegReady)));
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
await browser.close();
