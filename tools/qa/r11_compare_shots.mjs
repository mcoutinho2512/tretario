/** Rodada 11 — capturas comparativas da avenida por preset (câmera livre a 9 m, HUD oculto, sem vsync).
 * uso: QS="medium&dynres=0,high&dynres=0,ultra&dynres=0" [DPR=1] node tools/qa/r11_compare_shots.mjs <pasta>  (cliente em http://localhost:5204) */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = m.pvAxis[Number(process.env.A ?? 8)], b = m.pvAxis[Number(process.env.B ?? 13)];
const out = process.argv[2];
const H = Number(process.env.Y ?? 9);
for (const qq of (process.env.QS ?? 'high,ultra').split(',')) {
  const [q, ...ex] = qq.split('&');
  const tag = qq.replace(/[&=]/g, '_');
  const br = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'], defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: Number(process.env.DPR ?? 1) } });
  const p = await br.newPage();
  p.on('pageerror', (e) => console.log('ERRO', e.message));
  await p.goto(`http://localhost:5204/?autostart=1&welcome=0&quality=${q}&time=${process.env.T ?? '16:30'}&mp=off&uncapped=1&name=QA&spawn=${a[0]},${a[1]}${ex.length ? '&' + ex.join('&') : ''}`);
  await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
  await p.evaluate((a, b, H) => { window.__pv.hud(false); window.__pv.lookFrom(a[0], H, a[1], b[0], H * 0.45, b[1]); }, a, b, H);
  await new Promise((r) => setTimeout(r, 14000));
  await p.screenshot({ path: `${out}/cmp_${tag}.png` });
  console.log(qq, JSON.stringify(await p.evaluate(() => { const x = window.__pv.metrics(); return { fps: x.fps, cpu: x.cpuMs, gpu: x.gpuMs, calls: x.calls, tri: x.triangles, scale: x.governor?.scale }; })));
  await br.close();
}
