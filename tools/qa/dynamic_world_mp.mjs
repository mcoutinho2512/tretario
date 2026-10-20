/**
 * Rodada 12 — MUNDO DINÂMICO no multiplayer real (docs/DYNAMIC_WORLD.md), COM os autônomos ligados (agente G).
 * Servidor de teste (PV_TEST=1, banco em memória, PV_AUTONOMOUS=N) + navegador (a jogadora, filmando) + um observador do
 * SDK (bot de carga que só LÊ o estado: posição/kind/torcida dos autônomos). Cada cena filma GENTE de verdade:
 *   Q_concentracao        concentração com ≥ 15 pessoas (espera uma nascer sozinha; se não vier, `qa_dyn` num lugar
 *                         cheio e espera crescer por adesões)
 *   E..H_torcedores_<id>  a maior concentração de cada torcida (ids/cores só dos DADOS; FESTA forçada perto do maior
 *                         grupo de torcedores quando preciso — a adesão de mesma torcida é dado: sameSupMult)
 *   R_caminhada           CAMINHADA andando pelo eixo com quem acompanha
 *   S_discussao           DISCUSSAO (TENSÃO: dois gesticulando, plateia começando)
 *   T_pequena_briga       BRIGA (CONFRONTO: empurrão → soco)
 *   U_multidao_observando a plateia em volta da briga (WATCH_FIGHT)
 *   V_briga_generalizada  BRIGA_GENERALIZADA (adesões graduais)
 *   W_pessoas_fugindo     dispersão (AVOID_FIGHT / LEAVE_AREA)
 *   qa_video/briga_*.jpg + briga.gif  sequência de quadros da briga (TENSÃO → GENERALIZADO)
 * Focos forçados passam pela MESMA dinâmica (níveis em ordem, adesões graduais), só mais rápido (qa.forcedSpeedup).
 * Resumo em docs/bench/round12_dynamic_world.json.
 *
 * uso: PV_API=http://127.0.0.1:4711 npx vite --port 5217 --strictPort  →  node tools/qa/dynamic_world_mp.mjs [http://localhost:5217]
 *      PV_DYN_PORT (padrão 4710; API em +1) · PV_AUTONOMOUS (padrão 200) · PV_DYN_HEADFUL=1 abre a janela
 */
import puppeteer from 'puppeteer-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';

const base = process.argv[2] ?? 'http://localhost:5217';
const PORT = Number(process.env.PV_DYN_PORT ?? 4710);
const N = Number(process.env.PV_AUTONOMOUS ?? 200);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round12';
const VIDEO = `${SHOTS}/qa_video`;
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
mkdirSync(SHOTS, { recursive: true }); mkdirSync(VIDEO, { recursive: true }); mkdirSync('docs/bench', { recursive: true });

const sup = JSON.parse(readFileSync('public/gameplay/supporters.json', 'utf8'));
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
// perto da Central do Brasil (spawn), onde a população se concentra
const SP = { x: manifest.spawn.p[0] + 18, z: manifest.spawn.p[1] - 6 };

