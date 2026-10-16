/**
 * Rodada 7 — fotos e custo dos veículos/cenário de evento (carro de som, trio elétrico, caminhões de campanha,
 * telões, palco). Sem servidor (offline). Mede draw calls/triângulos de cada objeto PERTO e LONGE (LOD) pela
 * diferença com o objeto escondido no mesmo quadro de câmera.
 * uso: node tools/qa/event_vehicles_shots.mjs [baseUrl] [pasta]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const dir = process.argv[3] ?? 'screenshots/round7/vehicles';
mkdirSync(dir, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const veh = (id) => manifest.vehicleSpawns.find((v) => v.id === id);
const spot = (id) => manifest.eventSpots.find((v) => v.id === id);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`${base}/?autostart=1&quality=high&time=${process.env.TIME ?? '16:40'}`);
await page.waitForFunction('window.__pvReady === true', { timeout: 120000 });
await page.evaluate(() => window.__pv.hud(false));

/** câmera no referencial do objeto: lateral `l`, frente `f`, altura `y`; olha para o ponto local (tl, ty, tf) */
async function view(o, l, f, y, tl = 0, ty = 2, tf = 0) {
  const c = Math.cos(o.heading), s = Math.sin(o.heading);
  const P = (a, b) => [o.x + a * c + b * s, o.z - a * s + b * c];
  const [px, pz] = P(l, f), [tx, tz] = P(tl, tf);
  await page.evaluate((px, pz, tx, tz) => window.__pv.teleport(px, pz), px, pz, tx, tz);
  await page.evaluate((px, y, pz, tx, ty, tz) => window.__pv.lookFrom(px, y, pz, tx, ty, tz), px, y, pz, tx, ty, tz);
}
const metrics = () => page.evaluate(() => { const m = window.__pv.metrics(); return { calls: m.calls, tris: m.triangles }; });
/** custo do objeto = métricas com ele − sem ele (mesmo quadro de câmera) */
async function cost(name) {
  await w(900);
  const a = await metrics();
  await page.evaluate((n) => window.__pv.showObject(n, false), name);
  await w(600);
  const b = await metrics();
  await page.evaluate((n) => window.__pv.showObject(n, true), name);
  await w(300);
  return { calls: a.calls - b.calls, tris: a.tris - b.tris };
}
const report = {};
async function shot(file, settle = 2500) { await w(settle); await page.screenshot({ path: `${dir}/${file}`, type: file.endsWith('.jpg') ? 'jpeg' : 'png', quality: file.endsWith('.jpg') ? 88 : undefined }); console.log('📷', file); }

// D — carro de som
const som = veh('som0');
await view(som, 6.5, 6.0, 2.6, 0, 1.8, -0.5);
await shot('D_carro_de_som.jpg', 4000);
report.soundcar_near = await cost('rideable_som0');
await view(som, 30, 50, 8, 0, 1.5, 0);
report.soundcar_mid = await cost('rideable_som0');
await view(som, 60, 160, 20, 0, 1.5, 0);
report.soundcar_far = await cost('rideable_som0');

// E — trio elétrico (estacionado no centro do corredor)
const trio = veh('trio0');
await view(trio, 13, 9, 5.5, 0, 4.0, -1.0);
await shot('E_trio_eletrico.jpg', 4000);
await view(trio, -4, -19, 4.5, 0, 4.5, -2);
await shot('E2_trio_traseira_escada.jpg');
report.trio_near = await cost('rideable_trio0');
await view(trio, 40, 60, 12, 0, 3, 0);
report.trio_mid = await cost('rideable_trio0');
await view(trio, 80, 220, 30, 0, 3, 0);
report.trio_far = await cost('rideable_trio0');

// F — jogadores sobre o trio: offline, o jogador local sobe pela escada (mesmo fluxo da tecla E)
{
  const c = Math.cos(trio.heading), s = Math.sin(trio.heading);
  const foot = [trio.x + 0 * c + -7.2 * s, trio.z - 0 * s + -7.2 * c];
  await page.evaluate(() => window.__pv.lookFrom());
  await page.evaluate((x, z) => window.__pv.teleport(x, z), foot[0], foot[1]);
  await w(500);
  await page.evaluate(() => window.__pv.key('KeyE'));
  await w(800);
  report.boarded = await page.evaluate(() => window.__pv.platform());
  await page.evaluate(() => window.__pv.press('KeyW', 1600));
  await w(2200);
  report.onDeck = await page.evaluate(() => ({ p: window.__pv.platform(), probe: window.__pv.avatarProbe() }));
  await view(trio, 9, -11, 6.5, 0, 4.2, -2);
  await shot('F_jogador_sobre_o_trio.jpg', 3000);
}

// G — caminhões de campanha (13 e 22 = campanhas cadastradas nos DADOS, sem geometria nova) + telão + palco
const t0 = spot('truck0'), t1 = spot('truck1');
report.scenery = await page.evaluate(() => window.__pv.eventScenery());
await view(t0, -9, -9, 3.2, 0, 2.2, 6);
await shot('G_caminhoes_campanha.jpg', 3500);
report.truck_near = await cost('event_truck0');
await view(t1, -9, 3, 3.0, 0, 2.2, 0);
await shot('G2_caminhao_lateral.jpg');
// troca de arte em tempo de execução (só textura)
await page.evaluate(() => { window.__pv.setSceneryDesign('truck0', 'ato_pv'); window.__pv.setSceneryDesign('truck1', 'neutro_liso'); });
await view(t0, -9, -9, 3.2, 0, 2.2, 6);
await shot('G3_caminhoes_arte_neutra.jpg');
await page.evaluate(() => window.__pv.event('cotidiano'));
await view(t0, 50, 70, 12, 0, 2, 0);
report.truck_mid = await cost('event_truck0');
await view(t0, 80, 220, 30, 0, 2, 0);
report.truck_far = await cost('event_truck0');

const sc = spot('screen0');
await view(sc, 2, 14, 2.2, 0, 4.6, 0);
await shot('H_telao_avenida.jpg');
report.screen_near = await cost('event_screen0');
const st = spot('stage0');
await view(st, 6, 22, 4.5, 0, 4.5, 0);
await shot('I_palco.jpg', 3500);
report.stage_near = await cost('event_stage0');
await view(st, 60, 200, 25, 0, 4, 0);
report.stage_far = await cost('event_stage0');
report.feed = await page.evaluate(() => window.__pv.screenFeed());

console.log(JSON.stringify(report, null, 1));
writeFileSync(`${dir}/cost.json`, JSON.stringify(report, null, 1));
await browser.close();
