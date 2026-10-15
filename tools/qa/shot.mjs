/** Screenshot único com script de pose: node tools/qa/shot.mjs out.png quality time "<js>" */
import puppeteer from 'puppeteer-core';
const [out, quality = 'high', time = '16:30', js = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:5173/?autostart=1&quality=${quality}&time=${time}`);
await page.waitForFunction('window.__pvReady === true', { timeout: 120000 });
if (js) await page.evaluate(js);
await new Promise((r) => setTimeout(r, 3000));
console.log(JSON.stringify(await page.evaluate(() => window.__pv.metrics())));
await page.screenshot({ path: out });
await browser.close();
