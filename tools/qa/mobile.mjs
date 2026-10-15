/** Teste de fumaça mobile: emula iPhone 14 (toque, 390×844, DPR 3) e captura a tela. */
import puppeteer, { KnownDevices } from 'puppeteer-core';
const base = process.argv[2] ?? 'http://localhost:4173';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.emulate(KnownDevices['iPhone 14']);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base, { waitUntil: 'networkidle0' });
await page.screenshot({ path: 'screenshots/mobile_start.png' });
await page.waitForSelector('#explore:not([disabled])');
await page.tap('#explore');
await page.waitForFunction('window.__pvReady === true', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 4000));
// simula arrasto no joystick (metade esquerda)
const s = await page.touchscreen;
await s.touchStart(80, 650); await s.touchMove(80, 590); await new Promise((r) => setTimeout(r, 1500)); await s.touchEnd();
await new Promise((r) => setTimeout(r, 1000));
const m = await page.evaluate(() => window.__pv.metrics());
console.log(JSON.stringify(m));
await page.screenshot({ path: 'screenshots/mobile_game.png' });
console.log('errors:', errors);
await browser.close();
