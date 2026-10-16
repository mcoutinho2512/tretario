/**
 * Rodada 7 — ações sociais no multiplayer: 2 clientes reais (um navegador cada) + 1 distante.
 * A dança → B vê · A levanta os braços → B vê · A pega bandeira → B vê · A anda com a bandeira (balançando) → B vê
 * ação e movimento · A pega cartaz / megafone → B vê · A dança e anda → a dança termina nos dois lados (servidor)
 * · C distante não recebe A como jogador detalhado. Fase: B toca a mesma fase que A (relógio comum).
 * Servidor de teste próprio (PV_TEST=1, porta PV_SOCIAL_PORT ou 2655). Requer o dev server.
 * uso: node tools/qa/social_mp.mjs [baseUrl]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_SOCIAL_PORT ?? 2655);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

const browsers = [];
async function open(name, sp) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 800, height: 500 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0]},${sp[1]}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const seeA = async (B) => (await ev(B, () => window.__pv.mp().remotes)).find((r) => r.name === 'A');
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };

const S = [-540, 255];
const A = await open('A', S), B = await open('B', [S[0] + 3, S[1] + 2]);
const C = await open('C', [S[0] + 900, S[1] - 300]);
await w(2500);
const act = (key) => ev(A, (k) => window.__pv.act(k), key);
const prop = (kind, d) => ev(A, (k, dd) => window.__pv.prop(k, dd), kind, d);
const ids = await ev(A, () => ({ dance: 40, arms: 6 }));

async function expectSeen(name, pred, detail) {
  await w(120);
  const r = await until(async () => { const a = await seeA(B); return a && pred(a) ? a : null; });
  const den = await ev(A, () => window.__pv.lastDenial());
  check(name, !!r, (detail ? detail(r ?? (await seeA(B))) : JSON.stringify(r ?? (await seeA(B)) ?? null)) + (r ? '' : ` · negação: ${den}`));
  return r;
}

await act('dance_simple');
const r1 = await expectSeen('A dança → B vê a mesma ação (e o esqueleto toca)', (a) => a.act === ids.dance && (a.visualAct === null || a.visualAct === ids.dance));
const ownPhase = (await ev(A, () => window.__pv.social().local.phase));
const bPhase = (await seeA(B))?.actPhase ?? -1;
check('mesma fase da dança em A e B (relógio comum, ±0,4 s)', Math.abs(ownPhase - bPhase) < 0.4, `A ${ownPhase.toFixed(2)} s · B ${bPhase.toFixed(2)} s`);
void r1;
await act('arms_up');
await expectSeen('A levanta os braços → B vê', (a) => a.act === ids.arms);
await prop('flag_small', 'brasil');
await expectSeen('A pega bandeira (Brasil) → B vê item e design', (a) => a.prop === 1 && a.design === 1);
await act('flag_wave');
await w(400);
const p0 = await seeA(B);
await ev(A, () => window.__pv.press('KeyW', 2500));
await w(2900);
const p1 = await seeA(B);
check('A anda balançando a bandeira → B vê ação mantida e o movimento', p1 && p1.act === 23 && p1.prop === 1 && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, `ação ${p1?.act} · andou ${p1 ? Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) : '?'} m`);
await prop('sign_small', 'democracia');
await expectSeen('A pega cartaz → B vê (e a ação da bandeira termina)', (a) => a.prop === 3 && a.design === 5 && a.act === 0);
await prop('megaphone');
await act('megaphone');
await expectSeen('A usa megafone → B vê', (a) => a.prop === 7 && a.act === 24);
await prop(null);
await act('dance_lively');
await expectSeen('A dança de novo → B vê', (a) => a.act === 41);
await ev(A, () => window.__pv.press('KeyW', 1500));
await expectSeen('A anda → a dança termina para B (servidor cancela)', (a) => a.act === 0);
const own = await ev(A, () => window.__pv.social());
check('A também encerrou localmente e no servidor', own.local.act === 0 && own.server.act === 0, JSON.stringify(own));
const cSees = (await ev(C, () => window.__pv.mp().remotes)).some((r) => r.name === 'A');
check('C distante não recebe A como jogador detalhado', !cSees);
const negado = await ev(A, () => { window.__pv.act('flag_wave'); return new Promise((r) => setTimeout(() => r(window.__pv.mp() && window.__pv.social()), 900)); });
check('ação sem o item é negada (local e servidor)', negado.local.act === 0 && negado.server.act === 0);
for (const b of browsers) await b.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
process.exit(ok === results.length ? 0 : 1);
