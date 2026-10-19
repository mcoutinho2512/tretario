/**
 * RODADA 11 — bancada POR PRESET com multidão (jogador no meio de N bots, concentração densa no eixo da Pres. Vargas).
 * Mede, por preset × contagem: FPS (vazão sem vsync, `?uncapped=1`), CPU ms, GPU ms (EXT_disjoint_timer_query),
 * draw calls, triângulos, heap JS e — numa segunda carga com `?mem=1` — a memória REAL da GPU pelo livro-razão
 * (src/debug/memProbe.ts; a interceptação custa CPU, por isso fica fora da medição de FPS).
 *
 * Sobe o PRÓPRIO servidor de teste (PV_TEST=1, porta R11_BENCH_PORT, padrão 3960 — faixa 3950–3999) e os bots
 * (server/tools/bots.ts, cenário "dense"); tudo é encerrado pelo grupo de processo no fim, em erro ou Ctrl+C.
 *
 * uso (cliente rodando, p.ex. `npx vite --port 5204 --strictPort` ou `vite preview` de um build):
 *   node tools/qa/bench_r11_presets.mjs [base=http://localhost:5204] [contagens=50,250,500] [presets=low,medium,high,ultra]
 *   env: R11_TAG=antes|depois (sufixo do arquivo) · R11_VIEW=1920x1080 · R11_DPR=1 · R11_LEDGER=0 (pula a GPU real)
 *        R11_SHOTS=dir (capturas comparativas por preset/contagem; padrão screenshots/r11_bench)
 *        R11_EXTRA="&dynres=0" (padrão: resolução dinâmica DESLIGADA — mede o custo do preset em resolução cheia)
 * saída: docs/bench/round11_presets[_TAG].json
 */
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import os from 'node:os';

const BASE = process.argv[2] ?? 'http://localhost:5204';
const COUNTS = (process.argv[3] ?? '50,250,500').split(',').map(Number);
const PRESETS = (process.argv[4] ?? 'low,medium,high,ultra').split(',');
const PORT = Number(process.env.R11_BENCH_PORT ?? 3960);
const TAG = process.env.R11_TAG ? `_${process.env.R11_TAG}` : '';
const [VW, VH] = (process.env.R11_VIEW ?? '1920x1080').split('x').map(Number);
const DPR = Number(process.env.R11_DPR ?? 1);
const LEDGER = process.env.R11_LEDGER !== '0';
const SHOTS = process.env.R11_SHOTS ?? 'screenshots/r11_bench';
const EXTRA = process.env.R11_EXTRA ?? '&dynres=0';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });
mkdirSync('docs/bench', { recursive: true });
if (PORT < 3950 || PORT > 3998) { console.error('use uma porta entre 3950 e 3998'); process.exit(2); }

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const procs = new Set();
const start = (cmd, args, env = {}, stdio = ['ignore', 'pipe', 'pipe']) => {
  const p = spawn(cmd, args, { cwd: 'server', env: { ...process.env, ...env }, stdio, detached: true });
  procs.add(p);
  p.on('exit', () => procs.delete(p));
  return p;
};
const killGroup = (p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* já saiu */ } };
const cleanup = () => { for (const p of procs) killGroup(p); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

const server = start('npx', ['tsx', 'src/index.ts'], { PORT: String(PORT), PV_TEST: '1', PV_METRICS: '0' });
let up = false;
server.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 225 && !up; i++) await w(200);
if (!up) { console.error('servidor de teste não subiu'); process.exit(1); }

const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = m.pvAxis[11], b = m.pvAxis[12];
const C = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 };
const along = Math.atan2(b[0] - a[0], b[1] - a[1]);

async function startBots(n) {
  const list = [];
  const ready = [];
  for (let k = 0; k * 100 < n; k++) {
    const cnt = Math.min(100, n - k * 100);
    const p = start('npx', ['tsx', 'tools/bots.ts', String(cnt), '3600', `ws://127.0.0.1:${PORT}`, 'dense', `--offset=${k * 100}`, `--total=${n}`, '--wait-go', '--social=0.4'], {}, ['pipe', 'pipe', 'inherit']);
    const rl = createInterface({ input: p.stdout });
    ready.push(new Promise((res) => rl.on('line', (l) => { if (l.trim() === 'READY') res(); })));
    list.push(p);
  }
  await Promise.all(ready);
  for (const p of list) p.stdin.write('go\n');
  return list;
}

