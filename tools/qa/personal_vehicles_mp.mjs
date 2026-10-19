/**
 * Rodada 12 — VEÍCULO PESSOAL no multiplayer real: servidor de teste (PV_TEST=1, memória) e DOIS navegadores (Chrome).
 * A pede cada tipo pelas portas de entrada reais (barra de ações → Veículos, acesso rápido 4, inventário, barra de
 * novo para o carro na calçada); B, 8 m atrás, confere que o veículo de A SURGE, A aparece MONTADO, e que ele SOME
 * depois de abandonado. Spam pelo console (100 pedidos forjados) nunca passa de 1 ativo. Mede, em A, o tempo
 * seleção → `pveh_ok` (= já visível: a instância nasce da resposta) e a distância avatar → veículo.
 * Capturas em docs/screenshots/round12/ (L…P); resumo em docs/bench/round12_personal_vehicles.json.
 * uso: npx vite --port 5212 --strictPort  →  node tools/qa/personal_vehicles_mp.mjs [http://localhost:5212]
 *      PV_PVEH_PORT (padrão 4230)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5212';
const PORT = Number(process.env.PV_PVEH_PORT ?? 4230);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round12';
const IDLE_MS = 5000;
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

// pista da Pres. Vargas (eixo, t = 0,2, 4 m do centro) e a calçada larga do lado (36 m) — rumo do spawn = rumo do eixo
const ROAD = [-790.6, 346.5], SIDEWALK = [-777.9, 384.4];
const H = 1.9204;
const behind = (p, d) => [p[0] - Math.sin(H) * d, p[1] - Math.cos(H) * d];

// ---------------------------------------------------------------- servidor
const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_PVEH_IDLE_MS: String(IDLE_MS) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
procs.push(S);
S.log = [];
S.stdout.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
S.stderr.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !S.log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

async function open(name, at) {
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1366, height: 820 } });
  browsers.push(b);
  const p = await b.newPage();
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=medium&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${at[0].toFixed(1)},${at[1].toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvPveh && window.__pvInv', { timeout: 240000 });
  await w(2500);
  await p.evaluate(() => document.querySelector('.hud-hint')?.remove());
  return p;
}
const E = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(60); } return null; };
const shot = async (P, name) => { await P.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); console.log(`   📷 ${SHOTS}/${name}.jpg`); };
const hit = async (P, sel) => { const el = await P.$(sel); if (!el) throw new Error(`sem ${sel}`); await el.click(); await w(120); };
const riding = (P) => E(P, () => window.__pvPveh.riding());
const remoteOf = (P, sid) => E(P, (s) => window.__pv.mp().remotes.find((r) => r.id === s) ?? null, sid);
const dynOf = (P, sid) => E(P, (s) => window.__pvPveh.dynamic().filter((d) => d.owner === s), sid);

const out = { date: new Date().toISOString(), port: PORT, perKind: {} };
try {
  const A = await open('Ana', ROAD);
  const B = await open('Bruno', behind(ROAD, 8));
  const sidA = await E(A, () => window.__pv.mp().session);
  check('B vê A na rede', !!(await until(() => remoteOf(B, sidA))));

  /** pede pela porta indicada e mede: seleção → pveh_ok (A) e quando B vê o veículo e A montado */
  async function viaAndWatch(kind, how) {
    const n0 = await E(A, () => window.__pvPveh.stats().ok);
    const t0 = Date.now();
    await how();
    const ok = await until(() => E(A, (n) => window.__pvPveh.stats().ok > n, n0), 4000);
    const last = await E(A, () => window.__pvPveh.stats().last);
    const seen = await until(async () => { const d = await dynOf(B, sidA); return d.find((x) => x.kind === kind) ?? null; }, 4000);
    const tSeen = Date.now() - t0;
    const mounted = last?.mounted ? await until(async () => (await remoteOf(B, sidA))?.vehicle === last.id, 4000) : null;
    const rA = await riding(A);
    (out.perKind[kind] ??= []).push({ okMs: last?.okMs, d: last?.d, mounted: last?.mounted, bSeesMs: tSeen });
    check(`${kind}: selecionou → aparece (${last?.okMs} ms, ${last?.d} m do avatar) · B vê em ${tSeen} ms${last?.mounted ? ' · A montado' : ''}`, ok && seen && (!last?.mounted || (mounted && rA?.kind === kind)), JSON.stringify({ last, seen: !!seen, mountedForB: !!mounted, rA }));
    return last;
  }

  // ---- 1) PATINETE pela barra de ações (Veículos → Patinete)
  await hit(A, '.ab-btn[data-cat=veiculos]');
  const items = (await E(A, () => window.__pv.actionBar())).items.map((i) => i.id);
  check('barra → Veículos lista os pessoais (sem "mais próximo: N m")', ['v_scooter', 'v_bicycle', 'v_moto', 'v_car'].every((k) => items.includes(k)) && !(await E(A, () => document.querySelector('.ab-pop')?.textContent ?? '')).match(/\d+ m\b/), items.join(','));
  // B olha de lado (câmera livre de QA a 5 m, na altura dos olhos) para ver o patinete surgir junto de A
  const pa = await E(B, (s) => window.__pv.mp().remotes.find((r) => r.id === s), sidA);
  const side = [pa.x + Math.cos(H) * 5, pa.z - Math.sin(H) * 5];
  await E(B, (x, z, tx, tz) => window.__pv.lookFrom(x, 1.7, z, tx, 0.7, tz), side[0], side[1], pa.x, pa.z);
  await viaAndWatch('scooter', async () => {
    await hit(A, '.ab-pop button[data-id=v_scooter]');
  });
  await w(60);
  await shot(B, 'L_patinete_aparecendo');
  await E(B, () => window.__pv.lookFrom());
  await w(1100);
  await shot(A, 'M_avatar_montado');
  check('HUD: "Patinete disponível"', /Patinete disponível/.test(await E(A, () => document.body.textContent)));

  // ---- 2) BICICLETA pelo acesso rápido (fixada no 4 pelo inventário; tecla 4)
  await w(2700);
  await E(A, () => { const inv = window.__pvInv.inv; inv.openPanel(); inv.pin('veh:bicycle', 3); inv.close(); });
  await viaAndWatch('bicycle', async () => { await A.keyboard.press('Digit4'); });
  await w(1000);
  await shot(A, 'N_bicicleta_imediata');
  const q = await E(A, () => window.__pvInv.info().quick.slots[3]);
  check('acesso rápido 4 aceso montado na bicicleta', q.on, JSON.stringify(q));

  // ---- 3) MOTO pelo inventário (VEÍCULOS → USAR AGORA): B vê surgir e A montado
  await w(2700);
  await viaAndWatch('moto', async () => { await E(A, () => { const inv = window.__pvInv.inv; inv.openPanel(); void inv.equip('veh:moto'); }); });
  check('inventário fecha ao usar o veículo (para ver surgir)', !(await E(A, () => window.__pvInv.info().open)));
  await w(900);
  await shot(B, 'O_moto_imediata');
  const onlyOne = await dynOf(B, sidA);
  check('troca: só 1 pessoal de A no mundo (patinete e bicicleta sumiram)', onlyOne.length === 1 && onlyOne[0].kind === 'moto', JSON.stringify(onlyOne));

  // ---- 4) CARRO pedido da calçada larga: surge na pista mais próxima (a pé até ele) e A entra
  await w(2700);
  await E(A, () => window.__pvPveh.toggle('moto')); // desce
  await until(async () => !(await riding(A)), 3000);
  await E(A, (x, z) => { window.__pvProg?.tp(x, z); window.__pv.teleport(x, z); }, SIDEWALK[0], SIDEWALK[1]);
  await E(B, (x, z) => { window.__pvProg?.tp(x, z); window.__pv.teleport(x, z); }, ...behind(SIDEWALK, 9));
  await w(1500);
  await hit(A, '.ab-btn[data-cat=veiculos]');
  const car = await viaAndWatch('car', async () => { await hit(A, '.ab-pop button[data-id=v_car]'); });
  if (car && !car.mounted) {
    // apareceu ali na pista (≥ 3 m): E entra pelo caminho normal
    await E(A, (id) => window.__pv.rawEnter?.(id), car.id);
    await until(async () => (await riding(A))?.kind === 'car', 4000);
  }
  await w(1300);
  await shot(A, 'P_carro_imediato');
  check('carro: A dirigindo o próprio carro', (await riding(A))?.kind === 'car', JSON.stringify(await riding(A)));

  // ---- 5) spam pelo console: 100 pedidos forjados (40/s) → nunca mais de 1 ativo
  await w(2700);
  let maxOwned = 0;
  const d0 = await E(A, () => ({ ...window.__pvPveh.stats().denied }));
  for (let i = 0; i < 100; i++) {
    await E(A, (k) => window.__pvPveh.raw({ kind: k, seq: 0 }), ['scooter', 'bicycle', 'moto', 'car'][i % 4]);
    if (i % 4 === 3) { await w(100); maxOwned = Math.max(maxOwned, (await dynOf(B, sidA)).length); }
  }
  await w(800);
  const d1 = await E(A, () => window.__pvPveh.stats().denied);
  const taxa = (d1.taxa ?? 0) - (d0.taxa ?? 0);
  check('spam: 100 pedidos forjados → ≤ 1 pessoal ativo, ≥ 95 recusas por taxa', maxOwned <= 1 && taxa >= 95, `máx ativo ${maxOwned}, taxa ${taxa}`);
  out.spam = { maxOwned, taxa };

  // ---- 6) abandono: A desce; o pessoal some para B depois do prazo (PV_PVEH_IDLE_MS)
  await w(400);
  const r = await riding(A);
  if (r) await E(A, (k) => window.__pvPveh.toggle(k), r.kind);
  await until(async () => !(await riding(A)), 3000);
  const t0 = Date.now();
  const gone = await until(async () => (await dynOf(B, sidA)).length === 0 && (await dynOf(A, sidA)).length === 0, IDLE_MS + 4000);
  check(`abandono: some para A e B em ${Date.now() - t0} ms (prazo ${IDLE_MS} ms + tick de 1 s)`, gone);

  check('sem erros de página', A.errs.length === 0 && B.errs.length === 0, [...A.errs, ...B.errs].slice(0, 3).join(' | '));
} catch (e) {
  check('roteiro sem exceção', false, String(e?.stack ?? e));
} finally {
  out.results = results;
  out.summary = Object.fromEntries(Object.entries(out.perKind).map(([k, v]) => [k, { okMs: v[0].okMs, d: v[0].d, mounted: v[0].mounted, bSeesMs: v[0].bSeesMs }]));
  writeFileSync('docs/bench/round12_personal_vehicles.json', JSON.stringify(out, null, 2));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ok`);
  await cleanup();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
