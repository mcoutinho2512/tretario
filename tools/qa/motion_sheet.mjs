/**
 * Folha de contato de MOVIMENTO da multidão (rodada 9.1): câmera fixa a alguns metros da concentração de um carro de
 * som, N quadros espaçados — para comparar sincronia (todos respirando/andando juntos), giros e transições.
 * uso: node tools/qa/motion_sheet.mjs <baseUrl> <saída.jpg> [quadros=8] [intervaloMs=450] [quality=high]
 * Também grava <saída>.json com, por quadro, os humanos a < 12 m da câmera (esqueleto/instanciado, LOD, rumo).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

const [BASE = 'http://localhost:3161', OUT = 'screenshots/motion.jpg', N = '8', GAP = '450', Q = 'high'] = process.argv.slice(2);
const tmp = `${OUT}.frames`;
mkdirSync(tmp, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 960, height: 540 } });
const page = await br.newPage();
await page.goto(`${BASE}/?autostart=1&welcome=0&quality=${Q}&time=10:30&mem=1`);
await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
await w(1500);
const findPt = () => page.evaluate(() => window.__pv.rallyCrowd().rally.find((p) => p.kind === 'soundcar' && p.strength > 0));
let pt = await findPt();
// jogador junto da concentração (a multidão e os pedestres vivem ao redor dele), depois câmera fixa olhando o anel
await page.evaluate((x, z) => window.__pv.teleport(x + 7, z + 1, 0), pt.x, pt.z);
await w(10000);
// centro de quem está desenhado perto do jogador (esqueletos e instanciados), não o do veículo
const ctr = await page.evaluate(() => {
  const pl = window.__pv.metrics().player, pts = [];
  window.__pvScene.traverse((o) => {
    if (/^human_/.test(o.name) && o.parent?.name !== 'avatar') { let v = true; for (let p = o; p; p = p.parent) v &&= p.visible; if (v) pts.push([o.position.x, o.position.z]); }
    if (o.isInstancedMesh && /^crowd_(homem|mulher|idos)/.test(o.name)) { const a = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) pts.push([a[i * 16 + 12], a[i * 16 + 14]]); }
  });
  const near = pts.filter(([x, z]) => Math.hypot(x - pl.x, z - pl.z) < 12);
  const n = Math.max(1, near.length);
  return { x: near.reduce((s, p) => s + p[0], 0) / n, z: near.reduce((s, p) => s + p[1], 0) / n, n: near.length };
});
pt = { ...pt, ...ctr };
const cam = { x: pt.x + 6, y: 1.8, z: pt.z + 3.5 };
await page.evaluate((c, t) => { window.__pv.hud(false); window.__pv.lookFrom(c.x, c.y, c.z, t.x, 1.0, t.z); }, cam, pt);
await w(4000);
const files = [], log = [];
for (let i = 0; i < Number(N); i++) {
  const f = `${tmp}/t${String(i).padStart(2, '0')}_${(i * Number(GAP) / 1000).toFixed(1)}s.jpg`;
  await page.screenshot({ path: f, type: 'jpeg', quality: 85 });
  files.push(f);
  log.push(await page.evaluate((c) => {
    const out = [];
    window.__pvScene.traverse((o) => {
      if (!/^human_/.test(o.name)) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      const d = Math.hypot(o.position.x - c.x, o.position.z - c.z);
      const h = o.userData.pvHuman;
      if (d < 12) out.push({ d: +d.toFixed(1), heading: +o.rotation.y.toFixed(2), lod: h?.shownLod });
    });
    return out;
  }, cam));
  await w(Number(GAP));
}
await br.close();
execFileSync('python3', ['tools/qa/contact_sheet.py', OUT, '4', '480', ...files]);
writeFileSync(`${OUT}.json`, JSON.stringify({ base: BASE, point: pt, cam, frames: log }, null, 1));
rmSync(tmp, { recursive: true });
console.log('ok', OUT, log.map((f) => f.length).join(','));
