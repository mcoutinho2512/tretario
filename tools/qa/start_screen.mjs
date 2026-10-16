/** Captura da tela inicial (QA visual): node tools/qa/start_screen.mjs out.png <largura> <altura> <mobile 0|1> [js] */
import puppeteer from 'puppeteer-core';
const [out, w, h, mobile, js = ''] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: +w, height: +h, deviceScaleFactor: mobile === '1' ? 3 : 1, isMobile: mobile === '1', hasTouch: mobile === '1' });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 200)); });
await p.goto('http://localhost:5173/');
await p.waitForFunction('window.__pvStart', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
if (js) { await p.evaluate(js); await new Promise((r) => setTimeout(r, 1200)); }
await p.screenshot({ path: out });
console.log(JSON.stringify({ errs, hscroll: await p.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.getElementById('start').scrollWidth > innerWidth) }));
await b.close();
