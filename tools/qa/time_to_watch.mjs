/**
 * Rodada 8 — tempo até ASSISTIR: clique em "assistir" (window.__pvLaunch({ role: 'spectator' })) → 1º quadro do mundo
 * (`pv:world-visible`) e → 1º jogador remoto visível. Cache FRIO, rede limitada por CDP (perfis abaixo).
 * Use contra o build de produção (vite build + vite preview) — o servidor de desenvolvimento do Vite serve centenas
 * de módulos soltos e não representa o produto.
 * uso: node tools/qa/time_to_watch.mjs [baseUrl] (servidor de teste próprio na porta PV_TTW_PORT ou 2740, com 1 jogador)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { Client } from '@colyseus/sdk';

const base = process.argv[2] ?? 'http://localhost:5195';
const PORT = Number(process.env.PV_TTW_PORT ?? 2740);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const PROFILES = [
  { name: 'sem limite (localhost)', down: -1, up: -1, latency: 0 },
  { name: '20 Mbit/s · 40 ms', down: 20e6 / 8, up: 5e6 / 8, latency: 40 },
  { name: '10 Mbit/s · 60 ms', down: 10e6 / 8, up: 3e6 / 8, latency: 60 },
];

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let up = false;
server.stdout.on('data', (d) => { if (String(d).includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 100 && !up; i++) await w(200);
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });
// um jogador perto da câmera inicial (Central): "assistir" = ver alguém
const anchor = { x: -660, z: 260 };
const pl = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { body: 'mulher', skin: 1, hair: 1, top: 0xcc3333, bottom: 1, shoes: 1, name: 'Ana', testSpawn: anchor });
for (const t of ['crowd', 'gf', 'gf_del', 'pong', 'spawn']) pl.onMessage(t, () => {});

const out = [];
for (const prof of PROFILES) {
  for (let run = 0; run < 2; run++) {
    const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1280, height: 720 } });
    const p = await browser.newPage();
    const cdp = await p.target().createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: prof.latency, downloadThroughput: prof.down, uploadThroughput: prof.up });
    let bytes = 0;
    cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
    await p.goto(`${base}/?quality=auto&time=10:30&mp=ws://127.0.0.1:${PORT}`);
    await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 120000 });
    const homeBytes = bytes;
    await p.evaluate(() => { window.__ttw0 = performance.now(); void window.__pvLaunch({ role: 'spectator' }); });
    await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
    const frame = await p.evaluate(() => Math.round(performance.getEntriesByName('pv:world-visible')[0].startTime - window.__ttw0));
    await p.waitForFunction('window.__pv.mp()?.remotes?.length > 0', { timeout: 60000 }).catch(() => {});
    const remote = await p.evaluate(() => (window.__pv.mp()?.remotes?.length ? Math.round(performance.now() - window.__ttw0) : -1));
    out.push({ perfil: prof.name, run, cliqueAoQuadroMs: frame, cliqueAoPrimeiroJogadorMs: remote, MB: +((bytes - homeBytes) / 1e6).toFixed(1), MBtelaInicial: +(homeBytes / 1e6).toFixed(1) });
    console.log(JSON.stringify(out[out.length - 1]));
    await browser.close();
  }
}
await pl.leave();
console.log('\n| perfil | clique → 1º quadro | clique → 1º jogador | MB após o clique |\n|---|---|---|---|');
for (const r of out) console.log(`| ${r.perfil} (#${r.run + 1}) | ${(r.cliqueAoQuadroMs / 1000).toFixed(1)} s | ${r.cliqueAoPrimeiroJogadorMs < 0 ? '—' : (r.cliqueAoPrimeiroJogadorMs / 1000).toFixed(1) + ' s'} | ${r.MB} |`);
process.exit(0);
