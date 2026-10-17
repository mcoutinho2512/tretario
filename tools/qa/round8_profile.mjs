/**
 * QA rodada 8 — início, conta, editor, grupos, persistência em OUTRO navegador e tempo até assistir.
 * Requer servidor de jogo + API (PORT/PORT+1) e Vite com proxy /api. Códigos de e-mail: GET /api/dev/outbox.
 * uso: BASE=http://localhost:5192 MP=ws://127.0.0.1:2720 node tools/qa/round8_profile.mjs [saida]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const MP = process.env.MP ?? 'ws://127.0.0.1:2567';
const OUT = process.argv[2] ?? 'screenshots/round8';
mkdirSync(OUT, { recursive: true });
const report = { base: BASE, steps: [] };
const log = (k, v) => { report.steps.push({ k, v }); console.log(k, typeof v === 'string' ? v : JSON.stringify(v)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = (q = '') => `${BASE}/?mp=${encodeURIComponent(MP)}&time=16:30${q}`;

async function newPage(ctx, mobile = false) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') log('console', m.text().slice(0, 200)); });
  if (mobile) {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  } else await page.setViewport({ width: 1600, height: 900 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const code = async (email) => {
  for (let i = 0; i < 20; i++) {
    const box = await (await fetch(`${BASE}/api/dev/outbox`)).json().catch(() => []);
    const m = (Array.isArray(box) ? box : box.messages ?? []).filter((x) => (x.to ?? x.email) === email).pop();
    const c = m && (m.code ?? String(m.text ?? m.body ?? '').match(/\b\d{6}\b/)?.[0]);
    if (c) return c;
    await sleep(300);
  }
  throw new Error('sem código no outbox');
};
const type = async (page, sel, text) => { await page.$eval(sel, (e) => { e.value = ''; }); await page.type(sel, text); };

const stamp = Date.now().toString(36).slice(-5);
const email = `qa${stamp}@exemplo.test`, nick = `Carioca${stamp}`, pass = 'avenida2026';

// ---------------------------------------------------------------- A: início (desktop)
const ctxA = await browser.createBrowserContext();
const page = await newPage(ctxA);
await page.goto(url());
await page.waitForSelector('#home:not(.hidden)');
await page.waitForFunction(() => !document.querySelector('#btn-watch').disabled, { timeout: 60000 });
await sleep(1500);
log('home.live', await page.$eval('#home-live', (e) => e.textContent));
log('home.event', await page.$eval('#home-event', (e) => e.textContent));
await shot(page, 'A_home');

// ---------------------------------------------------------------- D: cadastro
await page.click('#btn-join');
await page.waitForSelector('#a-nick');
await type(page, '#a-email', email);
await type(page, '#a-nick', 'admin');
await sleep(400);
log('nick.reservado', await page.$eval('#a-nick-hint', (e) => e.textContent));
await type(page, '#a-nick', nick);
await page.waitForFunction(() => /está disponível/.test(document.querySelector('#a-nick-hint').textContent), { timeout: 5000 }).catch(() => {});
log('nick.livre', await page.$eval('#a-nick-hint', (e) => e.textContent));
await type(page, '#a-pass', pass);
await type(page, '#a-pass2', pass);
await shot(page, 'D_cadastro');
await page.keyboard.press('Enter'); // Enter envia
await page.waitForSelector('#a-code');
await shot(page, 'D2_verificar_email');
await page.type('#a-code', await code(email)); // 6 dígitos enviam sozinhos
// ---------------------------------------------------------------- E: editor
await page.waitForSelector('#start:not(.hidden)', { timeout: 15000 });
await page.waitForFunction(() => window.__pvStart?.preview, { timeout: 30000 });
await page.waitForSelector('#preview-loading.hidden', { timeout: 30000 });
log('editor.title', await page.$eval('#editor-title', (e) => e.textContent));
// visual escolhido à mão: mulher, regata, bermuda, cabelo crespo
await page.click('label.char:nth-child(2)');
await page.click('.style-chips[data-slot=HAIR] [data-style=afro]');
await page.click('.style-chips[data-slot=SHIRT] [data-style=regata]');
await page.click('.style-chips[data-slot=PANTS] [data-style=bermuda]');
await page.click('.swatches[data-key=skin] .swatch:nth-child(5)');
await page.click('.swatches[data-key=top] .swatch:nth-child(5)');
await sleep(6000); // peças avulsas (GLB) chegam depois do corpo
await shot(page, 'E_editor');
await page.click('#randomize');
await sleep(1800);
const r1 = await page.evaluate(() => window.__pvStart.look());
await page.click('#randomize');
await sleep(1800);
const r2 = await page.evaluate(() => window.__pvStart.look());
log('surpreenda.diferentes', JSON.stringify(r1) !== JSON.stringify(r2));
await shot(page, 'E2_editor_surpreenda');
await page.click('.pose-btn[data-zoom="1"]'); await page.click('.pose-btn[data-zoom="1"]');
await sleep(1500);
await shot(page, 'E3_editor_rosto');
await page.click('.pose-btn[data-zoom="-1"]'); await page.click('.pose-btn[data-zoom="-1"]');
const chosen = await page.evaluate(() => window.__pvStart.look());
await page.click('#explore');
// ---------------------------------------------------------------- G: escolha de grupo
await page.waitForSelector('.groups:not(.hidden) .group-card', { timeout: 15000 });
await sleep(400);
await shot(page, 'G_escolha_grupo');
await page.click('.group-card[data-key="grupo-13"]');
await sleep(200);
await shot(page, 'G2_grupo13_marcado');
const t0 = Date.now();
await page.click('#g-ok');
// ---------------------------------------------------------------- F: personagem salvo no mundo (jogador, com ticket)
await page.waitForFunction(() => window.__pv && window.__pvReady === true, { timeout: 120000 });
log('player.load_ms', Date.now() - t0);
await page.waitForFunction(() => window.__pvRemotes !== undefined, { timeout: 20000 }).catch(() => {});
await sleep(4000);
const me = await page.evaluate(async () => (await fetch('/api/me')).json());
log('me.membership', me.membership);
const norm = (a) => JSON.stringify(Object.keys(a ?? {}).sort().map((k) => [k, a[k]]));
// "vestir camiseta nas cores do grupo" estava marcado: só a parte de cima muda
log('me.appearance_igual_editor_exceto_camisa', norm({ ...me.appearance, top: 0, topStyle: '', shirtDesign: 0 }) === norm({ ...chosen, top: 0, topStyle: '', shirtDesign: 0 }));
log('me.camisa_cor_grupo13', me.appearance.top === 0xc8102e && me.appearance.topStyle === 'camiseta');
await page.evaluate(() => { window.__pv.portrait(3.2); });
await sleep(1500);
await shot(page, 'F_personagem_no_mundo');
// H/I/J: o mesmo personagem em cada grupo (camiseta nas cores + bandeira sugerida)
for (const [k, file, design] of [['grupo-13', 'H_grupo13', 'campanha_13'], ['grupo-22', 'I_grupo22', 'campanha_22'], ['neutro', 'J_neutro', 'paz']]) {
  await page.evaluate(async (k) => {
    const ev = await (await fetch('/api/events/current')).json();
    const g = ev.groups.find((x) => x.key === k);
    await fetch('/api/events/current/membership', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupKey: k }) });
    const cur = (await (await fetch('/api/me/appearance')).json()).appearance;
    const app = { ...cur, topStyle: 'camiseta', top: parseInt(g.colors[0].slice(1), 16), shirtDesign: 0 };
    const saved = (await (await fetch('/api/me/appearance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: app }) })).json()).appearance;
    window.__pv.setAppearance(saved);
    return saved;
  }, k);
  await page.evaluate((d) => { window.__pv.prop('flag_small', d); window.__pv.portrait(4.2); }, design);
  await sleep(2500);
  await shot(page, file);
}

// ---------------------------------------------------------------- persistência: OUTRO perfil de navegador
const ctxB = await browser.createBrowserContext();
const pageB = await newPage(ctxB);
await pageB.goto(url());
await pageB.waitForSelector('#home:not(.hidden)');
await pageB.click('#btn-login2');
await pageB.waitForSelector('#a-pass');
await type(pageB, '#a-email', email);
await type(pageB, '#a-pass', pass);
await pageB.keyboard.press('Enter');
await pageB.waitForFunction(() => !document.querySelector('#home-me').classList.contains('hidden'), { timeout: 15000 });
const meA = await page.evaluate(async () => (await fetch('/api/me')).json());
const meB = await pageB.evaluate(async () => (await fetch('/api/me')).json());
log('persist.appearance_igual', JSON.stringify(meA.appearance) === JSON.stringify(meB.appearance));
log('persist.membership_igual', JSON.stringify(meA.membership) === JSON.stringify(meB.membership));
log('persist.prefs', meB.preferences);
await sleep(500);
await shot(pageB, 'K_outro_navegador_logado');
await pageB.reload();
await pageB.waitForFunction(() => !document.querySelector('#home-me').classList.contains('hidden'), { timeout: 15000 });
log('session.restore_reload', await pageB.$eval('#home-who', (e) => e.textContent));
log('localStorage.sem_token', await pageB.evaluate(() => Object.keys(localStorage).filter((k) => /token|sess|cookie/i.test(k))));
await ctxB.close();

// ---------------------------------------------------------------- espectador: tempo até assistir (sem conta)
const ctxS = await browser.createBrowserContext();
const pageS = await newPage(ctxS);
const tNav = Date.now();
await pageS.goto(url());
await pageS.waitForFunction(() => !document.querySelector('#btn-watch').disabled, { timeout: 60000 });
const tReady = Date.now();
await pageS.click('#btn-watch');
await pageS.waitForFunction(() => window.__pvReady === true, { timeout: 120000 });
const tIn = Date.now();
log('spectator.ms_navegacao_ate_mundo', tIn - tNav);
log('spectator.ms_clique_ate_mundo', await pageS.evaluate(() => window.__pvSpectatorStartMs));
log('spectator.ms_home_pronta', tReady - tNav);
await sleep(3000);
await shot(pageS, 'S_espectador');
await ctxS.close();

// ---------------------------------------------------------------- U: celular (início, entrar, editor)
const ctxM = await browser.createBrowserContext();
const pm = await newPage(ctxM, true);
await pm.goto(url());
await pm.waitForSelector('#home:not(.hidden)');
await sleep(1500);
await shot(pm, 'U1_mobile_home');
await pm.tap('#btn-login2');
await pm.waitForSelector('#a-pass');
await type(pm, '#a-email', email);
await type(pm, '#a-pass', pass);
await shot(pm, 'U2_mobile_login');
await pm.keyboard.press('Enter');
await pm.waitForFunction(() => !document.querySelector('#home-me').classList.contains('hidden'), { timeout: 15000 });
await pm.tap('#btn-edit-char');
await pm.waitForSelector('#preview-loading.hidden', { timeout: 30000 });
await sleep(2000);
await shot(pm, 'U3_mobile_editor');
await pm.evaluate(() => document.querySelector('.builder').scrollIntoView());
await sleep(500);
await shot(pm, 'U4_mobile_editor_painel');
await ctxM.close();

writeFileSync(`${OUT}/round8_profile.json`, JSON.stringify(report, null, 1));
await browser.close();
