/**
 * Rodada 8 — ESPECTADOR no multiplayer: A jogador, B e C espectadores (um navegador cada).
 * B/C entram como espectadores (sem corpo, fora da contagem de jogadores) · A dança → B e C veem · A dirige → B e C
 * veem · B manda mensagens FORJADAS (mover, entrar, subir, empurrar, agir, item, grafite) → servidor nega, nada muda
 * · B troca para a câmera da Candelária (área de interesse vai junto) e volta: o mundo continua sincronizado
 * · métricas públicas semânticas · tempo até assistir (clique → 1º quadro; cache frio/rede limitada: time_to_watch.mjs).
 * Capturas: screenshots/round8/B_modo_espectador.png e C_camera_aerea.png (+ cópias em docs/screenshots/round8/).
 * Servidor de teste próprio (PV_TEST=1, porta PV_SPEC_PORT ou 2740; API +1). Requer o dev server (vite) com PV_API.
 * uso: node tools/qa/spectator_mp.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_SPEC_PORT ?? 2740);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const car = manifest.vehicleSpawns.find((s) => s.id === 'car0');
const sideA = [car.x - Math.cos(car.heading) * 1.7, car.z + Math.sin(car.heading) * 1.7];
const browsers = [];
async function launch(vw = 800, vh = 500) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: vw, height: vh } });
  browsers.push(browser);
  return browser;
}
async function openPlayer(name, sp) {
  const p = await (await launch()).newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return p;
}
/** espectador: entra pela mesma função do botão "ASSISTIR" (window.__pvLaunch) — mede clique → 1º quadro */
async function openSpectator(name, { vw = 800, vh = 500 } = {}) {
  const browser = await launch(vw, vh);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}`);
  await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 60000 });
  const tClick = Date.now();
  await p.evaluate(() => { void window.__pvLaunch({ role: 'spectator' }); });
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  const wall = Date.now() - tClick;
  const marks = await p.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)])));
  return { p, wall, clickToFrame: marks['pv:world-visible'] - marks['pv:click'] };
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
const remoteA = async (S) => (await ev(S, () => window.__pv.mp().remotes)).find((r) => r.name === 'A');
const metricsApi = async () => (await fetch(`http://127.0.0.1:${PORT + 1}/api/metrics/public`)).json();

// ---------------------------------------------------------------- entrada
const A = await openPlayer('A', sideA);
const { p: B, clickToFrame: tB } = await openSpectator('B', { vw: 1280, vh: 720 });
const { p: C, clickToFrame: tC } = await openSpectator('C');
check('tempo até assistir (clique → 1º quadro) < 10 s', tB < 10000 && tC < 10000, `B ${tB} ms · C ${tC} ms (cache quente, localhost)`);
for (const [n, S] of [['B', B], ['C', C]]) {
  const st = await ev(S, () => ({ role: window.__pv.mp().role, spec: window.__pv.spectator() }));
  check(`${n} entrou como ESPECTADOR (papel do servidor, sem corpo)`, st.role === 'spectator' && st.spec && st.spec.avatarVisible === false, JSON.stringify({ role: st.role, cam: st.spec?.mode }));
  await ev(S, (x, z) => window.__pv.specGoto(x, z, 45, true), sideA[0], sideA[1]);
}
await w(2500);
const aSeesSpecs = (await ev(A, () => window.__pv.mp().remotes)).length;
check('espectadores não são entidades (A não vê ninguém)', aSeesSpecs === 0, `remotos de A: ${aSeesSpecs}`);
const m0 = await metricsApi();
check('métricas: 1 jogador, 2 espectadores, 0 bots', m0.playersOnline === 1 && m0.spectatorsOnline === 2 && m0.testBots === 0 && m0.totalConnections === 3 && m0.environmentCrowd > 0, JSON.stringify(m0));

// ---------------------------------------------------------------- A dança
await ev(A, () => window.__pv.act('dance_simple'));
for (const [n, S] of [['B', B], ['C', C]]) {
  const r = await until(async () => { const a = await remoteA(S); return a && a.act === 40 ? a : null; });
  check(`A dança → ${n} (espectador) vê`, !!r, JSON.stringify(r ?? (await remoteA(S)) ?? null));
}
await ev(A, () => window.__pv.act(null));

// ---------------------------------------------------------------- A dirige
await ev(A, (id) => window.__pv.rawEnter(id), 'car0');
check('A entra no carro (servidor confirma)', !!(await until(() => ev(A, () => window.__pv.riding() !== null))));
const aSid = await ev(A, () => window.__pv.mp().session);
await ev(A, () => window.__pv.press('KeyW', 3000));
await w(3400);
const pA = await ev(A, () => window.__pv.metrics().player);
for (const [n, S] of [['B', B], ['C', C]]) {
  const v = (await ev(S, () => window.__pv.vehicles('car'))).find((x) => x.id === 'car0');
  const a = await remoteA(S);
  const err = v ? Math.hypot(v.x - pA.x, v.z - pA.z) : Infinity;
  check(`A dirige → ${n} vê o carro andando com A dentro`, v && v.occupant === aSid && a?.vehicle === 'car0' && Math.hypot(v.x - car.x, v.z - car.z) > 3 && err < 3, `andou ${v ? Math.hypot(v.x - car.x, v.z - car.z).toFixed(1) : '?'} m · erro ${err.toFixed(2)} m`);
}

