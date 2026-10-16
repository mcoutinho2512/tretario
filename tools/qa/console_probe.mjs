/** Abre o jogo e imprime erros/avisos do console (shaders, WebGL). uso: node tools/qa/console_probe.mjs "<js>" [espera ms] */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 900, height: 600 } });
const p = await b.newPage();
const seen = new Set();
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn' || m.type() === 'warning') { const t = m.text().slice(0, 1500); if (!seen.has(t)) { seen.add(t); console.log(`[${m.type()}]`, t); } } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?autostart=1&quality=high&time=16:00`);
await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
await p.evaluate(process.argv[2] ?? '');
await new Promise((r) => setTimeout(r, Number(process.argv[3] ?? 15000)));
await b.close();
