/**
 * Rodada 8 — tempo até ASSISTIR (espectador sem conta): navegação → mundo jogável, contexto NOVO (cache frio) a cada
 * rodada. Desktop e celular emulado (390×844, toque, rede 4G simulada opcional: NET=4g).
 * uso: BASE=http://localhost:4173 MP=ws://127.0.0.1:2567 node tools/qa/spectator_time.mjs [rodadas=3]
 */
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:4173', MP = process.env.MP ?? 'ws://127.0.0.1:2567';
const N = Number(process.argv[2] ?? 3);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
const out = [];
for (const mobile of [false, true]) {
  for (let i = 0; i < N; i++) {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage();
    if (mobile) await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    else await p.setViewport({ width: 1600, height: 900 });
    if (process.env.NET === '4g') { const c = await p.createCDPSession(); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 }); }
    const t0 = Date.now();
    await p.goto(`${BASE}/?mp=${encodeURIComponent(MP)}`);
    await p.waitForSelector('#home:not(.hidden)');
    const tHome = Date.now() - t0;
    await p.waitForFunction(() => !document.querySelector('#btn-watch').disabled, { timeout: 60000 });
    await p.click('#btn-watch');
    await p.waitForFunction(() => window.__pvReady === true, { timeout: 120000 });
    const r = { mobile, home_ms: tHome, total_ms: Date.now() - t0, click_ms: await p.evaluate(() => window.__pvSpectatorStartMs) };
    out.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
}
await b.close();
