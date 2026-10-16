/**
 * Captura + medição da página de itens: node tools/qa/props_shot.mjs out.png "<query>" [w] [h]
 * (BASE=http://localhost:5182 para outro servidor). Imprime draw calls/triângulos/memória dos itens.
 */
import puppeteer from 'puppeteer-core';
const [out, query = '', w = '1280', h = '720'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: +w, height: +h } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 300)); });
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/dev/props.html?${query}`);
await p.waitForFunction('window.__humanReady', { timeout: 90000 });
await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 3000)));
const m = await p.evaluate(() => window.__props.measure());
await p.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', quality: out.endsWith('.jpg') ? 85 : undefined });
console.log(JSON.stringify({ errs: errs.filter((e) => !e.includes('404')), m }));
await b.close();
