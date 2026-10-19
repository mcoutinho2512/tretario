/**
 * Rodada 10 — "clicou/tocou → interagiu" (docs/INTERACTION_SYSTEM.md): desktop 1280×720 + iPhone 14 emulado, cliente
 * real num servidor de TESTE próprio (PV_TEST=1, PV_STORE=memory, porta PV_IX_PORT ou 3210). Cliques e toques de
 * verdade (mouse / touchscreen do Chrome) nas posições projetadas dos objetos:
 *  - desktop: hover mostra UM realce ("CARRO · Entrar") e o cursor de clique; clique no carro, moto, bicicleta e
 *    patinete → o servidor confirma; HUD do veículo (velocidade + SAIR); SAIR desce; clique no item → item_self e a
 *    mão (HUD MÃOS × prop do servidor × corpo) igual; clique em outro jogador → painel (só dados públicos), denúncia
 *    confirmada sem ids; clique no vazio não faz nada; onboarding "Toque ou clique…" aparece uma vez;
 *  - celular: toque no carro/bicicleta/patinete/moto entra; arrasto por cima do carro gira a câmera e NÃO interage;
 *    toque parado não gira a câmera; SAIR grande (≥ 44 px) e PULAR escondido no veículo; toque no item e na pessoa.
 * Capturas: docs/screenshots/round10/G_interacao_carro, N_item_contextual, O_interacao_jogador, T_mobile,
 * X_hud_veiculo (+ X_hud_veiculo_celular).
 * uso: node tools/qa/interaction_mp.mjs [baseUrl]   (Vite: npx vite --port 5182 --strictPort)
 */
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5182';
const PORT = Number(process.env.PV_IX_PORT ?? 3210);
const SHOTS = 'docs/screenshots/round10';
mkdirSync(SHOTS, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const cleanup = async () => { for (const b of browsers) { try { await b.close(); } catch { /* */ } } try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

const RACKS = JSON.parse(readFileSync('public/gameplay/combat_props.json', 'utf8')).supply.racks;
const S = [-540, 255];

async function open(name, { device } = {}) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: device ? null : { width: 1280, height: 720 } });
  browsers.push(browser);
  const p = await browser.newPage();
  if (device) await p.emulate(KnownDevices[device]);
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${S[0]},${S[1]}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
  // registro dos avisos curtos (o texto do selo troca rápido)
  await p.evaluate(() => {
    window.__flashes = [];
    const el = document.querySelector('.hud-status');
    if (el) new MutationObserver(() => window.__flashes.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await w(2500);
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
const shot = async (P, name) => { await P.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); console.log(`   📷 ${SHOTS}/${name}.jpg`); };
const ix = (P) => ev(P, () => window.__pv.ix());
const flashes = (P) => ev(P, () => window.__flashes.slice());
const vehicles = (P) => ev(P, () => window.__pv.vehicles('all'));
const nearestOf = (list, kind, x, z) => list.filter((v) => v.kind === kind && !v.occupant).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
/** fica ao lado do veículo (lateral), câmera olhando para ele */
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
const exitVehicle = async (P, touch) => {
  const el = await P.$('.veh-exit');
  if (touch) await el.tap(); else await el.click();
  return until(async () => !(await ev(P, () => window.__pv.riding())), 5000);
};

try {
  // ============================================================ desktop
  const A = await open('Clica');
  const vs = await vehicles(A);
  const kinds = ['car', 'moto', 'bicycle', 'scooter'];
  const lateral = { car: 1.9, moto: 1.4, bicycle: 1.2, scooter: 1.1 };
  let first = true;
  for (const kind of kinds) {
    const v = nearestOf(vs, kind, S[0], S[1]);
    if (!v) { check(`desktop: há ${kind} livre`, false); continue; }
    await standBy(A, v, lateral[kind]);
    const c = await until(() => cand(A, `veh:${v.id}`), 4000);
    const scr = c?.screen;
    if (!scr) { check(`desktop: ${kind} visível na tela`, false, JSON.stringify(c)); continue; }
    await A.mouse.move(scr.sx, scr.sy);
    await w(350);
    const hov = await ix(A);
    const cursor = await ev(A, () => document.querySelector('canvas.game-canvas').style.cursor);
    const labels = await ev(A, () => [...document.querySelectorAll('.ix-label')].filter((e) => !e.hidden).map((e) => e.textContent));
    check(`desktop ${kind}: hover → UM realce "${hov.label}" e cursor de clique`, hov.hover?.key === `veh:${v.id}` && labels.length === 1 && hov.shown?.key === `veh:${v.id}` && cursor === 'pointer', `${labels.join(' | ')} · cursor=${cursor}`);
    if (kind === 'car') await shot(A, 'G_interacao_carro');
    await A.mouse.click(scr.sx, scr.sy);
    const rode = await until(async () => (await ev(A, () => window.__pv.riding())) === kind, 6000);
    const srvOcc = await until(async () => (await vehicles(A)).find((x) => x.id === v.id)?.occupant === (await ev(A, () => window.__pv.mp().session)), 3000);
    const last = (await ix(A)).last;
    check(`desktop: clique no ${kind} → servidor confirma (enter_ok, ocupante)`, rode && srvOcc && ['click', 'label'].includes(last?.via), `via=${last?.via} tipo=${last?.type}`);
    if (first) {
      first = false;
      const f = await flashes(A);
      check('onboarding: "Toque ou clique nos objetos para interagir." aparece na 1ª oportunidade', f.some((t) => t.includes('Toque ou clique nos objetos para interagir.')), f.slice(-4).join(' / '));
    }
    const vh = await until(async () => { const h = await ev(A, () => window.__pv.vehHud()); return h?.shown && h.text ? h : null; }, 3000);
    check(`desktop ${kind}: HUD de veículo (velocidade + ${vh?.exit})`, vh?.shown && /km\/h/.test(vh.text), vh?.text);
    if (kind === 'car') {
      await A.keyboard.down('KeyW'); await w(1600);
      const spd = await ev(A, () => window.__pv.vehHud().text);
      await shot(A, 'X_hud_veiculo');
      await A.keyboard.up('KeyW'); await w(300);
      check('desktop: W acelera o carro e o HUD mostra a velocidade', /[1-9]\d* km\/h/.test(spd), spd);
    }
    const off = await exitVehicle(A, false);
    check(`desktop ${kind}: SAIR (botão do HUD) desce pelo servidor`, off);
    await w(500);
  }
  // clique no vazio (céu): nada
  const before = (await ix(A)).stats;
  await A.mouse.click(640, 60);
  await w(300);
  const after = (await ix(A)).stats;
  check('desktop: clique no vazio não interage (só conta como "nada ali")', after.activations === before.activations && after.misses > before.misses);
  await ev(A, () => document.exitPointerLock?.());
  await w(200);

  // ---- item no chão / no apoio: clique → item_pick → mão
  const rack = RACKS[0];
  const t = rack.at.t, sd = rack.at.side ?? 0;
  const { x: rx, z: rz } = await ev(A, (tt, ss) => window.__pv.axisPoint(tt, ss), t, sd);
  await ev(A, (a, b) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, 0); }, rx + 3, rz);
  await w(1500);
  const items = await until(async () => { const i = await ev(A, () => window.__pv.r9b().items?.items ?? []); return i.length ? i : null; }, 6000);
  if (items) {
    const it = items.sort((a, b) => Math.hypot(a.x - rx, a.z - rz) - Math.hypot(b.x - rx, b.z - rz))[0];
    const yaw = Math.atan2(it.x - (it.x + 1.4), 0);
    await ev(A, (a, b, y) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, y); }, it.x + 1.4, it.z, yaw);
    await w(900);
    await ev(A, (y) => window.__pv.camera(y, 0.42, 4), yaw);
    await w(600);
    const c = await until(() => cand(A, `item:${it.id}`), 4000);
    if (c?.screen) {
      await A.mouse.move(c.screen.sx, c.screen.sy);
      await w(400);
      const h = await ix(A);
      await shot(A, 'N_item_contextual');
      check('desktop: hover no item → "… · Pegar"', h.hover?.key === `item:${it.id}` && /Pegar/.test(h.label), h.label);
      await A.mouse.click(c.screen.sx, c.screen.sy);
      const got = await until(async () => { const s = await ev(A, () => window.__pv.handSync()); return s.server === it.prop && s.social === it.prop ? s : null; }, 6000);
      await w(600);
      const hs = await ev(A, () => window.__pv.handSync());
      check('clique no item → servidor aprova (item_self) e aparece na mão', got && hs.visible === it.prop, JSON.stringify(hs));
      check('HUD "MÃOS" = item na mão = servidor = corpo (sem divergência)', hs.hud === hs.label && hs.server === hs.social && hs.visible === hs.social, JSON.stringify(hs));
      // T larga (sem item perto) e a mão esvazia junto no HUD
      await A.keyboard.press('KeyZ');
      const dropped = await until(async () => { const s = await ev(A, () => window.__pv.handSync()); return s.server === 0 && s.social === 0 ? s : null; }, 5000);
      await w(500);
      const hs2 = await ev(A, () => window.__pv.handSync());
      check('largar (Z) → mão, HUD e servidor vazios juntos', dropped && hs2.visible === 0 && /Vazias/.test(hs2.hud ?? ''), JSON.stringify(hs2));
    } else check('desktop: item visível na tela', false, JSON.stringify(c));
  } else check('itens do apoio chegaram (item_list)', false);

  // ---- pessoa: segundo jogador perto → clique abre o painel
  const B = await open('Pessoa');
  const pa = { x: S[0] + 20, z: S[1] + 10 };
  await ev(B, (a, b) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, Math.PI); }, pa.x, pa.z);
  await ev(A, (a, b, y) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, y); }, pa.x, pa.z - 3, 0);
  await w(1500);
  await ev(A, () => window.__pv.camera(0, 0.25, 4.5));
  await w(800);
  const pc = await until(async () => (await ix(A))?.cands.find((c) => c.type === 'person' && c.screen) ?? null, 8000);
  if (pc) {
    await ev(A, () => document.exitPointerLock?.()); await w(150); // fechar o painel recaptura o mouse (como os outros modais)
    await A.mouse.click(pc.screen.sx, pc.screen.sy);
    const pp = await until(async () => { const s = await ev(A, () => window.__pv.person()); return s.open ? s : null; }, 4000);
    await w(300);
    await shot(A, 'O_interacao_jogador');
    const sidB = await ev(B, () => window.__pv.mp().session);
    check('clique em outro jogador → painel compacto com VER PERFIL / INTERAGIR / SILENCIAR / DENUNCIAR', pp && /Pessoa/.test(pp.text) && ['VER PERFIL', 'INTERAGIR', 'SILENCIAR', 'DENUNCIAR'].every((k) => pp.text.includes(k)) && !/ATACAR/i.test(pp.text), pp?.text.replace(/\n/g, ' | '));
    check('painel só com dados públicos (sem sessão/ids/e-mail)', pp && !pp.text.includes(sidB) && !/@|userId|sess/i.test(pp.text));
    await A.click('.person-panel .pp-btn:nth-child(1)');
    await w(200);
    const prof = await ev(A, () => window.__pv.person());
    check('VER PERFIL: apelido + torcida pelos dados', prof.view === 'profile' && /Apelido/.test(prof.text) && /Torcida/.test(prof.text), prof.text.replace(/\n/g, ' | '));
    await A.evaluate(() => [...document.querySelectorAll('.person-panel .pp-btn')].find((b) => b.textContent === 'Voltar').click());
    await A.evaluate(() => [...document.querySelectorAll('.person-panel .pp-btn')].find((b) => b.textContent === 'INTERAGIR').click());
    await w(150);
    await A.evaluate(() => [...document.querySelectorAll('.person-panel .pp-btn')].find((b) => b.textContent === 'Acenar').click());
    const waved = await until(async () => (await ev(A, () => window.__pv.mp().self.social.act)) === 1, 4000);
    check('INTERAGIR → gesto (Acenar) confirmado pelo servidor', waved);
    // denúncia
    await ev(A, () => document.exitPointerLock?.()); await w(150); // fechar o painel recaptura o mouse (como os outros modais)
    await A.mouse.click(pc.screen.sx, pc.screen.sy);
    await until(async () => (await ev(A, () => window.__pv.person())).open, 3000);
    await A.evaluate(() => [...document.querySelectorAll('.person-panel .pp-btn')].find((b) => b.textContent === 'DENUNCIAR').click());
    await w(150);
    await A.evaluate(() => [...document.querySelectorAll('.person-panel .pp-btn')].find((b) => b.textContent === 'Spam').click());
    const rep = await until(async () => (await flashes(A)).find((f) => /Denúncia registrada/.test(f)), 4000);
    check('DENUNCIAR → user_report aceito pelo servidor ("Denúncia registrada")', rep);
    // Esc fecha
    await ev(A, () => document.exitPointerLock?.()); await w(150); // fechar o painel recaptura o mouse (como os outros modais)
    await A.mouse.click(pc.screen.sx, pc.screen.sy);
    await until(async () => (await ev(A, () => window.__pv.person())).open, 3000);
    await A.keyboard.press('Escape');
    await w(200);
    check('Esc fecha o painel', !(await ev(A, () => window.__pv.person())).open);
  } else check('desktop: outro jogador visível na tela', false);

  // ============================================================ celular (iPhone 14)
  const M = await open('Toca', { device: 'iPhone 14' });
  const mvs = await vehicles(M);
  let firstM = true;
  for (const kind of kinds) {
    const v = nearestOf(mvs.filter((x) => !x.occupant), kind, S[0] + 30, S[1]);
    if (!v) { check(`celular: há ${kind} livre`, false); continue; }
    await standBy(M, v, lateral[kind]);
    const c = await until(() => cand(M, `veh:${v.id}`), 4000);
    if (!c?.screen) { check(`celular: ${kind} na tela`, false); continue; }
    if (firstM) {
      firstM = false;
      // arrasto por cima do carro: gira a câmera e NÃO interage
      const yaw0 = await ev(M, () => window.__pv.camYaw());
      const st0 = (await ix(M)).stats.activations;
      const tc0 = await ev(M, () => window.__pv.touchTaps());
      await M.touchscreen.touchStart(c.screen.sx, c.screen.sy);
      for (let i = 1; i <= 6; i++) { await M.touchscreen.touchMove(c.screen.sx + i * 14, c.screen.sy); await w(16); }
      await M.touchscreen.touchEnd();
      await w(400);
      const st1 = (await ix(M)).stats.activations;
      const tc1 = await ev(M, () => window.__pv.touchTaps());
      const ride1 = await ev(M, () => window.__pv.riding());
      check('celular: arrasto por cima do veículo = câmera (não vira toque, não entra)', st1 === st0 && !ride1 && tc1.drags > tc0.drags && tc1.taps === tc0.taps, `drags ${tc0.drags}→${tc1.drags} taps ${tc0.taps}→${tc1.taps} yaw0=${yaw0}`);
      await standBy(M, v, lateral[kind]);
      const c2 = await until(() => cand(M, `veh:${v.id}`), 4000);
      Object.assign(c, c2);
      await w(300);
      await shot(M, 'T_mobile');
      const lbl = await ev(M, () => { const e = [...document.querySelectorAll('.ix-label')].find((x) => !x.hidden); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, t: e.textContent }; });
      check('celular: rótulo do alvo tocável (≥ 44 px de altura)', lbl && lbl.h >= 44, JSON.stringify(lbl));
    }
    await w(700); // câmera assentada: posição na tela relida antes do toque
    const cNow = (await cand(M, `veh:${v.id}`)) ?? c;
    const look0 = await ev(M, () => window.__pv.touchTaps());
    await M.touchscreen.tap(cNow.screen.sx, cNow.screen.sy);
    const rode = await until(async () => (await ev(M, () => window.__pv.riding())) === kind, 6000);
    if (!rode) { check(`celular: toque no ${kind} → entra (servidor)`, false); console.log('   dbg', JSON.stringify({ kind, scr: cNow.screen, last: (await ix(M)).last, riding: await ev(M, () => window.__pv.riding()), el: await ev(M, (x, y) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}` : null; }, cNow.screen.sx, cNow.screen.sy) })); if (await ev(M, () => window.__pv.riding())) await exitVehicle(M, true); continue; }
    const look1 = await ev(M, () => window.__pv.touchTaps());
    check(`celular: toque no ${kind} → entra (servidor) — toque não vira arrasto`, rode && look1.taps === look0.taps + 1 && look1.drags === look0.drags, `taps ${look0.taps}→${look1.taps}`);
    if (kind === 'car') {
      await w(500);
      const ui = await ev(M, () => {
        const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display === 'none' || r.width === 0 ? null : { w: r.width, h: r.height }; };
        return { exit: box('.veh-exit'), jump: box('.touch-btn.jump'), use: box('.touch-btn.use'), hud: window.__pv.vehHud() };
      });
      check('celular no carro: SAIR grande (≥ 44 px), PULAR/USAR escondidos, velocidade + dica do joystick', ui.exit && ui.exit.w >= 44 && ui.exit.h >= 44 && !ui.jump && !ui.use && ui.hud.shown, JSON.stringify(ui));
      // joystick: acelerar sem teclado
      const vp = M.viewport(); const sx = 80, sy = Math.round(vp.height * 0.78);
      await M.touchscreen.touchStart(sx, sy);
      for (let i = 1; i <= 5; i++) { await M.touchscreen.touchMove(sx, sy - i * 12); await w(30); }
      await w(1300);
      const sp = await ev(M, () => window.__pv.vehHud().text);
      await shot(M, 'X_hud_veiculo_celular');
      await M.touchscreen.touchEnd();
      check('celular: joystick ↑ acelera o carro (sem teclado)', /[1-9]\d* km\/h/.test(sp), sp);
    }
    const off = await exitVehicle(M, true);
    check(`celular ${kind}: SAIR desce`, off);
    await w(500);
  }
  // toque parado não gira a câmera
  const cam0 = await ev(M, () => window.__pv.camYaw());
  // HUD acordado (os painéis esmaecidos voltam a receber toques ao acordar): procura com ele visível
  await ev(M, () => window.__pv.hudSet({ poke: true, map: false }));
  await w(300);
  // ponto do cenário sem botão/painel do HUD e longe de qualquer objeto interativo projetado
  const free = await ev(M, () => {
    const pts = window.__pv.ix().cands.map((c) => c.screen).filter(Boolean);
    const H = innerHeight;
    // margem de 40 px de qualquer painel do HUD (os esmaecidos voltam a receber toques ao acordar)
    const hudBoxes = [...document.querySelectorAll('.hud > *:not(.touch-layer):not(.ix-label), .touch-btn')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.width < innerWidth * 0.95);
    const clear = (x, y) => hudBoxes.every((r) => x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40);
    for (let y = Math.round(H * 0.3); y < H * 0.85; y += 10) for (let x = 20; x < innerWidth - 20; x += 10) {
      const e = document.elementFromPoint(x, y);
      if (e?.classList.contains('touch-layer') && clear(x, y) && pts.every((p) => Math.hypot(p.sx - x, p.sy - y) > Math.max(60, p.rPx + 30))) return { x, y };
    }
    return null;
  });
  if (!free) check('celular: achou um ponto vazio para o toque parado', false);
  else {
    await M.touchscreen.tap(free.x, free.y);
    await w(300);
    const cam1 = await ev(M, () => window.__pv.camYaw());
    const st = (await ix(M)).state;
    check('celular: toque parado (no vazio) não gira a câmera e não interage', Math.abs(cam0 - cam1) < 1e-6 && st === 'foot', `yaw ${cam0.toFixed(4)} → ${cam1.toFixed(4)} · ${st}`);
  }
  await M.keyboard.press('Escape'); // fecha qualquer painel aberto por engano
  await ev(M, () => window.__pv.hudSet({ map: false, poke: true }));
  // toque na pessoa (A está perto de B em pa): M vai até lá
  await ev(M, (a, b) => { window.__pvProg?.tp(a, b); window.__pv.teleport(a, b, 0); }, pa.x + 1, pa.z - 3.2);
  await w(1500);
  await ev(M, () => window.__pv.camera(0, 0.25, 4.5));
  await w(800);
  const mpc = await until(async () => (await ix(M))?.cands.find((c) => c.type === 'person' && c.screen) ?? null, 8000);
  if (mpc) {
    await M.touchscreen.tap(mpc.screen.sx, mpc.screen.sy);
    const pp = await until(async () => { const s = await ev(M, () => window.__pv.person()); return s.open ? s : null; }, 4000);
    const btn = await ev(M, () => { const b = document.querySelector('.person-panel .pp-btn'); const r = b?.getBoundingClientRect(); return r ? r.height : 0; });
    const dbg = pp ? '' : JSON.stringify({ el: await ev(M, (x, y) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}` : null; }, mpc.screen.sx, mpc.screen.sy), mpc, last: (await ix(M)).last, stats: (await ix(M)).stats, taps: await ev(M, () => window.__pv.touchTaps()), fl: (await flashes(M)).slice(-3) });
    check('celular: toque na pessoa abre o painel (botões ≥ 44 px)', pp && btn >= 44, `${btn}px ${dbg}`);
    await M.touchscreen.tap(30, 120); // fora fecha
    await w(300);
    check('celular: toque fora fecha o painel', !(await ev(M, () => window.__pv.person())).open);
  } else check('celular: pessoa na tela', false, JSON.stringify({ ix: await ix(M).then((i) => ({ state: i.state, cands: i.cands.filter((c) => c.type === 'person') })), remotes: await ev(M, () => window.__pv.mp().remotes.map((r) => [r.name, r.x, r.z])), me: await ev(M, () => window.__pv.metrics().player), tap: free }));
} catch (e) {
  console.log('ERRO', e);
  check('roteiro terminou sem exceção', false, String(e?.message ?? e));
} finally {
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} verificações`);
  writeFileSync(`${SHOTS}/interaction_qa.json`, JSON.stringify({ when: new Date().toISOString(), ok, total: results.length, results }, null, 1));
  await cleanup();
  process.exit(ok === results.length ? 0 : 1);
}
