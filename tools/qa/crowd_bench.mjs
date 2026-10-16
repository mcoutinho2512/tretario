/**
 * BANCADA DE MULTIDÃO (cliente): o jogador no MEIO de N bots (concentração densa, elipse ~60 × 20 m no eixo da
 * Pres. Vargas) e mede o cliente por preset.
 *
 * Sobe o PRÓPRIO servidor de teste (PV_TEST=1, porta 2660 ou CROWD_BENCH_PORT; nunca a do walkthrough), bots em
 * processos de até 100 (server/tools/bots.ts, cenário "dense") e um Chrome headless (GPU via Metal) por preset.
 * Todos os processos são encerrados pelo GRUPO de processo ao final (ou em erro / Ctrl+C).
 *
 * uso (com o cliente rodando, p.ex. `npx vite --port 5192`):
 *   node tools/qa/crowd_bench.mjs [baseUrl=http://localhost:5192] [contagens=50,100,250,500] [presets=low,medium,high] [extra=]
 *   extra: parâmetros de URL adicionais (p.ex. "crowd=0" desliga o orçamento de multidão → comparação antes/depois)
 * saída: docs/screenshots/crowd_bench.json (+ CROWD_BENCH_TAG) e uma captura por cenário em screenshots/crowd_bench/
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

const BASE = process.argv[2] ?? 'http://localhost:5192';
const COUNTS = (process.argv[3] ?? '50,100,250,500').split(',').map(Number);
const PRESETS = (process.argv[4] ?? 'low,medium,high').split(',');
const EXTRA = process.argv[5] ? `&${process.argv[5]}` : '';
const PORT = Number(process.env.CROWD_BENCH_PORT ?? 2660);
const TAG = process.env.CROWD_BENCH_TAG ? `_${process.env.CROWD_BENCH_TAG}` : '';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('screenshots/crowd_bench', { recursive: true });

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
for (let i = 0; i < 150 && !up; i++) await w(200);
if (!up) { console.error('servidor não subiu'); process.exit(1); }

// mesmo centro da concentração de server/tools/bots.ts (meio do trecho axis[11]→axis[12])
const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = m.pvAxis[11], b = m.pvAxis[12];
const C = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 };
const along = Math.atan2(b[0] - a[0], b[1] - a[1]); // rumo ao longo da avenida

async function startBots(n) {
  const list = [];
  const ready = [];
  for (let k = 0; k * 100 < n; k++) {
    const cnt = Math.min(100, n - k * 100);
    const p = start('npx', ['tsx', 'tools/bots.ts', String(cnt), '3600', `ws://127.0.0.1:${PORT}`, 'dense', `--offset=${k * 100}`, `--total=${n}`, '--wait-go'], {}, ['pipe', 'pipe', 'inherit']);
    const rl = createInterface({ input: p.stdout });
    ready.push(new Promise((res) => rl.on('line', (l) => { if (l.trim() === 'READY') res(); })));
    list.push(p);
  }
  await Promise.all(ready);
  return list;
}

const out = [];
for (const n of COUNTS) {
  const bots = await startBots(n);
  await w(2000);
  for (const q of PRESETS) {
    const br = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info', '--disable-frame-rate-limit', '--disable-gpu-vsync'], defaultViewport: { width: 1280, height: 720 } });
    try {
      const p = await br.newPage();
      p.on('pageerror', (e) => console.log(`[${q}/${n}] ERRO`, e.message));
      await p.goto(`${BASE}/?autostart=1&quality=${q}&time=16:30&mp=ws://127.0.0.1:${PORT}&name=Bench&spawn=${C.x.toFixed(1)},${C.z.toFixed(1)}${EXTRA}`);
      await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 180000 });
      // câmera em 3ª pessoa olhando ao longo da avenida, por cima da multidão
      await p.evaluate((yaw) => window.__pv.camera(yaw, 0.22, 7), along);
      await w(7000);
      const samples = [];
      for (let i = 0; i < 16; i++) { samples.push(await p.evaluate(() => window.__pv.metrics())); await w(500); }
      const avg = (f) => +(samples.reduce((s, x) => s + (f(x) ?? 0), 0) / samples.length).toFixed(2);
      const last = samples.at(-1);
      await p.screenshot({ path: `screenshots/crowd_bench/${q}_${n}${TAG}.jpg`, type: 'jpeg', quality: 75 });
      const r = {
        bots: n, preset: q, extra: EXTRA || undefined,
        fps: avg((x) => x.fps), frameMs: avg((x) => x.frameMs), worstMs: Math.max(...samples.map((x) => x.worstMs ?? 0)),
        cpuMs: avg((x) => x.cpuMs), gpuMs: avg((x) => x.gpuMs), calls: Math.round(avg((x) => x.calls)), trianglesK: Math.round(avg((x) => x.triangles) / 1000),
        heapMB: last.heapMB, geometries: last.geometries, textures: last.textures,
        remotes: last.net?.remotes, far: last.crowd?.farNet, humans: last.crowd?.submitted,
        skinned: last.crowd?.skinned, instanced: last.crowd?.drawnInstanced, instancedCalls: last.crowd?.instancedCalls, hidden: last.crowd?.hidden,
        lods: last.crowd?.lod, peds: last.pedestrians?.limit, crowdMs: avg((x) => x.crowd?.ms), netInKBps: +((last.bandwidth?.inBps ?? 0) / 1024).toFixed(1),
      };
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
writeFileSync(`docs/screenshots/crowd_bench${TAG}.json`, JSON.stringify(out, null, 2));
console.table(out.map((r) => ({ bots: r.bots, preset: r.preset, fps: r.fps, cpu: r.cpuMs, gpu: r.gpuMs, calls: r.calls, triK: r.trianglesK, heap: r.heapMB, rem: r.remotes, far: r.far, skin: r.skinned, inst: r.instanced })));
cleanup();
process.exit(0);
