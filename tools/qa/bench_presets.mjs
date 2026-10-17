/**
 * Desempenho do cliente POR PRESET no multiplayer: sobe um servidor de teste próprio (porta 2640, PV_TEST=1),
 * 10 bots perto do spawn, e mede LOW/MEDIUM/HIGH/ULTRA em 2 pontos (Central e Candelária).
 * uso (com `npm run dev` rodando): node tools/qa/bench_presets.mjs [http://localhost:5173]
 * saída: screenshots/bench_presets.json
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const PORT = 2640;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const procs = [];
const start = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { cwd: 'server', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  procs.push(p); return p;
};
process.on('exit', () => procs.forEach((p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } }));
const server = start('npx', ['tsx', 'src/index.ts'], { PORT: String(PORT), PV_TEST: '1' });
let up = false; server.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 100 && !up; i++) await w(200);
start('npx', ['tsx', 'tools/bots.ts', '10', '600', `ws://127.0.0.1:${PORT}`]);
await w(3000);

const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const VIEWS = { central: m.spawn.p, candelaria: [690, -150] };
const out = [];
for (const q of ['low', 'medium', 'high', 'ultra']) {
  for (const [view, [x, z]] of Object.entries(VIEWS)) {
    const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info'], defaultViewport: { width: 1280, height: 720 } });
    const p = await b.newPage();
    let http = 0;
    const cdp = await p.target().createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.loadingFinished', (e) => { http += e.encodedDataLength; });
    const t0 = Date.now();
    await p.goto(`${BASE}/?autostart=1&welcome=0&quality=${q}&mp=ws://localhost:${PORT}&name=Bench&spawn=${x.toFixed(1)},${z.toFixed(1)}`);
    await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
    const loadS = (Date.now() - t0) / 1000;
    await w(5000);
    const samples = [];
    for (let i = 0; i < 12; i++) { samples.push(await p.evaluate(() => window.__pv.metrics())); await w(500); }
    const avg = (k) => +(samples.reduce((s, x) => s + (x[k] ?? 0), 0) / samples.length).toFixed(2);
    const last = samples.at(-1);
    const r = {
      preset: q, view, loadS: +loadS.toFixed(1), downloadMB: +(http / 1e6).toFixed(2),
      fps: avg('fps'), frameMs: avg('frameMs'), cpuMs: avg('cpuMs'), gpuMs: avg('gpuMs'),
      calls: Math.round(avg('calls')), trianglesK: Math.round(avg('triangles') / 1000), heapMB: last.heapMB,
      textures: last.textures, geometries: last.geometries, remotes: last.net?.remotes, netInKBps: +((last.bandwidth?.inBps ?? 0) / 1024).toFixed(2),
    };
    console.log(JSON.stringify(r));
    out.push(r);
    await b.close();
  }
}
writeFileSync('screenshots/bench_presets.json', JSON.stringify(out, null, 2));
process.exit(0);
