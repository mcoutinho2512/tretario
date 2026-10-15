import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'], defaultViewport: { width: 1200, height: 700 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:5173/?autostart=1&quality=high&time=16:30');
await page.waitForFunction('window.__pvReady === true', { timeout: 120000 });
const r = await page.evaluate(process.argv[2]);
console.log(JSON.stringify(r, null, 1));
await browser.close();
