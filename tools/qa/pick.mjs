import puppeteer from 'puppeteer-core';
const [quality, js, ...pts] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
await page.goto(`http://localhost:5173/?autostart=1&welcome=0&quality=${quality}&time=16:30`);
await page.waitForFunction('window.__pvReady === true', { timeout: 120000 });
await page.evaluate(js);
await new Promise((r) => setTimeout(r, 2500));
for (const p of pts) { const [x, y] = p.split(',').map(Number); console.log(p, JSON.stringify(await page.evaluate((x, y) => window.__pv.pick(x, y), x, y))); }
await browser.close();
