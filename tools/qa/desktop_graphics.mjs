/**
 * RODADA 11 — QA do HUD desktop, da escala da interface e dos gráficos ao vivo.
 *
 *  1. LAYOUT: 1366×768, 1440×900, 1440×900 @2x (Retina), 1920×1080 e 2560×1440 × escalas 80/100/125 % (90/110 também
 *     no 1920): com o alto ao centro cheio (indicador de zona + aviso de zona + aviso + ação bloqueada), mede as caixas
 *     VISÍVEIS de cada bloco do HUD e exige: dentro da tela, fora da ÁREA CENTRAL reservada (x 30–70 %, y 28–66 %) e
 *     sem interseção entre blocos.
 *  2. PRESET AO VIVO: baixo → médio → alto → ultra → alto pelo painel (clique no rádio) e pela API; sem erro, `far` da
 *     câmera, draw calls e FPS mudam, sem recarregar.
 *  3. LIMITE DE FPS AO VIVO (Chrome sem vsync): 30 / 60 / sem limite — mede o intervalo médio entre quadros.
 *  4. PERSISTÊNCIA: escala, limite de FPS e qualidade sobrevivem ao recarregar.
 *  5. CAPTURAS em docs/screenshots/round11/: Q_configuracoes, S_graficos, W_1366x768, X_1920x1080, Y_2560x1440,
 *     A_hud_desktop_d, U_evento.
 *
 * Sobe o PRÓPRIO servidor de teste (PV_TEST=1, PV_STORE=memory, porta R11_QA_PORT=3970 → 3971) e bots (cenário denso
 * com vida social). Cliente: `npx vite --port 5204 --strictPort`.
 * uso: node tools/qa/desktop_graphics.mjs [base=http://localhost:5204] [bots=60]
 * saída: docs/screenshots/round11/desktop_graphics.json (+ capturas)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5204';
const BOTS = Number(process.argv[3] ?? 60);
const PORT = Number(process.env.R11_QA_PORT ?? 3970);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DOCS = 'docs/screenshots/round11';
const PHASES = new Set((process.env.R11_PHASES ?? 'layout,live,fps').split(','));
mkdirSync(DOCS, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));

const procs = new Set();
const start = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { cwd: 'server', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  procs.add(p);
  p.on('exit', () => procs.delete(p));
  return p;
};
const cleanup = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* já saiu */ } } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const server = start('npx', ['tsx', 'src/index.ts'], { PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_METRICS: '0', PV_EVENT: process.env.PV_EVENT ?? 'manifestacao' });
let up = false;
server.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 225 && !up; i++) await w(200);
if (!up) { console.error('servidor de teste não subiu'); process.exit(1); }
for (let k = 0; k * 100 < BOTS; k++) {
  const n = Math.min(100, BOTS - k * 100);
  start('npx', ['tsx', 'tools/bots.ts', String(n), '3600', `ws://127.0.0.1:${PORT}`, 'dense', `--offset=${k * 100}`, `--total=${BOTS}`, '--social=0.5']);
}
await w(5000);

const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = m.pvAxis[11], b = m.pvAxis[12];
const C = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 };
const along = Math.atan2(b[0] - a[0], b[1] - a[1]);
// jogador um pouco atrás da concentração, olhando a avenida (a multidão à frente, não em cima da câmera)
const P = { x: C.x - Math.sin(along) * 26, z: C.z - Math.cos(along) * 26 };

