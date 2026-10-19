/**
 * Rodada 10 — montagem (AGENTE C): sonda OFFLINE do corpo no veículo. Para cada tipo: vai até um veículo, entra (E),
 * fotografa a entrada no meio, montado (lateral e 3/4), andando com curva, e a saída; imprime fase e erros do IK.
 * uso: node tools/qa/vehicle_mount_probe.mjs [baseUrl] [pasta]   (PV_KINDS=car,moto,bicycle,scooter)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5183';
const out = process.argv[3] ?? 'screenshots/tmp/mount';
mkdirSync(out, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1100, height: 700 } });
const p = await browser.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text()); });
const ev = (fn, ...a) => p.evaluate(fn, ...a);
const kinds = (process.env.PV_KINDS ?? 'car,moto,bicycle,scooter').split(',');
const first = manifest.vehicleSpawns.find((s) => s.kind === kinds[0] && (s.kind === 'car' || s.kind === 'moto' || s.id.startsWith('st')));
await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=10:30&spawn=${first.x.toFixed(1)},${(first.z + 4).toFixed(1)}`);
await p.waitForFunction('window.__pvReady === true', { timeout: 120000 });
await ev(() => window.__pv.peds(0));
await w(1500);
/** câmera livre olhando o veículo de um lado (local: +x = esquerda do motorista) */
const look = (v, lx, ly, lz, ty = 0.9) => ev((v, lx, ly, lz, ty) => {
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  window.__pv.lookFrom(v.x + lx * c + lz * s, v.y + ly, v.z - lx * s + lz * c, v.x, v.y + ty, v.z);
}, v, lx, ly, lz, ty);
for (const kind of kinds) {
  const sp = manifest.vehicleSpawns.find((s) => s.kind === kind && (kind === 'car' || kind === 'moto' || s.id.startsWith('st')));
  const c = Math.cos(sp.heading), s = Math.sin(sp.heading);
  const side = kind === 'car' ? 1.9 : 1.1; // lado do motorista (+x local)
  await ev((x, z, h) => window.__pv.teleport(x, z, h), sp.x + side * c - 0.6 * s, sp.z - side * s - 0.6 * c, sp.heading);
  await w(800);
  const v = await ev((id) => window.__pv.vehiclePose(id), sp.id);
  const far = kind === 'car' ? 4.2 : 2.6;
  await look(v, far, 1.3, 0.2);
  await w(300);
  await ev(() => window.__pv.key('KeyE'));
  await w(kind === 'car' ? 500 : 300);
  const vid = (await ev(() => window.__pv.mount().local.vehicle)) ?? sp.id;
  console.log(kind, 'entrando', vid, JSON.stringify(await ev(() => window.__pv.mount().local)));
  await p.screenshot({ path: `${out}/${kind}_1_entrando.jpg`, quality: 80 });
  await w(1200);
  console.log(kind, 'montado', JSON.stringify(await ev(() => window.__pv.mount())));
  await look(v, far, 1.2, 0.0);
  await w(250);
  await p.screenshot({ path: `${out}/${kind}_2_lado.jpg`, quality: 80 });
  await look(v, far * 0.7, 1.5, far * 0.8);
  await w(250);
  await p.screenshot({ path: `${out}/${kind}_3_frente.jpg`, quality: 80 });
  // andando com curva (câmera do jogo)
  await ev(() => window.__pv.lookFrom());
  await ev(() => { window.__pv.press('KeyW', 2600); setTimeout(() => window.__pv.press('KeyA', 1200), 1000); });
  await w(1700);
  console.log(kind, 'curva', JSON.stringify({ dyn: await ev((id) => window.__pv.vehicleDyn(id), vid), m: (await ev(() => window.__pv.mount().local)).solver }));
  await p.screenshot({ path: `${out}/${kind}_4_curva.jpg`, quality: 80 });
  await w(1500);
  await ev(() => window.__pv.press('KeyS', 1500));
  await w(1900);
  const v2 = await ev((id) => window.__pv.vehiclePose(id), vid);
  await look(v2, far, 1.3, 0.3);
  await ev(() => window.__pv.key('KeyE'));
  await w(kind === 'car' ? 380 : 220);
  console.log(kind, 'saindo', JSON.stringify(await ev(() => window.__pv.mount().local)));
  await p.screenshot({ path: `${out}/${kind}_5_saindo.jpg`, quality: 80 });
  await w(1200);
  console.log(kind, 'fora', JSON.stringify(await ev(() => ({ m: window.__pv.mount().local, riding: window.__pv.riding(), pl: window.__pv.metrics().player }))));
  await p.screenshot({ path: `${out}/${kind}_6_fora.jpg`, quality: 80 });
  await ev(() => window.__pv.lookFrom());
}
await browser.close();
