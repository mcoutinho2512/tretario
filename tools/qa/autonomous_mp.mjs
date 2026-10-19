/**
 * Rodada 12 — PERSONAGENS AUTÔNOMOS no multiplayer real (docs/AUTONOMOUS_CHARACTERS.md). Servidor de teste (PV_TEST=1,
 * banco em memória, PV_AUTONOMOUS=N) + navegador (a jogadora) + um observador do SDK (bot de carga, só para LER o
 * estado: posição/kind/torcida/veículo dos autônomos e escolher onde filmar). Capturas em docs/screenshots/round12/:
 *   A_avenida_populacao   rua cheia perto da jogadora (autônomos pelo MESMO estado/animação dos jogadores)
 *   D_grupo_social        roda de conversa (2–5, em círculo)
 *   E..H_torcedores_<id>  concentrações de cada torcida (ids e cores só dos DADOS: public/gameplay/supporters.json)
 *   X_veiculos_autonomos  autônomo de bicicleta/patinete/moto/carro do mundo
 *   Y_visao_aerea         visão do alto (densidade)
 * Resumo em docs/bench/round12_autonomous_qa.json.
 *
 * uso: PV_API=http://127.0.0.1:4361 npx vite --port 5213 --strictPort  →  node tools/qa/autonomous_mp.mjs [http://localhost:5213]
 *      PV_AUTO_PORT (padrão 4360; API em +1) · PV_AUTONOMOUS (padrão 200) · PV_AUTO_HEADFUL=1 abre a janela
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';

const base = process.argv[2] ?? 'http://localhost:5213';
const PORT = Number(process.env.PV_AUTO_PORT ?? 4360);
const N = Number(process.env.PV_AUTONOMOUS ?? 200);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round12';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const procs = [], browsers = [], rooms = [];
const cleanup = async () => {
  await Promise.allSettled(rooms.map((r) => r.leave()));
  await Promise.allSettled(browsers.map((b) => b.close()));
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } }
};
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });
mkdirSync(SHOTS, { recursive: true }); mkdirSync('docs/bench', { recursive: true });

const sup = JSON.parse(readFileSync('public/gameplay/supporters.json', 'utf8'));
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const SP = { x: manifest.spawn.p[0] + 18, z: manifest.spawn.p[1] - 6 };

// ---------------------------------------------------------------- servidor de teste
try { await fetch(`http://127.0.0.1:${PORT + 1}/api/health`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_AUTONOMOUS: String(N) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
procs.push(S);
S.log = [];
S.stdout.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
S.stderr.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !S.log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

const out = { date: new Date().toISOString(), port: PORT, population: N, scenes: {} };
try {
  const b = await puppeteer.launch({ executablePath: chrome, headless: process.env.PV_AUTO_HEADFUL ? false : 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1366, height: 860 } });
  browsers.push(b);
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=16:30&mp=ws://127.0.0.1:${PORT}&name=Qa&spawn=${SP.x.toFixed(1)},${SP.z.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 150000 });
  const E = (fn, a) => p.evaluate(fn, a);
  // observador (SDK): lê o estado sincronizado como qualquer cliente (o que ele vê é o que a jogadora vê)
  const obs = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1, name: 'Observador', bot: true, testSpawn: SP, aoiMax: 48 });
  obs.onMessage('*', () => {});
  rooms.push(obs);
  const people = () => { const a = []; obs.state?.players?.forEach((q, id) => a.push({ id, kind: q.kind, sup: q.sup, x: q.x, z: q.z, vehicle: q.vehicle, speed: q.speed, act: q.act, tag: q.tag, name: q.name })); return a; };
  const autos = () => people().filter((q) => q.kind === 1);
  const tp = async (at) => { obs.send('test_tp', { x: at.x, z: at.z }); await E((a) => window.__pvInv?.send?.('test_tp', a), at).catch(() => {}); await w(2500); };
  const look = (at, h = 9, back = 16) => E((a) => window.__pv.lookFrom(a[0] + a[3] * 0.4, a[2], a[1] + a[3], a[0], 1.0, a[1]), [at.x, at.z, h, back]);
  const shot = async (name, at, h, back) => { if (at) await look(at, h, back); await w(1400); await p.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); await E(() => window.__pv.lookFrom()); };

  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && autos().length < 20) await w(500);
  await w(12000); // deixa as rodas e concentrações se formarem
  const a0 = autos();
  check('autônomos chegam ao cliente pelo MESMO estado (kind 1)', a0.length >= 20, `${a0.length} na vista do observador`);
  check('humanos/bots com kind ≠ 1', people().filter((q) => q.kind !== 1).every((q) => q.kind === 0 || q.kind === 2));
  check('nametag por autônomo (tag 1/2)', a0.every((q) => q.tag === 1 || q.tag === 2), JSON.stringify(a0.slice(0, 6).map((q) => q.tag)));
  const names = a0.map((q) => q.name);
  check('apelidos sem série robótica', !names.some((n) => /^(bot|npc|player)\d*$/i.test(n)) && new Set(names).size === names.length, names.slice(0, 8).join(', '));
  // A — avenida
  await shot('A_avenida_populacao', { x: SP.x - 6, z: SP.z + 4 }, 2.4, -12);
  out.scenes.A = { autos: a0.length };
  // D — roda de conversa: 2–5 parados a ≤ 3 m uns dos outros (espera as rodas se formarem)
  for (let i = 0; i < 40; i++) { const st = autos().filter((q) => q.speed < 0.2 && !q.vehicle); if (st.some((q) => { const n = st.filter((o) => Math.hypot(o.x - q.x, o.z - q.z) < 3).length; return n >= 2 && n <= 5; })) break; await w(1000); }
  const still = autos().filter((q) => q.speed < 0.2 && !q.vehicle);
  let group = null;
  for (const q of still) { const g = still.filter((o) => Math.hypot(o.x - q.x, o.z - q.z) < 3.0); if (g.length >= 2 && g.length <= 5 && (!group || g.length > group.length)) group = g; }
  check('D: roda de conversa visível', !!group, group ? `${group.length} pessoas` : '');
  if (group) { const c = { x: group.reduce((s, q) => s + q.x, 0) / group.length, z: group.reduce((s, q) => s + q.z, 0) / group.length }; await shot('D_grupo_social', c, 2.6, 5.5); out.scenes.D = { n: group.length, c }; }
  // E..H — torcidas (arquivos nomeados pelos ids dos DADOS)
  const letters = ['E', 'F', 'G', 'H'];
  for (let i = 0; i < Math.min(4, sup.groups.length); i++) {
    const s = i + 1, gid = sup.groups[i].id;
    let best = null;
    for (let tries = 0; tries < 3 && !best; tries++) {
      const xs = autos().filter((q) => q.sup === s);
      for (const q of xs) { const n = xs.filter((o) => Math.hypot(o.x - q.x, o.z - q.z) < 12).length; if (!best || n > best.n) best = { x: q.x, z: q.z, n }; }
      if (!best) { const any = autos(); const far = any[Math.floor(Math.random() * any.length)]; if (far) await tp({ x: far.x + 20, z: far.z }); }
    }
    check(`${letters[i]}: torcedores (sup ${s}) na vista`, !!best, best ? `${best.n} juntos` : '');
    if (best) { await tp({ x: best.x + 8, z: best.z + 8 }); await shot(`${letters[i]}_torcedores_${gid}`, best, 3.4, 9); out.scenes[letters[i]] = { sup: s, ...best }; }
  }
  // X — veículos: vai para perto de uma estação/vaga de veículos do mundo e espera alguém montar
  const vs = (manifest.vehicleSpawns ?? []).filter((v) => ['bicycle', 'scooter', 'moto', 'car'].includes(v.kind));
  // vagas perto do eixo da avenida (onde a população anda), com vários veículos juntos
  const ax = manifest.pvAxis;
  const axisD = (x, z) => { let b2 = 1e9; for (let i = 0; i < ax.length - 1; i++) { const [p0, q0] = ax[i], [p1, q1] = ax[i + 1], vx = p1 - p0, vz = q1 - q0, l = vx * vx + vz * vz, t = Math.max(0, Math.min(1, ((x - p0) * vx + (z - q0) * vz) / l)); b2 = Math.min(b2, Math.hypot(x - p0 - vx * t, z - q0 - vz * t)); } return b2; };
  const st = vs.filter((v) => axisD(v.x, v.z) < 35).map((v) => ({ v, n: vs.filter((o) => Math.hypot(o.x - v.x, o.z - v.z) < 30).length })).sort((a, b2) => b2.n - a.n)[0]?.v;
  if (st) await tp({ x: st.x - 4, z: st.z - 6 });
  let rider = null;
  const t1 = Date.now();
  while (Date.now() - t1 < 150000 && !rider) { rider = autos().find((q) => q.vehicle); if (!rider) await w(1000); }
  check('X: autônomo montado em veículo do mundo', !!rider, rider ? `${rider.name} em ${rider.vehicle}` : 'nenhum em 90 s');
  if (rider) { await tp({ x: rider.x + 10, z: rider.z + 6 }); const r2 = autos().find((q) => q.id === rider.id) ?? rider; await shot('X_veiculos_autonomos', r2, 3, 9); out.scenes.X = { vehicle: rider.vehicle }; }
  // Y — visão aérea
  await tp(SP);
  await shot('Y_visao_aerea', SP, 70, 60);
  out.scenes.Y = { autos: autos().length };
  check('sem erros de página', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  check('roteiro', false, String(e?.stack ?? e));
} finally {
  out.results = results;
  writeFileSync('docs/bench/round12_autonomous_qa.json', JSON.stringify(out, null, 2) + '\n');
  await cleanup();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} ok`);
  process.exit(bad.length ? 1 : 0);
}
