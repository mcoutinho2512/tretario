/**
 * Rodada 9.1 — barra de ações (docs/HUD.md "Barra de ações"): desktop + iPhone 14 (toque), cliente real num servidor
 * de TESTE próprio (PV_TEST=1, PV_STORE=memory, porta PV_BAR_PORT ou 2990). Tudo por cliques/toques de verdade no DOM.
 *  - barra visível para jogador (e ausente no espectador); dica de controles por aparelho;
 *  - cada popover abre/fecha (clique, Esc, clique fora, teclado: Enter/setas/Esc);
 *  - item pela barra → servidor confirma o `prop`; tocar de novo / "Mãos vazias" larga;
 *  - gesto pela barra → servidor confirma a ação; Soco/Chute → `__pv.combat().stats.acts` sobe;
 *  - Veículos: E — USAR pela barra monta (servidor) e desmonta; entrada da lista → alvo no minimapa + mapa expandido;
 *  - Pichar longe → dica; perto → editor; Personagem abre o editor (ou o login sem conta); Mapa expande;
 *  - HUD limpo (H) esconde; esmaece andando e volta com o mouse; G (roda) continua;
 *  - celular: ícones ≥ 44 px, botão AÇÕES some, nenhuma sobreposição com joystick/botões (caixas).
 * Capturas: docs/screenshots/round9_1/menu_barra_desktop.jpg, menu_barra_popover.jpg, menu_barra_celular.jpg.
 * uso: node tools/qa/action_bar.mjs [baseUrl]
 */
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_BAR_PORT ?? 2990);
const SHOTS = 'docs/screenshots/round9_1';
mkdirSync(SHOTS, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const cleanup = async () => { for (const b of browsers) { try { await b.close(); } catch { /* */ } } try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

const S = [-540, 255];
async function open(name, { device, extra = '' } = {}) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: device ? null : { width: 1280, height: 720 } });
  browsers.push(browser);
  const p = await browser.newPage();
  if (device) await p.emulate(KnownDevices[device]);
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${S[0]},${S[1]}${extra}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
  await w(2500);
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
const bar = (P) => ev(P, () => window.__pv.actionBar());
const srv = (P) => ev(P, () => window.__pv.mp().self.social);
const shot = async (P, name) => { await P.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); console.log(`   📷 ${SHOTS}/${name}.jpg`); };
const status = (P) => ev(P, () => document.querySelector('.hud-status')?.textContent ?? '');
const visible = (P, sel) => ev(P, (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }, sel);
/** clique (desktop) ou toque (celular) no centro do elemento */
const hit = async (P, sel, touch = false) => {
  const el = await P.$(sel);
  if (!el) throw new Error(`sem ${sel}`);
  if (touch) await el.tap(); else await el.click();
  await w(220);
};
const tp = async (P, x, z) => { await ev(P, (a, b) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b); }, x, z); await w(700); };

