/**
 * Rodada 12 (agente D) — SONDA DE HUMANIZAÇÃO no cliente: por 5–10 min, no meio de uma multidão de "autônomos" (bots
 * de carga marcados kind=1 pelo servidor de TESTE: PV_QA_BOT_KIND=1), mede
 *   - inícios no mesmo instante (servidor): quantas pessoas começam uma ação / começam a andar na MESMA amostra
 *   - diversidade de FASE visual (o que o cliente desenha): entre quem toca a mesma ação em laço (palmas, dança…),
 *     a maior fração dentro de 1/30 do ciclo ("no mesmo quadro") e o comprimento do vetor médio circular R
 *     (0 = fases espalhadas, 1 = uníssono); idem caminhada e parado
 *   - viradas sincronizadas: quantas pessoas viram > 30° entre duas amostras (200 ms)
 * O pior caso é forçado: `--sync-clap=20` (todos os bots pedem palmas no MESMO instante, com a MESMA variação).
 * Também grava uma sequência de quadros (e um GIF) logo depois de uma palma sincronizada.
 * uso: node tools/qa/humanization_probe.mjs <baseUrl> [segundos=300] [rótulo=depois] [query extra, ex. r12var=0] [bots=120]
 * saída: docs/screenshots/round12/qa_video/humanization_<rótulo>.json, quadros_<rótulo>/ e humanization_<rótulo>.gif
 */
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const [base = 'http://localhost:5214', SECS = '300', TAG = 'depois', EXTRA = '', NB = '120'] = process.argv.slice(2);
const OUT = 'docs/screenshots/round12/qa_video';
mkdirSync(OUT, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 4460 + (TAG === 'depois' ? 0 : 1);
const M = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = M.pvAxis[11], b = M.pvAxis[12];
const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_QA_BOT_KIND: '1' }, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 225 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const bots = spawn('npx', ['tsx', 'tools/bots.ts', NB, String(Number(SECS) + 120), `ws://127.0.0.1:${PORT}`, 'dense', '--social=0.5', '--names', '--sync-clap=20'], { cwd: 'server', stdio: 'ignore', detached: true });
const kill = () => { try { process.kill(-bots.pid, 'SIGTERM'); } catch { /* */ } try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', kill);

/** comprimento do vetor médio circular (fases 0..1) e maior fração dentro de uma janela de 1/30 do ciclo */
function circ(ph) {
  let c = 0, s = 0;
  for (const p of ph) { c += Math.cos(p * 2 * Math.PI); s += Math.sin(p * 2 * Math.PI); }
  const R = Math.hypot(c, s) / ph.length;
  const sorted = [...ph].sort((x, y) => x - y), win = 1 / 30;
  let best = 0;
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (sorted[j] + win < sorted[i]) j++;
    best = Math.max(best, i - j + 1);
  }
  // janela que cruza o 0
  for (let i = 0; i < sorted.length && sorted[i] < win; i++) best = Math.max(best, i + 1 + sorted.filter((x) => x > 1 - win + sorted[i]).length);
  return { R, cluster: best / ph.length };
}

