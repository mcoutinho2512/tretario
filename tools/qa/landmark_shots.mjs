/**
 * Capturas dedicadas dos landmarks (rodada 5): câmera livre (__pv.lookFrom) em poses fixas, HUD oculto.
 * uso (com o dev server): BASE=http://localhost:5183 node tools/qa/landmark_shots.mjs <pasta> [quality=high] [hora=10:30]
 * ONLY=central1,cand2 filtra poses. Grava <pasta>/<pose>.jpg e <pasta>/landmarks_metrics.json.
 * Alturas da câmera/alvo são relativas ao chão no ponto (groundAt).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots/landmarks';
const quality = process.argv[3] ?? 'high';
const time = process.argv[4] ?? '10:30';
const base = process.env.BASE ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

// [jogador x,z] [câmera x,h,z] [alvo x,h,z]
const POSES = {
  central1: [[-605, 30], [-603, 1.7, 22], [-636, 46, 92]], // Praça Cristiano Ottoni (vindo do norte), nível do pedestre
  central2: [[-560, 250], [-520, 9, 300], [-650, 55, 120]], // da Pres. Vargas
  central3: [[-560, 150], [-430, 150, 260], [-650, 30, 100]], // aérea
  central4: [[-600, 100], [-575, 70, 120], [-639, 92, 92]], // relógio de perto
  central6: [[-612, 75], [-614, 1.7, 72], [-622, 5, 78]], // material do revestimento a ~8 m
  cand1: [[820, -200], [845, 6, -225], [745, 26, -186]], // fachada leste (Rua 1º de Março)
  central5: [[-600, 70], [-603, 1.7, 62], [-625, 14, 84]], // close-up da base da torre (materiais)
  cand2: [[650, -150], [650, 26, -150], [735, 30, -182]], // abside, da avenida
  cand4: [[790, -190], [796, 1.7, -196], [776, 9, -189]], // close-up do portal (materiais)
  cand3: [[740, -180], [860, 120, -300], [740, 20, -182]], // aérea
  palacio1: [[-500, 150], [-505, 2, 152], [-462, 42, 95]], // Praça Duque de Caxias (junto ao Panteão)
  palacio2: [[-430, 230], [-300, 120, 300], [-480, 30, 60]], // aérea
  ccbb1: [[820, -205], [818, 3, -212], [878, 17, -165]], // do chafariz da Praça Pio X (como a foto de 2007)
  ccbb2: [[840, -160], [800, 75, -250], [890, 10, -160]], // aérea
};
const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(POSES);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/?autostart=1&quality=${quality}&time=${time}`);
await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
const metrics = { quality, time, shots: {} };
for (const k of only) {
  const [[px, pz], [cx, ch, cz], [tx, th, tz]] = POSES[k];
  await page.evaluate(`(() => { const p = window.__pv; p.hud(false); p.teleport(${px}, ${pz});
    const g = p.groundAt(${cx}, ${cz}), gt = p.groundAt(${tx}, ${tz});
    p.lookFrom(${cx}, g + ${ch}, ${cz}, ${tx}, gt + ${th}, ${tz}); })()`);
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 5000)));
  const samples = [];
  for (let i = 0; i < 6; i++) { samples.push(await page.evaluate(() => window.__pv.metrics())); await new Promise((r) => setTimeout(r, 250)); }
  const avg = (f) => +(samples.reduce((s, x) => s + (x[f] ?? 0), 0) / samples.length).toFixed(2);
  metrics.shots[k] = { cpuMs: avg('cpuMs'), gpuMs: avg('gpuMs'), calls: Math.round(avg('calls')), triangles: Math.round(avg('triangles')) };
  await page.screenshot({ path: `${OUT}/${k}.jpg`, type: 'jpeg', quality: 86 });
  console.log(k, JSON.stringify(metrics.shots[k]));
}
metrics.errors = errors;
writeFileSync(`${OUT}/landmarks_metrics.json`, JSON.stringify(metrics, null, 2));
console.log(errors.length ? `ERROS: ${errors.join(' | ')}` : 'ok');
await browser.close();