const report = { layout: [], live: [], fps: [], persist: null, errors: [] };
const launch = (view, dpr = 1, extraArgs = []) => puppeteer.launch({
  executablePath: chrome, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', `--window-size=${view[0]},${view[1]}`, ...extraArgs],
  defaultViewport: { width: view[0], height: view[1], deviceScaleFactor: dpr },
});
async function open(br, q = 'medium', extra = '') {
  const p = await br.newPage();
  p.on('pageerror', (e) => { report.errors.push(e.message); console.log('ERRO', e.message); });
  await p.goto(`${BASE}/?autostart=1&welcome=0&quality=${q}&time=16:30&mp=ws://127.0.0.1:${PORT}&name=QA&spawn=${P.x.toFixed(1)},${P.z.toFixed(1)}${extra}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 180000 });
  await p.evaluate((yaw) => window.__pv.camera(yaw, 0.2, 6), along);
  await w(2500);
  return p;
}

/** enche a coluna do alto ao centro (indicador + aviso de zona + aviso + ação bloqueada) e mede os blocos visíveis */
const MEASURE = () => {
  const W = innerWidth, H = innerHeight;
  const center = { l: W * 0.3, r: W * 0.7, t: H * 0.28, b: H * 0.66 };
  const skip = /^(name-labels|ix-label|fx-disorient|touch-layer|debug-panel|vp-toast|hud-help|hud-sheet|action-wheel|hud-restore|person-panel|agenda-panel|debate-panel|evt-panel|gf-report|cbt-peace|lock-hint)$/;
  const effOpacity = (e) => { let o = 1; for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= Number(cs.opacity); } return o; };
  const blocks = [];
  for (const top of document.querySelector('.hud').children) {
    const name = top.className.split(' ')[0];
    if (skip.test(name)) continue;
    let r = null;
    for (const e of [top, ...top.querySelectorAll('*')]) {
      const bb = e.getBoundingClientRect();
      if (bb.width < 2 || bb.height < 2) continue;
      const cs = getComputedStyle(e);
      const painted = (e.childElementCount === 0 && (e.textContent?.trim() || e.tagName === 'CANVAS' || e.tagName === 'svg')) || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px';
      if (!painted || effOpacity(e) < 0.05) continue;
      r = r ? { l: Math.min(r.l, bb.left), t: Math.min(r.t, bb.top), r: Math.max(r.r, bb.right), b: Math.max(r.b, bb.bottom) } : { l: bb.left, t: bb.top, r: bb.right, b: bb.bottom };
    }
    if (r) blocks.push({ name, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])) });
  }
  const inter = (p, q) => Math.max(0, Math.min(p.r, q.r) - Math.max(p.l, q.l)) * Math.max(0, Math.min(p.b, q.b) - Math.max(p.t, q.t));
  const problems = [];
  for (const x of blocks) {
    if (x.l < -0.5 || x.t < -0.5 || x.r > W + 0.5 || x.b > H + 0.5) problems.push(`${x.name} sai da tela`);
    if (inter(x, center) > 0) problems.push(`${x.name} invade o centro`);
  }
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) if (inter(blocks[i], blocks[j]) > 4) problems.push(`${blocks[i].name} × ${blocks[j].name}`);
  return { W, H, center: Object.fromEntries(Object.entries(center).map(([k, v]) => [k, Math.round(v)])), blocks, problems };
};
async function fillTop(p) {
  await p.evaluate(() => {
    const r = window.__pv.r11();
    window.__pvProg?.ui; // (a fila de avisos é do HudShell)
    r.blocked('Mãos ocupadas: largue o item primeiro');
    const bn = document.querySelector('.zone-banner'); bn?.classList.add('show');
  });
  await p.evaluate(() => document.querySelector('.hud-notice') && (document.querySelector('.hud-notice').className = 'hud-notice show k-mission', document.querySelector('.hud-notice').textContent = 'Missão: chegue à Candelária com o grupo'));
  await w(450);
}

// ---------------------------------------------------------------- 1. layout por resolução × escala
const RES = [[1366, 768, 1], [1440, 900, 1], [1440, 900, 2], [1920, 1080, 1], [2560, 1440, 1]];
for (const [vw, vh, dpr] of PHASES.has('layout') ? RES : []) {
  const br = await launch([vw, vh], dpr);
  try {
    const p = await open(br, 'medium');
    const scales = vw === 1920 ? [80, 90, 100, 110, 125] : [80, 100, 125];
    for (const s of scales) {
      await p.evaluate((s) => window.__pv.r11().ui({ scale: s }), s);
      await w(300);
      await fillTop(p);
      const r = await p.evaluate(MEASURE);
      const row = { res: `${vw}x${vh}@${dpr}x`, scale: s, ok: r.problems.length === 0, problems: r.problems, blocks: r.blocks };
      report.layout.push(row);
      console.log(row.res, `${s}%`, row.ok ? 'ok' : r.problems.join('; '));
      if (s === 100 && dpr === 1) {
        const name = vw === 1366 ? 'W_1366x768' : vw === 1920 ? 'X_1920x1080' : vw === 2560 ? 'Y_2560x1440' : null;
        if (name) await p.screenshot({ path: `${DOCS}/${name}.jpg`, type: 'jpeg', quality: 82 });
      }
    }
    await p.evaluate(() => window.__pv.r11().ui({ scale: 100 }));
  } catch (e) { report.errors.push(`${vw}x${vh}: ${e.message}`); console.log('falhou', vw, e.message); }
  await br.close();
}

// ---------------------------------------------------------------- 2. HUD desktop, evento, ajustes e preset ao vivo (1920×1080)
if (PHASES.has('live')) {
  const br = await launch([1920, 1080]);
  const p = await open(br, 'medium');
  await w(3000);
  // A: HUD reorganizado — indicador de zona, aviso e ação bloqueada no alto ao centro; centro limpo
  await fillTop(p);
  await p.screenshot({ path: `${DOCS}/A_hud_desktop_d.jpg`, type: 'jpeg', quality: 84 });
  // U: HUD num evento (nome do evento, "acontecendo agora", minimapa com calor) — sem os avisos forçados
  await p.evaluate(() => { document.querySelector('.zone-banner')?.classList.remove('show'); document.querySelector('.hud-notice')?.classList.remove('show'); });
  await p.evaluate((yaw) => window.__pv.camera(yaw, 0.12, 8), along);
  await w(2500);
  await p.screenshot({ path: `${DOCS}/U_evento.jpg`, type: 'jpeg', quality: 84 });
  // Q: painel de ajustes (aba Interface) · S: aba Gráficos depois de trocar o preset pelo próprio rádio
  await p.evaluate(() => window.__pv.r11().open('interface'));
  await w(400);
  await p.screenshot({ path: `${DOCS}/Q_configuracoes.jpg`, type: 'jpeg', quality: 84 });
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.sheet-tab')].map((t) => ({ tab: t.dataset.tab, sel: t.getAttribute('aria-selected') })));
  report.tabs = tabs;
  await p.evaluate(() => window.__pv.r11().open('graficos'));
  const seq = ['low', 'medium', 'high', 'ultra', 'high'];
  for (const q of seq) {
    const t0 = Date.now();
    await p.evaluate((q) => document.querySelector(`.settings-sheet input[name="hud-q"][value="${q}"]`).click(), q);
    const applyMs = Date.now() - t0;
    await w(3500);
    const st = await p.evaluate(() => ({ s: window.__pv.r11().state(), m: window.__pv.metrics(), applied: document.querySelector('.sheet-applied')?.textContent, note: document.querySelector('.settings-sheet .sheet-note:not([hidden])')?.textContent ?? '' }));
    const row = { preset: q, level: st.s.level, applyMs, far: st.s.far, anisotropy: st.s.anisotropy, reloadFor: st.s.reloadFor, fps: st.m.fps, calls: st.m.calls, trianglesK: Math.round(st.m.triangles / 1000), applied: st.applied, note: st.note, sameDocument: await p.evaluate(() => !!window.__pv) };
    report.live.push(row);
    console.log('ao vivo', JSON.stringify(row));
  }
  await p.screenshot({ path: `${DOCS}/S_graficos.jpg`, type: 'jpeg', quality: 84 });
  // persistência: escala 110, FPS 30, qualidade alta → recarrega
  await p.evaluate(() => { window.__pv.r11().ui({ scale: 110 }); document.querySelector('.settings-sheet input[name="hud-fps"][value="30"]').click(); });
  await p.reload();
  await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
  report.persist = await p.evaluate(() => ({ ui: window.__pv.r11().state().ui, limit: window.__pv.r11().state().limit, quality: localStorage.getItem('pv3d.quality'), fps: localStorage.getItem('pv3d.fps'), cssScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale') }));
  console.log('persistência', JSON.stringify(report.persist));
  await p.evaluate(() => { window.__pv.r11().ui({ scale: 100 }); localStorage.setItem('pv3d.fps', 'auto'); });
  await br.close();
}

// ---------------------------------------------------------------- 3. limite de FPS ao vivo
// 30 e 60 com vsync normal (tela de 60 Hz do Chrome headless); "sem limite" sem vsync: passa de 60 e segue o rAF
// (num monitor de 120/144 Hz o rAF é a taxa do monitor) — sem laço ocupado: só renderiza dentro do requestAnimationFrame
for (const [flags, choices] of PHASES.has('fps') ? [[[], ['30', '60', 'unlimited', '30', '60']], [['--disable-gpu-vsync', '--disable-frame-rate-limit'], ['unlimited', '60']]] : []) {
  const br = await launch([1280, 720], 1, flags);
  const p = await open(br, 'low');
  for (const c of choices) {
    await p.evaluate((c) => window.__pv.r11().fps(c), c);
    await w(1500);
    await p.evaluate(() => window.__pv.takeFrames());
    await w(3000);
    const fr = await p.evaluate(() => window.__pv.takeFrames());
    const mean = fr.reduce((s, x) => s + x, 0) / Math.max(1, fr.length);
    const row = { vsync: flags.length === 0, choice: c, limit: await p.evaluate(() => window.__pv.r11().state().limit), frames: fr.length, meanMs: +mean.toFixed(2), fps: +(1000 / mean).toFixed(1) };
    report.fps.push(row);
    console.log('fps', JSON.stringify(row));
  }
  await br.close();
}

report.summary = {
  layoutCases: report.layout.length, layoutOk: report.layout.filter((r) => r.ok).length,
  liveOk: report.live.every((r) => r.level === (r.preset) && r.sameDocument),
  fpsOk: report.fps.length === 0 ? null : report.fps.every((r) => r.choice === '30' ? r.fps > 27 && r.fps < 33 : r.choice === '60' ? r.fps > 52 && r.fps < 66 : r.vsync ? r.fps > 52 : r.fps > 75),
  persistOk: report.persist ? report.persist.ui?.scale === 110 && report.persist.limit === 30 : null,
  errors: report.errors.length,
};
writeFileSync(`${DOCS}/desktop_graphics${process.env.R11_PHASES ? `_${[...PHASES].join('_')}` : ''}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary));
cleanup();
process.exit(0);
