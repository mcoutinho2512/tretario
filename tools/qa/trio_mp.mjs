/**
 * Trio elétrico e carro de som no multiplayer (rodada 7): clientes REAIS (um navegador cada), servidor de teste
 * próprio (PV_TEST=1, porta PV_TRIO_PORT ou 2673). Requer o Vite rodando (baseUrl).
 *
 *  trio      A sobe pela escada (E) → B vê A em cima · A anda no piso (local) → B vê · C dirige o trio →
 *            A continua no MESMO lugar do piso para A e para B (erro relativo medido) e o servidor leva A junto ·
 *            A desce (E) → no chão, atrás do trio
 *  som       A entra no carro de som · B não entra no mesmo · A dirige → B vê · A sai → disponível
 *  sólido    B tenta atravessar a carroceria do trio a pé → não entra
 *
 * uso: node tools/qa/trio_mp.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_TRIO_PORT ?? 2673);
const SHOTS = process.env.SHOTS ?? '';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const numbers = {};
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const killServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', killServer);

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const trio = manifest.vehicleSpawns.find((s) => s.kind === 'trio');
const som = manifest.vehicleSpawns.find((s) => s.kind === 'soundcar');
/** local (x lateral, z frente) → mundo, no referencial de um veículo (src/vehicles/platform.ts) */
const L2W = (v, lx, lz) => [v.x + lx * Math.cos(v.heading) + lz * Math.sin(v.heading), v.z - lx * Math.sin(v.heading) + lz * Math.cos(v.heading)];
const W2L = (v, x, z) => { const c = Math.cos(v.heading), s = Math.sin(v.heading), dx = x - v.x, dz = z - v.z; return [dx * c - dz * s, dx * s + dz * c]; };

const browsers = [];
async function open(name, sp) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: SHOTS ? 1280 : 800, height: SHOTS ? 720 : 500 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=16:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const me = (p) => ev(p, () => window.__pv.metrics().player);
const until = async (p, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(p, fn)) return true; await w(150); } return false; };
const remoteNamed = async (p, name) => (await ev(p, () => window.__pv.remoteDrawn())).find((r) => r.name === name);

// ------------------------------------------------------------------------------------------- trio
const A = await open('A', L2W(trio, 0.3, -7.6));
const B = await open('B', L2W(trio, 4.6, -3));
const C = await open('C', L2W(trio, 2.6, 4.9));
await w(2000);
const t0 = await ev(B, () => window.__pv.vehiclePose('trio0'));
check('trio: estacionado no centro do corredor, disponível', t0 && !t0.occupant && Math.hypot(t0.x - trio.x, t0.z - trio.z) < 0.3);

await ev(A, () => window.__pv.key('KeyE'));
check('trio: A sobe pela escada (E, servidor confirma)', await until(A, () => window.__pv.platform()?.id === 'trio0'), JSON.stringify(await ev(A, () => window.__pv.platform())));
const pA0 = await me(A);
check('trio: A está no piso (altura do deck)', Math.abs(pA0.y - (t0.y + 3.4)) < 0.05, `y=${pA0.y.toFixed(2)}`);
check('trio: B vê A em cima do trio', await until(B, () => window.__pv.remoteDrawn().some((r) => r.name === 'A' && r.platform === 'trio0')));
// A anda para a frente no piso (câmera atrás do trio → W = frente do trio)
await ev(A, (h) => window.__pv.camera(h, 0.3, 8), trio.heading);
await ev(A, () => window.__pv.press('KeyW', 1800));
await w(2600);
const plA = await ev(A, () => window.__pv.platform());
const rA = await remoteNamed(B, 'A');
check('trio: A anda no piso (posição local)', plA.lz > -4.5, `lz ${plA.lz.toFixed(2)}`);
check('trio: B vê a posição local de A', rA && Math.hypot(rA.plx - plA.lx, rA.plz - plA.lz) < 0.15, rA ? `erro ${Math.hypot(rA.plx - plA.lx, rA.plz - plA.lz).toFixed(3)} m` : '?');
// A tenta sair do piso (andar para o lado, além do guarda-corpo): o polígono segura
await ev(A, (h) => window.__pv.camera(h + Math.PI / 2, 0.3, 8), trio.heading);
await ev(A, () => window.__pv.press('KeyW', 2500));
await w(3000);
const plSide = await ev(A, () => window.__pv.platform());
check('trio: guarda-corpo segura (A não sai do piso andando)', Math.abs(plSide.lx) <= 1.0 + 1e-3 && plSide.lz >= -5.95, `lx ${plSide.lx.toFixed(2)}`);