const launch = () => puppeteer.launch({
  executablePath: chrome, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info', '--disable-frame-rate-limit', '--disable-gpu-vsync', `--window-size=${VW},${VH}`],
  defaultViewport: { width: VW, height: VH, deviceScaleFactor: DPR },
});
const url = (q, extra = '') => `${BASE}/?autostart=1&welcome=0&quality=${q}&time=16:30&mp=ws://127.0.0.1:${PORT}&uncapped=1&name=Bench&spawn=${C.x.toFixed(1)},${C.z.toFixed(1)}${EXTRA}${extra}`;
async function open(br, q, extra) {
  const p = await br.newPage();
  p.on('pageerror', (e) => console.log(`[${q}] ERRO`, e.message));
  await p.goto(url(q, extra));
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 180000 });
  await p.evaluate((yaw) => window.__pv.camera(yaw, 0.22, 7), along);
  return p;
}

const out = [];
for (const n of COUNTS) {
  const bots = await startBots(n);
  await w(2500);
  for (const q of PRESETS) {
    const br = await launch();
    try {
      const p = await open(br, q, '');
      await w(8000);
      const samples = [];
      for (let i = 0; i < 16; i++) { samples.push(await p.evaluate(() => window.__pv.metrics())); await w(500); }
      const avg = (f) => +(samples.reduce((s, x) => s + (f(x) ?? 0), 0) / samples.length).toFixed(2);
      const last = samples.at(-1);
      await p.screenshot({ path: `${SHOTS}/${q}_${n}${TAG}.jpg`, type: 'jpeg', quality: 80 });
      const r = {
        bots: n, preset: q,
        fps: avg((x) => x.fps), frameMs: avg((x) => x.frameMs), worstMs: Math.max(...samples.map((x) => x.worstMs ?? 0)),
        cpuMs: avg((x) => x.cpuMs), gpuMs: avg((x) => x.gpuMs), calls: Math.round(avg((x) => x.calls)), trianglesK: Math.round(avg((x) => x.triangles) / 1000),
        heapMB: last.heapMB, geometries: last.geometries, textures: last.textures,
        remotes: last.net?.remotes, humans: last.crowd?.submitted, skinned: last.crowd?.skinned, peds: last.pedestrians?.limit,
        scale: last.governor?.scale ?? null,
      };
      await p.close();
      if (LEDGER) {
        const pm = await open(br, q, '&mem=1');
        await w(6000);
        const rep = await pm.evaluate(() => window.__pv.memoryReport(false));
        r.gpuMB = rep?.ledger?.totalMB ?? null;
        r.gpuTexMB = rep?.ledger?.texturesMB ?? null;
        r.gpuBufMB = rep?.ledger?.buffersMB ?? null;
        r.gpuRbMB = rep?.ledger?.renderbuffersMB ?? null;
        await pm.close();
      }
      console.log(JSON.stringify(r));
      out.push(r);
    } catch (e) {
      console.log(`[${q}/${n}] falhou: ${e.message}`);
      out.push({ bots: n, preset: q, error: e.message });
    }
    await br.close();
  }
  bots.forEach(killGroup);
  await w(3000);
}
let chromeVersion = '';
try { chromeVersion = execFileSync(chrome, ['--version']).toString().trim(); } catch { /* */ }
const meta = {
  machine: `esta máquina: ${os.cpus()[0]?.model ?? '?'} · ${os.cpus().length} núcleos · ${Math.round(os.totalmem() / 2 ** 30)} GB`,
  browser: `${chromeVersion} headless (ANGLE/Metal, sem vsync, ?uncapped=1)`,
  viewport: `${VW}x${VH} @${DPR}x`, scene: 'jogador no meio da concentração densa (eixo 11→12), câmera 3ª pessoa a 7 m olhando a avenida, 16:30, 40 % dos bots com vida social',
  date: new Date().toISOString(), tag: process.env.R11_TAG ?? '', url: EXTRA,
};
writeFileSync(`docs/bench/round11_presets${TAG}.json`, JSON.stringify({ meta, results: out }, null, 2));
console.table(out.map((r) => ({ bots: r.bots, preset: r.preset, fps: r.fps, cpu: r.cpuMs, gpu: r.gpuMs, calls: r.calls, triK: r.trianglesK, heap: r.heapMB, gpuMB: r.gpuMB })));
cleanup();
process.exit(0);
