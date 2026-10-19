/**
 * Rodada 12 — MUNDO DINÂMICO no multiplayer real (docs/DYNAMIC_WORLD.md). Servidor de teste (PV_TEST=1, banco em
 * memória) + navegador; cada cena é FORÇADA pelo servidor (`qa_dyn {kind, x, z}`, só PV_TEST) perto da jogadora e
 * filmada quando os sinais (`dyn`) mostram o estado pedido:
 *   Q_concentracao        CONCENTRACAO (núcleo → adesões; HUD "Acontecendo agora" + marcador no minimapa)
 *   R_caminhada           CAMINHADA (centro anda pelo eixo; quem acompanha recebe FOLLOW_EVENT)
 *   S_discussao           DISCUSSAO (TENSÃO: dois gesticulando)
 *   T_pequena_briga       BRIGA (CONFRONTO: empurrão → soco; amigos chegam)
 *   U_multidao_observando BRIGA com observadores (WATCH_FIGHT)
 *   V_briga_generalizada  BRIGA_GENERALIZADA (adesões graduais até GENERALIZADO)
 *   W_pessoas_fugindo     dispersão (AVOID_FIGHT/LEAVE_AREA) — fim do foco
 * Resumo em docs/bench/round12_dynamic_world.json (níveis vistos, participantes/observadores por cena, sinais).
 *
 * ANTES da integração com o sistema de autônomos (AGENTE C) a WorldView é vazia: os focos são "fantasmas" (n = 0) —
 * o roteiro valida o caminho servidor → `dyn`/agenda/evt_pts → cliente e as capturas mostram só HUD/minimapa e o
 * ambiente. DEPOIS da integração, o mesmo roteiro filma os autônomos de verdade (n > 0) sem mudar nada.
 *
 * uso: PV_API=http://127.0.0.1:4521 npx vite --port 5215 --strictPort  →  node tools/qa/dynamic_world_mp.mjs [http://localhost:5215]
 *      PV_DYN_PORT (padrão 4520; usa 4520 e a API em 4521) · PV_DYN_HEADFUL=1 abre a janela
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5215';
const PORT = Number(process.env.PV_DYN_PORT ?? 4520);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round12';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const procs = [], browsers = [];
const cleanup = async () => {
  await Promise.allSettled(browsers.map((b) => b.close()));
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } }
};
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });
mkdirSync(SHOTS, { recursive: true }); mkdirSync('docs/bench', { recursive: true });

// ponto de filmagem: Central do Brasil, no eixo (mesma conta de src/world/zones.ts)
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
const HERE = pointOnAxis(0.2, 6);
const SPOT = (dt, side = 0) => pointOnAxis(0.2 + dt, side);

// ---------------------------------------------------------------- servidor de teste
try { await fetch(`http://127.0.0.1:${PORT + 1}/api/health`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
procs.push(S);
S.log = [];
S.stdout.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
S.stderr.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !S.log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

const out = { date: new Date().toISOString(), port: PORT, scenes: {} };
try {
  const b = await puppeteer.launch({ executablePath: chrome, headless: process.env.PV_DYN_HEADFUL ? false : 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1366, height: 860 } });
  browsers.push(b);
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const warns = []; p.on('console', (m) => { if (/not registered/i.test(m.text())) warns.push(m.text()); });
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=16:30&mp=ws://127.0.0.1:${PORT}&name=Qa&spawn=${HERE.x.toFixed(1)},${HERE.z.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvEvents && window.__pvInv', { timeout: 150000 });
  const E = (fn, a) => p.evaluate(fn, a);
  await E(() => window.__pv.peds(40));
  const force = (kind, at) => E((a) => window.__pvInv.send('qa_dyn', { kind: a[0], x: a[1], z: a[2] }), [kind, at.x, at.z]);
  const sigOf = (kind) => E((k) => (window.__pvEvents.dyn ?? []).filter((s) => s.k === k), kind);
  const waitSig = async (pred, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const l = await E(() => window.__pvEvents.dyn ?? []); const s = l.find(pred); if (s) return s; await w(250); } return null; };
  const look = (at) => E((a) => window.__pv.lookFrom(a[0] + 6, 18, a[1] + 22, a[0], 0.5, a[1]), [at.x, at.z]);
  const shot = async (name, at) => { if (at) await look(at); await w(900); await p.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); await E(() => window.__pv.lookFrom()); };

  // Q — concentração
  const qAt = SPOT(0.004, 4);
  await force('CONCENTRACAO', qAt);
  const q = await waitSig((s) => s.k === 'CONCENTRACAO');
  check('Q: concentração chega pelo `dyn`', !!q, JSON.stringify(q));
  await w(1500);
  const agenda = await E(() => window.__pvEvents.list.filter((e) => e.format === 'dinamico').map((e) => ({ name: e.name, state: e.state })));
  check('Q: aparece em "Acontecendo agora" (agenda, formato dinamico)', agenda.some((e) => e.state === 'ACTIVE'), JSON.stringify(agenda));
  const pts = await E(() => window.__pvEvents.points.filter((x) => x.id.startsWith('dyn_')).map((x) => ({ id: x.id, crowd: x.crowd, label: x.label })));
  check('Q: ponto no evt_pts (minimapa) sem NPC reservado', pts.length > 0 && pts.every((x) => x.crowd === 0), JSON.stringify(pts));
  await shot('Q_concentracao', qAt);
  out.scenes.Q = { sig: q, agenda, pts };

  // R — caminhada
  const rAt = SPOT(-0.006, -4);
  await force('CAMINHADA', rAt);
  const r0 = await waitSig((s) => s.k === 'CAMINHADA');
  await w(6000);
  const r1 = (await sigOf('CAMINHADA'))[0];
  check('R: caminhada anda (centro muda de lugar)', !!r0 && !!r1 && Math.hypot(r1.x - r0.x, r1.z - r0.z) > 2, JSON.stringify({ r0, r1 }));
  await shot('R_caminhada', r1 ?? rAt);
  out.scenes.R = { r0, r1 };

  // S/T/U/V/W — foco de briga (generalizada forçada passa por todos os níveis em ordem, acelerada no QA)
  const fAt = SPOT(0.012, 0);
  await force('BRIGA_GENERALIZADA', fAt);
  const levels = [];
  const seen = { 1: null, 2: null, 3: null };
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const s = (await E(() => window.__pvEvents.dyn ?? [])).find((x) => Math.hypot(x.x - fAt.x, x.z - fAt.z) < 30 && ['DISCUSSAO', 'BRIGA', 'BRIGA_GENERALIZADA'].includes(x.k));
    if (s && levels.at(-1) !== s.e) {
      levels.push(s.e);
      if (s.e === 1 && !seen[1]) { seen[1] = s; await shot('S_discussao', fAt); }
      if (s.e === 2 && !seen[2]) { seen[2] = s; await shot('T_pequena_briga', fAt); await shot('U_multidao_observando', { x: fAt.x + 6, z: fAt.z + 6 }); }
      if (s.e === 3 && !seen[3]) { seen[3] = s; await shot('V_briga_generalizada', fAt); break; }
    }
    await w(200);
  }
  check('S→T→V: níveis TENSÃO → CONFRONTO → GENERALIZADO em ordem', JSON.stringify(levels.slice(0, 3)) === '[1,2,3]', JSON.stringify(levels));
  check('V: intensidade de confronto no sinal', (seen[3]?.cb ?? 0) >= 0.75, JSON.stringify(seen[3]));
  // W — dispersão: o foco desce de nível e some (forcedMinS + tempo máximo acelerado)
  let gone = false, wShot = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 150000 && !gone) {
    const s = (await E(() => window.__pvEvents.dyn ?? [])).find((x) => x.id === seen[3]?.id);
    if (s && s.e < 3 && !wShot) { wShot = true; await shot('W_pessoas_fugindo', fAt); }
    gone = !!seen[3] && !s;
    await w(500);
  }
  if (!wShot) await shot('W_pessoas_fugindo', fAt);
  check('W: foco se dispersa e termina', gone);
  out.scenes.fight = { levels, seen };
  out.participants = { Q: q?.n ?? 0, V: seen[3]?.n ?? 0, nota: 'n = 0 antes da WorldView do AGENTE C (focos fantasmas)' };
  check('sem erros de página', errs.length === 0, errs.slice(0, 3).join(' | '));
  check('sem mensagem sem ouvinte no cliente', warns.length === 0, warns.slice(0, 2).join(' | '));
} catch (e) {
  check('roteiro', false, String(e?.stack ?? e));
} finally {
  out.results = results;
  writeFileSync('docs/bench/round12_dynamic_world.json', JSON.stringify(out, null, 2));
  await cleanup();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} ok`);
  process.exit(bad.length ? 1 : 0);
}
