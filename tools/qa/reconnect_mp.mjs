/**
 * Rodada 8 — RECONEXÃO, graça e LOGIN DUPLICADO (um navegador por cliente; servidor de teste próprio, graça de 10 s).
 *  1. A (conta de teste qa_a) segura uma bandeira; B observa. Queda artificial de A (WebSocket derrubado + rede
 *     offline): B vê A EM GRAÇA (uma entidade, marcada) e A mostra RECONECTANDO; rede volta → A reconecta na MESMA
 *     entidade (mesmo id, posição e item restaurados) e B continua vendo exatamente UMA entidade de A; A volta a andar.
 *  2. Graça vencida: A fica offline além do prazo → a entidade some para B (sem fantasma); rede volta → A entra de novo
 *     como entidade nova (uma só).
 *  3. Login duplicado: A2 entra com a MESMA conta → a sessão antiga recebe session_replaced e fecha (sem reconectar);
 *     B vê UMA entidade "A" (a nova); um espectador da mesma conta não derruba ninguém.
 * uso: node tools/qa/reconnect_mp.mjs [baseUrl]   (PV_RECONNECT_PORT, padrão 2740; graça PV_GRACE_S=10)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const base = process.argv[2] ?? 'http://localhost:5194';
const PORT = Number(process.env.PV_RECONNECT_PORT ?? 2740);
const GRACE_S = 10; // curta para o teste (produção: 20 s); maior que o atraso máximo entre tentativas (4 s) + a queda simulada (~3 s)
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_GRACE_S: String(GRACE_S) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

const browsers = [];
async function open(name, sp, extra = '') {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 800, height: 500 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  const cdp = await p.target().createCDPSession();
  await cdp.send('Network.enable');
  p.offline = (on) => cdp.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await p.goto(`${base}/?autostart=1&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0]},${sp[1]}${extra}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
const As = async (B) => (await ev(B, () => window.__pv.mp().remotes)).filter((r) => r.name === 'A');
const mp = (p) => ev(p, () => { const m = window.__pv.mp(); return { session: m.session, link: m.link, status: m.status, reconnects: m.reconnects, rejoins: m.rejoins, replaced: m.replaced, social: m.self.social }; });
const pos = (p) => ev(p, () => window.__pv.metrics().player);
const S = [-540, 255];

const A = await open('A', S, '&testUser=qa_a');
const B = await open('B', [S[0] + 4, S[1] + 3]);
await w(2000);
await ev(A, () => window.__pv.prop('flag_small', 'brasil'));
await ev(A, () => window.__pv.press('KeyW', 1200));
await w(2200);
const a0 = await mp(A), p0 = await pos(A);
check('A segura a bandeira (servidor confirma)', a0.social.prop === 1, JSON.stringify(a0.social));

// ---------------------------------------------------------------- 1. queda curta → reconecta na mesma entidade
const t0 = Date.now();
await A.offline(true);
await ev(A, () => window.__pv.netDrop());
const grace = await until(async () => { const l = await As(B); return l.length === 1 && l[0].link === 1 ? l : null; }, 6000);
check('queda: B vê A EM GRAÇA (uma entidade, marcada)', !!grace, JSON.stringify((await As(B)).map((r) => ({ id: r.id, link: r.link }))));
check('queda: A mostra RECONECTANDO…', (await mp(A)).link === 'RECONNECTING', (await mp(A)).link);
await w(1500);
check('durante a graça continua UMA entidade de A', (await As(B)).length === 1);
await A.offline(false);
const back = await until(async () => { const m = await mp(A); return m.link === 'CONNECTED' && m.reconnects >= 1 ? m : null; }, 12000);
const tBack = Date.now() - t0;
check('A reconecta na MESMA entidade (mesmo id)', back && back.session === a0.session && back.rejoins === 0, `${tBack} ms desde a queda (≈3 s offline) · ${JSON.stringify(back)}`);
await w(800);
const afterB = await As(B);
check('B vê exatamente UMA entidade de A, conectada', afterB.length === 1 && afterB[0].link === 0 && afterB[0].id === a0.session, JSON.stringify(afterB.map((r) => ({ id: r.id, link: r.link }))));
const p1 = await pos(A), a1 = await mp(A);
check('estado restaurado: posição e item na mão', Math.hypot(p1.x - p0.x, p1.z - p0.z) < 1.5 && a1.social.prop === 1 && afterB[0].prop === 1, `deslocamento ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m · item ${a1.social.prop}/${afterB[0].prop}`);
const q0 = afterB[0];
await ev(A, () => window.__pv.press('KeyD', 1200));
await w(1800);
const q1 = (await As(B))[0];
check('depois de reconectar A anda e B vê', q1 && Math.hypot(q1.x - q0.x, q1.z - q0.z) > 1, `${q1 ? Math.hypot(q1.x - q0.x, q1.z - q0.z).toFixed(1) : '?'} m`);

// ---------------------------------------------------------------- 2. graça vencida → some (sem fantasma) → entra de novo
await A.offline(true);
await ev(A, () => window.__pv.netDrop());
await until(async () => (await As(B))[0]?.link === 1, 5000);
const gone = await until(async () => (await As(B)).length === 0, (GRACE_S + 6) * 1000);
check(`graça vencida (${GRACE_S} s): a entidade de A some para B — sem fantasma`, !!gone, JSON.stringify(await As(B)));
const srvLeft = log.some((l) => l.includes(`saiu ${a0.session}`));
check('servidor removeu a entidade antiga', srvLeft);
await A.offline(false);
const fresh = await until(async () => { const m = await mp(A); return m.link === 'CONNECTED' && m.rejoins >= 1 && m.status === 'online' ? m : null; }, 30000);
check('rede volta: A entra de novo como entidade NOVA', fresh && fresh.session !== a0.session, JSON.stringify(fresh));
const one = await until(async () => { const l = await As(B); return l.length === 1 && l[0].id === fresh?.session ? l : null; }, 8000);
check('B vê UMA entidade de A (a nova)', !!one, JSON.stringify((await As(B)).map((r) => r.id)));

// ---------------------------------------------------------------- 3. login duplicado: a sessão nova assume
const pBefore = await pos(A);
const oldSid = (await mp(A)).session;
const A2 = await open('A', [S[0] - 30, S[1] + 10], '&testUser=qa_a');
const repl = await until(async () => (await mp(A)).replaced, 6000);
check('sessão antiga recebe session_replaced e para (sem reconectar)', !!repl && (await mp(A)).status === 'offline');
await w(1500);
const a2 = await mp(A2);
const listB = await As(B);
check('B vê UMA entidade "A" — a da sessão nova', listB.length === 1 && listB[0].id === a2.session && a2.session !== oldSid, JSON.stringify(listB.map((r) => r.id)));
const pA2 = await pos(A2);
check('a sessão nova continua de onde a antiga estava', Math.hypot(pA2.x - pBefore.x, pA2.z - pBefore.z) < 3, `${Math.hypot(pA2.x - pBefore.x, pA2.z - pBefore.z).toFixed(2)} m`);
await w(3000);
check('a sessão antiga não volta (sem duplicar)', (await As(B)).length === 1 && (await mp(A)).status === 'offline');
check('servidor registrou a substituição', log.some((l) => l.includes('substituída')));
// espectador da MESMA conta é permitido e não derruba o jogador
const SB = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 640, height: 400 } });
browsers.push(SB);
const sp = await SB.newPage();
await sp.goto(`${base}/?autostart=1&spectate=1&quality=low&mp=ws://127.0.0.1:${PORT}&testUser=qa_a`);
await sp.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
await w(1500);
check('aba de espectador da mesma conta: permitida, jogador segue', (await mp(A2)).replaced === false && (await mp(A2)).status === 'online' && (await ev(sp, () => window.__pv.mp().role)) === 'spectator');

for (const b of browsers) await b.close();
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
process.exit(ok === results.length ? 0 : 1);
