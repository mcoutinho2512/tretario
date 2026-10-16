/**
 * Teste multiplayer de ponta a ponta: 2 navegadores na mesma sala.
 * Requer: servidor (cd server && npm run dev) e cliente (npm run dev).
 */
import puppeteer from 'puppeteer-core';
const base = process.argv[2] ?? 'http://localhost:5173';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (avatar, name) => {
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1280, height: 720 } });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=16:30&mp=1&avatar=${avatar}&name=${name}`);
  await p.waitForFunction('window.__pvReady === true', { timeout: 120000 });
  return { b, p };
};
const A = await open('homem', 'Jogador_A');
const B = await open('idosa', 'Jogador_B');
await w(2500);
const m = async (x) => x.p.evaluate(() => window.__pv.metrics());
console.log('A net', JSON.stringify((await m(A)).net), '| B net', JSON.stringify((await m(B)).net));
const a0 = (await m(A)).player;
// A anda para frente 3 s
await A.p.evaluate(() => window.__pv.press('KeyW', 3000));
await w(3800);
const a1 = (await m(A)).player;
// posição de A vista por B (pelo estado remoto renderizado)
const seen = await B.p.evaluate(() => window.__pvRemotes?.() ?? null);
console.log('A moveu de', a0, 'para', a1);
console.log('B vê remotos:', JSON.stringify(seen));
// screenshot de B olhando para A
await B.p.evaluate((pos) => { const p = window.__pv.metrics().player; window.__pv.camera(Math.atan2(pos.x - p.x, pos.z - p.z), 0.15, 5); }, a1);
await w(1200);
await B.p.screenshot({ path: 'screenshots/tmp/mp_B_ve_A.png' });
// A sai
await A.b.close();
await w(2500);
console.log('após saída de A, B vê:', JSON.stringify(await B.p.evaluate(() => window.__pvRemotes?.() ?? null)));
// anti-trapaça: B tenta teleportar 300 m → servidor deve corrigir
const corrBefore = (await m(B)).net.corrections;
await B.p.evaluate(() => { const p = window.__pv.metrics().player; window.__pv.teleport(p.x + 300, p.z); });
await w(1500);
const after = await m(B);
console.log('teleporte: correções', corrBefore, '→', after.net.corrections, '| posição final de B', JSON.stringify(after.player));
await B.b.close();
