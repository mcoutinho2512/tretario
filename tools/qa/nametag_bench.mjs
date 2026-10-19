/**
 * Rodada 12 (agente D) — custo dos NOMES e da ANIMAÇÃO dos remotos com 50/250/500 pessoas detalhadas (todas com corpo
 * na StateView: PV_AOI_MAX=0). Servidor de TESTE próprio por rodada (portas 4410+), bots densos (server/tools/bots.ts
 * dense --social=0.3 --names) e o cliente no meio, câmera de 3ª pessoa. Mede por ~10 s: CPU do quadro (cpuMs), fps,
 * (até 64 detalhados: o cliente pede aoiMax = 2 × esqueletos do preset; o resto vem como multidão distante, sem nome),
 * ms do update dos remotos (interpolação + esqueletos + olhar + rótulos; só no cliente novo), rótulos visíveis,
 * decisão (ms), transform por quadro (ms), nós DOM `.name-label`, raios de oclusão.
 * uso: node tools/qa/nametag_bench.mjs <baseUrl> <rótulo> [kind=1|2] [Ns=50,250,500]
 *      (Vite: npx vite --port 5214 --strictPort; "antes" = bundle do master servido noutra porta)
 * saída: docs/bench/round12_nametags_<rótulo>.json (o agregado vai para docs/bench/round12_nametags.json)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [base = 'http://localhost:5214', label = 'depois', kind = '1', ns = '50,250,500'] = process.argv.slice(2);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const M = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = M.pvAxis[11], b = M.pvAxis[12];
const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
const results = [];
let port = 4410 + (label === 'antes' ? 0 : 20);

for (const N of ns.split(',').map(Number)) {
  port++;
  const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(port), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_AOI_MAX: '0', PV_QA_BOT_KIND: kind === '1' ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const log = [];
  server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
  server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
  for (let i = 0; i < 225 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
  const bots = spawn('npx', ['tsx', 'tools/bots.ts', String(N), '600', `ws://127.0.0.1:${port}`, 'dense', '--social=0.3', '--names'], { cwd: 'server', stdio: 'ignore', detached: true });
  let browser = null;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 720 } });
    const p = await browser.newPage();
    await p.goto(`${base}/?autostart=1&welcome=0&quality=high&crowdSkinned=32&time=10:30&mp=ws://127.0.0.1:${port}&name=Medidor&spawn=${cx.toFixed(1)},${cz.toFixed(1)}`);
    await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
    await p.evaluate((x, z) => { window.__pvProg?.tp(x, z); window.__pv.teleport(x, z, 0); }, cx, cz);
    let st = null;
    for (let i = 0; i < 120; i++) {
      st = await p.evaluate(() => ({ remotes: window.__pv.metrics().net?.remotes ?? 0, far: window.__pv.metrics().crowd?.farNet ?? 0 }));
      if (st.remotes + st.far >= N * 0.95) break;
      await w(1000);
    }
    await p.evaluate(() => window.__pv.camera(0.3, 0.32, 7));
    // cliente novo: pior caso do olhar — todos os remotos perto olham para o medidor
    await p.evaluate(() => window.__pvR12?.lookAtMe(true));
    await w(4000);
    await p.evaluate(() => window.__pv.takeFrames());
    const samples = [];
    for (let i = 0; i < 10; i++) {
      await w(1000);
      samples.push(await p.evaluate(() => {
        const m = window.__pv.metrics();
        const lab = window.__pv.hudInfo?.().labels ?? null;
        const r12 = window.__pvR12;
        return {
          cpuMs: m.cpuMs, fps: m.fps, crowdMs: m.crowd?.ms ?? null, skinned: m.crowd?.skinned ?? null,
          netMs: r12 ? r12.netMs() : null, lookActive: r12 ? r12.lookStats().active : null,
          shown: lab?.shown ?? null, decideMs: lab?.decideMs ?? null, frameMs: lab?.frameMs ?? null, rays: lab?.rays ?? null,
          domNodes: document.querySelectorAll('.name-label').length,
        };
      }));
    }
    const fr = await p.evaluate(() => window.__pv.takeFrames());
    const avg = (k) => { const v = samples.map((s) => s[k]).filter((x) => typeof x === 'number'); return v.length ? +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(4) : null; };
    const frameAvg = fr.length ? fr.reduce((s, x) => s + x, 0) / fr.length : null;
    const sorted = [...fr].sort((x, y) => x - y);
    const out = {
      label, kind: Number(kind), N, ...st,
      cpuMs: avg('cpuMs'), fps: frameAvg ? +(1000 / frameAvg).toFixed(1) : avg('fps'), p95FrameMs: sorted.length ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(2) : null,
      crowdMs: avg('crowdMs'), skinned: avg('skinned'), netUpdateMs: avg('netMs'), lookActive: avg('lookActive'),
      labelsShown: avg('shown'), labelDecideMs: avg('decideMs'), labelFrameMs: avg('frameMs'), occlusionRaysTotal: samples.at(-1)?.rays ?? null,
      domLabelNodes: samples.at(-1)?.domNodes ?? null,
    };
    results.push(out);
    console.log(JSON.stringify(out));
  } catch (e) { console.error(N, e); } finally {
    try { await browser?.close(); } catch { /* */ }
    try { process.kill(-bots.pid, 'SIGTERM'); } catch { /* */ }
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ }
    await w(1500);
  }
}
writeFileSync(`docs/bench/round12_nametags_${label}.json`, JSON.stringify({ when: new Date().toISOString(), base, results }, null, 2));
process.exit(0);
