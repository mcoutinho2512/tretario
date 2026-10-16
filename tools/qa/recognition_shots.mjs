/**
 * Capturas dos edifícios de reconhecimento (rodada 6): poses fixas ao longo da Pres. Vargas, nível do
 * pedestre (1,7 m) e aéreas, HUD oculto. Mesmas poses antes/depois (docs/screenshots/r6_recognition/).
 * uso (com o dev server): BASE=http://localhost:5193 node tools/qa/recognition_shots.mjs <pasta> [quality=high] [hora=10:30]
 * ONLY=p1,p2 filtra poses. Grava <pasta>/<pose>.jpg e <pasta>/recognition_metrics.json.
 * Alturas da câmera/alvo são relativas ao chão no ponto (groundAt).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots/recognition';
const quality = process.argv[3] ?? 'high';
const time = process.argv[4] ?? '10:30';
const base = process.env.BASE ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

// [jogador x,z] [câmera x,h,z] [alvo x,h,z]
const POSES = {
  // extremo oeste (Rua de Santana / Cidade Nova): Ed. Paulo de Frontin ("Balança Mas Não Cai")
  p1_santana: [[-1060, 445], [-1060, 1.7, 440], [-930, 34, 468]],
  // da Central para leste (Campo de Santana à direita, Duque de Caxias à esquerda)
  p2_central_leste: [[-560, 262], [-560, 1.7, 262], [-200, 30, 130]],
  // trecho do Campo de Santana olhando para leste (mesmo enquadramento da foto de 2011, Andrevruas)
  p3_campo_santana: [[-330, 195], [-330, 1.7, 195], [300, 40, -20]],
  // meio da avenida (Passos) olhando para a Candelária
  p4_meio: [[60, 60], [60, 1.7, 60], [740, 35, -182]],
  // Uruguaiana: corredor dos prédios do PA com a Candelária ao fundo
  p5_portal_candelaria: [[380, -70], [380, 1.7, -70], [745, 30, -186]],
  // da Candelária olhando para oeste (Central ao fundo)
  p6_oeste: [[690, -170], [690, 1.7, -170], [-660, 60, 105]],
  // fechadas nos edifícios de reconhecimento (enquadramentos parecidos com as fotos de referência)
  c1_banco_central: [[170, 25], [170, 1.7, 25], [520, 45, -120]], // como AvPresVargas1 (2017)
  c2_embratel: [[-150, 72], [-150, 1.7, 72], [-20, 24, 38]],
  c3_kennedy: [[400, -60], [400, 1.7, -60], [365, 40, 5]],
  c4_biblioteca: [[-250, 175], [-250, 1.7, 175], [-205, 8, 215]],
  c5_rio_branco: [[612, -140], [612, 1.7, -140], [380, 40, -40]], // como AvPresVargas2 (2017), olhando para oeste
  c6_paulo_frontin: [[-1120, 470], [-1120, 1.7, 470], [-940, 40, 470]], // do Mangue, como a foto do panoramio
  // aéreas
  a1_meio: [[200, 0], [120, 230, 330], [330, 0, -60]],
  a2_oeste: [[-500, 250], [-700, 220, 650], [-450, 0, 250]],
  a3_candelaria: [[600, -150], [430, 200, 120], [640, 0, -170]],
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
  const [[px0, pz0], [cx, ch, cz], [tx, th, tz]] = POSES[k];
  // o avatar fica 5 m atrás da câmera (fora do quadro) nas poses ao nível do pedestre
  const dl = Math.hypot(tx - cx, tz - cz) || 1;
  const [px, pz] = ch < 10 ? [cx - ((tx - cx) / dl) * 5, cz - ((tz - cz) / dl) * 5] : [px0, pz0];
  await page.evaluate(`(() => { const p = window.__pv; p.hud(false); p.teleport(${px}, ${pz});
    const g = p.groundAt(${cx}, ${cz}), gt = p.groundAt(${tx}, ${tz});
    p.lookFrom(${cx}, g + ${ch}, ${cz}, ${tx}, gt + ${th}, ${tz}); })()`);
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 5000)));
  const samples = [];
  for (let i = 0; i < 6; i++) { samples.push(await page.evaluate(() => window.__pv.metrics())); await new Promise((r) => setTimeout(r, 250)); }
  const avg = (f) => +(samples.reduce((s, x) => s + (x[f] ?? 0), 0) / samples.length).toFixed(2);
  metrics.shots[k] = { cpuMs: avg('cpuMs'), gpuMs: avg('gpuMs'), calls: Math.round(avg('calls')), triangles: Math.round(avg('triangles')) };
  await page.screenshot({ path: `${OUT}/${k}.jpg`, type: 'jpeg', quality: 84 });
  console.log(k, JSON.stringify(metrics.shots[k]));
}
metrics.errors = errors;
writeFileSync(`${OUT}/recognition_metrics.json`, JSON.stringify(metrics, null, 2));
console.log(errors.length ? `ERROS: ${errors.join(' | ')}` : 'ok');
await browser.close();
