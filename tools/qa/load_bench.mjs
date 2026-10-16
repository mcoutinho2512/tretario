/**
 * Carregamento como jogo web (build de produção servido como em produção: tools/qa/static_server.mjs).
 * Para cada perfil de rede: 1ª visita SEM cache e 2ª visita COM cache (mesmo contexto do navegador).
 * Marcos (desde o início da navegação): home visível · botão "Explorar" pronto · mundo visível · pode andar;
 * bytes transferidos até cada marco e após 30 s de jogo (carregamento progressivo).
 * uso: npm run build && node tools/qa/load_bench.mjs   → screenshots/load_bench.json
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = 4180;
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILES = [
  { name: 'sem limite (localhost)', net: null },
  { name: '4G típico (9 Mbps, RTT 85 ms)', net: { offline: false, downloadThroughput: (9e6 / 8), uploadThroughput: (1.5e6 / 8), latency: 85 } },
  { name: '4G lento (1,6 Mbps, RTT 150 ms)', net: { offline: false, downloadThroughput: (1.6e6 / 8), uploadThroughput: (0.75e6 / 8), latency: 150 } },
];
const w = (ms) => new Promise((r) => setTimeout(r, ms));

try { await fetch(BASE); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const srv = spawn('node', ['tools/qa/static_server.mjs', String(PORT)], { stdio: 'ignore', detached: true });
process.on('exit', () => { try { process.kill(-srv.pid); } catch { /* */ } });
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await w(100); } }

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1366, height: 768 } });

async function visit(page, cdp, label) {
  const reqs = new Map();
  let bytes = 0, requests = 0, cached = 0, revalidated = 0;
  const onResp = (e) => {
    reqs.set(e.requestId, e.response.url);
    if (e.response.fromDiskCache || e.response.fromMemoryCache) cached++;
    if (e.response.status === 304) revalidated++;
  };
  const onDone = (e) => { bytes += e.encodedDataLength; requests++; };
  const onCache = () => { cached++; };
  cdp.on('Network.responseReceived', onResp);
  cdp.on('Network.loadingFinished', onDone);
  cdp.on('Network.requestServedFromCache', onCache);
  const snap = () => ({ mb: +(bytes / 1e6).toFixed(2), requests });
  const t0 = Date.now();
  await page.goto(`${BASE}/?quality=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => performance.getEntriesByName('pv:home').length > 0, { timeout: 120000 });
  const atHome = snap();
  await page.waitForFunction(() => !document.getElementById('explore').disabled, { timeout: 300000 });
  const atReady = snap();
  const readyMs = Date.now() - t0;
  await page.click('#explore');
  await page.waitForFunction(() => performance.getEntriesByName('pv:world-visible').length > 0, { timeout: 600000 });
  const atWorld = snap();
  const marks = await page.evaluate(() => {
    const m = (n) => Math.round(performance.getEntriesByName(n)[0]?.startTime ?? -1);
    const nav = performance.getEntriesByType('navigation')[0];
    return { home: m('pv:home'), worldVisible: m('pv:world-visible'), playable: m('pv:playable'), domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? -1) };
  });
  await w(30000);
  const after30 = snap();
  const metrics = await page.evaluate(() => window.__pv?.metrics?.());
  cdp.off('Network.responseReceived', onResp);
  cdp.off('Network.loadingFinished', onDone);
  cdp.off('Network.requestServedFromCache', onCache);
  const r = {
    visit: label, homeMs: marks.home, exploreReadyMs: readyMs, worldVisibleMs: marks.worldVisible, playableMs: marks.playable,
    mbAtHome: atHome.mb, mbAtReady: atReady.mb, mbAtWorld: atWorld.mb, mbAfter30s: after30.mb,
    requests: after30.requests, fromCache: cached, revalidated304: revalidated, heapMB: metrics?.heapMB ?? null,
  };
  console.log(JSON.stringify(r));
  return r;
}

const out = [];
for (const prof of PROFILES) {
  const ctx = await browser.createBrowserContext(); // perfil limpo: cache vazio
  const page = await ctx.newPage();
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  if (prof.net) await cdp.send('Network.emulateNetworkConditions', prof.net);
  console.log(`== ${prof.name}`);
  const cold = await visit(page, cdp, 'primeira visita (sem cache)');
  const warm = await visit(page, cdp, 'segunda visita (com cache)');
  out.push({ profile: prof.name, cold, warm });
  await ctx.close();
}
mkdirSync('screenshots', { recursive: true });
writeFileSync('screenshots/load_bench.json', JSON.stringify(out, null, 2));
await browser.close();
process.exit(0);
