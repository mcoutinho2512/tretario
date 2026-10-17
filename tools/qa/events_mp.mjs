/**
 * Rodada 9 — EVENTOS AGENDADOS no multiplayer real: dois servidores de teste (PV_TEST=1) com a agenda DOS DADOS
 * (public/events) e horários encurtados (PV_AGENDA_FILE + PV_AGENDA_EPOCH), navegadores (um por cliente) + bots do SDK.
 *   S1 manifestacao  caminhada Central → Campo de Santana (líder virtual; P a pé + bots acompanham; espectador aéreo vê
 *                    as células de ambiente andarem), corrida de bicicleta (A no navegador + bot B, rota real da Cidade
 *                    Nova), corrida de patinete (bot C; A acompanha com evt_watch)
 *   S2 classico      confronto entre DUAS torcidas fictícias (G no navegador + bots): área, derrubada, retorno protegido
 * Capturas reais em docs/screenshots/round9/ (Q, R, S, T, W, X) e resumo em docs/bench/round9_events.json.
 * uso: node tools/qa/events_mp.mjs [baseUrl]   (vite: PV_API=http://127.0.0.1:2931 npx vite --port 5304 --strictPort)
 *      PV_EVT_PORT (padrão 2990; usa 2990–2993)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';

const base = process.argv[2] ?? 'http://localhost:5304';
const PORT1 = Number(process.env.PV_EVT_PORT ?? 2990), PORT2 = PORT1 + 2;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round9';
const TMP = 'screenshots/tmp';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const procs = [], browsers = [], rooms = [];
const cleanup = async () => {
  await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(2000)]);
  await Promise.allSettled(browsers.map((b) => b.close()));
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } }
};
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });
mkdirSync(SHOTS, { recursive: true }); mkdirSync(TMP, { recursive: true }); mkdirSync('docs/bench', { recursive: true });

// ---------------------------------------------------------------- geometria (mesmas funções do jogo: src/world/zones.ts)
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const axis = manifest.pvAxis;
const SEG = []; let LEN = 0;
for (let i = 0; i < axis.length - 1; i++) { const l = Math.hypot(axis[i + 1][0] - axis[i][0], axis[i + 1][1] - axis[i][1]); SEG.push(l); LEN += l; }
function pointOnAxis(t, side = 0) {
  let want = Math.max(0, Math.min(1, t)) * LEN;
  for (let i = 0; i < SEG.length; i++) {
    if (want <= SEG[i] || i === SEG.length - 1) {
      const [ax, az] = axis[i], [bx, bz] = axis[i + 1], u = SEG[i] ? Math.min(1, want / SEG[i]) : 0, dx = (bx - ax) / (SEG[i] || 1), dz = (bz - az) / (SEG[i] || 1);
      return { x: ax + (bx - ax) * u - dz * side, z: az + (bz - az) * u + dx * side, heading: Math.atan2(dx, dz) };
    }
    want -= SEG[i];
  }
  return { x: axis[0][0], z: axis[0][1], heading: 0 };
}
function tOf(x, z) {
  let best = { t: 0, d: Infinity }, acc = 0;
  for (let i = 0; i < axis.length - 1; i++) {
    const [ax, az] = axis[i], [bx, bz] = axis[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * u - x, az + dz * u - z);
    if (d < best.d) best = { t: (acc + SEG[i] * u) / LEN, d };
    acc += SEG[i];
  }
  return best;
}
const P = (at) => ('x' in at ? { x: at.x, z: at.z } : pointOnAxis(at.t, at.side ?? 0));
/** caminho denso em (t, lado) entre pontos, com meia-volta suave (semicírculo) quando o sentido inverte */
function racePath(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot((b.t - a.t) * LEN, (b.side ?? 0) - (a.side ?? 0)) / 6));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) { const u = k / n; out.push(pointOnAxis(a.t + (b.t - a.t) * u, (a.side ?? 0) + ((b.side ?? 0) - (a.side ?? 0)) * u)); }
  }
  return out.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
}
/** meia-volta: de (t0, +s) a (t0, −s) por um semicírculo além de t0 (dir = +1 para leste) */
const turn = (t0, s, dir) => Array.from({ length: 7 }, (_, i) => { const f = ((i + 1) / 8) * Math.PI; return { t: t0 + (dir * s * Math.sin(f)) / LEN, side: s * Math.cos(f) }; });

