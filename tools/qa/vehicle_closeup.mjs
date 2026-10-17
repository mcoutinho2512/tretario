/**
 * Close-ups dos veículos (Rodada 5): carro dirigível estacionado (3/4 frente e traseira); moto, bicicleta e patinete estacionados
 * (rodada 7: avenida fechada, sem trânsito NPC).
 * uso (com o dev server): BASE=http://localhost:5173 node tools/qa/vehicle_closeup.mjs <pasta> [quality=high] [hora=10:30]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots/veh_closeup';
const quality = process.argv[3] ?? 'high';
const time = process.argv[4] ?? '10:30';
const base = process.env.BASE ?? 'http://localhost:5173';
const tag = process.env.TAG ?? '';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`${base}/?autostart=1&welcome=0&quality=${quality}&time=${time}`);
await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
await page.evaluate(() => window.__pv.hud(false));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** posiciona o jogador além do alvo e a câmera olhando para ele (alvo entre câmera e jogador) */
async function look(x, z, viewYaw, dist, pitch = 0.18) {
  await page.evaluate((x, z, yaw, dist, pitch) => {
    // jogador 4 m além do alvo, na direção da visada
    window.__pv.teleport(x + Math.sin(yaw) * 4, z + Math.cos(yaw) * 4, yaw);
    window.__pv.camera(yaw, pitch, dist);
  }, x, z, viewYaw, dist, pitch);
}

// carro dirigível estacionado (estático)
const cars = await page.evaluate(() => window.__pv.vehicles());
if (cars.length) {
  const c = cars[0];
  const h = c.heading;
  for (const [name, off] of [['parked_front34', Math.PI + 0.75], ['parked_rear34', -0.75], ['parked_side', Math.PI / 2]]) {
    await look(c.x, c.z, h + off, 9.5, 0.16);
    await wait(2500);
    await page.screenshot({ path: `${OUT}/${tag}${name}.jpg`, type: 'jpeg', quality: 88 });
    console.log(name);
  }
}

// avenida fechada (rodada 7): sem trânsito NPC — close-ups da moto, bicicleta e patinete estacionados
const all = await page.evaluate(() => window.__pv.vehicles('all'));
for (const kind of ['moto', 'bicycle', 'scooter']) {
  const v = all.find((o) => o.kind === kind);
  if (!v) continue;
  await look(v.x, v.z, v.heading + Math.PI + 0.9, kind === 'moto' ? 5 : 4, 0.2);
  await wait(2500);
  await page.screenshot({ path: `${OUT}/${tag}parked_${kind}.jpg`, type: 'jpeg', quality: 88 });
  console.log('parked', kind, v.id);
}
console.log(JSON.stringify(await page.evaluate(() => window.__pv.metrics())));
await browser.close();
