/**
 * Veículos no multiplayer (avenida fechada, rodada 7): 2 clientes reais nascem junto a cada tipo de veículo.
 * Para cada tipo (carro, moto, bicicleta, patinete): parado/disponível · A entra · B não entra no mesmo ·
 * A anda · B vê o movimento · A sai · veículo parado e disponível.
 * Servidor de teste próprio (PV_TEST=1, porta PV_VEH_PORT ou 2650). Requer `npm run dev`.
 * uso: node tools/qa/vehicles_mp.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_VEH_PORT ?? 2650);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
// um NAVEGADOR por cliente: abas em segundo plano congelam o requestAnimationFrame (o jogo para)
const browsers = [];
async function open(name, sp) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 800, height: 500 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const me = (p) => ev(p, () => window.__pv.metrics().player);
const until = async (p, fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(p, fn)) return true; await w(150); } return false; };

for (const kind of ['car', 'moto', 'bicycle', 'scooter']) {
  const v = manifest.vehicleSpawns.find((s) => s.kind === kind && (kind !== 'bicycle' && kind !== 'scooter' ? true : s.id.startsWith('st')));
  // A ao lado (lado esquerdo do veículo), B um pouco atrás
  const sideA = [v.x - Math.cos(v.heading) * (kind === 'car' ? 1.7 : 1.0), v.z + Math.sin(v.heading) * (kind === 'car' ? 1.7 : 1.0)];
  const sideB = [sideA[0] - Math.sin(v.heading) * 1.5, sideA[1] - Math.cos(v.heading) * 1.5];
  const A = await open(`A_${kind}`, sideA), B = await open(`B_${kind}`, sideB);
  await w(1500);
  const v0 = (await ev(B, (k) => window.__pv.vehicles(k), kind)).find((x) => x.id === v.id);
  check(`${kind}: parado e disponível`, v0 && !v0.occupant && v0.state === 0 && Math.hypot(v0.x - v.x, v0.z - v.z) < 0.3, `estado ${v0?.state}`);
  await ev(A, (id) => window.__pv.rawEnter(id), v.id);
  check(`${kind}: A entra (servidor confirma)`, await until(A, () => window.__pv.riding() !== null), String(await ev(A, () => window.__pv.riding())));
  await ev(B, (id) => window.__pv.rawEnter(id), v.id);
  await w(1000);
  check(`${kind}: B não entra no mesmo veículo`, (await ev(B, () => window.__pv.lastDenial())) === 'enter:ocupado' && (await ev(B, () => window.__pv.riding())) === null);
  const p0 = await me(A);
  await ev(A, () => window.__pv.press('KeyW', 3000));
  await w(3400);
  const p1 = await me(A);
  const corr = await ev(A, () => window.__pv.mp().correctionReasons);
  const seen = (await ev(B, (k) => window.__pv.vehicles(k), kind)).find((x) => x.id === v.id);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check(`${kind}: A anda`, moved > 3, `${moved.toFixed(1)} m · correções ${JSON.stringify(corr)}`);
  check(`${kind}: B vê o movimento`, seen && Math.hypot(seen.x - p1.x, seen.z - p1.z) < 2.5, `erro ${seen ? Math.hypot(seen.x - p1.x, seen.z - p1.z).toFixed(2) : '?'} m`);
  await ev(A, () => window.__pv.press('KeyS', 1200));
  await w(1400);
  await ev(A, () => window.__pv.key('KeyE'));
  const out = await until(A, () => window.__pv.riding() === null);
  await w(1200);
  const a1 = (await ev(B, (k) => window.__pv.vehicles(k), kind)).find((x) => x.id === v.id);
  await w(1000);
  const a2 = (await ev(B, (k) => window.__pv.vehicles(k), kind)).find((x) => x.id === v.id);
  check(`${kind}: A sai; veículo parado e disponível`, out && !a2.occupant && a2.state === 0 && Math.hypot(a2.x - a1.x, a2.z - a1.z) < 0.05, `estado ${a2.state}`);
  for (const b of browsers.splice(0)) await b.close();
  await w(800);
}
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
console.log(log.filter((l) => /negado|entrou em|vaga/.test(l)).slice(0, 20).join('\n'));
process.exit(ok === results.length ? 0 : 1);
