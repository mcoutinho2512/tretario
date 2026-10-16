/**
 * Verificação rápida do slice multiplayer depois das mudanças de memória (rodada 6):
 * sobe um servidor de teste próprio (porta 2693, PV_TEST=1), abre 2 navegadores com corpos diferentes,
 * confere que cada um vê o outro (personagem remoto carregado pelo AssetManager), tenta um empurrão
 * (ragdoll/Rapier) e imprime o relatório de memória com a memória WASM.
 * uso (com o cliente rodando): BASE=http://localhost:5173 node tools/qa/mp_memory_check.mjs
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const PORT = Number(process.env.PORT ?? 2693);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });
let up = false; server.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 100 && !up; i++) await w(200);
const errors = [];
const open = async (avatar, name, x) => {
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info'], defaultViewport: { width: 1280, height: 720 } });
  const p = await b.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await p.goto(`${BASE}/?autostart=1&quality=medium&time=10:30&mp=ws://localhost:${PORT}&avatar=${avatar}&name=${name}&spawn=${x},280`);
  await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
  return { b, p };
};
const A = await open('homem', 'MemA', -580);
const B = await open('idosa', 'MemB', -578.5);
await w(5000);
const info = async (x) => x.p.evaluate(() => ({ mp: window.__pv.mp(), m: window.__pv.metrics() }));
const ia = await info(A), ib = await info(B);
console.log('A remotos', ia.m.net?.remotes, 'status', ia.m.net?.status, '| B remotos', ib.m.net?.remotes, 'status', ib.m.net?.status);
// empurrão: A muda para modo interação (se a política permitir) e empurra B
await A.p.evaluate(() => window.__pv.key('KeyK'));
await B.p.evaluate(() => window.__pv.key('KeyK'));
await w(800);
const target = ib.mp?.session;
if (target) await A.p.evaluate((t) => window.__pv.rawPush(t), target);
await w(1500);
console.log('B caído?', await B.p.evaluate(() => window.__pv.isDown()), '| negação A:', await A.p.evaluate(() => window.__pv.lastDenial()));
await w(4000);
const rep = await B.p.evaluate(() => window.__pv.memoryReport(false));
console.log('B memória: heapMB', rep.heap?.usedMB, 'GPU est', rep.totals.gpuEstMB, 'WASM', JSON.stringify(rep.wasm), 'personagens', JSON.stringify(Object.fromEntries(Object.entries(rep.categories).filter(([k]) => k.startsWith('characters')))));
console.log('assets', JSON.stringify({ deduped: rep.assets.imagesDeduped, decoded: rep.assets.imagesDecoded, gltfs: rep.assets.gltfs.length }));
console.log('erros:', errors.length ? errors.join(' | ') : 'nenhum');
await A.b.close(); await B.b.close();
process.exit(errors.length ? 1 : 0);
