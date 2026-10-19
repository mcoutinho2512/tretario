/**
 * Rodada 10 — montagem (AGENTE C): corpo no veículo no MULTIPLAYER. Para carro, moto, bicicleta e patinete:
 * A entra · B (outro navegador) vê A entrando e depois sentado/montado no banco (fase derivada do `vehicle`, IK no
 * remoto) · A dirige com curva · B vê veículo + corpo coerentes (pelve no banco, mãos no guidão/volante) · A sai · B vê
 * a saída e o corpo de pé no ponto do servidor. Screenshots (visão de A e de B) em docs/screenshots/round10/.
 * Depois: custo — 5 robôs (SDK) montados perto de B; tempo do solver por quadro e CPU do quadro com/sem.
 * Servidor de teste próprio (PV_TEST=1, porta PV_MOUNT_PORT ou 3310). Requer o Vite (padrão http://localhost:5183).
 * uso: node tools/qa/vehicle_mount_mp.mjs [baseUrl]   (PV_KINDS=car,moto,bicycle,scooter · PV_COST=0 pula o custo)
 */
import puppeteer from 'puppeteer-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';

const base = process.argv[2] ?? 'http://localhost:5183';
const PORT = Number(process.env.PV_MOUNT_PORT ?? 3310);
const OUT = 'docs/screenshots/round10';
mkdirSync(OUT, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const kill = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', kill);

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const browsers = [];
async function open(name, sp, size = { width: 960, height: 600 }) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: size });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  await p.evaluate(() => window.__pv.peds(0));
  await w(300);
  await p.evaluate(() => window.__pv.key('KeyH')); // HUD limpo nas fotos
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (p, fn, ms = 8000, ...a) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(p, fn, ...a)) return true; await w(100); } return false; };
/** câmera livre de B mirando o veículo (lado local lx; +x = esquerda do motorista) */
const frame = (p, id, lx, ly, lz, ty = 0.9) => ev(p, (id, lx, ly, lz, ty) => {
  const v = window.__pv.vehiclePose(id);
  if (!v) return false;
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  window.__pv.lookFrom(v.x + lx * c + lz * s, v.y + ly, v.z - lx * s + lz * c, v.x, v.y + ty, v.z);
  return true;
}, id, lx, ly, lz, ty);
const remoteOf = (p, name) => ev(p, (n) => window.__pv.mount().remotes.find((r) => r.name === n) ?? null, name);
const SHOT = { car: ['H_entrando_carro', 'I_dirigindo', 'J_saida_carro'], moto: ['K_moto'], bicycle: ['L_bicicleta'], scooter: ['M_patinete'] };
const report = { kinds: {}, cost: null };

