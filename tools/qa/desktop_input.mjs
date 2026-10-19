/**
 * Rodada 11 — DESKTOP FIRST (docs/DESKTOP_CONTROLS.md): Chrome real (1280×720 e 1920×1080), cliente num servidor de
 * TESTE próprio (PV_TEST=1, PV_STORE=memory, porta PV_DESK_PORT ou 3711). Verifica, com mouse e teclado de verdade:
 *  - cursor visível e `document.pointerLockElement === null` o tempo todo (gameplay, painéis, veículo, combate, chat,
 *    menu, evento), nenhum `requestPointerLock` chamado;
 *  - botão direito + arrasto gira (yaw muda) e soltar para; menu de contexto bloqueado; clique esquerdo depois seleciona;
 *  - clique/roda/botão direito em HUD não chegam ao mundo; R/Q/C/F agem, clique esquerdo NÃO soca;
 *  - entrar/dirigir/sair de carro, moto, bicicleta e patinete (clique, SAIR do HUD, tecla E); olhar em volta dirigindo
 *    e a câmera volta atrás do veículo ~1 s depois de soltar;
 *  - chat: Enter foca, WASD não move digitando, Esc sai, clique fora devolve ao jogo; canais GERAL/PERTO/GRUPO;
 *  - Esc: fecha só o topo e, sem nada aberto, abre o menu do jogo (o mundo continua); tela de controles + remapeamento;
 *  - arrastar sobre um jogador não abre o painel; clique abre;
 * Capturas em docs/screenshots/round11/ (A_hud_desktop … V_confronto). O Chrome headless NÃO desenha o cursor do
 * sistema: nas capturas, um marcador (seta branca) é desenhado na posição do mouse só para a foto.
 * Custo da seleção com 500 entidades: tools/qa/selection_500.mjs.
 * uso: node tools/qa/desktop_input.mjs [baseUrl]   (Vite: npx vite --port 5201 --strictPort)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5201';
const PORT = Number(process.env.PV_DESK_PORT ?? 3711);
const SHOTS = 'docs/screenshots/round11';
mkdirSync(SHOTS, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 225 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const killAll = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', killAll);

const S = [-540, 255];

async function open(name, { width = 1280, height = 720, spawnAt = S } = {}) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width, height } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  // conta pedidos de pointer lock e menus de contexto que passaram (não deveriam existir)
  await p.evaluateOnNewDocument(() => {
    window.__lockCalls = 0;
    const orig = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function (...a) { window.__lockCalls++; return orig.apply(this, a); };
    window.__ctxShown = 0;
    window.addEventListener('contextmenu', (e) => { if (!e.defaultPrevented) window.__ctxShown++; });
    window.__lockSeen = 0;
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) window.__lockSeen++; });
  });
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${spawnAt[0]},${spawnAt[1]}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
  await w(2500);
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
/** marcador do cursor para a foto (o headless não desenha o cursor do sistema) */
async function shot(P, name, cursor) {
  if (cursor) await ev(P, (x, y) => {
    let m = document.getElementById('qa-cursor');
    if (!m) { m = document.createElement('div'); m.id = 'qa-cursor'; m.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;width:22px;height:22px;'; m.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 1 L2 18 L6.5 13.8 L9.6 20.5 L12.4 19.2 L9.4 12.7 L15.5 12.4 Z" fill="#fff" stroke="#000" stroke-width="1.3"/></svg>'; document.body.appendChild(m); }
    m.style.left = `${x - 2}px`; m.style.top = `${y - 1}px`; m.hidden = false;
  }, cursor[0], cursor[1]);
  await P.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 });
  await ev(P, () => { const m = document.getElementById('qa-cursor'); if (m) m.hidden = true; });
  console.log(`   📷 ${SHOTS}/${name}.jpg`);
}
const ix = (P) => ev(P, () => window.__pv.ix());
const inp = (P) => ev(P, () => window.__pv.input());
const vehicles = (P) => ev(P, () => window.__pv.vehicles('all'));
const nearestOf = (list, kind, x, z) => list.filter((v) => v.kind === kind && !v.occupant).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
/** estado do cursor/lock agora */
const cursorState = (P) => ev(P, () => {
  const c = document.querySelector('canvas.game-canvas');
  const cs = getComputedStyle(c).cursor, bs = getComputedStyle(document.body).cursor;
  return { lock: document.pointerLockElement === null ? null : 'LOCKED', canvas: cs, body: bs, calls: window.__lockCalls, seen: window.__lockSeen, hidden: cs === 'none' || bs === 'none' };
});
const lockLog = [];
async function noLock(P, where) {
  const s = await cursorState(P);
  lockLog.push({ where, ...s });
  return s.lock === null && !s.hidden && s.calls === 0 && s.seen === 0;
}
async function standBy(P, v, lateral) {
  const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
  const x = v.x + lx * lateral, z = v.z + lz * lateral;
  const yaw = Math.atan2(v.x - x, v.z - z);
  await ev(P, (a, b, y) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, y); }, x, z, yaw);
  await w(900);
  await ev(P, (y) => window.__pv.camera(y, 0.32, 5.5), yaw);
  await w(500);
}
const cand = async (P, key) => (await ix(P))?.cands.find((c) => c.key === key) ?? null;
async function rightDrag(P, x0, y0, dx, dy, steps = 12) {
  await P.mouse.move(x0, y0);
  await P.mouse.down({ button: 'right' });
  for (let i = 1; i <= steps; i++) { await P.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps); await w(16); }
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

