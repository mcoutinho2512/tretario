/**
 * Teste ponta a ponta em PRODUÇÃO (rodada 9.1) — navegador real pela internet, sem servidor de teste.
 *
 *   node tools/qa/prod_e2e.mjs <https://dominio> visitor
 *   node tools/qa/prod_e2e.mjs <https://dominio> register <email> <apelido>      → conta PENDENTE (beta)
 *   node tools/qa/prod_e2e.mjs <https://dominio> play     <email>               → entra no mundo, anda, ganha XP
 *   node tools/qa/prod_e2e.mjs <https://dominio> progress <email>               → login e confere o progresso salvo
 *
 * Senha da conta de QA: variável PV_QA_PASSWORD (nunca no repositório). Perfil do navegador por e-mail em
 * screenshots/prod_e2e/<email>/ (cookie de sessão entre as fases). Saída: N/N e JSON com tempos/medidas.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [BASE, PHASE, EMAIL, NICK] = process.argv.slice(2);
const PASS = process.env.PV_QA_PASSWORD ?? '';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const out = { base: BASE, phase: PHASE, at: new Date().toISOString() };
if (!BASE || !PHASE) { console.error('uso: node tools/qa/prod_e2e.mjs <url> visitor|register|play|progress [email] [apelido]'); process.exit(2); }
if (PHASE !== 'visitor' && (!EMAIL || PASS.length < 10)) { console.error('fases com conta precisam de <email> e PV_QA_PASSWORD (≥ 10)'); process.exit(2); }

const profile = `screenshots/prod_e2e/${(EMAIL ?? 'visitante').replace(/[^a-z0-9]/gi, '_')}`;
mkdirSync(profile, { recursive: true });
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', userDataDir: `${profile}/chrome`, args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1280, height: 720 }, protocolTimeout: 240000 });
const p = await b.newPage();
const errors = [], csp = [], wsUrls = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 200)); });
const cdp = await p.createCDPSession();
await cdp.send('Network.enable');
cdp.on('Network.webSocketCreated', (e) => wsUrls.push(e.url));
const api = (path, method = 'GET', body) => p.evaluate(async (path, method, body) => {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, body: j };
}, path, method, body);
const shot = (n) => p.screenshot({ path: `${profile}/${n}.jpg`, type: 'jpeg', quality: 80 });

try {
  if (PHASE === 'visitor') {
    const t0 = Date.now();
    await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    out.homeMs = Date.now() - t0;
    const robots = await p.$eval('meta[name="robots"]', (m) => m.content).catch(() => '');
    check('home abre pela internet (HTTPS)', p.url().startsWith('https://'), `${out.homeMs} ms`);
    check('noindex na home', /noindex/.test(robots));
    check('marca BETA visível', await p.evaluate(() => /BETA/.test(document.body.innerText)));
    await shot('V1_home');
    const t1 = Date.now();
    await p.goto(`${BASE}/?autostart=1&spectate=1&welcome=0`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.session', { timeout: 180000 });
    out.spectateMs = Date.now() - t1;
    await w(4000);
    const m = await p.evaluate(() => ({ mp: window.__pv.mp(), fps: window.__pv.metrics().fps }));
    check('espectador entra no mundo pela internet', !!m.mp?.session, `${out.spectateMs} ms até o mundo`);
    check('multiplayer usa wss://<domínio>/game', wsUrls.some((u) => u.startsWith(BASE.replace('https', 'wss') + '/game')), wsUrls.slice(0, 2).join(' '));
    check('nenhuma violação de CSP', csp.length === 0, csp.slice(0, 2).join(' | '));
    out.visitorFps = Math.round(m.fps);
    await shot('V2_espectador');
  } else if (PHASE === 'register') {
    await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
    const r = await api('/api/auth/register', 'POST', { email: EMAIL, password: PASS, confirm: PASS, nickname: NICK });
    out.register = { status: r.status, registration: r.body?.me?.registration ?? null, state: r.body?.me?.access?.state ?? r.body?.me?.state ?? null };
    check('cadastro público aceito (201)', r.status === 201, JSON.stringify(out.register));
    check('conta fica PENDENTE (beta) — sem código mostrado', r.status === 201 && !JSON.stringify(r.body).match(/\b\d{6}\b|code|codigo/i), '');
    const t = await api('/api/session/ticket', 'POST', {});
    check('sem aprovação: não recebe ticket de jogador', t.status !== 200 || !t.body?.ticket, `status ${t.status} ${t.body?.error ?? ''}`);
  } else if (PHASE === 'play' || PHASE === 'progress') {
    await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
    let me = await api('/api/me');
    if (me.status !== 200 || !me.body?.user) {
      const l = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS });
      check('login', l.status === 200, `status ${l.status} ${l.body?.error ?? ''}`);
      me = await api('/api/me');
    }
    out.me = { state: me.body?.access?.state ?? me.body?.state, nickname: me.body?.profile?.nickname };
    const before = await api('/api/me/progress');
    out.progressBefore = { status: before.status, xp: before.body?.xp ?? before.body?.progress?.xp, level: before.body?.level ?? before.body?.progress?.level, missions: (before.body?.completedMissions ?? before.body?.progress?.completedMissions ?? []).length };
    if (PHASE === 'progress') {
      check('progresso salvo continua lá (XP > 0)', (out.progressBefore.xp ?? 0) > 0, JSON.stringify(out.progressBefore));
    } else {
      const t1 = Date.now();
      // mesmo caminho do botão "Entrar" da home (com papel → multiplayer + ticket da conta); ?autostart=1 é o modo local
      await p.goto(`${BASE}/?welcome=0`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 60000 });
      await w(3000); // a home lê /api/me (conta) antes
      await p.evaluate(() => window.__pvLaunch({ role: 'player' }));
      await p.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.session', { timeout: 180000 });
      out.playMs = Date.now() - t1;
      const role = await p.evaluate(() => window.__pv.mp()?.role ?? (window.__pv.spectator?.() ? 'spectator' : 'player'));
      check('entra no mundo como JOGADOR pela internet', role !== 'spectator', `${out.playMs} ms · papel ${role}`);
      await w(3000);
      await p.evaluate(() => window.__pv.press?.('KeyW', 9000));
      await w(9500);
      await p.evaluate(() => window.__pv.jump?.());
      await w(1500);
      await shot('P1_jogador');
      // progressão é gravada em lote (≤ 15 s) — espera e lê pela API
      let xp = 0;
      for (let i = 0; i < 12 && !(xp > 0); i++) { await w(3000); const pr = await api('/api/me/progress'); xp = pr.body?.xp ?? pr.body?.progress?.xp ?? 0; out.progressAfter = pr.body; }
      check('andou e ganhou XP (salvo no servidor)', xp > 0, `xp ${xp}`);
      check('nenhuma violação de CSP / erro de página', csp.length === 0 && errors.length === 0, [...csp, ...errors].slice(0, 2).join(' | '));
      const lo = await api('/api/auth/logout', 'POST', {});
      check('logout', lo.status === 200 || lo.status === 204, `status ${lo.status}`);
      const l2 = await api('/api/auth/login', 'POST', { email: EMAIL, password: PASS });
      const pr2 = await api('/api/me/progress');
      check('login de novo: XP continua', l2.status === 200 && (pr2.body?.xp ?? pr2.body?.progress?.xp ?? 0) === xp, `xp ${pr2.body?.xp ?? pr2.body?.progress?.xp}`);
    }
  }
} catch (e) { check('roteiro sem exceção', false, String(e).slice(0, 300)); }
out.errors = errors.slice(0, 5); out.csp = csp.slice(0, 5); out.ws = wsUrls.slice(0, 3);
writeFileSync(`${profile}/${PHASE}.json`, JSON.stringify(out, null, 1));
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} verificações OK`);
await b.close();
process.exit(ok === results.length ? 0 : 1);
