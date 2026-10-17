/**
 * Custo dos personagens NPC na mesma sessão (robusto a carga externa): alterna 0 ↔ N pedestres várias vezes
 * e compara CPU/GPU médios. uso: node tools/qa/char_cost.mjs [quality=high]
 */
import puppeteer from 'puppeteer-core';
const quality = process.argv[2] ?? 'high';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?autostart=1&welcome=0&quality=${quality}&time=10:30`);
await p.waitForFunction('window.__pvReady === true', { timeout: 240000 });
await p.evaluate("window.__pv.hud(false); window.__pv.setShot('mid')");
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = async () => { const s = []; for (let i = 0; i < 10; i++) { s.push(await p.evaluate(() => window.__pv.metrics())); await w(200); } return s; };
const N = (await p.evaluate(() => window.__pv.metrics())).pedestrians.active || 56;
const res = { on: [], off: [] };
await w(4000);
for (let round = 0; round < 3; round++) {
  await p.evaluate((n) => window.__pv.peds(n), N); await w(2500); res.on.push(...await sample());
  await p.evaluate(() => window.__pv.peds(0)); await w(2500); res.off.push(...await sample());
}
const avg = (a, k) => +(a.reduce((s, x) => s + (x[k] ?? 0), 0) / a.length).toFixed(2);
const vis = avg(res.on.map((x) => ({ v: x.pedestrians.visible })), 'v');
console.log(JSON.stringify({ quality, peds: N, visibleAvg: vis, cpuOn: avg(res.on, 'cpuMs'), cpuOff: avg(res.off, 'cpuMs'), gpuOn: avg(res.on, 'gpuMs'), gpuOff: avg(res.off, 'gpuMs'), callsOn: avg(res.on, 'calls'), callsOff: avg(res.off, 'calls'), trisOn: avg(res.on, 'triangles'), trisOff: avg(res.off, 'triangles') }));
await b.close();
