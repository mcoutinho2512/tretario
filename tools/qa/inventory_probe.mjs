/**
 * Rodada 11 — sonda: de onde vêm as texturas novas do renderer do JOGO durante abrir/fechar o inventário?
 * Compara `__pv.memoryReport` por categoria em janelas: parado, 100 ciclos com prévia 3D (ROUPAS), 100 ciclos sem
 * prévia (ITENS), parado de novo. uso: Vite em 5202 → node tools/qa/inventory_probe.mjs [base] (sobe o servidor de teste)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5202';
const PORT = Number(process.env.PV_INV_PORT ?? 3820);
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let up = false;
S.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 150 && !up; i++) await w(200);
const sp = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).spawn.p;
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1366, height: 820 } });
try {
  const p = await b.newPage();
  await p.goto(`${base}/?autostart=1&welcome=0&quality=medium&time=10:30&mp=ws://127.0.0.1:${PORT}&name=Ana&spawn=${sp[0]},${sp[1]}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvInv', { timeout: 150000 });
  await w(8000);
  const snap = () => p.evaluate(() => { const r = window.__pv.memoryReport(false); return { renderer: r.renderer, cats: r.categories }; });
  const cyc = (cat) => p.evaluate(async (c) => { for (let i = 0; i < 100; i++) { window.__pvInv.inv.openPanel(); window.__pvInv.inv.panel.setCategory(c); await new Promise((r) => requestAnimationFrame(r)); window.__pvInv.inv.close(); } }, cat);
  const diff = (a, z) => {
    const o = {};
    for (const k of new Set([...Object.keys(a.cats), ...Object.keys(z.cats)])) { const x = JSON.stringify(a.cats[k]), y = JSON.stringify(z.cats[k]); if (x !== y) o[k] = { from: a.cats[k], to: z.cats[k] }; }
    return { renderer: [a.renderer, z.renderer], cats: o };
  };
  const s0 = await snap(); await w(7000); const s1 = await snap();
  await cyc('ROUPAS'); await w(1500); const s2 = await snap();
  await cyc('ITENS'); await w(1500); const s3 = await snap();
  await w(7000); const s4 = await snap();
  console.log(JSON.stringify({ parado: diff(s0, s1), roupas: diff(s1, s2), itens: diff(s2, s3), parado2: diff(s3, s4) }, null, 1));
} finally {
  await b.close();
  try { process.kill(-S.pid, 'SIGTERM'); } catch { /* */ }
}
