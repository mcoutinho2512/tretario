/**
 * Memória e custo dos grafites (offline): cria 1 e depois 100 grafites típicos perto do jogador (hook de medição
 * `__pv.gf.stress`) e mede GPU (páginas do atlas), texturas, heap JS e draw calls/tempo de quadro.
 * uso: node tools/qa/graffiti_memory.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info', '--js-flags=--expose-gc'], defaultViewport: { width: 1280, height: 720 } });
const p = await browser.newPage();
await p.goto(`${base}/?autostart=1&quality=high&time=10:30`);
await p.waitForFunction('window.__pvReady === true', { timeout: 120000 });
await p.evaluate(() => window.__pv.teleport(-612, 248, Math.PI));
await p.evaluate(() => window.__pv.peds(0)); // sem pedestres: medição sem ruído
await w(5000);
const sample = async () => {
  await p.evaluate(() => window.gc?.());
  await w(800);
  return p.evaluate(() => { const m = window.__pv.metrics(); const g = window.__pv.graffiti().renderer; return { heapMB: m.heapMB, textures: m.textures, calls: m.calls, cpuMs: m.cpuMs, gpuMs: m.gpuMs, ...g }; });
};
const s0 = await sample();
const one = await p.evaluate(() => window.__pv.gf.stress(1, true));
const s1 = await sample();
const hundred = await p.evaluate(() => window.__pv.gf.stress(99, true));
await w(2000);
const s100 = await sample();
const out = {
  at: new Date().toISOString(),
  base: s0, um: { stress: one, ...s1 }, cem: { stress: hundred, ...s100 },
  porGrafite: { conteudoBytes: hundred.avgBytes, gpuTileKB: +(s1.tileBytes / 1024).toFixed(0), heapKB: +(((s100.heapMB - s1.heapMB) * 1e6) / 99 / 1024).toFixed(1) },
  por100: { gpuMB: +(s100.gpuBytes / 1e6).toFixed(1), paginas: s100.pages, tiles: s100.tiles, heapMB: +(s100.heapMB - s0.heapMB).toFixed(1), drawCallsExtra: s100.calls - s0.calls },
};
console.log(JSON.stringify(out, null, 1));
mkdirSync('screenshots/round7/graffiti', { recursive: true });
writeFileSync('screenshots/round7/graffiti/memory.json', JSON.stringify(out, null, 1));
await browser.close();