try {
  // ============================================================ 1280×720
  const A = await open('Mesa');
  check('entrou: cursor visível, sem pointer lock, nenhum requestPointerLock', await noLock(A, 'entrada'), JSON.stringify(await cursorState(A)));
  await A.mouse.move(820, 420);
  await shot(A, 'A_hud_desktop', [820, 420]);
  // clique esquerdo no cenário vazio: não captura nada, não soca
  const c0 = (await ev(A, () => window.__pv.combat()))?.stats.sent ?? 0;
  await A.mouse.click(640, 120);
  await w(400);
  const c1 = (await ev(A, () => window.__pv.combat()))?.stats.sent ?? 0;
  check('clique esquerdo no cenário: sem pointer lock e sem soco', (await noLock(A, 'clique vazio')) && c1 === c0, `golpes ${c0}→${c1}`);

  // ---- câmera: botão direito + arrasto
  const y0 = (await inp(A)).camYaw;
  await rightDrag(A, 640, 400, 240, 0);
  const mid = await inp(A);
  await A.mouse.up({ button: 'right' });
  await w(200);
  const y1 = (await inp(A)).camYaw;
  await A.mouse.move(900, 420); await A.mouse.move(400, 420); await w(250);
  const y2 = (await inp(A)).camYaw;
  check('botão direito + arrasto gira a câmera (yaw muda) com o cursor visível', Math.abs(angDiff(y1, y0)) > 0.3 && mid.looking, `Δyaw=${angDiff(y1, y0).toFixed(2)} rad · olhando=${mid.looking}`);
  check('soltou o direito: mover o mouse não gira mais', Math.abs(angDiff(y2, y1)) < 1e-3, `Δ=${angDiff(y2, y1).toFixed(4)}`);
  const ctx = await ev(A, () => window.__ctxShown);
  check('menu de contexto do navegador bloqueado sobre o cenário', ctx === 0, `menus=${ctx}`);
  check('arrasto de câmera sem pointer lock', await noLock(A, 'arrasto direito'));
  // esquerdo arrastando também gira (trackpad) e não clica
  const ixb = (await ix(A)).stats.clicks;
  await A.mouse.move(500, 400); await A.mouse.down(); for (let i = 1; i <= 8; i++) { await A.mouse.move(500 + i * 20, 400); await w(16); } await A.mouse.up();
  await w(200);
  check('esquerdo arrastando gira e NÃO vira clique', (await ix(A)).stats.clicks === ixb && (await inp(A)).stats.worldDrags >= 2, `cliques=${(await ix(A)).stats.clicks - ixb}`);

  // ---- UI consome: clique, botão direito e roda em cima do HUD não chegam ao mundo
  const before = await inp(A);
  const ixs0 = (await ix(A)).stats;
  const box = await ev(A, () => { const r = document.querySelector('.hud-tr').firstElementChild.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const hx = box.x + box.width / 2, hy = box.y + box.height / 2;
  const hit = await ev(A, (x, y) => { const e = document.elementFromPoint(x, y); return e?.tagName + '.' + e?.className; }, hx, hy);
  await A.mouse.move(hx, hy);
  await A.mouse.down({ button: 'right' }); await A.mouse.move(hx - 120, hy); await A.mouse.up({ button: 'right' });
  await A.mouse.wheel({ deltaY: 300 });
  await A.mouse.click(hx, hy);
  await w(300);
  const after = await inp(A);
  const ixs1 = (await ix(A)).stats;
  await A.keyboard.press('KeyM'); // de volta ao minimapa compacto (o expandido cobre o centro)
  await w(300);
  check('HUD consome: botão direito/roda/clique no minimapa não giram, não dão zoom e não interagem com o mundo', Math.abs(angDiff(after.camYaw, before.camYaw)) < 1e-3 && after.stats.worldClicks === before.stats.worldClicks && ixs1.clicks === ixs0.clicks, `alvo=${hit} Δyaw=${angDiff(after.camYaw, before.camYaw).toFixed(4)} cliquesMundo=${after.stats.worldClicks - before.stats.worldClicks}`);

  // ---- veículos: carro (identificar de longe → selecionar → dirigir → olhar em volta → SAIR)
  const vs = await vehicles(A);
  const car = nearestOf(vs, 'car', S[0], S[1]);
  if (car) {
    await standBy(A, car, 14);
    const cf = await until(async () => { const c = await cand(A, `veh:${car.id}`); return c?.screen ? c : null; }, 4000);
    if (cf) {
      await A.mouse.move(cf.screen.sx, cf.screen.sy); await w(350);
      const h = await ix(A);
      await shot(A, 'B_cursor_sobre_carro', [cf.screen.sx, cf.screen.sy]);
      check('carro distante: IDENTIFICADO no hover ("CARRO · longe" / chegue mais perto) e não usado', h.hover?.key === `veh:${car.id}` && /CARRO · (longe|chegue mais perto)/.test(h.label) && h.cursor === '', `${h.label} · cursor="${h.cursor}"`);
      await A.mouse.click(cf.screen.sx, cf.screen.sy); await w(600);
      check('clique no carro distante: só explica (servidor não é chamado para entrar)', !(await ev(A, () => window.__pv.riding())), (await ix(A)).last ? 'ativou?!' : 'ok');
    }
    await standBy(A, car, 1.9);
    const c = await until(async () => { const x = await cand(A, `veh:${car.id}`); return x?.screen ? x : null; }, 4000);
    if (c) {
      await A.mouse.move(c.screen.sx, c.screen.sy); await w(350);
      const h = await ix(A);
      check('hover no carro ao alcance: realce "CARRO · Entrar" e cursor de mão', h.hover?.key === `veh:${car.id}` && /Entrar/.test(h.label) && h.cursor === 'pointer', `${h.label} · cursor=${h.cursor}`);
      await shot(A, 'C_carro_selecionado', [c.screen.sx, c.screen.sy]);
      await A.mouse.click(c.screen.sx, c.screen.sy);
      const rode = await until(async () => (await ev(A, () => window.__pv.riding())) === 'car', 6000);
      check('clique no carro → entra (servidor confirma), sem pointer lock', rode && (await noLock(A, 'entrou no carro')));
      await A.keyboard.down('KeyW'); await w(1800);
      await A.mouse.move(980, 300);
      await shot(A, 'D_dirigindo_cursor', [980, 300]);
      // olhar em volta dirigindo: direito segurado → câmera fica onde o jogador deixou; soltou → volta ~1 s depois
      await rightDrag(A, 640, 360, 420, 0, 14);
      await w(500);
      const hold = await inp(A);
      const hd = await ev(A, () => window.__pv.carHeading());
      const offHold = Math.abs(angDiff(hold.camYaw, hd));
      await A.mouse.up({ button: 'right' });
      await w(500);
      const at05 = await inp(A); const hd05 = await ev(A, () => window.__pv.carHeading());
      await w(1900);
      const at24 = await inp(A); const hd24 = await ev(A, () => window.__pv.carHeading());
      await A.keyboard.up('KeyW');
      const off05 = Math.abs(angDiff(at05.camYaw, hd05)), off24 = Math.abs(angDiff(at24.camYaw, hd24));
      check('dirigindo: botão direito olha em volta (câmera fora do rumo enquanto segura)', offHold > 0.6, `desvio=${offHold.toFixed(2)} rad`);
      check('soltou: espera ~1 s (0,5 s depois ainda olhando) e volta atrás do veículo suavemente', off05 > 0.4 && off24 < 0.25, `0,5 s: ${off05.toFixed(2)} · 2,4 s: ${off24.toFixed(2)} rad`);
      check('dirigindo: WASD com o cursor visível, sem pointer lock', await noLock(A, 'dirigindo'));
      // SAIR do HUD (clicável)
      await w(600);
      await A.click('.veh-exit');
      const off = await until(async () => !(await ev(A, () => window.__pv.riding())), 5000);
      check('botão SAIR do HUD do veículo (clique) desce', off);
    } else check('carro visível na tela', false);
  } else check('há carro livre', false);

  // moto / bicicleta / patinete: iguais (clique entra, W anda, E ou SAIR sai)
  const L = { moto: 1.4, bicycle: 1.2, scooter: 1.1 };
  const SHOT = { moto: 'E_moto', bicycle: 'F_bicicleta', scooter: 'G_patinete' };
  for (const kind of ['moto', 'bicycle', 'scooter']) {
    const v = nearestOf(await vehicles(A), kind, S[0], S[1]);
    if (!v) { check(`há ${kind} livre`, false); continue; }
    await standBy(A, v, L[kind]);
    const c = await until(async () => { const x = await cand(A, `veh:${v.id}`); return x?.screen ? x : null; }, 4000);
    if (!c) { check(`${kind} na tela`, false); continue; }
    await A.mouse.click(c.screen.sx, c.screen.sy);
    const rode = await until(async () => (await ev(A, () => window.__pv.riding())) === kind, 6000);
    await A.keyboard.down('KeyW'); await w(1300);
    await A.mouse.move(900, 330);
    await shot(A, SHOT[kind], [900, 330]);
    await A.keyboard.up('KeyW'); await w(700);
    const y0v = (await inp(A)).camYaw;
    await rightDrag(A, 300, 520, 200, 0, 8); // longe do rótulo do veículo (o rótulo é HUD: consome o clique)
    const y1v = (await inp(A)).camYaw;
    await A.mouse.up({ button: 'right' });
    if (kind === 'moto') await A.keyboard.press('KeyE'); else await A.click('.veh-exit');
    const off = await until(async () => !(await ev(A, () => window.__pv.riding())), 5000);
    check(`${kind}: clique entra, direito olha em volta, ${kind === 'moto' ? 'tecla E' : 'SAIR'} sai — sem pointer lock`, rode && off && Math.abs(angDiff(y1v, y0v)) > 0.2 && (await noLock(A, kind)), `Δyaw=${angDiff(y1v, y0v).toFixed(2)}`);
    await w(500);
  }

  // ---- combate: R/Q/C pelo teclado; clique esquerdo NÃO é soco
  await ev(A, (a, b) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, 0); }, S[0], S[1]);
  await w(1200);
  const k0 = (await ev(A, () => window.__pv.combat())).stats;
  await A.keyboard.press('KeyR'); await w(900);
  await A.keyboard.press('KeyQ'); await w(900);
  await A.keyboard.press('KeyC'); await w(900);
  const k1 = (await ev(A, () => window.__pv.combat())).stats;
  await A.mouse.click(700, 200); await w(700);
  const k2 = (await ev(A, () => window.__pv.combat())).stats;
  check('combate: R soco · Q chute · C esquiva pelo teclado', k1.sent - k0.sent >= 3, `pedidos ${k0.sent}→${k1.sent}`);
  check('clique esquerdo não soca (nem no confronto)', k2.sent === k1.sent, `pedidos ${k1.sent}→${k2.sent}`);
  await A.keyboard.press('KeyR'); await w(120);
  await A.mouse.move(760, 380);
  await shot(A, 'V_confronto', [760, 380]);
  check('combate sem pointer lock', await noLock(A, 'combate'));

  // ---- chat
  await w(800);
  const p0 = await ev(A, () => ({ ...window.__pv.mp().self }));
  const pos0 = await ev(A, () => window.__pv.metrics().player);
  await A.keyboard.press('Enter'); await w(300);
  const focused = await ev(A, () => document.activeElement?.classList.contains('chat-field'));
  await A.keyboard.type('wwwwaaaasssdddd', { delay: 25 });
  await w(400);
  const pos1 = await ev(A, () => window.__pv.metrics().player);
  const tabs = await ev(A, () => [...document.querySelectorAll('.chat-tab')].map((b) => b.textContent.replace(/\d+/g, '').trim()));
  await A.mouse.move(980, 420);
  await shot(A, 'T_chat', [980, 420]);
  check('chat: Enter foca o campo; WASD digitando não move', focused && Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) < 0.05, `foco=${focused} Δ=${Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z).toFixed(3)} m`);
  check('chat: canais GERAL / PERTO / GRUPO preservados', ['Geral', 'Perto', 'Grupo'].every((t) => tabs.some((x) => x.startsWith(t))), tabs.join(','));
  await A.keyboard.press('Escape'); await w(250);
  const ce = await ev(A, () => ({ focus: document.activeElement?.classList.contains('chat-field'), state: document.querySelector('.chat-tabs')?.closest('[data-state]')?.dataset.state, menu: window.__pv.input().menu }));
  check('chat: Esc sai do chat (e NÃO abre o menu junto)', !ce.focus && ce.state !== 'open' && !ce.menu, JSON.stringify(ce));
  await A.keyboard.press('Enter'); await w(250);
  await A.mouse.click(700, 260); await w(300);
  const cf2 = await ev(A, () => document.activeElement?.classList.contains('chat-field'));
  await A.keyboard.down('KeyW'); await w(500); await A.keyboard.up('KeyW');
  const pos2 = await ev(A, () => window.__pv.metrics().player);
  check('chat: clique fora devolve ao jogo (W volta a andar)', !cf2 && Math.hypot(pos2.x - pos1.x, pos2.z - pos1.z) > 0.3, `andou ${Math.hypot(pos2.x - pos1.x, pos2.z - pos1.z).toFixed(2)} m`);
  void p0;

  // ---- Esc com hierarquia + menu do jogo + controles
  await A.click('.hud-btns button'); // ⚙ ajustes
  await w(250);
  await A.keyboard.press('F1'); await w(300);
  const s1 = await inp(A);
  await A.keyboard.press('Escape'); await w(200);
  const s2 = await inp(A);
  await A.keyboard.press('Escape'); await w(200);
  const s3 = await inp(A);
  await A.keyboard.press('Escape'); await w(300);
  const s4 = await inp(A);
  check('Esc fecha só o topo: controles → ajustes → (nada) abre o menu do jogo', s1.controls && s1.settings && !s2.controls && s2.settings && !s3.settings && !s3.menu && s4.menu, `${JSON.stringify(s1.esc)} → ${JSON.stringify(s2.esc)} → ${JSON.stringify(s3.esc)} → menu=${s4.menu}`);
  const items = await ev(A, () => [...document.querySelectorAll('.game-menu .gm-card > .gm-btn')].map((b) => b.textContent));
  check('menu do jogo: CONTINUAR, CONFIGURAÇÕES, CONTROLES, ÁUDIO, GRÁFICOS, SAIR', ['CONTINUAR', 'CONFIGURAÇÕES', 'CONTROLES', 'ÁUDIO', 'GRÁFICOS', 'SAIR'].every((t, i) => items[i] === t), items.join(' · '));
  const t0 = await ev(A, () => window.__pv.mp()?.status ?? window.__pv.metrics().net?.status);
  await A.mouse.move(640, 300);
  await shot(A, 'M_menu_jogo', [640, 300]);
  await w(1200);
  const t1 = await ev(A, () => ({ net: window.__pv.metrics().net?.status, frames: window.__pv.takeFrames().length }));
  check('menu aberto: mundo não pausa e não desconecta', t1.frames > 10 && t1.net === 'online', `status ${t0}→${t1.net} · quadros=${t1.frames}`);
  // SAIR pede confirmação; Esc cancela só a confirmação
  await A.click('.game-menu [data-item="sair"]'); await w(200);
  await A.keyboard.press('Escape'); await w(200);
  const s5 = await inp(A);
  check('SAIR pede confirmação; Esc cancela só ela (menu continua)', s5.menu && !s5.esc.includes('menu-sair'), JSON.stringify(s5.esc));
  await A.click('.game-menu [data-item="controles"]'); await w(300);
  await shot(A, 'R_controles');
  const groups = await ev(A, () => [...document.querySelectorAll('.controls-screen .cs-group h3')].map((h) => h.textContent));
  check('tela de CONTROLES agrupada (MOVIMENTO, CÂMERA, INTERAÇÃO, VEÍCULOS, COMBATE, ITENS, SOCIAL)', ['MOVIMENTO', 'CÂMERA', 'INTERAÇÃO', 'VEÍCULOS', 'COMBATE', 'ITENS', 'SOCIAL'].every((g) => groups.includes(g)), groups.join(' · '));
  // remapeamento: Mapa M → N; N abre o mapa; restaurar padrão
  await A.click('.controls-screen .cs-key[data-action="map"]'); await w(150);
  await A.keyboard.press('KeyN'); await w(200);
  const rm = await ev(A, () => document.querySelector('.controls-screen .cs-key[data-action="map"]').textContent);
  await A.keyboard.press('Escape'); await w(200);
  const mapBefore = await ev(A, () => document.querySelector('.minimap')?.classList.contains('expanded') ?? null);
  await A.keyboard.press('KeyN'); await w(300);
  const mapAfter = await ev(A, () => document.querySelector('.minimap')?.classList.contains('expanded') ?? null);
  await A.keyboard.press('KeyN'); await w(200);
  check('remapeamento: clique na tecla, aperta a nova (Mapa → N) e N passa a abrir o mapa', rm === 'N' && mapBefore !== mapAfter, `tecla=${rm} mapa ${mapBefore}→${mapAfter}`);
  await A.keyboard.press('F1'); await w(200);
  await A.click('.controls-screen .cs-key[data-action="map"]'); await w(100);
  await A.keyboard.press('KeyI'); await w(200);
  const conflictMsg = await ev(A, () => document.querySelector('.controls-screen .cs-msg').textContent);
  await A.click('.controls-screen [data-confirm="no"]'); await w(100);
  check('remapeamento: tecla já usada pergunta (conflito avisado)', /já é de "Inventário"/.test(conflictMsg), conflictMsg);
  await A.click('.controls-screen [data-reset]'); await w(150);
  const rs = await ev(A, () => document.querySelector('.controls-screen .cs-key[data-action="map"]').textContent);
  check('restaurar padrão (Mapa volta a M)', rs === 'M', rs);
  await A.keyboard.press('Escape'); await w(200);
  check('menu/controles sem pointer lock', await noLock(A, 'menu'));

  // ---- pessoa: arrastar por cima NÃO abre o painel; clique abre
  const B = await open('Outra');
  const pa = { x: S[0] + 20, z: S[1] + 10 };
  await ev(B, (a, b) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, Math.PI); }, pa.x, pa.z);
  await ev(A, (a, b, y) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, y); }, pa.x, pa.z - 3, 0);
  await w(1500);
  await ev(A, () => window.__pv.camera(0, 0.25, 4.5));
  await w(800);
  const pc = await until(async () => (await ix(A))?.cands.find((c) => c.type === 'person' && c.screen) ?? null, 8000);
  if (pc) {
    await A.mouse.move(pc.screen.sx, pc.screen.sy); await w(300);
    const hp = await ix(A);
    check('hover em pessoa: cursor de interação (context-menu)', hp.hover?.type === 'person' && hp.cursor === 'context-menu', `cursor=${hp.cursor}`);
    await A.mouse.down(); for (let i = 1; i <= 6; i++) { await A.mouse.move(pc.screen.sx + i * 12, pc.screen.sy); await w(16); } await A.mouse.up();
    await w(400);
    const dragged = await ev(A, () => window.__pv.person());
    await ev(A, () => window.__pv.camera(0, 0.25, 4.5)); await w(500);
    const pc2 = (await ix(A)).cands.find((c) => c.key === pc.key)?.screen ?? pc.screen;
    await A.mouse.click(pc2.sx, pc2.sy);
    const opened = await until(async () => { const s = await ev(A, () => window.__pv.person()); return s.open ? s : null; }, 4000);
    check('arrastar sobre o jogador não abre o painel; clique parado abre', !dragged.open && !!opened, `arrasto=${dragged.open} clique=${!!opened}`);
    await A.mouse.down({ button: 'right' }); await A.mouse.move(pc2.sx + 80, pc2.sy); await A.mouse.up({ button: 'right' }); await w(200);
    check('girar a câmera com o painel da pessoa aberto não o fecha', (await ev(A, () => window.__pv.person())).open);
    await A.keyboard.press('Escape'); await w(200);
    const pclose = await ev(A, () => ({ p: window.__pv.person().open, menu: window.__pv.input().menu }));
    check('Esc fecha o painel da pessoa (só ele)', !pclose.p && !pclose.menu, JSON.stringify(pclose));
  } else check('outro jogador na tela', false);
  await browsers[1].close();

  // ---- evento: agenda (painel) aberta/fechada sem lock
  const ag = await ev(A, () => { const r = window.__pvR9; if (!r?.agenda) return null; r.agenda.toggle(true); return r.agenda.open; });
  if (ag) { await w(300); await A.keyboard.press('Escape'); await w(200); }
  check('evento/agenda: sem pointer lock em nenhum momento', await noLock(A, 'evento'), `${lockLog.length} pontos checados`);

  // 500 entidades: custo da seleção → tools/qa/selection_500.mjs (servidor e bots próprios)

  // ============================================================ 1920×1080
  const H = await open('MesaHD', { width: 1920, height: 1080 });
  check('1920×1080: entrou sem pointer lock, cursor visível', await noLock(H, 'hd entrada'));
  const hy0 = (await inp(H)).camYaw;
  await rightDrag(H, 960, 540, 300, 0);
  await H.mouse.up({ button: 'right' });
  const hy1 = (await inp(H)).camYaw;
  check('1920×1080: botão direito + arrasto gira', Math.abs(angDiff(hy1, hy0)) > 0.3, `Δ=${angDiff(hy1, hy0).toFixed(2)}`);
  const hv = nearestOf(await vehicles(H), 'car', S[0], S[1]);
  if (hv) {
    await standBy(H, hv, 1.9);
    const c = await until(async () => { const x = await cand(H, `veh:${hv.id}`); return x?.screen ? x : null; }, 4000);
    if (c) { await H.mouse.click(c.screen.sx, c.screen.sy); }
    const rode = await until(async () => (await ev(H, () => window.__pv.riding())) === 'car', 6000);
    await H.keyboard.press('KeyE');
    const off = await until(async () => !(await ev(H, () => window.__pv.riding())), 5000);
    check('1920×1080: clique entra no carro, E sai', rode && off);
  }
  await H.keyboard.press('Escape'); await w(300);
  check('1920×1080: Esc sem nada aberto abre o menu', (await inp(H)).menu);
  await H.keyboard.press('Escape');
  check('1920×1080: sem pointer lock do começo ao fim', await noLock(H, 'hd fim'));
} catch (e) {
  console.error(e);
  check('roteiro sem exceção', false, String(e?.message ?? e));
} finally {
  for (const b of browsers) { try { await b.close(); } catch { /* */ } }
  killAll();
  const ok = results.filter((r) => r.ok).length;
  writeFileSync(`${SHOTS}/desktop_input.json`, JSON.stringify({ ok, total: results.length, results, lockLog }, null, 2));
  console.log(`\n${ok}/${results.length} ok`);
  process.exit(ok === results.length ? 0 : 1);
}