try { await fetch(`http://127.0.0.1:${PORT + 1}/api/health`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_AUTONOMOUS: String(N) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
procs.push(S);
S.log = [];
S.stdout.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
S.stderr.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !S.log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

const out = { date: new Date().toISOString(), port: PORT, population: N, scenes: {} };
try {
  const b = await puppeteer.launch({ executablePath: chrome, headless: process.env.PV_DYN_HEADFUL ? false : 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1366, height: 860 } });
  browsers.push(b);
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=16:30&mp=ws://127.0.0.1:${PORT}&name=Qa&spawn=${SP.x.toFixed(1)},${SP.z.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvEvents && window.__pvInv', { timeout: 180000 });
  const E = (fn, a) => p.evaluate(fn, a);
  const obs = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1, name: 'Observador', bot: true, testSpawn: SP, aoiMax: 120 });
  obs.onMessage('*', () => {});
  rooms.push(obs);
  const people = () => { const a = []; obs.state?.players?.forEach((q, id) => a.push({ id, kind: q.kind, sup: q.sup, x: q.x, z: q.z, vehicle: q.vehicle, speed: q.speed, act: q.act })); return a; };
  const autos = () => people().filter((q) => q.kind === 1);
  const around = (at, r) => autos().filter((q) => Math.hypot(q.x - at.x, q.z - at.z) <= r).length;
  const me = async () => E(() => { const s = window.__pv.mp(); return s?.self ?? window.__pv.player?.() ?? null; }).catch(() => null);
  const tp = async (at) => { obs.send('test_tp', { x: at.x, z: at.z }); await E((a) => window.__pvInv?.send?.('test_tp', a), at).catch(() => {}); await w(2500); };
  const look = (at, h, back, side = 0.4) => E((a) => window.__pv.lookFrom(a[0] + a[3] * a[4], a[2], a[1] + a[3], a[0], 1.0, a[1]), [at.x, at.z, h, back, side]);
  const shot = async (name, at, h = 7, back = 14) => { if (at) await look(at, h, back); await w(1200); await p.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); await E(() => window.__pv.lookFrom()); };
  const force = (kind, at) => E((a) => window.__pvInv.send('qa_dyn', { kind: a[0], x: a[1], z: a[2] }), [kind, at.x, at.z]);
  const sigs = () => E(() => window.__pvEvents.dyn ?? []);
  /** o ponto mais cheio de autônomos (raio r) perto de `c` */
  const densest = (r = 10, filter = () => true) => {
    const xs = autos().filter(filter); let best = null;
    for (const q of xs) { const g = xs.filter((o) => Math.hypot(o.x - q.x, o.z - q.z) < r); if (!best || g.length > best.n) best = { x: g.reduce((s2, o) => s2 + o.x, 0) / g.length, z: g.reduce((s2, o) => s2 + o.z, 0) / g.length, n: g.length }; }
    return best;
  };

  // população chega (LOD + chegadas)
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && autos().length < 60) await w(1000);
  await w(20000);
  check('autônomos na vista (kind 1)', autos().length >= 40, `${autos().length}`);

  // PV_DYN_ONLY=q,e,r,briga (lista): só essas cenas — refilmar uma sem refazer o resto
  const only = (k) => !process.env.PV_DYN_ONLY || process.env.PV_DYN_ONLY.split(',').includes(k);
  if (only('q')) {
  // ---------------- Q — concentração ≥ 15 (natural, senão forçada num lugar cheio e crescendo)
  let q = null;
  const tq = Date.now();
  while (Date.now() - tq < 150000) {
    const s = (await sigs()).filter((x) => ['CONCENTRACAO', 'FESTA', 'ENCONTRO_TORCIDAS', 'MANIFESTACAO'].includes(x.k)).sort((a2, b2) => b2.n - a2.n)[0];
    if (s && s.n >= 15) { q = { ...s, forced: false }; break; }
    if (Date.now() - tq > 60000 && !q) {
      const d = densest(20);
      if (d) { await tp({ x: d.x + 10, z: d.z + 8 }); await force('CONCENTRACAO', d); q = { forcedAt: d }; }
    }
    await w(2000);
    if (q?.forcedAt) { const s2 = (await sigs()).find((x) => x.k === 'CONCENTRACAO' && Math.hypot(x.x - q.forcedAt.x, x.z - q.forcedAt.z) < 20); if (s2 && s2.n >= 15) { q = { ...s2, forced: true }; break; } }
  }
  if (q?.x !== undefined) {
    await tp({ x: q.x + 12, z: q.z + 10 });
    const crowd = around(q, q.r + 4);
    check('Q: concentração com ≥ 15 participantes', q.n >= 15, JSON.stringify({ k: q.k, n: q.n, w: q.w, r: q.r, forced: q.forced, autonomosNoRaio: crowd }));
    await shot('Q_concentracao', q, 12, 20);
    out.scenes.Q = { ...q, crowd };
  } else check('Q: concentração com ≥ 15 participantes', false, 'nenhuma em 150 s');

  }
  if (only('e')) {
  // ---------------- E..H — torcidas (ids/cores dos DADOS)
  const letters = ['E', 'F', 'G', 'H'];
  for (let i = 0; i < Math.min(4, sup.groups.length); i++) {
    const s = i + 1, gid = sup.groups[i].id;
    let best = densest(20, (o) => o.sup === s);
    if (best && best.n < 12) {
      // convida: FESTA perto do maior grupo dessa torcida — a adesão por mesma torcida é dado (sameSupMult)
      await tp({ x: best.x + 10, z: best.z + 10 });
      await force('FESTA', best);
      for (let k = 0; k < 30; k++) { await w(3000); const nb = densest(20, (o) => o.sup === s); if (nb && nb.n > best.n) best = nb; if (best.n >= 15) break; }
      best = densest(20, (o) => o.sup === s) ?? best; // a cena como está agora
    }
    check(`${letters[i]}: torcedores (sup ${s}) juntos`, !!best && best.n >= 8, best ? `${best.n} a ≤ 20 m (${around(best, 20)} pessoas no total)` : '');
    if (best) { await tp({ x: best.x + 9, z: best.z + 9 }); await shot(`${letters[i]}_torcedores_${gid}`, best, 9, 13); out.scenes[letters[i]] = { sup: s, ...best }; }
  }

  }
  if (only('r')) {
  // ---------------- R — caminhada (num lugar cheio)
  let r0 = null, r1 = null;
  for (let tries = 0; tries < 3 && !(r1 && r1.n >= 5); tries++) {
    // uma caminhada que não "pegou" (pouca gente em volta) é tentada de novo noutro lugar cheio
    const rAt = densest(16, (o) => tries === 0 || Math.hypot(o.x - (r0?.x ?? 0), o.z - (r0?.z ?? 0)) > 40) ?? SP;
    await tp({ x: rAt.x + 10, z: rAt.z + 10 });
    await force('CAMINHADA', rAt);
    await w(2000);
    const ids0 = new Set((await sigs()).filter((x) => x.k === 'CAMINHADA').map((x) => x.id));
    r0 = (await sigs()).filter((x) => x.k === 'CAMINHADA').sort((a2, b2) => Math.hypot(a2.x - rAt.x, a2.z - rAt.z) - Math.hypot(b2.x - rAt.x, b2.z - rAt.z))[0];
    await w(60000); // ~25 s juntando gente (QA) + caminhada
    r1 = (await sigs()).find((x) => x.k === 'CAMINHADA' && (!r0 || x.id === r0.id)) ?? null;
    void ids0;
  }
  check('R: caminhada anda com gente acompanhando', !!r0 && !!r1 && Math.hypot(r1.x - r0.x, r1.z - r0.z) > 10 && r1.n >= 5, JSON.stringify({ r0, r1 }));
  // filma o centro da caminhada (posição atual: o sinal anda com ela)
  if (r1) { await tp({ x: r1.x + 10, z: r1.z + 12 }); const r2 = (await sigs()).find((x) => x.id === r1.id) ?? r1; await shot('R_caminhada', r2, 9, 15); out.scenes.R_film = r2; }
  out.scenes.R = { r0, r1 };

  }
  if (only('briga')) {
  // ---------------- S/T/U/V/W — briga num lugar cheio (plateia de verdade)
  let levels = [], seen = {}, frame = 0, focus = null, fAt = SP;
  // a briga forçada passa pela MESMA dinâmica (adesões sorteadas pela personalidade): se não generalizar no tempo do
  // QA, tenta de novo noutro lugar cheio (até 3 vezes) — a captura V só sai com ≥ 5 brigando
  for (let attempt = 0; attempt < 3 && !seen[3]; attempt++) {
    levels = []; seen = {}; frame = 0; focus = null;
    for (const f of readdirSync(VIDEO)) if (f.startsWith('briga_')) unlinkSync(`${VIDEO}/${f}`);
    await w(5000);
    fAt = densest(12) ?? SP;
    await tp({ x: fAt.x + 9, z: fAt.z + 9 });
    await w(3000);
    check(`briga (tentativa ${attempt + 1}): lugar com plateia`, around(fAt, 14) >= 12, `${around(fAt, 14)} autônomos a ≤ 14 m`);
    await force('BRIGA_GENERALIZADA', fAt);
    const tf = Date.now();
    while (Date.now() - tf < 90000) {
      const s = (await sigs()).find((x) => Math.hypot(x.x - fAt.x, x.z - fAt.z) < 30 && ['DISCUSSAO', 'BRIGA', 'BRIGA_GENERALIZADA'].includes(x.k));
      if (s) {
        focus = s;
        if (frame < 60) { await look(s, 5, 11); await w(150); if (frame % 4 === 0) await p.screenshot({ path: `${VIDEO}/briga_${String(frame).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 70 }); frame++; }
        if (levels.at(-1) !== s.e) levels.push(s.e);
        if (s.e < (levels.length > 1 ? Math.max(...levels) : 0)) break; // desceu sem generalizar
        if (s.e === 1 && !seen[1] && Date.now() - tf > 2500) { seen[1] = s; await shot('S_discussao', s, 3.2, 6.5); }
        if (s.e === 2 && !seen[2] && s.n >= 2) { await w(1500); seen[2] = (await sigs()).find((x) => x.id === s.id) ?? s; await shot('T_pequena_briga', seen[2], 3.2, 6.5); }
        if (s.e === 2 && seen[2] && !seen.u && (s.w ?? 0) >= 3) { seen.u = s; await shot('U_multidao_observando', s, 6, 13); }
        if (s.e === 3 && !seen[3] && s.n >= 3) { seen[3] = s; await shot('V_briga_generalizada', seen[3], 5, 11); if (!seen.u) { seen.u = seen[3]; await shot('U_multidao_observando', seen[3], 7, 16); } break; }
      }
      await w(250);
    }
  }
  check('S→T→V: TENSÃO → CONFRONTO → GENERALIZADO em ordem', JSON.stringify(levels.filter((x, i) => levels.indexOf(x) === i).slice(0, 3)) === '[1,2,3]', JSON.stringify(levels));
  check('V: participantes e plateia de verdade', (seen[3]?.n ?? 0) >= 3 && (seen[3]?.w ?? 0) >= 1, JSON.stringify(seen[3]));
  // W — dispersão: quem brigava/olhava se afasta correndo
  let wShot = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 150000) {
    const s = (await sigs()).find((x) => x.id === seen[3]?.id);
    if (frame < 90 && s) { await look(s, 5, 11); await w(150); if (frame % 4 === 0) await p.screenshot({ path: `${VIDEO}/briga_${String(frame).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 70 }); frame++; }
    if (s && s.e < 3 && !wShot) { wShot = true; await w(1500); await shot('W_pessoas_fugindo', s, 7, 14); }
    if (!s && seen[3]) break;
    await w(400);
  }
  if (!wShot && focus) await shot('W_pessoas_fugindo', focus, 7, 14);
  check('W: foco se dispersa e termina', !(await sigs()).some((x) => x.id === seen[3]?.id));
  out.scenes.fight = { levels, seen, frames: frame };
  }
  // gif curto da briga (Pillow) — quadros em qa_video/
  const py = spawnSync('python3', ['-c', `
import glob
from PIL import Image
fs=sorted(glob.glob('${VIDEO}/briga_*.jpg'))
ims=[Image.open(f).convert('RGB').resize((480,302)) for f in fs]
pal=[i.quantize(colors=64, method=Image.Quantize.MEDIANCUT) for i in ims]
pal[0].save('${VIDEO}/briga.gif', save_all=True, append_images=pal[1:], duration=450, loop=0, optimize=True) if pal else None
print(len(pal))`], { encoding: 'utf8' });
  check('gif da briga', py.status === 0, (py.stdout || py.stderr).trim().slice(0, 200));
  check('sem erros de página', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  check('roteiro', false, String(e?.stack ?? e));
} finally {
  out.results = results;
  writeFileSync('docs/bench/round12_dynamic_world.json', JSON.stringify(out, null, 2) + '\n');
  await cleanup();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} ok`);
  process.exit(bad.length ? 1 : 0);
}