for (const kind of (process.env.PV_KINDS ?? 'car,moto,bicycle,scooter').split(',')) {
  const v = manifest.vehicleSpawns.find((s) => s.kind === kind && (kind === 'car' || kind === 'moto' || s.id.startsWith('st')));
  const c = Math.cos(v.heading), s = Math.sin(v.heading);
  const side = kind === 'car' ? 1.9 : 1.1;
  const sideA = [v.x + side * c, v.z - side * s];
  const sideB = [v.x + 6 * c + 2 * s, v.z - 6 * s + 2 * c];
  const A = await open(`A${kind}`, sideA), B = await open(`B${kind}`, sideB);
  await w(1500);
  const far = kind === 'car' ? 4.3 : 2.8;
  const rec = { kind, id: v.id };
  await frame(B, v.id, far, 1.3, 0.4);
  await ev(A, (id) => window.__pv.rawEnter(id), v.id);
  check(`${kind}: A entra (servidor confirma)`, await until(A, () => window.__pv.riding() !== null), String(await ev(A, () => window.__pv.riding())));
  // B vê a ENTRADA (fase derivada da mudança de vehicle no remoto)
  const sawEntering = await until(B, (n) => window.__pv.mount().remotes.find((r) => r.name === n)?.mount?.phase === 'entering', 2500, `A${kind}`);
  await frame(B, v.id, far, 1.3, 0.4);
  await w(kind === 'car' ? 520 : 200);
  if (kind === 'car') { await B.screenshot({ path: `${OUT}/H_entrando_carro_visao_B.jpg`, quality: 82 }); await A.screenshot({ path: `${OUT}/H_entrando_carro_visao_A.jpg`, quality: 82 }); }
  check(`${kind}: B vê A ENTRANDO (fase entering no remoto)`, sawEntering);
  const mounted = await until(B, (n) => window.__pv.mount().remotes.find((r) => r.name === n)?.mount?.phase === 'mounted', 4000, `A${kind}`);
  await w(400);
  const rm = await remoteOf(B, `A${kind}`);
  rec.remoteMounted = rm?.mount?.solver ?? null;
  const e = rm?.mount?.solver?.err ?? {};
  check(`${kind}: B vê A MONTADO — pelve no banco, mãos no guidão/volante (IK no remoto)`, mounted && rm?.mount?.solver?.ik && (e.hip ?? 1) < 0.05 && (e.handL ?? 1) < 0.12 && (e.handR ?? 1) < 0.12, JSON.stringify(e));
  await frame(B, v.id, far, 1.2, 0.0);
  await w(300);
  await B.screenshot({ path: `${OUT}/${SHOT[kind][0]}${kind === 'car' ? '_parado' : ''}_visao_B.jpg`, quality: 82 });
  // A dirige com curva; B acompanha (câmera livre reposicionada a cada foto)
  await ev(A, () => { window.__pv.press('KeyW', 3200); setTimeout(() => window.__pv.press('KeyA', 1400), 900); });
  if (kind === 'bicycle' || kind === 'scooter' || kind === 'moto') {
    // sequência vista por B (lado): pedalada / impulso do patinete / partida da moto — folha de contato
    const frames = [];
    mkdirSync('screenshots/tmp/seq', { recursive: true });
    for (let i = 0; i < 8; i++) {
      await frame(B, v.id, far * 0.95, 1.0, 0.0, 0.7);
      const f = `screenshots/tmp/seq/${kind}_${i}.jpg`;
      await B.screenshot({ path: f, quality: 80 });
      frames.push(f);
      await w(60);
    }
    spawnSync('python3', ['tools/qa/contact_sheet.py', `${OUT}/${SHOT[kind][0]}_sequencia_visao_B.jpg`, '4', '400', ...frames]);
  } else await w(1700);
  await frame(B, v.id, far * 1.15, 1.6, far * 0.6);
  await w(120);
  const dynB = await ev(B, (id) => window.__pv.vehicleDyn(id), v.id);
  const rm2 = await remoteOf(B, `A${kind}`);
  await B.screenshot({ path: `${OUT}/${kind === 'car' ? 'I_dirigindo' : SHOT[kind][0]}_andando_visao_B.jpg`, quality: 82 });
  // visão de A: câmera do jogo atrás/3-4 do veículo, um pouco de cima (a pose fica visível)
  await ev(A, (id, d) => { const p = window.__pv.vehiclePose(id); window.__pv.camera(p.heading + 0.6, 0.32, d); }, v.id, { car: 7.4, moto: 4.9, bicycle: 4.6, scooter: 4.4 }[kind]);
  await w(350);
  await A.screenshot({ path: `${OUT}/${kind === 'car' ? 'I_dirigindo' : SHOT[kind][0]}_andando_visao_A.jpg`, quality: 82 });
  const e2 = rm2?.mount?.solver?.err ?? {};
  rec.driving = { dynB, err: e2, torso: rm2?.mount?.solver?.torso, kickW: rm2?.mount?.solver?.kickW };
  check(`${kind}: B vê veículo andando com o corpo coerente (pelve presa ao banco em movimento)`, (dynB?.speed ?? 0) > 0.8 && rm2?.mount?.phase === 'mounted' && (e2.hip ?? 1) < 0.05, `v=${dynB?.speed?.toFixed(2)} esterço=${dynB?.steer?.toFixed(2)} incl=${dynB?.lean?.toFixed(2)} pedivela=${dynB?.crank?.toFixed(2)} err=${JSON.stringify(e2)}`);
  if (kind === 'bicycle') {
    // pedalada: o pedivela gira com a velocidade (B, só pela posição do veículo)
    const c0 = (await ev(B, (id) => window.__pv.vehicleDyn(id), v.id)).crank;
    await w(400);
    const c1 = (await ev(B, (id) => window.__pv.vehicleDyn(id), v.id)).crank;
    check('bicycle: B vê a pedalada (pedivela gira com a velocidade)', Math.abs(c1 - c0) > 0.3, `${c0.toFixed(2)} → ${c1.toFixed(2)} rad`);
  }
  await w(1800);
  await ev(A, () => window.__pv.press('KeyS', 1500));
  for (let i = 0; i < 10; i++) { await frame(B, v.id, far, 1.3, 0.3); await w(200); } // B acompanha (o corpo do remoto segue na vista)
  // saída
  await frame(B, v.id, far, 1.3, 0.3);
  if (process.env.PV_DEBUG) console.log('DEBUG', JSON.stringify(await ev(B, () => ({ m: window.__pv.mount().remotes, crowd: window.__pv.metrics().crowd, me: window.__pv.metrics().player }))), JSON.stringify(await ev(B, (id) => window.__pv.vehiclePose(id), v.id)));
  // B registra, quadro a quadro, as fases do remoto (a saída dura ~0,4–0,8 s)
  await ev(B, (n) => {
    window.__phases = [];
    const tick = () => { const r = window.__pv.mount().remotes.find((x) => x.name === n); const ph = r?.mount?.phase ?? 'sem_corpo'; if (window.__phases.at(-1) !== ph) window.__phases.push(ph); if (window.__phases.length < 20) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, `A${kind}`);
  await ev(A, () => window.__pv.key('KeyE'));
  const sawExit = await until(B, () => window.__phases.includes('exiting'), 3000);
  await w(kind === 'car' ? 200 : 100);
  if (kind === 'car') { await B.screenshot({ path: `${OUT}/J_saida_carro_visao_B.jpg`, quality: 82 }); await A.screenshot({ path: `${OUT}/J_saida_carro_visao_A.jpg`, quality: 82 }); }
  check(`${kind}: B vê A SAINDO (fase exiting no remoto)`, sawExit, (await ev(B, () => window.__phases)).join(' → '));
  const done = await until(B, (n) => window.__pv.mount().remotes.find((r) => r.name === n)?.mount?.phase === 'none', 3000, `A${kind}`);
  await w(900);
  const rm3 = await remoteOf(B, `A${kind}`);
  const aSelf = await ev(A, () => window.__pv.mp().self);
  const meA = await ev(A, () => window.__pv.metrics().player);
  const vp = await ev(B, (id) => window.__pv.vehiclePose(id), v.id);
  const rootB = rm3?.root ?? [0, 0, 0];
  const gap = Math.hypot(rootB[0] - meA.x, rootB[2] - meA.z);
  check(`${kind}: depois da saída, B desenha A de pé no ponto do servidor (fora da carroceria)`, done && gap < 0.6 && aSelf.vehicle === '' && vp && !vp.occupant, `distância do desenho ${gap.toFixed(2)} m · veículo livre ${vp && !vp.occupant}`);
  if (kind === 'car') await B.screenshot({ path: `${OUT}/J_saida_carro_fora_visao_B.jpg`, quality: 82 });
  report.kinds[kind] = rec;
  for (const b of browsers.splice(0)) await b.close();
  await w(600);
}

// ------------------------------------------------------------------ custo com vários montados perto
if (process.env.PV_COST !== '0') {
  const ids = ['moto0', 'moto1', 'moto4', 'moto5', 'car4'];
  const obs = [-766.5, 371.0];
  const B = await open('Observa', obs, { width: 1280, height: 720 });
  await ev(B, (x, z) => window.__pv.lookFrom(x + 9, 4, z + 9, x - 3, 0.8, z + 2), obs[0], obs[1]);
  await w(1500);
  const sample = async (ms) => {
    await ev(B, () => window.__pv.mountCostReset());
    const s = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { s.push(await ev(B, () => window.__pv.metrics().cpuMs)); await w(100); }
    const cost = await ev(B, () => window.__pv.mount().cost);
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    return { cpuMs: +avg.toFixed(3), solveMsPerCall: cost.n ? +(cost.ms / cost.n).toFixed(4) : 0, calls: cost.n, ikCalls: cost.ik, solveMsTotal: +cost.ms.toFixed(2), frames: Math.round(ms / 1000 * (await ev(B, () => window.__pv.metrics().fps))) };
  };
  const bots = [];
  for (const id of ids) {
    const v = manifest.vehicleSpawns.find((x) => x.id === id);
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { name: `R_${id}`, body: 'mulher', skin: 2, hair: 2, top: 2, bottom: 2, shoes: 1, testSpawn: { x: v.x + (id.startsWith('car') ? 1.9 : 1.0) * c, z: v.z - (id.startsWith('car') ? 1.9 : 1.0) * s } });
    room.onMessage('*', () => {});
    bots.push({ room, id });
  }
  await w(1500);
  const before = await sample(3000);
  for (const b of bots) b.room.send('enter', { id: b.id, seq: 0 });
  await w(2500);
  const mounted = await sample(4000);
  await B.screenshot({ path: `${OUT}/N_custo_5_montados_visao_B.jpg`, quality: 80 });
  for (const b of bots) b.room.send('exit', {});
  await w(2000);
  const after = await sample(3000);
  const perFrame = mounted.frames ? mounted.solveMsTotal / mounted.frames : 0;
  report.cost = { before, mounted, after, solveMsPerFrame: +perFrame.toFixed(3) };
  check('custo: 5 montados perto — solver < 1 ms por quadro', perFrame < 1, `solver ${perFrame.toFixed(3)} ms/quadro (${mounted.solveMsPerCall} ms por corpo, IK ${mounted.ikCalls}/${mounted.calls}) · CPU do quadro a pé ${before.cpuMs} → montados ${mounted.cpuMs} → depois ${after.cpuMs} ms`);
  for (const b of bots) await b.room.leave().catch(() => {});
  for (const b of browsers.splice(0)) await b.close();
}

writeFileSync(`${OUT}/vehicle_mount_mp.json`, JSON.stringify({ results, report }, null, 1));
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
kill();
process.exit(ok === results.length ? 0 : 1);