let browser = null;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 900000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 960, height: 600 } });
  const p = await browser.newPage();
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&crowdSkinned=32&time=10:30&mp=ws://127.0.0.1:${PORT}&name=Sonda&spawn=${cx.toFixed(1)},${cz.toFixed(1)}${EXTRA ? `&${EXTRA}` : ''}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvR12', { timeout: 240000 });
  await p.evaluate((x, z) => { window.__pvProg?.tp(x, z); window.__pv.teleport(x, z, 0); window.__pv.camera(0.6, 0.28, 9); }, cx, cz);
  for (let i = 0; i < 60; i++) { const n = await p.evaluate(() => window.__pv.metrics().net?.remotes ?? 0); if (n >= Math.min(60, Number(NB)) * 0.9) break; await w(1000); }
  await w(5000);
  const prev = new Map();
  const acc = { samples: 0, actStartsMax: 0, actStartsHist: {}, walkStartsMax: 0, turnsMax: 0, turnsHist: {}, act: [], walk: [], idle: [], vatWalk: [] };
  const t0 = Date.now();
  let framesDone = false, lastSyncAt = 0;
  while (Date.now() - t0 < Number(SECS) * 1000) {
    const s = await p.evaluate(() => window.__pvR12.sample());
    acc.samples++;
    let actStarts = 0, walkStarts = 0, turns = 0;
    const byAct = new Map(), walk = [], idle = [], vat = [];
    for (const r of s) {
      const q = prev.get(r.nid);
      if (q) {
        if (r.act && (!q.act || r.actAt !== q.actAt)) actStarts++; // começou (ou recomeçou) uma ação
        if (q.speed < 0.15 && r.speed > 0.3) walkStarts++;
        let dh = (((r.heading - q.heading) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
        if (dh > 0.52) turns++;
      }
      prev.set(r.nid, r);
      if (r.skinned && r.actPhase !== null && r.act) { if (!byAct.has(r.act)) byAct.set(r.act, []); byAct.get(r.act).push(r.actPhase); }
      else if (r.skinned && r.speed > 0.4 && r.walk !== null) walk.push(r.walk);
      else if (r.skinned && r.speed < 0.1 && r.idle !== null) idle.push(r.idle);
      if (!r.skinned && r.speed > 0.4) vat.push(r.vat);
    }
    acc.actStartsMax = Math.max(acc.actStartsMax, actStarts); acc.actStartsHist[actStarts] = (acc.actStartsHist[actStarts] ?? 0) + 1;
    acc.walkStartsMax = Math.max(acc.walkStartsMax, walkStarts);
    acc.turnsMax = Math.max(acc.turnsMax, turns); acc.turnsHist[turns] = (acc.turnsHist[turns] ?? 0) + 1;
    for (const [, ph] of byAct) if (ph.length >= 5) acc.act.push({ n: ph.length, ...circ(ph) });
    if (walk.length >= 5) acc.walk.push({ n: walk.length, ...circ(walk) });
    if (idle.length >= 5) acc.idle.push({ n: idle.length, ...circ(idle) });
    if (vat.length >= 5) acc.vatWalk.push({ n: vat.length, ...circ(vat) });
    if (actStarts >= 10) lastSyncAt = Date.now();
    // sequência de quadros ~1,5 s depois de uma palma sincronizada (uma vez)
    if (!framesDone && lastSyncAt && Date.now() - lastSyncAt > 1500) {
      framesDone = true;
      const dir = `${OUT}/quadros_${TAG}`;
      rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
      const files = [];
      for (let k = 0; k < 16; k++) { const f = `${dir}/q${String(k).padStart(2, '0')}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 70 }); files.push(f); await w(120); }
      execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nfs=sys.argv[2:]\nim=[Image.open(f).convert('RGB').resize((640,400)) for f in fs]\npal=[i.quantize(colors=96) for i in im]\npal[0].save(sys.argv[1],save_all=True,append_images=pal[1:],duration=150,loop=0,optimize=True)`, `${OUT}/humanization_${TAG}.gif`, ...files]);
      execFileSync('python3', ['tools/qa/contact_sheet.py', `${OUT}/humanization_${TAG}_folha.jpg`, '4', '320', ...files.filter((_, i) => i % 2 === 0)]);
    }
    await w(200);
  }
  const sum = (arr) => arr.length ? { groups: arr.length, meanN: +(arr.reduce((x, y) => x + y.n, 0) / arr.length).toFixed(1), meanR: +(arr.reduce((x, y) => x + y.R, 0) / arr.length).toFixed(3), maxR: +Math.max(...arr.map((x) => x.R)).toFixed(3), meanCluster: +(arr.reduce((x, y) => x + y.cluster, 0) / arr.length).toFixed(3), maxCluster: +Math.max(...arr.map((x) => x.cluster)).toFixed(3) } : null;
  const out = {
    tag: TAG, extra: EXTRA, seconds: Number(SECS), bots: Number(NB), samples: acc.samples, sampleMs: 200,
    serverSameInstant: { actStartsMax: acc.actStartsMax, actStartsHist: acc.actStartsHist, walkStartsMax: acc.walkStartsMax },
    turns: { maxPerSample: acc.turnsMax, hist: acc.turnsHist },
    visualPhase: { loopActions: sum(acc.act), walk: sum(acc.walk), idle: sum(acc.idle), instancedWalk: sum(acc.vatWalk) },
    note: 'R: 0 = fases espalhadas, 1 = uníssono; cluster = maior fração das pessoas dentro de 1/30 do ciclo ("no mesmo quadro")',
    when: new Date().toISOString(),
  };
  writeFileSync(`${OUT}/humanization_${TAG}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  try { await browser?.close(); } catch { /* */ }
  kill();
  process.exit(process.exitCode ?? 0);
}