// ---------------------------------------------------------------- B forjado
const before = { riding: await ev(A, () => window.__pv.riding()), p: await ev(A, () => window.__pv.metrics().player) };
const forged = [['move', [-600, 0, 300, 0, 5, 1, 99999]], ['enter', { id: 'car1', seq: 1 }], ['exit', {}], ['board', { id: 'trio0' }], ['push', aSid], ['act', { a: 40 }], ['prop', { p: 1, d: 0 }], ['gf_new', { s: 'x', c: 'AAAA' }], ['mode', 'interacao'], ['pmove', [0, 0, 0, 0, 1, 1]]];
const denials = await ev(B, async (list) => {
  const n0 = window.__pv.mp().capDenials.length;
  for (const [t, m] of list) window.__pv.netSend(t, m);
  await new Promise((r) => setTimeout(r, 1200));
  return window.__pv.mp().capDenials.slice(n0);
}, forged);
await w(600);
const after = { riding: await ev(A, () => window.__pv.riding()), p: await ev(A, () => window.__pv.metrics().player) };
const car1 = (await ev(C, () => window.__pv.vehicles('car'))).find((x) => x.id === 'car1');
const remotesA = await ev(A, () => window.__pv.mp().remotes);
check('B forjado: servidor nega TODAS (capacidade) e nada muda (A segue dirigindo; car1 livre; B sem entidade)', denials.length === forged.length && after.riding === before.riding && (!car1 || !car1.occupant) && remotesA.length === 0,
  `negações ${JSON.stringify(denials)} · A ${after.riding} · car1 ${car1?.occupant || 'livre'}`);
const bSrv = log.filter((l) => /entrou em car1|subiu no trio|empurrão/.test(l));
check('log do servidor: nenhuma ação do espectador aceita', bSrv.length === 0, bSrv.join(' | '));

// ---------------------------------------------------------------- B troca para a Candelária e volta
await ev(B, () => window.__pv.specSelect('candelaria'));
await w(4500);
const sB = await ev(B, () => window.__pv.spectator());
const cand = manifest.landmarks.find((l) => l.key === 'LANDMARK_CANDELARIA').center;
check('B na câmera da Candelária', sB.mode === 'candelaria' && Math.hypot(sB.focus.x - cand[0], sB.focus.z - cand[1]) < 250, `foco a ${Math.hypot(sB.focus.x - cand[0], sB.focus.z - cand[1]).toFixed(0)} m do marco`);
await w(1200);
const farA = await remoteA(B);
check('área de interesse acompanhou a câmera (A, longe, saiu da vista detalhada de B)', !farA, farA ? `ainda vê A a ${Math.hypot(farA.x - sB.focus.x, farA.z - sB.focus.z).toFixed(0)} m` : '');
await ev(A, () => window.__pv.press('KeyW', 2000));
await w(2400);
await ev(B, (x, z) => window.__pv.specGoto(x, z, 45, true), (await ev(A, () => window.__pv.metrics().player)).x, (await ev(A, () => window.__pv.metrics().player)).z);
const back = await until(async () => { const a = await remoteA(B); return a && a.vehicle === 'car0' ? a : null; }, 6000);
await w(800);
const pA2 = await ev(A, () => window.__pv.metrics().player);
const bA = await remoteA(B), cA = await remoteA(C);
check('B volta para A: mundo sincronizado (B e C veem A no mesmo lugar)', back && bA && cA && Math.hypot(bA.x - pA2.x, bA.z - pA2.z) < 3 && Math.hypot(cA.x - pA2.x, cA.z - pA2.z) < 3,
  `B erro ${bA ? Math.hypot(bA.x - pA2.x, bA.z - pA2.z).toFixed(2) : '?'} m · C erro ${cA ? Math.hypot(cA.x - pA2.x, cA.z - pA2.z).toFixed(2) : '?'} m`);

// ---------------------------------------------------------------- capturas
mkdirSync('screenshots/round8', { recursive: true });
mkdirSync('docs/screenshots/round8', { recursive: true });
await ev(A, () => window.__pv.press('KeyS', 900));
await w(1200);
await ev(B, () => window.__pv.specSelect('trio'));
await w(5000);
await B.screenshot({ path: 'screenshots/round8/B_modo_espectador.png' });
await C.setViewport({ width: 1280, height: 720 });
await ev(C, () => window.__pv.specSelect('aerea'));
await w(6000);
const sC = await ev(C, () => window.__pv.spectator());
check('C na câmera aérea (altitude máxima, dentro do mapa)', sC.mode === 'aerea' && sC.altitude > 200 && sC.altitude <= 262, `altitude ${sC.altitude} m`);
await C.screenshot({ path: 'screenshots/round8/C_camera_aerea.png' });
for (const f of ['B_modo_espectador.png', 'C_camera_aerea.png']) copyFileSync(`screenshots/round8/${f}`, `docs/screenshots/round8/${f}`);

// tempo até assistir com cache frio e rede limitada (build de produção): tools/qa/time_to_watch.mjs
console.log(JSON.stringify({ timeToWatchDevWarm: { B: tB, C: tC } }));

for (const b of browsers) await b.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
process.exit(ok === results.length ? 0 : 1);
