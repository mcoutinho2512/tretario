/**
 * Movimento de um jogador REMOTO visto por outro cliente (rodada 9.1): o cliente A anda em linha reta, faz uma curva
 * de 90° e para; o cliente B (câmera fixa) amostra a raiz do avatar remoto a cada quadro e mede a suavidade:
 *  - jitter de velocidade: desvio-padrão da velocidade quadro a quadro no trecho reto (m/s) e variação relativa
 *  - maior salto de rumo visível por quadro (rad)
 * e grava 12 quadros numa folha de contato.
 * uso: node tools/qa/remote_motion.mjs <baseUrl> <ws://servidor> <saída.jpg>
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [BASE = 'http://localhost:3161', MP = 'ws://127.0.0.1:3150', OUT = 'docs/screenshots/round9_1/remoto.jpg'] = process.argv.slice(2);
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const launch = (vw, vh) => puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: vw, height: vh } });
const X = -540, Z = 255, H = 2.0;
const url = (name, x, z) => `${BASE}/?autostart=1&welcome=0&quality=high&time=10:30&mem=1&name=${name}&mp=${MP}&spawn=${x.toFixed(1)},${z.toFixed(1)}`;
const brA = await launch(480, 360), brB = await launch(520, 600);
const A = await brA.newPage(), B = await brB.newPage();
const side = H + Math.PI / 2;
const cam = { x: X + Math.sin(H) * 3 + Math.sin(side) * 7, y: 1.7, z: Z + Math.cos(H) * 3 + Math.cos(side) * 7 };
// posições pelo `spawn` (o servidor é autoritativo: teletransporte local seria corrigido)
await Promise.all([A.goto(url('Andarilho', X, Z)), B.goto(url('Observador', cam.x + 3, cam.z + 3))]);
await Promise.all([A, B].map((p) => p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 })));
// A no ponto de partida; B a 6 m de lado olhando o trajeto
await A.evaluate(() => window.__pv.peds(0));
await B.evaluate(() => { window.__pv.peds(0); window.__pv.hud(false); });
await w(9000);
await B.evaluate((c, x, z, h) => window.__pv.lookFrom(c.x, c.y, c.z, x + Math.sin(h) * 3, 1.0, z + Math.cos(h) * 3), cam, X, Z, H);
await w(1500);
// B registra a raiz do avatar remoto (o que estiver perto do trajeto) a cada quadro
await B.evaluate((x, z) => { window.__trkRef = { x, z }; }, X, Z);
await B.evaluate(() => {
  window.__trk = [];
  const loop = () => {
    let best = null;
    const me = window.__pv.metrics().player;
    window.__pvScene.traverse((o) => {
      if (o.name !== 'avatar' || !o.visible) return;
      const p = o.position;
      if (Math.hypot(p.x - me.x, p.z - me.z) < 0.6) return; // o próprio avatar do observador
      const d = Math.hypot(p.x - window.__trkRef.x, p.z - window.__trkRef.z);
      if (d < 60 && (!best || d < best.d)) best = { d, x: p.x, z: p.z, y: o.rotation.y };
    });
    if (best) window.__trk.push([performance.now(), best.x, best.z, best.y]);
    if (window.__trk.length < 900) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
// A: anda 3 s em linha reta (medição SEM capturas de tela — elas travam quadros), curva 90° por 2 s, para
await A.evaluate((x, z, h) => window.__pv.walkTo(x + Math.sin(h) * 40, z + Math.cos(h) * 40, false), X, Z, H);
await w(2600);
const tmp = `${OUT}.frames`;
mkdirSync(tmp, { recursive: true });
const files = [];
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  if (i === 3) await A.evaluate((h) => { const m = window.__pv.metrics().player; window.__pv.walkTo(m.x + Math.sin(h + Math.PI / 2) * 30, m.z + Math.cos(h + Math.PI / 2) * 30, false); }, H);
  if (i === 8) await A.evaluate(() => window.__pv.stopWalk());
  const f = `${tmp}/r${String(i).padStart(2, '0')}_${((Date.now() - t0) / 1000).toFixed(2)}s.jpg`;
  await B.screenshot({ path: f, type: 'jpeg', quality: 82 });
  files.push(f);
  await w(260);
}
await w(1500);
const trk = await B.evaluate(() => window.__trk);
await brA.close(); await brB.close();
execFileSync('python3', ['tools/qa/contact_sheet.py', OUT, '6', '300', ...files]);
rmSync(tmp, { recursive: true });
// métricas: trecho reto = primeiros ~2,2 s com velocidade > 1 m/s
const v = [];
for (let i = 1; i < trk.length; i++) {
  const dt = (trk[i][0] - trk[i - 1][0]) / 1000;
  if (dt <= 0) continue;
  v.push({ t: trk[i][0] - trk[0][0], s: Math.hypot(trk[i][1] - trk[i - 1][1], trk[i][2] - trk[i - 1][2]) / dt, dh: Math.abs(Math.atan2(Math.sin(trk[i][3] - trk[i - 1][3]), Math.cos(trk[i][3] - trk[i - 1][3]))) });
}
const moving = v.filter((x) => x.t > 700 && x.t < 2500);
const mean = moving.reduce((s, x) => s + x.s, 0) / Math.max(1, moving.length);
const sd = Math.sqrt(moving.reduce((s, x) => s + (x.s - mean) ** 2, 0) / Math.max(1, moving.length));
const res = { samples: trk.length, straight: moving.length, meanSpeed: +mean.toFixed(3), speedSd: +sd.toFixed(3), speedCv: +(sd / Math.max(1e-3, mean)).toFixed(3), maxHeadingStep: +Math.max(...v.map((x) => x.dh)).toFixed(3), framesWithZeroMove: moving.filter((x) => x.s < 0.05).length };
writeFileSync(`${OUT}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
