/**
 * Rodada 9.1 — telas de produção no navegador real (servidor de teste próprio, PV_REGISTRATION=beta, sala sem vaga
 * para JOGADORES: MAX_PLAYERS_PER_ROOM=0):
 *  1. cadastro BETA: o formulário mostra "Cadastro recebido" (nenhum campo de código, nenhum código na página nem na
 *     resposta) e a home diz "aguardando liberação beta"; selo BETA no início
 *  2. sala cheia: entrar jogando → aviso "Sala cheia" (sem travar) → ENTRAR COMO ESPECTADOR → assiste
 *  3. versão antiga (?pvTest=0 simula bundle velho) → "Nova versão disponível" com RECARREGAR; selo BETA no HUD
 * uso: node tools/qa/beta_ui.mjs [baseUrl] [--port=2960]   (o Vite precisa de PV_API=http://127.0.0.1:<port+1>)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../../server', import.meta.url));
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:5312';
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] ?? 2960);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: SERVER, env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_REGISTRATION: 'beta', MAX_PLAYERS_PER_ROOM: '0', MAX_SPECTATORS_PER_ROOM: '50', PV_LOG_QUIET: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const log = [];
srv.stdout.on('data', (d) => log.push(...String(d).split('\n').filter(Boolean)));
srv.stderr.on('data', (d) => log.push(...String(d).split('\n').filter(Boolean)));
for (let i = 0; i < 120 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

let browser;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1000, height: 640 } });
  // ---------------------------------------------------------------- 1. cadastro beta
  const p = await browser.newPage();
  const bodies = [];
  p.on('response', async (r) => { if (r.url().includes('/api/auth/register')) { try { bodies.push(await r.text()); } catch { /* */ } } });
  const MP = `mp=ws://127.0.0.1:${PORT}`;
  await p.goto(`${base}/?welcome=0&quality=low&${MP}`);
  await p.waitForSelector('#btn-join', { visible: true });
  check('selo BETA no início', await p.$eval('.logo .beta-tag', (e) => e.textContent === 'BETA' && e.offsetParent !== null).catch(() => false));
  check('noindex,nofollow no index.html', await p.$eval('meta[name=robots]', (e) => e.content).catch(() => '') === 'noindex,nofollow');
  await p.click('#btn-join');
  await p.waitForSelector('#a-nick', { visible: true });
  const email = `beta${Date.now()}@exemplo.test`;
  await p.type('#a-email', email);
  await p.type('#a-nick', `Beta${Date.now().toString(36).slice(-4)}`);
  await p.type('#a-pass', 'Lapa#Arcos2026');
  await p.type('#a-pass2', 'Lapa#Arcos2026');
  await w(600);
  await p.click('.acct-card .submit, form .submit').catch(async () => { await p.keyboard.press('Enter'); });
  const title = await p.waitForFunction(() => document.getElementById('acct-title')?.textContent === 'Cadastro recebido', { timeout: 15000 }).then(() => true).catch(() => false);
  const lead = await p.evaluate(() => document.getElementById('acct-title')?.parentElement?.querySelector('.lead')?.textContent ?? '');
  check('cadastro beta: "Cadastro recebido — liberado pela equipe"', title && /liberado pela equipe/.test(lead), lead.slice(0, 80));
  check('nenhum campo de código e nenhum código na página', await p.evaluate(() => !document.getElementById('a-code') && !/\b\d{6}\b/.test(document.body.innerText)));
  check('resposta do cadastro sem código', bodies.length > 0 && !/\b\d{6}\b/.test(bodies.join()) && /"registration":"beta"/.test(bodies.join()), bodies[0]?.slice(0, 120));
  const outbox = await p.evaluate(async () => (await fetch('/api/dev/outbox')).status);
  check('caixa de saída de dev inexistente no beta', outbox === 404, `status ${outbox}`);
  await p.click('form .submit');
  const sub = await p.waitForFunction(() => /aguardando liberação beta/.test(document.getElementById('btn-join-sub')?.textContent ?? ''), { timeout: 8000 }).then(() => true).catch(() => false);
  check('home: conta pendente "aguardando liberação beta"', sub, await p.evaluate(() => `${document.getElementById('btn-join-sub')?.textContent} · ${document.getElementById('home-msg')?.textContent}`));
  await p.close();

  // ---------------------------------------------------------------- 2. sala cheia → espectador
  const q = await browser.newPage();
  await q.goto(`${base}/?autostart=1&welcome=0&quality=low&time=10:30&${MP}`);
  const t0 = Date.now();
  const full = await q.waitForSelector('.net-notice[data-kind=full]', { timeout: 180000 }).then(() => true).catch(() => false);
  const txt = full ? await q.$eval('.net-notice', (e) => e.innerText) : '';
  check('sala cheia: aviso claro, sem travar', full && /Sala cheia/.test(txt) && /espectador/i.test(txt), `${txt.replace(/\s+/g, ' ').slice(0, 90)} (${Date.now() - t0} ms após abrir)`);
  if (full) {
    await Promise.all([q.waitForNavigation({ timeout: 30000 }).catch(() => {}), q.click('.net-notice button.primary')]);
    const watching = await q.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.role === "spectator" && window.__pv.mp().status === "online"', { timeout: 180000 }).then(() => true).catch(() => false);
    check('ENTRAR COMO ESPECTADOR → assiste (papel do servidor)', watching, q.url().replace(base, ''));
    check('selo BETA no HUD', await q.$eval('.attribution .beta-tag', (e) => e.textContent === 'BETA').catch(() => false));
  }
  await q.close();

  // ---------------------------------------------------------------- 3. versão antiga
  const r = await browser.newPage();
  await r.goto(`${base}/?autostart=1&spectate=1&welcome=0&quality=low&time=10:30&${MP}&pvTest=0`);
  const ver = await r.waitForSelector('.net-notice[data-kind=protocol]', { timeout: 180000 }).then(() => true).catch(() => false);
  const vtxt = ver ? await r.$eval('.net-notice', (e) => e.innerText) : '';
  check('versão diferente: "Nova versão disponível" com RECARREGAR', ver && /Nova versão disponível/.test(vtxt) && /RECARREGAR/.test(vtxt), vtxt.replace(/\s+/g, ' ').slice(0, 90));
  await r.close();
} catch (e) {
  check(`execução sem exceção (${e.message})`, false);
} finally {
  await browser?.close().catch(() => {});
  srv.kill('SIGTERM');
  await new Promise((res) => { srv.once('exit', res); setTimeout(res, 5000); });
}
const pass = results.filter((x) => x.ok).length;
console.log(`\n[beta_ui] ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