// ---------------------------------------------------------------- agenda de QA: a dos DADOS, horários encurtados
const man = JSON.parse(readFileSync('public/events/manifestacao.json', 'utf8'));
const cla = JSON.parse(readFileSync('public/events/classico-exemplo.json', 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const walkD = clone(man.agenda.find((d) => d.format === 'caminhada'));
walkD.recurrence = { everyMin: 120, offsetMin: 0, registrationMin: 2.4, startingS: 10, durationMin: 2.6 };
walkD.walk.route = [...walkD.walk.route.filter((c) => c.at.t <= 0.39), { id: 'qa-fim', at: { t: 0.41, side: 0 }, radius: 20 }];
walkD.walk.paceMs = 3;
const bikeD = clone(man.agenda.find((d) => d.race?.vehicle === 'bicycle'));
bikeD.recurrence = { everyMin: 120, offsetMin: 0.25, registrationMin: 2.5, startingS: 10, durationMin: 4 };
bikeD.race.laps = 1; bikeD.race.timeLimitS = 220;
const scootD = clone(man.agenda.find((d) => d.race?.vehicle === 'scooter'));
scootD.recurrence = { everyMin: 120, offsetMin: 3.6, registrationMin: 2.2, startingS: 10, durationMin: 3 };
scootD.race.laps = 1; scootD.race.timeLimitS = 170;
const clashD = clone(cla.agenda.find((d) => d.format === 'confronto_grupos'));
clashD.recurrence = { everyMin: 120, offsetMin: 0, registrationMin: 1.6, startingS: 8, durationMin: 1.4 };
const T0 = Date.now();
const E1 = Math.ceil((T0 + 150_000) / 1000) * 1000, E2 = Math.ceil((T0 + 210_000) / 1000) * 1000;
writeFileSync(`${TMP}/agenda_s1.json`, JSON.stringify([walkD, bikeD, scootD]));
writeFileSync(`${TMP}/agenda_s2.json`, JSON.stringify([clashD]));

// ---------------------------------------------------------------- servidores
function server(port, event, file, epoch) {
  const s = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(port), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_EVENT: event, PV_AGENDA_FILE: `../${file}`, PV_AGENDA_EPOCH: String(epoch) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  procs.push(s);
  s.log = [];
  s.stdout.on('data', (d) => s.log.push(...d.toString().split('\n').filter(Boolean)));
  s.stderr.on('data', (d) => s.log.push(...d.toString().split('\n').filter(Boolean)));
  return s;
}
for (const p of [PORT1, PORT2]) { try { await fetch(`http://127.0.0.1:${p + 1}/metrics`); console.error(`porta ${p} ocupada`); process.exit(2); } catch { /* livre */ } }
const S1 = server(PORT1, 'manifestacao', `${TMP}/agenda_s1.json`, E1), S2 = server(PORT2, 'classico-exemplo', `${TMP}/agenda_s2.json`, E2);
for (let i = 0; i < 150 && !(S1.log.some((l) => l.includes('[pv3d-server]')) && S2.log.some((l) => l.includes('[pv3d-server]'))); i++) await w(200);

// ---------------------------------------------------------------- bots (SDK, mensagens cruas — como um cliente)
const APP = { body: 'homem', skin: 0x9a6b4f, hair: 0x1d1714, top: 0x3a5f8a, bottom: 0x2c3a52, shoes: 0xe8e8e2 };
const REC = ['agenda', 'evt_res', 'race', 'race_def', 'evt_result', 'evt_pts', 'walk', 'clash', 'evt_done', 'enter_ok', 'enter_denied', 'knock', 'push_denied', 'mode_ok', 'mode_denied'];
const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'pong', 'chat_hello', 'chat', 'chat_mutes', 'presence', 'spawn', 'race_board', 'exit_ok', 'action', 'denied'];
async function bot(port, name, spawnAt, o = {}) {
  const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('presidente_vargas', { ...APP, name, bot: true, testSpawn: spawnAt, ...o });
  rooms.push(room);
  const b = { name, room, seq: 0, x: spawnAt.x, z: spawnAt.z, h: 0, msgs: {}, corrections: 0 };
  for (const t of QUIET) room.onMessage(t, () => {});
  for (const t of REC) room.onMessage(t, (m) => { (b.msgs[t] ??= []).push(m); if (b.msgs[t].length > 400) b.msgs[t].splice(0, 200); });
  room.onMessage('correct', (c) => { b.corrections++; b.x = c[0]; b.z = c[2]; });
  b.last = (t) => b.msgs[t]?.at(-1);
  b.move = (x, z, speed, loco) => { b.h = Math.atan2(x - b.x, z - b.z) || b.h; b.x = x; b.z = z; room.send('move', [Math.round(x * 100) / 100, 0, Math.round(z * 100) / 100, Math.round(b.h * 1000) / 1000, speed, loco, ++b.seq]); };
  /** anda/dirige pelo caminho a v m/s (um movimento a cada 100 ms) */
  b.drive = async (path, v, loco = 4, stop = () => false) => {
    for (const q of path) {
      for (;;) {
        if (stop()) return;
        const d = Math.hypot(q.x - b.x, q.z - b.z);
        if (d < 0.05) break;
        const st = Math.min(d, v * 0.1);
        b.move(b.x + ((q.x - b.x) / d) * st, b.z + ((q.z - b.z) / d) * st, v, loco);
        await w(100);
      }
    }
  };
  b.enter = async (id) => { room.send('enter', { id, seq: b.seq }); for (let i = 0; i < 40 && !b.msgs.enter_ok?.length; i++) await w(100); const e = b.msgs.enter_ok?.at(-1); if (e) { b.x = e.x; b.z = e.z; } return !!e; };
  b.agenda = () => b.last('agenda')?.list ?? [];
  return b;
}
const entryOf = (list, id) => list.find((e) => e.id === id);
const until = async (fn, ms = 10000, step = 200) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(step); } return null; };

