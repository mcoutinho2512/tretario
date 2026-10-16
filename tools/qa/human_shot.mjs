/** Captura da página de teste do personagem: node tools/qa/human_shot.mjs out.png "<query>" [w] [h] */
import puppeteer from 'puppeteer-core';
const [out, query = '', w = '900', h = '900'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: +w, height: +h } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}${process.env.PAGE ?? '/dev/human.html'}?${query}`);
await p.waitForFunction('window.__humanReady', { timeout: 60000 });
await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 1500)));
const info = await p.evaluate(() => ({ h: window.__human.info(), gait: globalThis.__pvGait }));
await p.screenshot({ path: out });
console.log(JSON.stringify({ errs, info }));
await b.close();
