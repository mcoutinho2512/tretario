/** Corrida (Shift+W): grava quadros via CDP screencast para inspeção visual. uso: node tools/qa/run_frames.mjs <pasta> [segundos=12] */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2] ?? 'screenshots/tmp/run_frames';
const secs = Number(process.argv[3] ?? 12);
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 640, height: 400 } });
const p = await b.newPage();
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?autostart=1&quality=high&time=10:30`);
await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
await p.evaluate(() => { window.__pv.hud(false); window.__pv.teleport(-540, 255, 2.0); });
await new Promise((r) => setTimeout(r, 5000));
const cdp = await p.createCDPSession();
let n = 0; const t0 = Date.now(); const meta = [];
cdp.on('Page.screencastFrame', async (f) => {
  const name = `f_${String(n++).padStart(4, '0')}.jpg`;
  writeFileSync(`${OUT}/${name}`, Buffer.from(f.data, 'base64'));
  meta.push({ name, t: Date.now() - t0 });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await p.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', shiftKey: true })); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
await new Promise((r) => setTimeout(r, secs * 1000));
await cdp.send('Page.stopScreencast');
writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta));
console.log('quadros', n);
await b.close();