// C dirige o trio
await ev(C, () => window.__pv.rawEnter('trio0'));
check('trio: C entra na cabine e dirige', await until(C, () => window.__pv.riding() === 'trio'));
await ev(A, () => window.__pv.rawEnter('trio0'));
await w(800);
check('trio: A (em cima) não pega a direção', (await ev(A, () => window.__pv.riding())) === null);
const plFix = await ev(A, () => window.__pv.platform());
const sB = [], sA = [], sSrv = [];
await ev(C, () => window.__pv.press('KeyW', 7000));
const tDrive = Date.now();
while (Date.now() - tDrive < 7500) {
  const [poseB, rB] = [await ev(B, () => window.__pv.vehiclePose('trio0')), await remoteNamed(B, 'A')];
  if (poseB && rB) {
    const [lx, lz] = W2L(poseB, rB.x, rB.z);
    sB.push(Math.hypot(lx - plFix.lx, lz - plFix.lz));
    const [sx, sz] = W2L(poseB, rB.wx, rB.wz);
    sSrv.push(Math.hypot(sx - plFix.lx, sz - plFix.lz));
  }
  const [poseA, pa] = [await ev(A, () => window.__pv.vehiclePose('trio0')), await me(A)];
  if (poseA) { const [lx, lz] = W2L(poseA, pa.x, pa.z); sA.push(Math.hypot(lx - plFix.lx, lz - plFix.lz)); }
  await w(120);
}
const bw = await ev(B, () => window.__pv.mp().bandwidth);
await w(800);
const t1 = await ev(B, () => window.__pv.vehiclePose('trio0'));
const moved = Math.hypot(t1.x - t0.x, t1.z - t0.z);
const max = (a) => (a.length ? Math.max(...a) : NaN);
numbers.trio = { moved: +moved.toFixed(2), samples: sB.length, maxRelErrB: +max(sB).toFixed(3), maxRelErrA: +max(sA).toFixed(3), maxServerLagM: +max(sSrv).toFixed(2), bwB: bw };
check('trio: anda devagar (C dirigindo) e B vê', moved > 3 && moved < 1.6 * 7.5, `${moved.toFixed(1)} m em ~7 s`);
check('trio: A fica no mesmo lugar do piso — visto por B (sem escorregar)', max(sB) < 0.1, `erro máx ${max(sB).toFixed(3)} m em ${sB.length} amostras`);
check('trio: A fica no mesmo lugar do piso — visto por A', max(sA) < 0.1, `erro máx ${max(sA).toFixed(3)} m`);
check('trio: servidor leva A junto (posição de mundo segue o trio)', max(sSrv) < 2.5, `defasagem máx ${max(sSrv).toFixed(2)} m (pose interpolada × último patch)`);
if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await ev(B, () => window.__pv.hud(false)); await ev(B, (h) => window.__pv.camera(h + 2.4, 0.35, 16), trio.heading); await w(1500); await B.screenshot({ path: `${SHOTS}/F2_mp_A_sobre_o_trio_visto_por_B.jpg`, type: 'jpeg', quality: 85 }); }
await ev(C, () => window.__pv.press('KeyS', 1500));
await w(1800);
await ev(C, () => window.__pv.key('KeyE'));
check('trio: C sai da cabine', await until(C, () => window.__pv.riding() === null));
// B tenta atravessar a carroceria a pé
{
  const pose = await ev(B, () => window.__pv.vehiclePose('trio0'));
  const [fx, fz] = L2W(pose, -5, -1);
  const [sx, sz] = L2W(pose, 3.0, -1);
  await ev(B, (x, z) => window.__pv.teleport(x, z), sx, sz);
  await w(600);
  await ev(B, (x, z) => window.__pv.walkTo(x, z, false), fx, fz);
  let inside = 0;
  for (let i = 0; i < 25; i++) { const p = await me(B); const [lx, lz] = W2L(pose, p.x, p.z); if (Math.abs(lx) < 1.3 && Math.abs(lz) < 6.3) inside++; await w(150); }
  await ev(B, () => window.__pv.stopWalk());
  check('trio: carroceria é sólida para quem anda (B não atravessa)', inside === 0, `${inside} amostras dentro`);
}
await ev(A, () => window.__pv.key('KeyE'));
check('trio: A desce (E) e fica no chão atrás do trio', await until(A, () => window.__pv.platform() === null && window.__pv.metrics().player.y < 1), JSON.stringify(await me(A)));
{
  const pose = await ev(A, () => window.__pv.vehiclePose('trio0'));
  const p = await me(A);
  const [lx, lz] = W2L(pose, p.x, p.z);
  check('trio: desceu pelo pé da escada', Math.hypot(lx - 0, lz + 7.2) < 1.2, `local (${lx.toFixed(2)}, ${lz.toFixed(2)})`);
}
check('trio: B vê A no chão', await until(B, () => window.__pv.remoteDrawn().some((r) => r.name === 'A' && !r.platform)));
for (const b of browsers.splice(0)) await b.close();
await w(800);

