/**
 * Rodada 10 — TORCIDAS no multiplayer real: servidor de teste (PV_TEST=1, banco em memória) com o "Encontro das
 * torcidas" DOS DADOS (public/events/manifestacao.json) começando agora, navegador (jogadora com a camisa da torcida) +
 * bots do SDK (outras torcidas, `sup` na entrada) e as concentrações de NPCs simulados (RallyCrowd) nas cores.
 * Capturas em docs/screenshots/round10/: A_selecao_torcidas (desktop e celular), F_concentracao_torcidas, P_evento_torcida,
 * Q_multidao, Y_minimapa; resumo em docs/bench/round10_supporters.json.
 * uso: PV_API=http://127.0.0.1:3151 npx vite --port 5181 --strictPort  →  node tools/qa/supporters_mp.mjs [http://localhost:5181]
 *      PV_SUP_PORT (padrão 3150; usa 3150 e a API em 3151)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';

const base = process.argv[2] ?? 'http://localhost:5181';
const PORT = Number(process.env.PV_SUP_PORT ?? 3150);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round10';
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

// ---------------------------------------------------------------- geometria (mesma conta de src/world/zones.ts)
const axis = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
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
const P = (at) => ('x' in at ? { x: at.x, z: at.z } : pointOnAxis(at.t, at.side ?? 0));

// ---------------------------------------------------------------- dados
const SUP = JSON.parse(readFileSync('public/gameplay/supporters.json', 'utf8'));
const ev = JSON.parse(readFileSync('public/events/manifestacao.json', 'utf8'));
const def = ev.agenda.find((d) => d.format === 'torcida');
const agenda = [{ ...def, recurrence: { everyMin: 120, offsetMin: 0.25, registrationMin: 0.2, startingS: 3, durationMin: 25 } }];
writeFileSync(`${TMP}/agenda_sup.json`, JSON.stringify(agenda));
const pts = def.supporters.points.map((p) => ({ ...p, ...P(p.at), g: SUP.groups.find((g) => g.id === p.group) }));
const meet = P(def.supporters.meet.at);

// ---------------------------------------------------------------- servidor
try { await fetch(`http://127.0.0.1:${PORT + 1}/api/health`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_EVENT: 'manifestacao', PV_AGENDA_FILE: `../${TMP}/agenda_sup.json`, PV_AGENDA_EPOCH: 'now' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
procs.push(S);
S.log = [];
S.stdout.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
S.stderr.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !S.log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

const out = { date: new Date().toISOString(), port: PORT };
try {
  // ---------------------------------------------------------------- A: escolha de torcida (desktop e celular)
  for (const [name, vp] of [['A_selecao_torcidas', { width: 1366, height: 860 }], ['A_selecao_torcidas_celular', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: vp });
    browsers.push(b);
    const p = await b.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${base}/?mp=ws://127.0.0.1:${PORT}`);
    await p.waitForSelector('#btn-supporter', { visible: true, timeout: 60000 });
    await w(800);
    await p.click('#btn-supporter');
    await p.waitForSelector('.sup-card', { visible: true });
    const n = await p.$$eval('.sup-card', (c) => c.length);
    await p.click('.sup-card:nth-child(3)');
    await w(400);
    await p.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86, fullPage: vp.isMobile });
    check(`${name}: 4 torcidas + neutro`, n === 5, `${n} cartões, erros ${errs.length}`);
    // confirma (visitante: só a sessão) e volta à home com o rótulo novo
    await p.click('#s-ok');
    await w(600);
    const chip = await p.$eval('#btn-supporter-label', (e) => e.textContent);
    check(`${name}: escolha local da sessão`, /TORCIDA: /.test(chip ?? ''), chip);
    await b.close(); browsers.splice(browsers.indexOf(b), 1);
  }

  // ---------------------------------------------------------------- bots: uma pessoa por torcida + duas na 1ª
  const APP = { body: 'homem', skin: 0x9a6b4f, hair: 0x1d1714, top: 0x3a5f8a, bottom: 0x2c3a52, shoes: 0xe8e8e2 };
  const bots = [];
  const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'pong', 'chat_hello', 'chat', 'chat_mutes', 'presence', 'spawn', 'action', 'denied', 'evt_pts', 'prog', 'prog_ev', 'ads', 'evt_done', 'evt_result'];
  const bodies = ['mulher', 'idoso', 'idosa', 'homem', 'mulher'];
  const plan = [...pts.map((q, i) => ({ q, i })), { q: pts[0], i: 4 }];
  for (const { q, i } of plan) {
    const at = { x: q.x + Math.cos(i * 2.1) * 3, z: q.z + Math.sin(i * 2.1) * 3 };
    const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, body: bodies[i], name: `Torcedor${i}`, bot: true, testSpawn: at, topStyle: 'camiseta', shirtDesign: q.g.clothingSet.shirtDesign, sup: q.group });
    rooms.push(room);
    const bt = { room, msgs: {} };
    for (const t of QUIET) room.onMessage(t, () => {});
    for (const t of ['agenda', 'evt_res']) room.onMessage(t, (m) => { (bt.msgs[t] ??= []).push(m); });
    room.onMessage('*', () => {});
    bots.push(bt);
  }
  await w(800);
  const sups = bots.map((b) => b.room.state?.players?.get(b.room.sessionId)?.sup);
  check('sup na rede (bots sem conta escolhem pela entrada)', sups.join(',') === '1,2,3,4,1', sups.join(','));

  // ---------------------------------------------------------------- navegador: jogadora da 1ª torcida
  const fla = pts[0];
  const spawnAt = { x: fla.x + (meet.x - fla.x) * 0.35, z: fla.z + (meet.z - fla.z) * 0.35 };
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1366, height: 800 } });
  browsers.push(b);
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=10:30&mp=ws://127.0.0.1:${PORT}&name=Ana&sup=${fla.group}&spawn=${spawnAt.x.toFixed(1)},${spawnAt.z.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvEvents', { timeout: 150000 });
  const E = (fn, ...a) => p.evaluate(fn, ...a);
  await E((s) => window.__pv.setAppearance({ body: 'mulher', skin: 0xc68b62, hair: 0x2b1c12, top: 0x141414, bottom: 0xffffff, shoes: 0x111111, topStyle: 'camiseta', shirtDesign: s }), fla.g.clothingSet.shirtDesign);
  await E(() => window.__pv.peds(30));
  // espera ACTIVE e inscreve (navegador e bots)
  let inst = null;
  for (let i = 0; i < 120 && !inst; i++) { const a = (await E(() => window.__pvEvents.info().agenda)).find((e) => e.id === def.id && (e.state === 'REGISTRATION' || e.state === 'STARTING' || e.state === 'ACTIVE')); inst = a?.inst ?? null; if (!inst) await w(500); }
  check('encontro de torcidas na agenda', !!inst, inst ?? '');
  await E((i) => window.__pvEvents.join(i), inst);
  for (const bt of bots) bt.room.send('evt_join', { inst });
  for (let i = 0; i < 80; i++) { const a = (await E(() => window.__pvEvents.info().agenda)).find((e) => e.inst === inst); if (a?.state === 'ACTIVE') break; await w(500); }
  await w(4000);
  const info = await E(() => window.__pvEvents.info());
  const supPts = info.points.filter((q) => q.sup);
  check('4 concentrações de torcida (evt_pts com sup)', supPts.length === 4, supPts.map((q) => `${q.label}@${q.sup}`).join(' '));
  const rc = await E(() => window.__pv.rallyCrowd());
  out.rallyCrowd = { members: rc.members, submitted: rc.submitted, skinned: rc.skinned, points: rc.points };
  check('NPCs simulados nas concentrações', rc.members > 60, `${rc.members} membros`);
  const mp = await (await fetch(`http://127.0.0.1:${PORT + 1}/api/metrics/public`)).json();
  out.metrics = mp;
  check('NPCs fora da contagem de jogadores', mp.playersOnline === 1 && mp.testBots === bots.length, JSON.stringify({ playersOnline: mp.playersOnline, testBots: mp.testBots }));

  // ---------------------------------------------------------------- capturas
  const look = (from, to) => (from ? E((a) => window.__pv.lookFrom(...a), [from.x, from.y, from.z, to.x, to.y, to.z]) : E(() => window.__pv.lookFrom()));
  // F: concentração da 1ª torcida de perto (do meio da avenida, um pouco à frente)
  const dir = { x: meet.x - fla.x, z: meet.z - fla.z }, dl = Math.hypot(dir.x, dir.z);
  const cF = pointOnAxis(def.supporters.points[0].at.t + 0.012, 1);
  await look({ x: cF.x, y: 4.2, z: cF.z }, { x: fla.x, y: 1.1, z: fla.z });
  await w(3000);
  await p.screenshot({ path: `${SHOTS}/F_concentracao_torcidas.jpg`, type: 'jpeg', quality: 86 });
  // Q: as quatro concentrações e o encontro, do alto e de lado
  const mid = pointOnAxis(def.supporters.meet.at.t, 0), ax = { x: Math.sin(mid.heading), z: Math.cos(mid.heading) };
  await look({ x: mid.x - ax.z * 34 - ax.x * 30, y: 26, z: mid.z + ax.x * 34 - ax.z * 30 }, { x: mid.x, y: 0, z: mid.z });
  await w(3000);
  await p.screenshot({ path: `${SHOTS}/Q_multidao.jpg`, type: 'jpeg', quality: 86 });
  out.render = await E(() => { const m = window.__pv.metrics(); return { calls: m.calls, triangles: m.triangles, textures: m.textures, geometries: m.geometries, fps: m.fps }; });
  // P: a jogadora inscrita, câmera de jogo atrás dela, painel do evento
  await look();
  await E((a) => window.__pv.walkTo(a[0], a[1], false), [fla.x + 2, fla.z + 1]);
  await w(5000);
  const h = Math.atan2(fla.x - spawnAt.x, fla.z - spawnAt.z);
  await E((y) => window.__pv.camera(y, 0.28, 6.5), h + Math.PI - 0.6);
  // Y: minimapa expandido com os marcadores agregados das concentrações
  await E(() => window.__pv.toggleMap());
  await w(1500);
  await p.screenshot({ path: `${SHOTS}/Y_minimapa.jpg`, type: 'jpeg', quality: 86 });
  await E(() => window.__pv.toggleMap());
  // P: a jogadora inscrita (camisa da torcida), HUD com o evento acontecendo
  await w(2000);
  await p.screenshot({ path: `${SHOTS}/P_evento_torcida.jpg`, type: 'jpeg', quality: 86 });
  const sup = await E(() => { const n = window.__pv.mp(); return n?.session; });
  check('navegador sem erros', !errs.length, errs.slice(0, 3).join(' | '));
  out.session = !!sup;
} catch (e) {
  check('execução', false, String(e?.stack ?? e));
} finally {
  out.results = results;
  writeFileSync('docs/bench/round10_supporters.json', JSON.stringify(out, null, 2));
  await cleanup();
  if (results.some((r) => !r.ok)) { console.log(S.log.slice(-15).join('\n')); process.exitCode = 1; }
}