// ---------------------------------------------------------------- navegadores (um por cliente)
async function open(name, port, q = '', role = 'player', vp = { width: 1280, height: 720 }) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: vp });
  browsers.push(browser);
  const p = await browser.newPage();
  p.errors = [];
  p.on('pageerror', (e) => { p.errors.push(e.message); console.log(`[${name}] ERR`, e.message); });
  if (role === 'spectator') {
    await p.goto(`${base}/?quality=low&time=10:30&mp=ws://127.0.0.1:${port}${q}`);
    await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 90000 });
    await p.evaluate(() => { void window.__pvLaunch({ role: 'spectator' }); });
  } else await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${port}&name=${name}${q}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvEvents', { timeout: 150000 });
  p.name = name;
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const info = (p) => ev(p, () => window.__pvEvents.info());
const shot = (p, f) => p.screenshot({ path: `${SHOTS}/${f}.jpg`, type: 'jpeg', quality: 86 });
const keyDown = (p, code) => ev(p, (c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
const keyUp = (p, code) => ev(p, (c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), code);
const me = (p) => ev(p, () => window.__pv.metrics().player);
/** rumo do jogador (atan2(dx, dz)) por duas amostras de posição */
async function headingOf(p, ms = 400) { const a = await me(p); await w(ms); const b = await me(p); return Math.hypot(b.x - a.x, b.z - a.z) > 0.2 ? Math.atan2(b.x - a.x, b.z - a.z) : null; }
/** dirige o veículo do navegador pelo caminho: W (e Shift) segurados, mira no próximo ponto a cada 100 ms */
async function browserDrive(p, path, { boost = true, reach = 3, stop = () => false, maxMs = 240000 } = {}) {
  await keyDown(p, 'KeyW'); if (boost) await keyDown(p, 'ShiftLeft');
  const t0 = Date.now();
  let i = 0;
  try {
    while (i < path.length && Date.now() - t0 < maxMs && !(await stop())) {
      const pos = await me(p);
      if (Math.hypot(path[i].x - pos.x, path[i].z - pos.z) < reach) { i++; continue; }
      await ev(p, (x, z) => window.__pvEvents.qaAim(x, z), path[i].x, path[i].z);
      await w(80);
    }
  } finally { await keyUp(p, 'KeyW'); await keyUp(p, 'ShiftLeft'); }
  return i >= path.length;
}

const out = { date: new Date().toISOString(), ports: [PORT1, PORT2], epochs: { s1: new Date(E1).toISOString(), s2: new Date(E2).toISOString() } };
const st14 = manifest.vehicleSpawns.filter((s) => s.id.startsWith('st14_'));
const bikeSt = st14.filter((s) => s.kind === 'bicycle'), scootSt = st14.find((s) => s.kind === 'scooter');
const CEN = pointOnAxis(0.28, 0);
const CS = pointOnAxis(0.385, 0);

// clientes: o 1º bot cria a sala (o relógio da agenda já está fixado por PV_AGENDA_EPOCH)
const B = await bot(PORT1, 'Bia', { x: bikeSt[1].x + 1, z: bikeSt[1].z - 1.5 });
const C = await bot(PORT1, 'Caio', { x: scootSt.x + 1, z: scootSt.z - 1.5 });
const [A, Pw, Sp, G] = await Promise.all([
  open('Ana', PORT1, `&spawn=${(bikeSt[0].x - 1).toFixed(1)},${(bikeSt[0].z + 1.2).toFixed(1)}`),
  open('Paulo', PORT1, `&spawn=${(CEN.x + 6).toFixed(1)},${(CEN.z + 4).toFixed(1)}`),
  open('Espectador', PORT1, '', 'spectator'),
  open('Gil', PORT2, `&spawn=${(CS.x + 3).toFixed(1)},${(CS.z - 2).toFixed(1)}&testGroup=mare-vermelha`),
]);
out.loadedAtS = +((Date.now() - T0) / 1000).toFixed(1);
console.log(`navegadores prontos em ${out.loadedAtS} s (caminhada/bicicleta em ${((E1 - Date.now()) / 1000).toFixed(0)} s, confronto em ${((E2 - Date.now()) / 1000).toFixed(0)} s)`);
await ev(G, () => window.__pv.setAppearance({ body: 'homem', skin: 0x8d5a3b, hair: 0x1d1714, top: 0xb0101f, bottom: 0x111111, shoes: 0xe8e8e2, topStyle: 'camiseta', shirtDesign: 205 }));
for (const p of [A, Pw]) await ev(p, () => window.__pv.peds(40)); // pedestres locais modestos (4 navegadores na mesma máquina)

// ---------------------------------------------------------------- agenda visível
{
  const ag = await until(async () => { const l = (await info(A)).agenda; return l.length >= 3 ? l : null; }, 15000);
  check('agenda chega ao entrar (jogador): caminhada, bicicleta e patinete com estado e horário do servidor', ag && ['caminhada-central-candelaria', 'corrida-bicicleta-cidade-nova', 'corrida-patinete-cidade-nova'].every((id) => entryOf(ag, id)), ag?.map((e) => `${e.id}:${e.state}`).join(' '));
  const sa = (await until(async () => { const l = (await info(Sp)).agenda; return l.length ? l : null; }, 8000)) ?? [];
  check('agenda chega ao espectador (mesma lista)', sa.length === ag?.length, `${sa.length} itens`);
  const ga = await until(async () => (await info(G)).agenda.find((e) => e.format === 'confronto_grupos'), 15000);
  check('agenda do clássico: confronto entre grupos', !!ga, ga ? `${ga.name} ${ga.state}` : '');
  out.agenda = ag;
}

// ---------------------------------------------------------------- tarefas em paralelo
async function walkTask() {
  const ws = [];
  for (let i = 0; i < 6; i++) ws.push(await bot(PORT1, `Cam${i}`, { x: CEN.x + 8 * Math.cos(i), z: CEN.z + 8 * Math.sin(i) }));
  const ent = () => entryOf(ws[0].agenda(), walkD.id);
  await until(() => ent()?.state === 'REGISTRATION', 60000);
  const inst = ent().inst;
  for (const b of ws) b.room.send('evt_join', { inst });
  await ev(Pw, (i) => window.__pvEvents.join(i), inst);
  await until(async () => (await info(Pw)).lastRes?.ok, 5000);
  check('caminhada: P (navegador) e 6 bots inscritos', (await info(Pw)).lastRes?.ok && ws.every((b) => b.last('evt_res')?.ok), `count ${ent()?.count}`);
  // segue o líder (evt_pts — mesma posição da concentração que todos recebem)
  let walking = true;
  const leader = (b) => b.last('evt_pts')?.list.find((p) => p.inst === inst);
  const follow = ws.map((b, i) => (async () => {
    while (walking) {
      const L = leader(b);
      if (L) { const a = i * 1.1, r = 1.5 + (i % 3); /* perto do eixo: o caminho do líder é livre de paredes */ const tgt = { x: L.x + Math.cos(a) * r, z: L.z + Math.sin(a) * r }; const d = Math.hypot(tgt.x - b.x, tgt.z - b.z); if (d > 0.5) { const st = Math.min(d, 4.2 * 0.1); b.move(b.x + ((tgt.x - b.x) / d) * st, b.z + ((tgt.z - b.z) / d) * st, 4.2, 2); } }
      await w(100);
    }
  })());
  const pFollow = (async () => { while (walking) { const L = (await info(Pw)).points.find((p) => p.inst === inst); if (L) await ev(Pw, (x, z) => window.__pv.walkTo(x, z, true), L.x + 2, L.z - 1); await w(400); } })();
  await until(() => ent()?.state === 'ACTIVE', 200000, 500);
  const tA = Date.now();
  // NPCs simulados da concentração no cliente (RallyCrowd) ao redor do ponto de evento
  const rc = await ev(Pw, () => window.__pv.rallyCrowd());
  const evPt = rc.rally.find((r) => r.id.startsWith('evt_walk'));
  check('caminhada: concentração de evento no cliente (RallyPoint "event") com NPCs simulados', !!evPt && rc.members > 0 && rc.submitted > 0, `ponto ${evPt?.id} · NPCs ${rc.members} (desenhados ${rc.submitted})`);
  // espectador no alto sobre o trajeto
  const mid = pointOnAxis(0.35);
  await ev(Sp, (a) => window.__pv.specPose(...a), [mid.x, mid.z, mid.heading, 1.2, 420, true]);
  const cellsAt = async () => (await ev(Sp, () => window.__pv.specCells()));
  const c0 = await until(async () => { const c = await cellsAt(); return c?.tier === 'AGGREGATE' && c.list.length > 5 ? c : null; }, 15000);
  const l0 = leader(ws[0]);
  await w(28000);
  { // câmera livre sobre o meio da avenida, atrás e acima da concentração, olhando para o líder
    const L = leader(ws[0]), t = tOf(L.x, L.z).t, back = pointOnAxis(t - 26 / LEN, -6);
    await ev(Pw, (a) => window.__pv.lookFrom(...a), [back.x, 11, back.z, L.x, 1.2, L.z]);
  }
  await w(1500);
  await shot(Pw, 'Q_caminhada_central_candelaria');
  await ev(Pw, () => window.__pv.lookFrom());
  await w(8000);
  await shot(Sp, 'R_caminhada_aerea');
  await ev(Pw, () => window.__pv.toggleMap());
  await w(1500);
  await shot(Pw, 'X_minimapa_evento');
  await ev(Pw, () => window.__pv.toggleMap());
  await until(() => Date.now() - tA > 62000, 70000, 500);
  const c1 = await cellsAt();
  const l1 = leader(ws[0]);
  // deslocamento da concentração vista do alto: centro das células que GANHARAM ambiente × das que perderam
  const key = (c) => `${c.cx},${c.cz}`;
  const m0 = new Map(c0.list.map((c) => [key(c), c])), m1 = new Map(c1.list.map((c) => [key(c), c]));
  let gx = 0, gz = 0, gn = 0, lx = 0, lz = 0, ln = 0;
  for (const k of new Set([...m0.keys(), ...m1.keys()])) {
    const d = (m1.get(k)?.env ?? 0) - (m0.get(k)?.env ?? 0), [cx, cz] = k.split(',').map(Number), x = (cx + 0.5) * 40, z = (cz + 0.5) * 40;
    if (d > 0) { gx += x * d; gz += z * d; gn += d; } else if (d < 0) { lx += x * -d; lz += z * -d; ln += -d; }
  }
  const gain = gn ? { x: gx / gn, z: gz / gn } : null, loss = ln ? { x: lx / ln, z: lz / ln } : null;
  const shift = gain && loss ? Math.hypot(gain.x - loss.x, gain.z - loss.z) : 0;
  out.walkAerial = { t0: c0 && { cells: c0.cells, env: c0.env, digest: c0.digest }, t1: { cells: c1.cells, env: c1.env, digest: c1.digest }, leader0: l0 && [l0.x, l0.z], leader1: l1 && [l1.x, l1.z], gain, loss, shiftM: Math.round(shift), movedEnv: gn };
  check('espectador aéreo: a concentração (ambiente das células) ANDA com a caminhada rumo à Candelária', c0 && shift > 100 && gain && tOf(gain.x, gain.z).t > tOf(loss.x, loss.z).t, `deslocamento ${Math.round(shift)} m (${gn} pessoas de ambiente mudaram de célula) · líder ${l0 && Math.round(Math.hypot(l1.x - l0.x, l1.z - l0.z))} m`);
  check('espectador aéreo: tudo em AGGREGATE, sem entidades por jogador', c1.tier === 'AGGREGATE' && c1.impostors?.drawn >= 0, `${c1.cells} células`);
  // participação
  const done = await until(async () => (await info(Pw)).done.includes(inst), 40000, 500);
  check('caminhada: P concluiu (servidor emitiu event_complete → evt_done) por acompanhar a concentração', !!done, JSON.stringify((await info(Pw)).walk));
  check('caminhada: bots que acompanharam também concluíram', ws.filter((b) => b.msgs.evt_done?.some((m) => m.inst === inst)).length >= 5, `${ws.filter((b) => b.msgs.evt_done).length}/6`);
  await until(() => ent()?.state === 'FINISHED', 90000, 500);
  walking = false;
  await Promise.all([...follow, pFollow]);
  check('caminhada: líder chegou ao fim da rota e a instância terminou (FINISHED)', ent()?.state === 'FINISHED', JSON.stringify(ent()));
}

async function raceTask() {
  // A (navegador) monta na bicicleta da estação; B (bot) na vizinha; C a pé tenta se inscrever
  await ev(A, (id) => window.__pv.rawEnter(id), bikeSt[0].id);
  const okA = await until(async () => (await ev(A, () => window.__pv.riding())) === 'bicycle', 8000);
  await B.enter(bikeSt[1].id);
  check('bicicleta: A e B montados (estado do servidor)', okA && B.msgs.enter_ok?.length, '');
  const ent = () => entryOf(B.agenda(), bikeD.id);
  await until(() => ent()?.state === 'REGISTRATION', 60000);
  const inst = ent().inst;
  C.room.send('evt_join', { inst });
  await until(() => C.msgs.evt_res?.length, 4000);
  check('bicicleta: inscrição a pé negada (veiculo)', C.msgs.evt_res?.[0]?.r === 'veiculo', JSON.stringify(C.msgs.evt_res?.[0]));
  await ev(A, (i) => window.__pvEvents.join(i), inst);
  B.room.send('evt_join', { inst });
  await until(async () => (await info(A)).lastRes && B.msgs.evt_res?.length, 5000);
  const ia = await info(A);
  check('bicicleta: A e B inscritos; A recebe a rota (race_def) e desenha os marcadores', ia.lastRes?.ok && B.msgs.evt_res[0].ok && ia.raceDef?.cps === bikeD.race.checkpoints.length && ia.markers >= 2, `cps ${ia.raceDef?.cps} · marcadores ${ia.markers}`);
  // largada: A dirige até a linha (rota real: pistas laterais da Cidade Nova)
  const S = bikeD.race.start.at, cps = bikeD.race.checkpoints.map((c) => c.at);
  const toStart = racePath([{ t: 0.131, side: 18 }, { t: 0.13, side: 10 }, { t: 0.1, side: 10 }, { t: 0.05, side: 9 }, { t: 0.036, side: 4 }, { t: 0.03, side: 0 }]);
  await Promise.all([browserDrive(A, toStart, { reach: 2.5 }), B.drive(toStart.map((q) => ({ x: q.x + 2, z: q.z - 2 })), 6.5)]);
  await ev(A, (x, z) => window.__pvEvents.qaAim(x, z), P(cps[0]).x, P(cps[0]).z);
  // percurso: S → cps → S, com meias-voltas suaves nas pontas
  const route = racePath([S, ...cps.slice(0, 3), { t: cps[3].t - 10 / LEN, side: 10 }, ...turn(cps[3].t - 10 / LEN, 10, 1), { t: cps[3].t - 10 / LEN, side: -10 }, ...cps.slice(4), { t: S.t + 6 / LEN, side: -5 }, S]);
  out.bikeRouteM = Math.round(route.reduce((a, q, i) => a + (i ? Math.hypot(q.x - route[i - 1].x, q.z - route[i - 1].z) : 0), 0));
  await until(async () => { const r = (await info(A)).race; return r && r.t >= 0; }, 120000, 250);
  const t0 = Date.now();
  check('bicicleta: contagem (STARTING) e largada (ACTIVE) pelo relógio do servidor', A && (await info(A)).race.t >= 0, `t=${(await info(A)).race.t} ms`);
  const shotAt = (async () => { await w(22000); const h = await headingOf(A); await ev(A, (y) => window.__pv.camera(y, 0.3, 9), (h ?? 1.9) - 0.35); await w(500); await shot(A, 'S_corrida_bicicleta'); })();
  const [aDone] = await Promise.all([browserDrive(A, route, { reach: 3.5 }), B.drive(route.map((q) => ({ x: q.x, z: q.z })), 6.9), shotAt]);
  const fa = await until(async () => { const r = (await info(A)).race; return r?.finished ? r : null; }, 10000);
  const fb = B.msgs.race?.find((m) => m.finished);
  check('bicicleta: A (navegador) completou por movimentos reais — checkpoints em ordem até a chegada', aDone && fa?.finished, fa ? `${fa.rank}º · ${(fa.t / 1000).toFixed(1)} s · cp ${fa.cp}` : JSON.stringify((await info(A)).race));
  check('bicicleta: B (bot) completou; tempos plausíveis (≥ rota / teto de velocidade)', fb && fb.t >= (out.bikeRouteM / 7.3) * 1000 * 0.9, fb ? `${fb.rank}º · ${(fb.t / 1000).toFixed(1)} s · rota ${out.bikeRouteM} m` : '');
  const res = await until(async () => (await info(A)).result, 15000);
  check('bicicleta: resultado (evt_result) com posição e tempo do servidor', res?.rows.length === 2 && res.rows.every((r) => r.status === 'ok') && res.rows[0].rank === 1, res?.rows.map((r) => `${r.rank}º ${r.name} ${(r.timeMs / 1000).toFixed(1)} s`).join(' · '));
  out.bike = { route: out.bikeRouteM, a: fa, b: fb, result: res?.rows, wallS: (Date.now() - t0) / 1000 };
}

async function scooterTask() {
  // C monta no patinete e corre; A acompanha (evt_watch) parado à beira da pista com os marcadores
  await C.enter(scootSt.id);
  const ent = () => entryOf(C.agenda(), scootD.id);
  await until(() => ent()?.state === 'REGISTRATION', 120000);
  const inst = ent().inst;
  C.room.send('evt_join', { inst });
  await until(() => C.msgs.evt_res?.some((m) => m.inst === inst), 5000);
  check('patinete: C inscrito montado no patinete (mesmo runner da bicicleta)', C.msgs.evt_res.find((m) => m.inst === inst)?.ok && C.msgs.race_def?.some((m) => m.inst === inst && m.vehicle === 'scooter'), '');
  await ev(A, (i) => window.__pvEvents.watch(i), inst);
  await until(async () => (await info(A)).raceDef?.inst === inst, 5000);
  check('patinete: A acompanha (evt_watch) e vê os marcadores da corrida', (await info(A)).raceDef?.inst === inst && (await info(A)).markers >= 2, `${(await info(A)).markers} marcadores`);
  const S = scootD.race.start.at, cps = scootD.race.checkpoints.map((c) => c.at);
  // A vai para a beira da pista perto do 2º checkpoint e olha para ela
  const spot = racePath([{ t: 0.032, side: 2 }, { t: 0.05, side: 14 }, { t: cps[1].t - 0.004, side: 15 }]);
  await browserDrive(A, spot, { boost: false, reach: 2.5 });
  const look = P(cps[1]);
  await ev(A, (x, z) => window.__pvEvents.qaAim(x, z), look.x, look.z);
  const toStart = racePath([{ t: 0.131, side: 18 }, { t: 0.13, side: 10 }, { t: 0.1, side: 10 }, { t: 0.07, side: 8 }, { t: 0.055, side: 3 }, { t: 0.05, side: 0 }]);
  await C.drive(toStart, 5.4);
  await until(() => C.last('race')?.t >= 0, 150000, 250);
  const route = racePath([S, ...cps.slice(0, 2), { t: cps[2].t - 10 / LEN, side: 10 }, ...turn(cps[2].t - 10 / LEN, 10, 1), { t: cps[2].t - 10 / LEN, side: -10 }, ...cps.slice(3), { t: S.t + 6 / LEN, side: -6 }, S]);
  let shotDone = false;
  const shotTask = (async () => {
    // o espectador (já livre da caminhada) acompanha a corrida e enquadra o checkpoint 2 do chão (camada NEAR)
    await ev(Sp, (i) => window.__pvEvents.watch(i), inst);
    await ev(Sp, (a) => window.__pv.specPose(...a), [look.x, look.z, pointOnAxis(cps[1].t).heading + Math.PI, 0.55, 26, true]);
    await until(async () => Math.hypot(C.x - look.x, C.z - look.z) < 9, 90000, 50);
    await shot(Sp, 'T_corrida_patinete'); shotDone = true;
  })();
  await C.drive(route, 5.6);
  await shotTask;
  const fc = await until(() => C.msgs.race?.find((m) => m.inst === inst && m.finished), 8000);
  check('patinete: C completou por movimentos (checkpoints em ordem, servidor)', !!fc, fc ? `${fc.rank}º · ${(fc.t / 1000).toFixed(1)} s` : JSON.stringify(C.last('race')));
  const res = await until(async () => { const r = (await info(A)).result; return r?.inst === inst ? r : null; }, 20000);
  check('patinete: quem acompanha recebe o resultado', res?.rows?.[0]?.status === 'ok', res?.rows.map((r) => `${r.rank}º ${r.name} ${(r.timeMs / 1000).toFixed(1)} s`).join(' · '));
  out.scooter = { c: fc, result: res?.rows, shot: shotDone };
}

async function clashTask() {
  const at = (t, side) => pointOnAxis(t, side);
  const R1 = await bot(PORT2, 'Rui', at(0.383, -6), { testGroup: 'mare-vermelha', topStyle: 'camiseta', shirtDesign: 205, top: 0xb0101f });
  const T1 = await bot(PORT2, 'Tais', at(0.39, 14), { testGroup: 'onda-tricolor', topStyle: 'camiseta', shirtDesign: 202, top: 0x7a1f2b });
  const T2 = await bot(PORT2, 'Teo', at(0.392, 18), { testGroup: 'onda-tricolor', topStyle: 'camiseta', shirtDesign: 202, top: 0x7a1f2b });
  const N = await bot(PORT2, 'Nina', at(0.38, 20), { testGroup: 'coro-da-diagonal', topStyle: 'camiseta', shirtDesign: 201 });
  const ent = () => entryOf(R1.agenda(), clashD.id);
  await until(() => ent()?.state === 'REGISTRATION', 200000, 500);
  const inst = ent().inst;
  N.room.send('evt_join', { inst });
  for (const b of [R1, T1, T2]) b.room.send('evt_join', { inst });
  await ev(G, (i) => window.__pvEvents.join(i), inst);
  await until(() => N.msgs.evt_res?.length && R1.msgs.evt_res?.length, 5000);
  check('confronto: torcida fora das regras do evento negada (grupo)', N.msgs.evt_res[0].r === 'grupo', JSON.stringify(N.msgs.evt_res[0]));
  check('confronto: 2 + 2 inscritos das duas torcidas permitidas', (await until(async () => (await info(G)).lastRes?.ok, 4000)) && [R1, T1, T2].every((b) => b.msgs.evt_res[0].ok), `count ${ent()?.count}`);
  await until(() => ent()?.state === 'ACTIVE', 120000, 300);
  // G segura a área central sozinho; os outros longe dela
  const H = P(clashD.clash.holdArea.at);
  await ev(G, (x, z) => window.__pv.walkTo(x, z, false), H.x + 1, H.z);
  await w(9000);
  const s1 = (await info(G)).clash;
  check('confronto: só a Maré Vermelha na área → pontua por segurar', s1?.score?.['mare-vermelha'] > 0 && s1?.score?.['onda-tricolor'] === 0 && s1?.hold === 'mare-vermelha', JSON.stringify(s1?.score));
  // T1 entra na área: disputada (ninguém pontua)
  await T1.drive([{ x: H.x - 1.5, z: H.z + 1 }], 4, 2);
  await w(3500);
  const s2 = (await info(G)).clash;
  check('confronto: duas torcidas na área → disputada (hold nulo)', s2?.hold === null, JSON.stringify(s2));
  // derrubada no evento: T1 e R1 aceitam interação (modo K); T1 empurra R1 → +3 para a Onda; R1 volta ao ponto do grupo
  await Promise.all([R1.drive([{ x: H.x - 1.5, z: H.z - 0.4 }], 4, 2), T2.drive([{ x: H.x + 3, z: H.z + 3 }], 4, 2)]);
  await ev(G, (y) => window.__pv.camera(y, 0.32, 10), pointOnAxis(0.385).heading + 2.4);
  await w(1500);
  await shot(G, 'W_evento_entre_grupos');
  R1.room.send('mode', 'interacao'); T1.room.send('mode', 'interacao');
  await w(600);
  T1.move(T1.x, T1.z - 0.05, 0.5, 1); // vira para R1
  await w(200);
  T1.room.send('push', R1.room.sessionId);
  const knocked = await until(() => R1.msgs.knock?.some((k) => k.target === R1.room.sessionId), 4000);
  const ret = await until(() => R1.corrections && Math.hypot(R1.x - P(clashD.clash.respawn[0]).x, R1.z - P(clashD.clash.respawn[0]).z) < 2, 9000);
  const fx = [R1, T2].map((b) => b.room.state.players?.get?.(R1.room.sessionId)?.fx).find((v) => v !== undefined) ?? -1;
  const s3 = (await until(async () => { const c = (await info(G)).clash; return c?.score?.['onda-tricolor'] >= 3 ? c : null; }, 4000)) ?? (await info(G)).clash;
  check('confronto: derrubada entre inscritos pontua para a torcida rival', knocked && s3?.score?.['onda-tricolor'] >= 3, JSON.stringify(s3?.score));
  check('confronto: derrubado volta ao ponto de retorno do grupo, protegido (FX.PROTECTED)', ret && (fx & 2) === 2, `pos ${R1.x.toFixed(1)},${R1.z.toFixed(1)} fx=${fx}`);
  const res = await until(async () => (await info(G)).result, 120000, 500);
  check('confronto: resultado por grupo no fim; participação concluída (evt_done) — nunca recompensa por golpe', res?.score && (await info(G)).done.includes(inst) && [R1, T1, T2].every((b) => b.msgs.evt_done?.length), JSON.stringify(res?.score));
  out.clash = { s1: s1?.score, s2: s2?.hold, s3: s3?.score, result: res?.score, rows: res?.rows };
}

try {
  await Promise.all([walkTask(), (async () => { await raceTask(); await scooterTask(); })(), clashTask()].map((p) => p.catch((e) => { console.error(e); check(`tarefa sem erro: ${e.message}`, false); })));
  for (const p of [A, Pw, Sp, G]) check(`${p.name}: sem erros de página`, !p.errors.length, p.errors.slice(0, 2).join(' | '));
  out.serverLog = [...S1.log, ...S2.log].filter((l) => l.includes('[eventos]') || l.includes('erro') || l.includes('Error')).slice(0, 30);
} finally {
  const n = results.filter((r) => r.ok).length;
  out.results = results;
  writeFileSync('docs/bench/round9_events.json', JSON.stringify(out, null, 1));
  console.log(`\n${n}/${results.length} ${n === results.length ? 'OK' : 'FALHAS'}`);
  await cleanup();
  process.exit(n === results.length ? 0 : 1);
}
