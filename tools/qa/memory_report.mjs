/**
 * Relatório de memória (rodada 6 — docs/MEMORY.md).
 *
 * uso (com o servidor de desenvolvimento rodando; BASE=http://localhost:5173 por padrão):
 *   node tools/qa/memory_report.mjs [saida=screenshots/memory/run] [presets=high,low] [--loop=300] [--profile]
 *
 * Para cada preset: abre o jogo com ?mem=1 (livro-razão de alocações da GPU), mede no spawn e depois de
 * teleportar pelo corredor Central → meio → Candelária → meio → Central (volta), aguardando o streaming.
 * Em cada ponto: __pv.memoryReport() (categorias, duplicatas, GPU), performance.memory, CDP Runtime.getHeapUsage
 * (heap V8 + backing stores de ArrayBuffer) antes e depois de um GC forçado.
 * --profile: amostragem do heap (HeapProfiler.startSampling) — memória viva por arquivo-fonte no fim.
 * --loop=N: teste de vazamento — N segundos de teleportes contínuos pelo corredor, amostra o heap (pós-GC) a cada
 *   ciclo e grava loop.json + loop.svg (gráfico do heap ao longo do tempo).
 * Saída: <saida>/<preset>.json, <saida>/summary.md
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = args.filter((a) => !a.startsWith('--'));
const OUT = pos[0] ?? 'screenshots/memory/run';
const PRESETS = (pos[1] ?? 'high,low').split(',');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const LOOP = flags.loop ? Number(flags.loop) : 0;
const SETTLE = Number(process.env.SETTLE ?? 7000);
mkdirSync(OUT, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));

const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const C = m.landmarks.find((l) => l.key === 'LANDMARK_CENTRAL').center;
const K = m.landmarks.find((l) => l.key === 'LANDMARK_CANDELARIA').center;
// pontos na avenida (um pouco afastados dos edifícios-marco)
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ROUTE = [
  ['central', lerp(C, K, 0.08)],
  ['meio', lerp(C, K, 0.5)],
  ['candelaria', lerp(C, K, 0.9)],
  ['meio_volta', lerp(C, K, 0.5)],
  ['central_volta', lerp(C, K, 0.08)],
];

const mb = (b) => Math.round(b / 104857.6) / 10;

async function heap(cdp, page) {
  const u = await cdp.send('Runtime.getHeapUsage');
  const pm = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);
  return { usedMB: mb(u.usedSize), totalMB: mb(u.totalSize), backingStoreMB: mb(u.backingStorageSize ?? 0), embedderMB: mb(u.embedderHeapUsedSize ?? 0), perfMemMB: mb(pm) };
}
async function gcHeap(cdp, page) {
  for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage'); await w(300); }
  return heap(cdp, page);
}

function summarizeSampling(profile) {
  const byFile = new Map();
  const walk = (n, stackFile) => {
    const url = n.callFrame.url || '';
    const file = url ? url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '') : stackFile;
    const self = n.selfSize ?? 0;
    if (self) byFile.set(file || '(nativo)', (byFile.get(file || '(nativo)') ?? 0) + self);
    for (const c of n.children ?? []) walk(c, file || stackFile);
  };
  walk(profile.head, '');
  return [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([file, b]) => ({ file, MB: mb(b) }));
}

function svgPlot(series, title) {
  const W = 900, H = 360, P = 50;
  const xs = series.map((s) => s.t), ys = series.flatMap((s) => [s.usedMB, s.rawMB ?? s.usedMB, s.gpuMB ?? 0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys) * 1.1;
  const X = (v) => P + ((v - x0) / Math.max(1, x1 - x0)) * (W - 2 * P), Y = (v) => H - P - (v / y1) * (H - 2 * P);
  const line = (k, color) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${series.filter((s) => s[k] !== undefined).map((s) => `${X(s.t).toFixed(1)},${Y(s[k]).toFixed(1)}`).join(' ')}"/>`;
  const grid = Array.from({ length: 6 }, (_, i) => { const v = (y1 * i) / 5; return `<line x1="${P}" x2="${W - P}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ddd"/><text x="5" y="${Y(v) + 4}" font-size="11">${v.toFixed(0)} MB</text>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>${grid}
<text x="${P}" y="20" font-size="14">${title}</text>
<text x="${W - P}" y="${H - 15}" font-size="11" text-anchor="end">tempo (s)</text>
${line('rawMB', '#bbb')}${line('usedMB', '#1565c0')}${line('gpuMB', '#e65100')}
<text x="${P + 10}" y="40" font-size="11" fill="#1565c0">heap JS após GC</text><text x="${P + 130}" y="40" font-size="11" fill="#999">heap JS (sem GC)</text><text x="${P + 250}" y="40" font-size="11" fill="#e65100">GPU (livro-razão)</text></svg>`;
}

const summary = [];
for (const preset of PRESETS) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  const cdp = await page.target().createCDPSession();
  await cdp.send('HeapProfiler.enable');
  if (flags.profile) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536 });
  const t0 = Date.now();
  await page.goto(`${BASE}/?autostart=1&quality=${preset}&time=10:30&mem=1`);
  await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
  const loadS = (Date.now() - t0) / 1000;
  await w(SETTLE);
  const points = [];
  const measure = async (name) => {
    const raw = await heap(cdp, page);
    const after = await gcHeap(cdp, page);
    const rep = await page.evaluate(() => window.__pv.memoryReport(true));
    const met = await page.evaluate(() => window.__pv.metrics());
    const p = { name, heapRaw: raw, heapGC: after, report: rep, fps: met.fps, chunks: met.chunks };
    points.push(p);
    console.log(`[${preset}] ${name}: heap ${raw.usedMB}→${after.usedMB} MB (GC), ArrayBuffers ${after.backingStoreMB} MB, GPU est ${rep.totals.gpuEstMB} MB, ledger ${rep.ledger?.totalMB ?? '—'} MB, tex ${rep.totals.textures}, geo ${rep.totals.geometries}`);
    return p;
  };
  await measure('spawn');
  for (const [name, [x, z]] of ROUTE) {
    await page.evaluate((x, z) => window.__pv.teleport(x, z), x, z);
    await w(SETTLE);
    await measure(name);
  }
  let loop = null;
  if (LOOP > 0) {
    const series = [];
    const tStart = Date.now();
    let i = 0;
    const pts = [lerp(C, K, 0.08), lerp(C, K, 0.3), lerp(C, K, 0.55), lerp(C, K, 0.9), lerp(C, K, 0.55), lerp(C, K, 0.3)];
    const gpuNow = () => page.evaluate(() => window.__pv.memoryReport(false).ledger?.totalMB ?? null);
    while ((Date.now() - tStart) / 1000 < LOOP) {
      const [x, z] = pts[i++ % pts.length];
      await page.evaluate((x, z) => window.__pv.teleport(x, z), x, z);
      await w(2500);
      const raw = await heap(cdp, page);
      const s = { t: +((Date.now() - tStart) / 1000).toFixed(1), rawMB: raw.usedMB, usedMB: raw.usedMB, backingStoreMB: raw.backingStoreMB };
      if (i % pts.length === 0) { const g = await gcHeap(cdp, page); s.usedMB = g.usedMB; s.backingStoreMB = g.backingStoreMB; s.gc = true; s.gpuMB = await gpuNow(); }
      series.push(s);
    }
    const gcs = series.filter((s) => s.gc);
    const first = gcs[0], last = gcs.at(-1);
    // tendência (mínimos quadrados) do heap pós-GC, em MB por minuto
    const n = gcs.length, mx = gcs.reduce((a, s) => a + s.t, 0) / n, my = gcs.reduce((a, s) => a + s.usedMB, 0) / n;
    const slope = gcs.reduce((a, s) => a + (s.t - mx) * (s.usedMB - my), 0) / Math.max(1e-9, gcs.reduce((a, s) => a + (s.t - mx) ** 2, 0));
    loop = { seconds: LOOP, cycles: gcs.length, firstMB: first?.usedMB, lastMB: last?.usedMB, minMB: Math.min(...gcs.map((s) => s.usedMB)), maxMB: Math.max(...gcs.map((s) => s.usedMB)), slopeMBperMin: +(slope * 60).toFixed(2), gpuFirstMB: first?.gpuMB, gpuLastMB: last?.gpuMB, series };
    writeFileSync(`${OUT}/${preset}_loop.json`, JSON.stringify(loop, null, 1));
    writeFileSync(`${OUT}/${preset}_loop.svg`, svgPlot(series, `Heap ao longo de ${LOOP}s de teleportes — ${preset.toUpperCase()}`));
    console.log(`[${preset}] loop ${LOOP}s: pós-GC ${loop.firstMB} → ${loop.lastMB} MB (min ${loop.minMB}, max ${loop.maxMB}), tendência ${loop.slopeMBperMin} MB/min, GPU ${loop.gpuFirstMB} → ${loop.gpuLastMB} MB`);
    await measure('apos_loop');
  }
  let sampling = null;
  if (flags.profile) {
    const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
    await cdp.send('HeapProfiler.stopSampling');
    sampling = summarizeSampling(profile);
  }
  const out = { preset, loadS, errors: errors.slice(0, 10), points, loop: loop && { ...loop, series: undefined }, sampling };
  writeFileSync(`${OUT}/${preset}.json`, JSON.stringify(out, null, 1));
  summary.push(out);
  await browser.close();
}

// ---------------------------------------------------------------- resumo em markdown
const md = [];
for (const s of summary) {
  md.push(`## ${s.preset.toUpperCase()} (carga ${s.loadS}s)\n`);
  md.push('| ponto | heap bruto MB | heap V8 pós-GC MB | ArrayBuffers MB | performance.memory pós-GC MB | GPU est. MB | GPU real (livro) MB | texturas | geometrias | materiais |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const p of s.points) md.push(`| ${p.name} | ${p.heapRaw.usedMB} | ${p.heapGC.usedMB} | ${p.heapGC.backingStoreMB} | ${p.heapGC.perfMemMB} | ${p.report.totals.gpuEstMB} | ${p.report.ledger?.totalMB ?? '—'} | ${p.report.totals.textures} | ${p.report.totals.geometries} | ${p.report.totals.materials} |`);
  const last = s.points.find((p) => p.name === 'candelaria') ?? s.points.at(-1);
  md.push(`\nCategorias (ponto: ${last.name})\n`);
  md.push('| categoria | texturas | tex GPU MB | tex CPU MB | geometrias | geo GPU MB | geo CPU MB | materiais | esqueletos | bones MB |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, c] of Object.entries(last.report.categories)) md.push(`| ${k} | ${c.textures} | ${c.texGpuMB} | ${c.texCpuMB} | ${c.geometries} | ${c.geoMB} | ${c.geoCpuMB ?? c.geoMB} | ${c.materials} | ${c.skeletons} | ${c.boneTexMB} |`);
  const d = last.report.duplicates;
  if (d) md.push(`\nDuplicatas: texturas ${d.counts.textures} grupos (${d.counts.texWastedMB} MB desperdiçados), materiais ${d.counts.materials} cópias, geometrias ${d.counts.geometries} cópias (${d.counts.geoWastedMB} MB)\n`);
  if (last.report.ledger) md.push(`GPU (livro-razão): texturas ${last.report.ledger.texturesMB} MB (${last.report.ledger.textureCount}), buffers ${last.report.ledger.buffersMB} MB, renderbuffers ${last.report.ledger.renderbuffersMB} MB, texturas sem dono na cena ${last.report.ledger.unattributedTexMB} MB\n`);
  md.push(`WASM: ${last.report.wasm.map((x) => `${x.label} ${x.MB} MB`).join(', ') || '—'} · animação: ${JSON.stringify(last.report.animation)}\n`);
  if (s.sampling) { md.push('Heap vivo por arquivo (amostragem):\n'); for (const x of s.sampling) md.push(`- ${x.file}: ${x.MB} MB`); md.push(''); }
  if (s.loop) md.push(`Loop ${s.loop.seconds}s: pós-GC ${s.loop.firstMB} → ${s.loop.lastMB} MB (min ${s.loop.minMB}, max ${s.loop.maxMB}), tendência ${s.loop.slopeMBperMin} MB/min; GPU ${s.loop.gpuFirstMB} → ${s.loop.gpuLastMB} MB\n`);
  if (s.errors.length) md.push(`Erros: ${s.errors.join(' | ')}\n`);
}
writeFileSync(`${OUT}/summary.md`, md.join('\n'));
console.log(`gravado em ${OUT}/summary.md`);
process.exit(0);
