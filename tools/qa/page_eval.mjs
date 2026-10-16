/** Avalia uma expressão numa página local (QA): node tools/qa/page_eval.mjs "<caminho?query>" "<readyExpr>" "<expr>" */
import puppeteer from 'puppeteer-core';
const [path, ready, expr] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}${path}`);
await p.waitForFunction(ready, { timeout: 180000 });
await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 1500)));
console.log(await p.evaluate(expr));
await b.close();
