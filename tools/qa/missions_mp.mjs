/**
 * Rodada 9 — missões/progressão no navegador (um Chrome por jogador), servidor de teste próprio (PV_TEST=1, memória):
 *  jogador NOVO vê "BEM-VINDO À PRESIDENTE VARGAS — Explore a avenida" com UM objetivo → "Começar" → anda (teclado,
 *  movimento validado pelo servidor) → BEM-VINDO conclui e aparecem as próximas → teleporte do servidor de teste pelas
 *  zonas → CONHEÇA A PRESIDENTE VARGAS conclui (aviso) + aviso de NÍVEL → tela PROGRESSO pelo menu ☰ (nível, barra de
 *  XP, missões, conquistas, recompensas com requisito e "em breve") → outro jogador não recebe nada disso → recarregar
 *  (visitante): progresso da sessão recomeça, boas-vindas não repete (visto guardado no aparelho).
 * Capturas reais: docs/screenshots/round9/L_missao_exploracao.jpg, M_progresso_xp.jpg, N_recompensas.jpg
 * uso: node tools/qa/missions_mp.mjs [baseUrl]   (PV_MISSIONS_PORT, padrão 2980; precisa do dev server)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_MISSIONS_PORT ?? 2980);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

// zonas: mesmo cálculo de src/world/zones.ts (pointOnAxis) sobre os DADOS
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const zoneDefs = JSON.parse(readFileSync('public/world/zones.json', 'utf8')).zones;
function pointOnAxis(axis, t) {
  const seg = []; let total = 0;
  for (let i = 0; i < axis.length - 1; i++) { const l = Math.hypot(axis[i + 1][0] - axis[i][0], axis[i + 1][1] - axis[i][1]); seg.push(l); total += l; }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const [ax, az] = axis[i], [bx, bz] = axis[i + 1], u = seg[i] ? Math.min(1, want / seg[i]) : 0;
      return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, heading: Math.atan2((bx - ax), (bz - az)) };
    }
    want -= seg[i];
  }
  return { x: axis[0][0], z: axis[0][1], heading: 0 };
}
const anchor = (id) => pointOnAxis(manifest.pvAxis, zoneDefs.find((z) => z.id === id).anchor.t);

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_METRICS: '0' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const cleanup = async () => { for (const b of browsers) await b.close().catch(() => {}); try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

async function open(name, sp, vp = { width: 1280, height: 720 }) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: vp });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=16:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp.x.toFixed(1)},${sp.z.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvProg?.ui?.p', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
const prog = (p) => ev(p, () => { const u = window.__pvProg.ui; return { p: u.p, persistent: u.persistent, notices: window.__pvProg.notices.map((n) => n.text), tracker: document.querySelector('.prog-tracker')?.textContent ?? '', trackerHidden: document.querySelector('.prog-tracker')?.hidden }; });
const noticeShown = (p, re) => ev(p, (src) => new RegExp(src).test(document.querySelector('.hud-notice.show')?.textContent ?? ''), re.source);

try {
  mkdirSync('docs/screenshots/round9', { recursive: true });
  const C0 = anchor('CENTRAL');
  const A = await open('Ana', C0);
  const B = await open('Bia', { x: C0.x + 5, z: C0.z + 3 }, { width: 640, height: 400 });

  // ---- boas-vindas (1ª entrada)
  const wel = await until(() => ev(A, () => document.querySelector('.prog-welcome')?.textContent ?? ''));
  check('jogador novo: boas-vindas "BEM-VINDO À PRESIDENTE VARGAS — Explore a avenida"', /BEM-VINDO À PRESIDENTE VARGAS/.test(wel ?? '') && /Explore a avenida/.test(wel ?? ''), (wel ?? '').slice(0, 90));
  check('boas-vindas com UM objetivo simples', ((wel ?? '').match(/Objetivo:/g) ?? []).length === 1 && /Caminhe 30 m/.test(wel ?? ''));
  const s0 = await prog(A);
  check('só a missão de boas-vindas ativa (as outras aparecem depois)', s0.p.active.length === 1 && s0.p.active[0].missionId === 'boas_vindas', s0.p.active.map((a) => a.missionId).join(','));
  check('visitante: progresso marcado como não persistente', s0.persistent === false);
  await A.click('.pw-ok');
  await w(600);
  check('"Começar" fecha a tela e o rastreador mostra a missão', !(await ev(A, () => !!document.querySelector('.prog-welcome'))) && /BEM-VINDO/.test((await prog(A)).tracker));
  check('servidor guardou "visto" (prog_seen)', !!(await until(async () => (await prog(A)).p.seen?.includes('welcome'))));

  // ---- anda ~40 m pelo eixo (teclado; movimento validado pelo servidor)
  await ev(A, (h) => { window.__pv.teleport(window.__pv.metrics().player.x, window.__pv.metrics().player.z, h); }, C0.heading + Math.PI);
  await w(300);
  const startPos = await ev(A, () => ({ ...window.__pv.metrics().player }));
  await ev(A, () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' })); window.__pv.press('KeyW', 9000); });
  await w(9300);
  await ev(A, () => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' })));
  const endPos = await ev(A, () => ({ ...window.__pv.metrics().player }));
  const walked = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
  const done1 = await until(async () => (await prog(A)).p.completedMissions.includes('boas_vindas'), 8000);
  check('andou a pé e BEM-VINDO concluiu (servidor)', !!done1, `${walked.toFixed(1)} m`);
  const s1 = await prog(A);
  check('aviso "MISSÃO CONCLUÍDA — BEM-VINDO…"', s1.notices.some((t) => /MISSÃO CONCLUÍDA — BEM-VINDO/.test(t)) || !!(await until(async () => (await prog(A)).notices.some((t) => /MISSÃO CONCLUÍDA — BEM-VINDO/.test(t)))));
  check('próximas missões reveladas aos poucos (3, não 10)', ['conheca_pv', 'entre_no_clima', 'mobilidade'].every((id) => s1.p.active.some((a) => a.missionId === id)) && s1.p.active.length <= 4, s1.p.active.map((a) => a.missionId).join(','));
  check('aviso de nova missão', !!(await until(async () => (await prog(A)).notices.some((t) => /Nova missão: CONHEÇA/.test(t)))));
  await ev(A, () => window.__pvProg.ui.net.send('mission_track', { id: 'conheca_pv' }));
  check('rastreador acompanha CONHEÇA A PRESIDENTE VARGAS', !!(await until(async () => /CONHEÇA A PRESIDENTE VARGAS/.test((await prog(A)).tracker))));

  // ---- teleporte (servidor de teste) pelas zonas
  const xp0 = (await prog(A)).p.xp;
  for (const z of ['CAMPO_DE_SANTANA', 'RIO_BRANCO', 'CANDELARIA']) {
    const p = anchor(z);
    await ev(A, (x, zz) => window.__pvProg.tp(x, zz), p.x, p.z);
    await w(2600);
  }
  const mid = await prog(A);
  check('objetivos de zona avançam (3 de 4)', mid.p.active.find((a) => a.missionId === 'conheca_pv')?.values && Object.keys(mid.p.active.find((a) => a.missionId === 'conheca_pv').values).length === 3);
  await ev(A, () => window.__pv.camera(Math.PI * 0.9, 0.28, 11));
  await ev(A, (x, zz) => window.__pvProg.tp(x, zz), C0.x, C0.z);
  const shown = await until(() => noticeShown(A, /MISSÃO CONCLUÍDA — CONHEÇA A PRESIDENTE VARGAS/), 12000);
  check('CONHEÇA A PRESIDENTE VARGAS concluiu (aviso na tela)', !!shown);
  await w(1100); // HUD volta do esmaecimento (0,7 s) e o rastreador já mostra a próxima missão
  await A.screenshot({ path: 'docs/screenshots/round9/L_missao_exploracao.jpg', type: 'jpeg', quality: 86 });
  console.log('   captura docs/screenshots/round9/L_missao_exploracao.jpg');
  const s2 = await prog(A);
  check('XP só das recompensas (missões + conquistas)', s2.p.xp === xp0 + 200 + 100, `${xp0} → ${s2.p.xp}`);
  check('conquista DO INÍCIO AO FIM + camisa ondas do calçadão liberada', s2.p.achievements.includes('inicio_ao_fim') && s2.p.unlocks.includes('shirt:211'));
  const lvl = await until(async () => (await prog(A)).notices.find((t) => /^NÍVEL \d/.test(t)), 15000);
  check('aviso de subida de nível', !!lvl, lvl ?? '');
  check('nível ≥ 3 (375 XP)', s2.p.level >= 3, `nível ${s2.p.level}`);

  // ---- tela PROGRESSO pelo menu ☰
  await w(1500);
  await A.click('.hud-btns .hud-icon[aria-label="Menu"]');
  await w(250);
  const item = await ev(A, () => [...document.querySelectorAll('.hud-menu button')].map((b) => b.textContent));
  check('menu ☰ tem "Progresso"', item.includes('Progresso'), item.join(' | '));
  await ev(A, () => [...document.querySelectorAll('.hud-menu button')].find((b) => b.textContent === 'Progresso').click());
  await w(500);
  const scr = await ev(A, () => { const s = document.querySelector('.ps-panel'); return s ? { text: s.textContent, bar: parseFloat(s.querySelector('.ps-bar i')?.style.width ?? '0') } : null; });
  check('PROGRESSO: nível + barra de XP', !!scr && /NÍVEL \d/.test(scr.text) && /XP/.test(scr.text) && scr.bar > 0, scr ? `barra ${scr.bar}%` : '');
  check('PROGRESSO: missões ativas e concluídas', !!scr && /MISSÕES ATIVAS/.test(scr.text) && /CONCLUÍDAS \(2\//.test(scr.text));
  check('PROGRESSO: conquistas e recompensas (liberado / requisito / em breve)', !!scr && /CONQUISTAS/.test(scr.text) && /Liberado/.test(scr.text) && /Nível \d/.test(scr.text) && /Em breve/.test(scr.text));
  await A.screenshot({ path: 'docs/screenshots/round9/M_progresso_xp.jpg', type: 'jpeg', quality: 86 });
  console.log('   captura docs/screenshots/round9/M_progresso_xp.jpg');
  await ev(A, () => { const s = document.querySelector('.ps-panel'); s.scrollTop = s.scrollHeight; });
  await w(300);
  await A.screenshot({ path: 'docs/screenshots/round9/N_recompensas.jpg', type: 'jpeg', quality: 86 });
  console.log('   captura docs/screenshots/round9/N_recompensas.jpg');
  await ev(A, () => window.__pvProg.ui.close());

  // ---- outro jogador não recebe o progresso de ninguém
  const b = await prog(B);
  check('outro jogador (B) não recebeu nada de A', b.p.xp === 0 && !b.notices.some((t) => /CONHEÇA/.test(t)), `B xp ${b.p.xp}`);

  // ---- visitante recarrega: progresso da sessão recomeça; boas-vindas não repete (visto no aparelho)
  await A.reload();
  await A.waitForFunction('window.__pvReady === true && window.__pvProg?.ui?.p', { timeout: 120000 });
  await w(2500);
  const r = await prog(A);
  check('visitante: nova sessão começa do zero (nada persiste)', r.p.xp === 0 && r.p.completedMissions.length === 0);
  check('visitante: boas-vindas não aparece de novo', !(await ev(A, () => !!document.querySelector('.prog-welcome'))));
  check('servidor sem falha de progressão', !log.some((l) => /\[progressão\] falha|assinante falhou/.test(l)));
} catch (e) {
  check('execução sem erro', false, e?.stack ?? String(e));
} finally {
  await cleanup();
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} verificações OK`);
process.exit(ok === results.length ? 0 : 1);
