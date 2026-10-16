/**
 * Corrida longa em linha reta (Shift+W): mede POR QUADRO o intervalo entre quadros, o deslocamento do jogador e do
 * avatar visível, e a fase do clipe de corrida — detecta travadas/saltos ("reinicia a corrida e aparece mais à frente").
 * uso (com `npm run dev`): node tools/qa/run_hitch.mjs [segundos=20] [mp=ws://...]
 */
import puppeteer from 'puppeteer-core';
const secs = Number(process.argv[2] ?? 20);
const mp = process.argv[3] ? `&mp=${process.argv[3]}` : '';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADED ? false : 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720), deviceScaleFactor: Number(process.env.DPR ?? 1) } });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
p.on('console', (m) => { if (m.text().startsWith('[tex]')) console.log(m.text()); });
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?autostart=1${process.env.Q ? '&quality=' + process.env.Q : ''}&time=10:30${mp}`);
await p.waitForFunction('window.__pvReady === true' + (mp ? ' && window.__pv.mp()?.session' : ''), { timeout: 180000 });
const [x, z, h] = (process.env.START ?? '-540,255,2.0').split(',').map(Number);
await p.evaluate((x, z, h, js) => { window.__pv.teleport(x, z, h); if (js) eval(js); }, x, z, h, process.env.JS ?? '');
await new Promise((r) => setTimeout(r, 5000));
await p.evaluate(() => {
  window.__loaf = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__loaf.push({ t: Math.round(e.startTime), dur: Math.round(e.duration), block: Math.round(e.blockingDuration ?? 0), render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), scripts: (e.scripts ?? []).map((s) => ({ d: Math.round(s.duration), fn: s.sourceFunctionName, src: (s.sourceURL ?? '').split('/').pop(), pos: s.sourceCharPosition, inv: s.invoker })).filter((s) => s.d > 5) }); }).observe({ type: 'long-animation-frame', buffered: false }); } catch { /* sem LoAF */ }
});
await p.evaluate(() => window.__pv.takeFrames());
const out = await p.evaluate((secs) => new Promise((res) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', shiftKey: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  const rows = []; const t0 = performance.now(); let last = t0;
  const f = (now) => {
    const m = window.__pv.metrics().player; const a = window.__pv.avatarProbe();
    const h = m.heading ?? 0; const fw = a.pelvisXZ ? a.pelvisXZ[0] * Math.sin(h) + a.pelvisXZ[1] * Math.cos(h) : 0;
    rows.push({ t: +(now - t0).toFixed(1), dt: +(now - last).toFixed(1), x: m.x, z: m.z, spd: a.speed, w: a.w, fw: +fw.toFixed(3) });
    last = now;
    if (now - t0 < secs * 1000) requestAnimationFrame(f); else res(rows);
  };
  requestAnimationFrame(f);
}), secs);
const corr = mp ? await p.evaluate(() => window.__pv.mp().correctionReasons) : null;
let worst = [];
for (let i = 1; i < out.length; i++) {
  const r = out[i], q = out[i - 1];
  const d = Math.hypot(r.x - q.x, r.z - q.z);
  if (r.dt > 50 || d > 0.4) worst.push({ t: r.t, dt: r.dt, jump: +d.toFixed(2), spd: r.spd, w: JSON.stringify(r.w) });
}
// pelve à frente do jogador (m): um clipe com deslocamento embutido cresce e volta de repente no loop
let pj = [];
for (let i = 1; i < out.length; i++) { const d = out[i].fw - out[i - 1].fw; if (Math.abs(d) > 0.08) pj.push({ t: out[i].t, de: out[i - 1].fw, para: out[i].fw }); }
const fws = out.slice(60).map((r) => r.fw);
console.log(`pelve à frente: min ${Math.min(...fws).toFixed(2)} max ${Math.max(...fws).toFixed(2)} m · saltos da pelve > 8 cm/quadro: ${pj.length}`, JSON.stringify(pj.slice(0, 8)));
// ritmo por janela de 0,5 s: proporção de quadros longos (>12 ms) — alternar 120/60 Hz parece "tranco"
let line = '';
for (let t = 0; t < secs * 1000; t += 500) { const w = out.filter((r) => r.t >= t && r.t < t + 500); if (!w.length) continue; const long = w.filter((r) => r.dt > 12).length / w.length; line += long < 0.1 ? '.' : long > 0.9 ? '#' : '+'; }
console.log('ritmo (. = 120 Hz liso, # = 60 Hz, + = misturado):', line);
const dts = out.map((r) => r.dt).sort((a, b) => a - b);
console.log(`quadros ${out.length} · dt p50 ${dts[dts.length >> 1]} p99 ${dts[Math.floor(dts.length * 0.99)]} max ${dts.at(-1)} ms · correções ${JSON.stringify(corr)}`);
console.log('eventos (dt>50ms ou salto>0,4m):', worst.length);
for (const w of worst.slice(0, 30)) console.log(JSON.stringify(w));
const gf = (await p.evaluate(() => window.__pv.takeFrames())).slice(2).sort((a, b) => a - b);
const q = (k) => gf[Math.min(gf.length - 1, Math.floor(gf.length * k))].toFixed(1);
console.log(`quadros do JOGO: ${gf.length} (${(gf.length / secs).toFixed(0)} FPS) · intervalo p1 ${q(0.01)} p50 ${q(0.5)} p99 ${q(0.99)} máx ${gf.at(-1).toFixed(1)} ms · fora de 14–20 ms: ${gf.filter((x) => x < 14 || x > 20).length}`);
const hl = await p.evaluate(() => window.__pv.hitches());
console.log('quadros longos por etapa (ms):'); for (const h of hl.slice(0, 15)) console.log(JSON.stringify(h));
const loaf = await p.evaluate(() => window.__loaf);
console.log('quadros longos (LoAF > 50 ms):', loaf.length);
for (const l of loaf.filter((x) => x.dur > 55).slice(0, 15)) console.log(JSON.stringify(l));
await b.close();