// ------------------------------------------------------------------------------------------- carro de som
{
  const sideA = L2W(som, 1.9, 1.0), sideB = L2W(som, -2.6, 0);
  const A2 = await open('A2', sideA), B2 = await open('B2', sideB);
  await w(1500);
  const v0 = await ev(B2, (id) => window.__pv.vehiclePose(id), som.id);
  check('som: parado e disponível', v0 && !v0.occupant && Math.hypot(v0.x - som.x, v0.z - som.z) < 0.3);
  await ev(A2, () => window.__pv.key('KeyE'));
  check('som: A entra (E, servidor confirma)', await until(A2, () => window.__pv.riding() === 'soundcar'));
  await ev(B2, (id) => window.__pv.rawEnter(id), som.id);
  await w(1000);
  check('som: B não entra no carro de som ocupado', (await ev(B2, () => window.__pv.lastDenial())) === 'enter:ocupado' && (await ev(B2, () => window.__pv.riding())) === null);
  const p0 = await me(A2);
  await ev(A2, () => window.__pv.press('KeyW', 4000));
  await w(4400);
  const p1 = await me(A2);
  const seen = await ev(B2, (id) => window.__pv.vehiclePose(id), som.id);
  const corr = await ev(A2, () => window.__pv.mp().correctionReasons);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  numbers.soundcar = { moved: +moved.toFixed(2), corrections: corr };
  check('som: A dirige em passo de cortejo', moved > 4 && moved < 4.2 * 4.6, `${moved.toFixed(1)} m em 4 s · correções ${JSON.stringify(corr)}`);
  check('som: B vê o movimento', seen && Math.hypot(seen.x - p1.x, seen.z - p1.z) < 2.0, `erro ${seen ? Math.hypot(seen.x - p1.x, seen.z - p1.z).toFixed(2) : '?'} m`);
  if (SHOTS) { await ev(B2, () => window.__pv.hud(false)); await w(800); await B2.screenshot({ path: `${SHOTS}/D2_mp_carro_de_som_visto_por_B.jpg`, type: 'jpeg', quality: 85 }); }
  await ev(A2, () => window.__pv.press('KeyS', 1500));
  await w(1800);
  await ev(A2, () => window.__pv.key('KeyE'));
  const out = await until(A2, () => window.__pv.riding() === null);
  await w(1500);
  const a2 = await ev(B2, (id) => window.__pv.vehiclePose(id), som.id);
  const pOut = await me(A2);
  check('som: A sai pela porta (fora da carroceria); disponível para B', out && !a2.occupant && Math.hypot(pOut.x - a2.x, pOut.z - a2.z) > 1.2, `ocupante '${a2.occupant ?? ''}'`);
  for (const b of browsers.splice(0)) await b.close();
}

const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
console.log(JSON.stringify(numbers));
console.log(log.filter((l) => /negado|subiu|entrou em|vaga/.test(l)).slice(0, 20).join('\n'));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ results, numbers }, null, 1));
killServer();
process.exit(ok === results.length ? 0 : 1);
