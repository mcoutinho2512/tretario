/**
 * Rodada 9 — CONFRONTO no multiplayer: 2 jogadores reais (um Chrome cada) + servidor de teste próprio (PV_TEST=1,
 * PV_STORE=memory, evento 'cotidiano' = interação opcional, porta PV_COMBAT_PORT ou 2960). Requer o dev server.
 *
 * Roteiro: A e B entram numa área de PAZ (fora de zona de combate) → K nos dois → A soca → negado 'zona_paz' (aviso
 * discreto) e B sem impacto · os dois andam até a ÁREA DE TREINO do boneco (política COMBAT) → A soca B → B cambaleia
 * (servidor) e reage · B esquiva enquanto A golpeia → 'dodged' · A pega o taco (prop 11) → golpe de taco · golpes até
 * B cair (condição 0 → queda/ragdoll) → B levanta → proteção (fx PROTECTED; golpe 'blocked') · boneco reage ·
 * A pula e B vê A no ar · HUD de confronto.
 * Capturas reais: docs/screenshots/round9/A_pulo.jpg, B_soco.jpg, C_chute.jpg, D_esquiva.jpg, I_hud_confronto.jpg
 * uso: node tools/qa/combat_mp.mjs [baseUrl]   (imprime N/N)
 */
import puppeteer, { KnownDevices } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_COMBAT_PORT ?? 2960);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'docs/screenshots/round9';
mkdirSync(OUT, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_EVENT: 'cotidiano', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const cleanup = async () => { for (const b of browsers) await b.close().catch(() => {}); try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

const combat = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8'));
const D = combat.dummies[0];
// paz: 22 m a leste do boneco (fora da área de treino, r = areaR); combate: 3 m a leste do boneco
const PEACE = { A: [D.x + 22, D.z], B: [D.x + 22, D.z + 1.1] };
const FIGHT = { A: [D.x + 3.2, D.z], B: [D.x + 3.2, D.z + 1.1] };

async function open(name, sp, phone = false) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1100, height: 640 }, protocolTimeout: 240000 });
  browsers.push(browser);
  const p = await browser.newPage();
  if (phone) await p.emulate(KnownDevices['iPhone 14']);
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=15:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pv.combat()', { timeout: 180000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (p, fn, ms = 4000, step = 100, ...a) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(p, fn, ...a)) return true; await w(step); } return false; };
const me = (p) => ev(p, () => window.__pv.metrics().player);
const cb = (p) => ev(p, () => window.__pv.combat());
const mp = (p) => ev(p, () => window.__pv.mp());
async function walk(p, to, ms = 15000) {
  await ev(p, (x, z) => window.__pv.walkTo(x, z, false), to[0], to[1]);
  await until(p, () => window.__pv.arrived(), ms, 150);
  await ev(p, () => window.__pv.stopWalk());
}
/** vira o corpo para o ponto (rumo enviado no próximo movimento) */
const face = async (p, to) => { const m = await me(p); await ev(p, (y) => window.__pv.face(y), Math.atan2(to[0] - m.x, to[1] - m.z)); await w(250); };
/** câmera atrás do jogador olhando para o ponto */
const look = async (p, to, pitch = 0.12, dist = 4.2) => { const m = await me(p); await ev(p, (y, pi, d) => window.__pv.camera(y, pi, d), Math.atan2(to[0] - m.x, to[1] - m.z), pitch, dist); };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });

const A = await open('Ana', PEACE.A);
const B = await open('Beto', PEACE.B);
try {
  check('A e B se veem', await until(A, () => window.__pv.mp().remotes.length >= 1, 8000) && await until(B, () => window.__pv.mp().remotes.length >= 1, 8000));
  for (const p of [A, B]) await ev(p, () => window.__pv.key('KeyK'));
  check('modo interação nos dois (servidor)', await until(A, () => window.__pv.mp().self.interaction === 'interacao', 4000) && await until(B, () => window.__pv.mp().self.interaction === 'interacao', 4000));
  await w(5200); // proteção de entrada (5 s) termina

  // ---------------------------------------------------------------- 1. PAZ
  {
    const c = await cb(A);
    check('área de paz: política PEACE no cliente', c.policy === 'PEACE', `política ${c.policy}`);
    await face(A, PEACE.B); await face(B, PEACE.A);
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    const denied = await until(A, () => window.__pv.combat().stats.denied.includes('zona_paz'), 3000);
    const peace = (await cb(A)).hud.peace;
    check('PAZ: soco negado pelo servidor (zona_paz) com aviso discreto ZONA DE PAZ', denied && peace, `aviso ${peace}`);
    await w(600);
    const b = await cb(B), st = (await mp(B)).self.status;
    check('PAZ: B sem impacto (condição 100, de pé)', b.condition === 100 && st === 0 && b.stats.hitsIn === 0, `condição ${b.condition} · status ${st}`);
  }

  // ---------------------------------------------------------------- 2. área de treino (COMBAT)
  await Promise.all([walk(A, FIGHT.A), walk(B, FIGHT.B)]);
  await w(1800); // zona com histerese (servidor 2 Hz, 1,2 s de permanência)
  {
    const a = await cb(A), b = await cb(B);
    check('na área de treino: política de confronto nos dois', a.policy !== 'PEACE' && b.policy !== 'PEACE' && a.context && b.context, `A ${a.policy} · B ${b.policy}`);
  }
  await face(A, FIGHT.B); await face(B, FIGHT.A);
  await look(A, FIGHT.B, 0.14, 3.6);
  // soco: B cambaleia (servidor) e reage
  {
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    await w(230);
    await shot(A, 'B_soco');
    const hit = await until(B, () => window.__pv.combat().stats.hitsIn >= 1, 3000);
    const b = await cb(B);
    check('COMBATE: A soca B → servidor decide o acerto, B perde condição', hit && b.condition < 100, `condição ${b.condition} · último ${JSON.stringify(b.stats.lastHit)}`);
    check('B reage (cambaleia: estado 3 decidido pelo servidor)', b.stats.lastHit?.st === 3);
    check('B volta ao normal depois do cambaleio', await until(B, () => window.__pv.mp().self.status === 0 && !window.__pv.combat().locked, 3000));
  }
  // chute
  {
    await w(900);
    await face(A, FIGHT.B);
    const before = (await cb(B)).stats.hitsIn;
    await ev(A, () => window.__pv.cbt('cbt_kick'));
    await w(300);
    await shot(A, 'C_chute');
    check('chute acerta (servidor)', await until(B, (n) => window.__pv.combat().stats.hitsIn > n, 3000, 100, before));
  }
  // esquiva: B esquiva e A golpeia na janela → 'dodged'
  {
    await w(1200);
    await walk(B, FIGHT.B, 5000); await face(B, FIGHT.A); await face(A, FIGHT.B);
    await w(400);
    const before = (await cb(B)).stats.dodgedIn;
    await ev(B, () => window.__pv.cbt('cbt_dodge'));
    await w(60);
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    await w(120);
    await look(B, FIGHT.A, 0.12, 4);
    await shot(B, 'D_esquiva');
    const dodged = await until(B, (n) => window.__pv.combat().stats.dodgedIn > n, 3000, 100, before);
    const a = await cb(A);
    check('B esquiva → servidor responde "dodged" (sem impacto)', dodged, `A viu ${a.stats.dodgedOut} esquivas`);
  }
  // taco (prop 11) → golpe de taco
  {
    await w(1000);
    await walk(B, FIGHT.B, 5000);
    await ev(A, () => window.__pv.prop('bat'));
    check('A pega o taco (servidor confirma o item)', await until(A, () => window.__pv.social().server?.prop === 11, 3000));
    await face(A, FIGHT.B); await face(B, FIGHT.A);
    await w(300);
    const before = (await cb(B)).stats.hitsIn;
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    const hit = await until(B, (n) => window.__pv.combat().stats.hitsIn > n, 3000, 100, before);
    const lh = (await cb(B)).stats.lastHit;
    check('golpe de taco resolvido no servidor (ação 10)', hit && lh?.a === 10, JSON.stringify(lh));
  }
  // golpes até B cair → levanta → proteção
  {
    let down = false;
    for (let i = 0; i < 8 && !down; i++) {
      await w(950);
      await walk(B, FIGHT.B, 4000); await face(A, FIGHT.B);
      await ev(A, () => window.__pv.cbt('cbt_punch'));
      down = await until(B, () => window.__pv.isDown(), 1500, 80);
    }
    check('condição 0 → B cai (queda/ragdoll existente)', down);
    await w(600);
    await look(A, FIGHT.B, 0.2, 5);
    check('A vê B caído (estado do servidor)', ((await mp(A)).remotes.find((r) => r.name === 'Beto')?.status ?? 0) >= 1);
    check('B levanta (servidor)', await until(B, () => !window.__pv.isDown() && window.__pv.mp().self.status === 0, 9000));
    check('B protegido ao levantar (fx PROTECTED)', await until(B, () => (window.__pv.mp().self.fx & 2) !== 0, 2000));
    await walk(B, FIGHT.B, 4000); await face(A, FIGHT.B); await face(B, FIGHT.A);
    const before = (await cb(A)).stats.blocked;
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    const blocked = await until(A, (n) => window.__pv.combat().stats.blocked > n, 3000, 100, before);
    check('golpe durante a proteção → "blocked", B intacto', blocked && (await cb(B)).condition === 100, `condição ${(await cb(B)).condition}`);
    await w(500);
    await look(B, FIGHT.A, 0.1, 3.4);
    await shot(B, 'I_hud_confronto');
    check('HUD de confronto visível em B depois do confronto', (await cb(B)).hud.shown);
  }
  // boneco de treino
  {
    await ev(A, () => window.__pv.prop(null));
    await until(A, () => (window.__pv.social().server?.prop ?? 0) === 0, 3000);
    await walk(A, [D.x + 1.1, D.z], 6000);
    await face(A, [D.x, D.z]);
    check('A recebe o boneco de treino (cbt_dummy, não é jogador)', (await cb(A)).dummies.length === 1 && (await mp(A)).remotes.every((r) => r.name !== ''));
    const before = (await cb(A)).stats.dummyHits;
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    check('boneco reage ao golpe (servidor)', await until(A, (n) => window.__pv.combat().stats.dummyHits > n, 3000, 100, before));
  }
  // pulo: B vê A no ar (y interpolado + loco 3 → impulso/pouso da biblioteca)
  {
    await w(1000);
    const g = await me(A);
    await look(B, [g.x, g.z], 0.04, 5);
    const r0 = (await mp(B)).remotes.find((x) => x.name === 'Ana');
    await ev(A, () => window.__pv.jump());
    let aPeak = 0, bPeak = 0, shotDone = false;
    for (let i = 0; i < 25; i++) {
      const ay = (await me(A)).y - g.y;
      const ry = ((await mp(B)).remotes.find((x) => x.name === 'Ana')?.y ?? r0.y) - r0.y;
      aPeak = Math.max(aPeak, ay); bPeak = Math.max(bPeak, ry);
      if (!shotDone && ry > 0.3) { shotDone = true; await shot(B, 'A_pulo'); }
      await w(30);
    }
    check('A pula (previsão local)', aPeak > 0.3, `pico ${aPeak.toFixed(2)} m`);
    check('B vê A no ar (servidor aceitou o y do pulo)', bPeak > 0.25, `pico visto ${bPeak.toFixed(2)} m`);
    const st = (await cb(A)).stats;
    check('servidor aceitou o pulo (sem jump_denied)', st.jumps >= 1 && st.jumpDenied.length === 0, JSON.stringify(st.jumpDenied));
  }
  // toque (iPhone emulado): SOCO/CHUTE/ESQUIVA só com contexto de confronto
  {
    const M = await open('Toque', [PEACE.A[0] + 3, PEACE.A[1] - 2], true);
    const c0 = await cb(M);
    check('toque: botões de confronto escondidos em zona de paz (modo pacífico)', c0.touch === false && !c0.context, JSON.stringify({ touch: c0.touch, ctx: c0.context }));
    await walk(M, [FIGHT.A[0] + 2, FIGHT.A[1] - 3], 20000);
    const shown = await until(M, () => window.__pv.combat().touch === true, 4000);
    check('toque: botões aparecem na área de treino', shown);
    await ev(M, () => window.__pv.cbt('cbt_punch'));
    await w(250);
    await shot(M, 'J_toque_confronto');
    await walk(M, [PEACE.A[0] + 3, PEACE.A[1] - 2], 20000);
    check('toque: somem ao sair', await until(M, () => window.__pv.combat().touch === false, 5000));
  }
} catch (e) { console.error(e); check('roteiro sem exceção', false, String(e)); }
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length}`);
await cleanup();
process.exit(ok === results.length ? 0 : 1);
