/**
 * Evidências da rodada 7 (vida da manifestação), no jogo (preset ALTO, evento padrão "Ato na Presidente Vargas"):
 * A multidão geral · B bandeiras/cartazes · C dança/gestos · W visão ampla (multidão + bandeiras + cartazes + trio).
 * D–J vêm dos scripts de cada sistema (docs/screenshots/round7/); K da bancada de 500 bots (crowd_bench).
 * uso (com o dev server): node tools/qa/round7_shots.mjs [pasta=docs/screenshots/round7]
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const OUT = process.argv[2] ?? 'docs/screenshots/round7';
const BASE = process.env.BASE ?? 'http://localhost:5173';
const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const trio = m.vehicleSpawns.find((v) => v.kind === 'trio');
const H = trio.heading, fx = Math.sin(H), fz = Math.cos(H), sx = Math.cos(H), sz = -Math.sin(H);
const at = (along, side) => [trio.x + fx * along + sx * side, trio.z + fz * along + sz * side];
const shots = [
  // [nome, posição do jogador, rumo, câmera(yaw, pitch, dist), js extra]
  ['A_multidao_geral', at(-30, 4), H, [H, 0.32, 16], ''],
  ['B_bandeiras_cartazes', at(-17, -3), H, [H + 0.25, 0.12, 5], "window.__pv.prop('flag_large','brasil');setTimeout(()=>window.__pv.act('flag_wave'),400)"],
  ['C_danca_gestos', at(-14, 6), H, [H - 0.5, 0.15, 6], "setTimeout(()=>window.__pv.act('dance_party'),400)"],
  ['W_avenida_ampla', at(-70, 10), H, [H + 0.08, 0.42, 34], ''],
];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1600, height: 900 } });
for (const [name, p, h, cam, js] of shots) {
  const page = await b.newPage();
  await page.goto(`${BASE}/?autostart=1&quality=high&time=16:00`);
  await page.waitForFunction('window.__pvReady === true', { timeout: 180000 });
  await page.evaluate((p, h, cam, js) => { window.__pv.hud(false); window.__pv.teleport(p[0], p[1], h); window.__pv.camera(...cam); if (js) eval(js); }, p, h, cam, js);
  await new Promise((r) => setTimeout(r, 30000)); // a concentração se forma e o LOD chega
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 85 });
  const mt = await page.evaluate(() => window.__pv.metrics());
  console.log(name, JSON.stringify({ fps: Math.round(mt.fps), calls: mt.calls, humans: mt.crowd?.submitted, instanced: mt.crowd?.drawnInstanced, props: mt.crowd?.props }));
  await page.close();
}
await b.close();