try {
  // ============================================================ desktop
  const A = await open('Barra');
  let q = await bar(A);
  check('barra visível para jogador (7 botões)', q && q.buttons.length === 7 && q.rect.h > 40 && await visible(A, '.action-bar .ab-row'), q ? `${Math.round(q.rect.w)}×${Math.round(q.rect.h)} em y=${Math.round(q.rect.y)}` : 'sem barra');
  check('dica de controles do desktop', q.hint.shown && q.hint.text.startsWith('W A S D mover') && q.hint.text.includes('G roda'), q.hint.text);
  const labels = await ev(A, () => [...document.querySelectorAll('.ab-btn')].map((b) => ({ aria: b.getAttribute('aria-label'), txt: b.textContent.trim(), svg: !!b.querySelector('svg'), hasPop: b.getAttribute('aria-haspopup') })));
  check('botões com ícone SVG próprio + rótulo + aria-label; ^ nos que abrem popover', labels.every((l) => l.svg && l.aria && l.txt) && labels.filter((l) => l.hasPop).length === 4, labels.map((l) => l.txt).join(' · '));
  // sem sobreposição com chat / mãos / "Ações G" / atribuição
  const boxes = await ev(A, () => Object.fromEntries(['.action-bar .ab-row', '.hud-slot-chat', '.hud-slot-hand', '.hud-br', '.attribution'].map((s) => { const e = document.querySelector(s); const r = e?.getBoundingClientRect(); return [s, r && r.width ? { x: r.x, y: r.y, w: r.width, h: r.height } : null]; })));
  const ov = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const hits = Object.entries(boxes).filter(([k, r]) => k !== '.action-bar .ab-row' && ov(boxes['.action-bar .ab-row'], r)).map(([k]) => k);
  check('desktop: barra não cobre chat, mãos, Ações G nem a atribuição', hits.length === 0, hits.join(', ') || 'sem sobreposição');
  await ev(A, () => document.querySelector('.hud-hint')?.remove());
  await shot(A, 'menu_barra_desktop');

  // ---- cada popover abre/fecha (clique · Esc · clique fora)
  for (const cat of ['veiculos', 'itens', 'confronto', 'gestos']) {
    await hit(A, `.ab-btn[data-cat=${cat}]`);
    q = await bar(A);
    const opened = q.open === cat && q.items.length > 0 && await visible(A, '.ab-pop');
    const exp = await ev(A, (c) => document.querySelector(`.ab-btn[data-cat=${c}]`).getAttribute('aria-expanded'), cat);
    await A.keyboard.press('Escape');
    await w(150);
    const esc = (await bar(A)).open === null;
    await hit(A, `.ab-btn[data-cat=${cat}]`);
    await A.mouse.click(640, 250); // fora (no cenário)
    await w(200);
    const outside = (await bar(A)).open === null;
    await ev(A, () => document.exitPointerLock?.());
    await hit(A, `.ab-btn[data-cat=${cat}]`);
    await hit(A, `.ab-btn[data-cat=${cat}]`);
    const again = (await bar(A)).open === null;
    check(`popover ${cat}: abre (aria-expanded) · Esc fecha · clique fora fecha · 2º clique fecha`, opened && exp === 'true' && esc && outside && again, `${q.items.length} opções: ${q.items.slice(0, 4).map((i) => i.label).join(' / ')}…`);
  }
  // ---- teclado: foco no botão → Enter abre e foca a 1ª opção → ↓ anda → Esc volta ao botão
  await ev(A, () => document.querySelector('.ab-btn[data-cat=gestos]').focus());
  await A.keyboard.press('Enter');
  await w(150);
  const k1 = await ev(A, () => ({ open: window.__pv.actionBar().open, idx: [...document.querySelectorAll('.ab-pop button')].indexOf(document.activeElement) }));
  await A.keyboard.press('ArrowDown');
  const k2 = await ev(A, () => [...document.querySelectorAll('.ab-pop button')].indexOf(document.activeElement));
  await A.keyboard.press('Escape');
  await w(100);
  const k3 = await ev(A, () => ({ open: window.__pv.actionBar().open, focus: document.activeElement?.dataset?.cat ?? null }));
  await ev(A, () => document.querySelector('.ab-btn[data-cat=itens]').focus());
  await A.keyboard.press('ArrowLeft');
  const k4 = await ev(A, () => document.activeElement?.dataset?.cat ?? null);
  await ev(A, () => document.activeElement?.blur());
  check('teclado: Enter abre e foca a 1ª opção · ↓ anda · Esc fecha e volta ao botão · ← troca de botão', k1.open === 'gestos' && k1.idx === 0 && k2 === 1 && k3.open === null && k3.focus === 'gestos' && k4 === 'veiculos', JSON.stringify({ k1, k2, k3, k4 }));

  // ---- itens: pegar pela barra → servidor confirma; tocar de novo larga; "Mãos vazias" larga
  await hit(A, '.ab-btn[data-cat=itens]');
  await hit(A, '.ab-pop [data-id=p3]');
  const got = await until(async () => (await srv(A)).prop === 3);
  const act3 = (await bar(A)).items.find((i) => i.id === 'p3');
  check('item pela barra (Cartaz) → servidor confirma o prop e a opção fica ativa', got && act3?.active, JSON.stringify(await srv(A)));
  const hasDesign = await visible(A, '.ab-pop .ab-design');
  const d0 = (await srv(A)).design;
  await hit(A, '.ab-pop .ab-design button:last-child');
  const d1 = await until(async () => { const s = await srv(A); return s.design !== d0 ? s.design : null; });
  check('trocar design pela barra (◀ ▶) → servidor confirma', hasDesign && d1, `${d0} → ${d1}`);
  await ev(A, () => document.querySelector('.hud-hint')?.remove());
  await shot(A, 'menu_barra_popover');
  await hit(A, '.ab-pop [data-id=p3]');
  const rel = await until(async () => (await srv(A)).prop === 0);
  check('tocar no item na mão de novo → larga (servidor: mãos vazias)', rel, JSON.stringify(await srv(A)));
  await hit(A, '.ab-pop [data-id=p1]');
  await until(async () => (await srv(A)).prop === 1);
  await hit(A, '.ab-pop [data-id=p0]');
  const rel2 = await until(async () => (await srv(A)).prop === 0);
  check('"Mãos vazias" pela barra larga a bandeira (servidor)', rel2, JSON.stringify(await srv(A)));
  await A.keyboard.press('Escape');

  // ---- gesto pela barra
  await hit(A, '.ab-btn[data-cat=gestos]');
  await hit(A, '.ab-pop [data-id=a4]'); // Comemorar (once)
  const g1 = await until(async () => (await srv(A)).act === 4, 3000);
  check('gesto pela barra (Comemorar) → servidor confirma a ação; popover fecha', g1 && (await bar(A)).open === null, JSON.stringify(await srv(A)));
  await w(2800);

  // ---- confronto: Soco / Chute
  const acts = async () => (await ev(A, () => window.__pv.combat()?.stats.acts ?? -1));
  await hit(A, '.ab-btn[data-cat=confronto]');
  const a0 = await acts();
  await hit(A, '.ab-pop [data-id=cbt_punch]');
  const a1 = await until(async () => { const v = await acts(); return v > a0 ? v : null; }, 3000);
  await w(1300);
  await hit(A, '.ab-pop [data-id=cbt_kick]');
  const a2 = await until(async () => { const v = await acts(); return v > (a1 ?? a0) ? v : null; }, 3000);
  check('Soco e Chute pela barra → combat().stats.acts sobe (servidor)', a1 && a2, `${a0} → ${a1} → ${a2}`);
  await w(500);
  const meter = await until(async () => (await bar(A)).meter, 2500);
  check('confronto: mini barras de condição/fôlego no botão enquanto o HUD de confronto mostra', meter && (await ev(A, () => window.__pv.combat().hud.shown)), `meter ${meter}`);
  await hit(A, '.ab-pop [data-id=p11]');
  const bat = await until(async () => (await srv(A)).prop === 11);
  await hit(A, '.ab-pop [data-id=p11]');
  const bat0 = await until(async () => (await srv(A)).prop === 0);
  check('Pegar rápido: Taco pela barra (servidor) e largar tocando de novo', bat && bat0, JSON.stringify(await srv(A)));
  await A.keyboard.press('Escape');

  // ---- mapa
  await hit(A, '.ab-btn[data-cat=mapa]');
  const m1 = (await ev(A, () => window.__pv.hudInfo().expanded));
  await hit(A, '.ab-btn[data-cat=mapa]');
  const m2 = (await ev(A, () => window.__pv.hudInfo().expanded));
  check('Mapa expande e recolhe', m1 === true && m2 === false);

  // ---- pichar longe → dica; perto → editor
  await hit(A, '.ab-btn[data-cat=pichar]');
  const st = await status(A);
  check('Pichar longe de superfície → dica curta', /tapume|parede liberada/i.test(st), st);
  const sf = await ev(A, () => { const p = window.__pv.metrics().player; return window.__pv.gf.surfacesNear(p.x, p.z, 400).filter((s) => s.kind !== 'ground').sort((a, b) => Math.hypot(a.front[0] - p.x, a.front[1] - p.z) - Math.hypot(b.front[0] - p.x, b.front[1] - p.z))[0]; });
  if (sf) {
    await tp(A, sf.front[0], sf.front[1]);
    await until(async () => (await ev(A, () => window.__pv.graffiti().near)), 3000);
    await hit(A, '.ab-btn[data-cat=pichar]');
    const ed = await until(async () => (await ev(A, () => window.__pv.graffiti().editing)), 3000);
    check('Pichar perto de parede liberada → abre o editor de grafite', ed, `${sf.kind} ${sf.id}`);
    await ev(A, () => window.__pv.gf.close());
  } else check('Pichar perto de parede liberada → abre o editor de grafite', false, 'sem superfície em 400 m');

  // ---- veículos: E — USAR pela barra e direção pela lista
  const bike = await ev(A, () => { const p = window.__pv.metrics().player; return window.__pv.vehicles('bicycle').filter((v) => !v.occupant).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; });
  await tp(A, bike.x + 0.9, bike.z + 0.9);
  const ready = await until(async () => (await bar(A)).buttons.find((b) => b.cat === 'veiculos').ready, 3000);
  await hit(A, '.ab-btn[data-cat=veiculos]');
  q = await bar(A);
  const useIt = q.items.find((i) => i.id === 'use');
  check('Veículos: ponto no botão e "E — USAR …" quando há veículo perto; lista com distância', ready && useIt && /USAR/.test(useIt.label) && q.items.some((i) => i.id === 'v_bicycle'), q.items.map((i) => i.label).join(' | '));
  const far = q.items.find((i) => i.id.startsWith('v_') && i.id !== 'v_bicycle') ?? q.items.find((i) => i.id === 'v_bicycle');
  if (far) {
    await hit(A, `.ab-pop [data-id=${far.id}]`);
    const hi = await ev(A, () => window.__pv.hudInfo());
    check('entrada da lista → alvo no minimapa + mapa expandido (sem teleporte)', hi.target && hi.expanded, `${far.label} → alvo ${hi.target?.label}`);
    await ev(A, () => window.__pv.toggleMap());
  }
  await hit(A, '.ab-btn[data-cat=veiculos]');
  await hit(A, '.ab-pop [data-id=use]');
  const rode = await until(async () => (await ev(A, () => window.__pv.riding())) === 'bicycle', 5000);
  await w(400);
  await hit(A, '.ab-btn[data-cat=veiculos]');
  q = await bar(A);
  const down = q.items.find((i) => i.id === 'use');
  if (down) await hit(A, '.ab-pop [data-id=use]');
  const off = await until(async () => (await ev(A, () => window.__pv.riding())) === null, 5000);
  check('E — USAR pela barra monta na bicicleta (servidor) e a barra também desce', rode && off, `subiu ${!!rode} · opção "${down?.label}" · desceu ${!!off}`);
  await A.keyboard.press('Escape');

  // ---- personagem
  await hit(A, '.ab-btn[data-cat=personagem]');
  const ed = await until(() => ev(A, () => !!document.querySelector('.acct:not(.hidden)') || !document.getElementById('start')?.classList.contains('hidden')), 3000);
  check('Personagem abre o editor (sem conta: o login da conta, como o menu ☰)', ed && (await bar(A)).stats.editorOpens === 1, (await ev(A, () => (document.querySelector('.acct:not(.hidden)') ? 'login' : 'editor'))));
  await ev(A, () => { document.querySelector('.acct')?.classList.add('hidden'); document.getElementById('start')?.classList.add('hidden'); });

  // ---- HUD limpo, auto-ocultar, roda G
  await ev(A, () => window.__pv.key('KeyH'));
  await w(250);
  const cleanHidden = !(await visible(A, '.action-bar .ab-row'));
  await ev(A, () => window.__pv.key('KeyH'));
  await w(250);
  check('HUD limpo (H) esconde a barra e volta', cleanHidden && await visible(A, '.action-bar .ab-row'));
  await ev(A, () => window.__pv.press('KeyW', 4200));
  await w(4000);
  const dimOp = await ev(A, () => ({ dim: window.__pv.hudInfo().dim, op: getComputedStyle(document.querySelector('.ab-row')).opacity }));
  await w(600);
  await A.mouse.move(300, 300); await A.mouse.move(340, 320);
  await w(900);
  const backOp = await ev(A, () => ({ dim: window.__pv.hudInfo().dim, op: getComputedStyle(document.querySelector('.ab-row')).opacity }));
  check('esmaece andando (auto-ocultar) e volta com o mouse', dimOp.dim && Number(dimOp.op) < 0.2 && !backOp.dim && Number(backOp.op) > 0.9, `${JSON.stringify(dimOp)} → ${JSON.stringify(backOp)}`);
  await ev(A, () => window.__pv.key('KeyG'));
  await w(250);
  const wheel = await visible(A, '.action-wheel.open');
  await A.keyboard.press('Escape');
  check('roda G continua funcionando', wheel);
  await w(5000);
  q = await bar(A);
  check('dica escondida 6 s depois do 1º movimento', !q.hint.shown, JSON.stringify(q.hint));
  q = await bar(A);
  console.log('   custo:', JSON.stringify(q.stats));

  // ============================================================ espectador: sem barra
  try {
    const V = await open('Olhar', { extra: '&spectate=1' });
    const has = await ev(V, () => ({ bar: !!document.querySelector('.action-bar'), spec: document.querySelector('.hud')?.classList.contains('spectating') }));
    check('espectador não recebe a barra (fica com a barra de câmeras)', has.spec && !has.bar, JSON.stringify(has));
  } catch (e) { check('espectador não recebe a barra', false, String(e.message ?? e)); }

  // ============================================================ celular (iPhone 14)
  const M = await open('Cel', { device: 'iPhone 14' });
  q = await bar(M);
  const touch = await ev(M, () => document.querySelector('.hud').classList.contains('touch'));
  const small = q.buttons.every((b) => b.w >= 44 && b.h >= 44);
  check('celular: barra de ícones (≥ 44 px), sem rótulos, dica do toque', touch && q && small && q.hint.text === 'joystick mover · arraste para olhar' && !(await visible(M, '.ab-lbl')), `${q.buttons.map((b) => `${Math.round(b.w)}×${Math.round(b.h)}`).join(' ')} · "${q.hint.text}"`);
  const fixed = await ev(M, () => [...document.querySelectorAll('.touch-btn')].filter((b) => getComputedStyle(b).display !== 'none' && !b.hidden && !b.closest('[hidden]')).map((b) => b.textContent));
  check('celular: botão AÇÕES some (a barra assume) — fixos ≤ 4', !fixed.includes('AÇÕES') && fixed.filter((t) => !['USAR', 'SOCO', 'CHUTE', 'ESQUIVA'].includes(t)).length <= 4, fixed.join(', '));
  // sobreposição: barra (e dica) × botões de toque visíveis + joystick parado + chat
  const mb = await ev(M, () => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, n: e.className + (e.textContent ? ` ${e.textContent.slice(0, 10)}` : '') }; };
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.display !== 'none' && !e.closest('[hidden]'); };
    const others = [...document.querySelectorAll('.touch-btn, .stick-base, .hud-slot-hand, .chat-pill, .hud-bc')].filter(vis).map(R);
    return { bar: R(document.querySelector('.ab-row')), hint: R(document.querySelector('.ab-hint')), others, vw: innerWidth, vh: innerHeight };
  });
  const over = mb.others.filter((o) => ov(mb.bar, o) || ov(mb.hint, o)).map((o) => o.n);
  check('celular: barra não cobre joystick, botões (PULAR/CORRER/CHAT/SOCO/CHUTE/ESQUIVA), MÃOS nem a ação contextual', over.length === 0 && mb.bar.x >= 0 && mb.bar.x + mb.bar.w <= mb.vw, `barra ${Math.round(mb.bar.x)},${Math.round(mb.bar.y)} ${Math.round(mb.bar.w)}×${Math.round(mb.bar.h)} · ${over.join(', ') || 'sem sobreposição'} · ${mb.others.length} caixas`);
  await ev(M, () => document.querySelector('.hud-hint')?.remove());
  await shot(M, 'menu_barra_celular');
  await hit(M, '.ab-btn[data-cat=itens]', true);
  const mo = (await bar(M)).open;
  await hit(M, '.ab-pop [data-id=p1]', true);
  const mp1 = await until(async () => (await srv(M)).prop === 1);
  const optH = await ev(M, () => Math.min(...[...document.querySelectorAll('.ab-pop .ab-opt')].map((b) => b.getBoundingClientRect().height)));
  const sheet = await ev(M, () => { const r = document.querySelector('.ab-pop').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  check('celular: opções numa folha inteira dentro da tela', sheet.y >= 0 && sheet.x >= 0 && sheet.x + sheet.w <= sheet.vw && sheet.y + sheet.h <= sheet.vh, JSON.stringify(sheet));
  await shot(M, 'menu_barra_celular_popover');
  await hit(M, '.ab-pop [data-id=p1]', true);
  const mp0 = await until(async () => (await srv(M)).prop === 0);
  check('celular: toque abre Itens; bandeira pela barra (servidor) e larga tocando de novo; opções ≥ 44 px', mo === 'itens' && mp1 && mp0 && optH >= 44, `opção ${Math.round(optH)} px`);
  await hit(M, '.ab-btn[data-cat=gestos]', true);
  await M.touchscreen.tap(240, 160); // fora (cenário, acima da barra)
  await w(250);
  const outT = (await bar(M)).open === null;
  check('celular: toque fora fecha o popover', outT);
  await hit(M, '.ab-btn[data-cat=gestos]', true);
  await hit(M, '.ab-pop [data-id=a1]', true);
  const mg = await until(async () => (await srv(M)).act === 1, 3000);
  check('celular: gesto pela barra (Acenar) → servidor', mg, JSON.stringify(await srv(M)));
  await w(2600);
  await hit(M, '.ab-btn[data-cat=confronto]', true);
  const ma0 = await ev(M, () => window.__pv.combat().stats.acts);
  await hit(M, '.ab-pop [data-id=cbt_punch]', true);
  const ma1 = await until(async () => { const v = await ev(M, () => window.__pv.combat().stats.acts); return v > ma0 ? v : null; }, 3000);
  check('celular: Soco pela barra → acts sobe', ma1, `${ma0} → ${ma1}`);
  await hit(M, '.ab-btn[data-cat=mapa]', true);
  const mm = await ev(M, () => window.__pv.hudInfo().expanded);
  check('celular: Mapa expande pela barra (e fecha o popover aberto)', mm && (await bar(M)).open === null);
} catch (e) {
  console.log('❌ erro', e);
  results.push({ name: 'erro', ok: false });
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} verificações`);
  await cleanup();
  process.exit(ok === results.length ? 0 : 1);
}
