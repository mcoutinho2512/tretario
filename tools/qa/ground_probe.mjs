/**
 * Contato com o chão, medido no jogo: para cada corpo, parado / andando / correndo, amostra por quadro
 * (requestAnimationFrame na página) a altura do pé mais baixo menos o chão e as oscilações de físico/raiz/pelve.
 * uso (com `npm run dev`): node tools/qa/ground_probe.mjs [corpos=homem,mulher,idoso,idosa]
 */
import puppeteer from 'puppeteer-core';
const bodies = (process.argv[2] ?? 'homem,mulher,idoso,idosa').split(',');
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 800, height: 600 } });
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { min: +s[0].toFixed(3), p50: +s[Math.floor(s.length / 2)].toFixed(3), max: +s.at(-1).toFixed(3), range: +(s.at(-1) - s[0]).toFixed(3) }; };
for (const body of bodies) {
  const p = await b.newPage();
  await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?autostart=1&quality=high&time=10:30&avatar=${body}`);
  await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
  await p.evaluate(() => { window.__pv.hud(false); window.__pv.teleport(-540, 255, 2.0); });
  await new Promise((r) => setTimeout(r, 8000)); // LOD0 chega depois de jogável
  const sample = (ms) => p.evaluate((ms) => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const f = () => { const s = window.__pv.avatarProbe(); if (s && s.ballL !== null) out.push(s); if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(out); };
    requestAnimationFrame(f);
  }), ms);
  const report = {};
  for (const [mode, run] of [['parado', null], ['andando', false], ['correndo', true]]) {
    if (run !== null) {
      await p.evaluate((run) => { window.__pv.teleport(-540, 255, 2.0); window.__pv.walkTo(-540 + Math.sin(2.0) * 60, 255 + Math.cos(2.0) * 60, run); }, run);
      await new Promise((r) => setTimeout(r, 1200));
    }
    const s = await sample(3000);
    if (run !== null) await p.evaluate(() => window.__pv.stopWalk?.());
    const foot = s.map((x) => Math.min(x.ballL, x.ballR, x.footL, x.footR) - x.ground);
    report[mode] = {
      n: s.length, lod: s.at(-1)?.lod, speed: stat(s.map((x) => x.speed)).p50,
      pe_menos_chao: stat(foot), fisico_menos_chao: stat(s.map((x) => x.playerY - x.ground)),
      raiz_osc: stat(s.map((x) => x.root - x.ground)).range, arm: stat(s.map((x) => x.armY)), pelve_osc: stat(s.map((x) => x.pelvis - x.root)).range,
    };
  }
  console.log(body, JSON.stringify(report));
  await p.close();
}
await b.close();
