/**
 * Rodada 9 — CONFRONTO no multiplayer: 2 jogadores reais (um Chrome cada) + servidor de teste próprio (PV_TEST=1,
 * PV_STORE=memory, evento 'cotidiano' = interação opcional, porta PV_COMBAT_PORT ou 2960). Requer o dev server.
 *
 * Decisão do dono (2026-10-18): avenida toda COMBAT, sem área de paz, sem consentimento (zones.json).
 * Roteiro: A e B entram ao lado do spawn, PACÍFICOS (sem K) → A soca → B sofre impacto e vê o golpe · os dois vão até
 * a área de treino do boneco → A soca B → B cambaleia (servidor) e reage · B esquiva enquanto A golpeia → 'dodged' ·
 * A pega o taco no apoio (prop 11) → golpe de taco · golpes até B cair (condição 0 → queda/ragdoll) → B levanta →
 * proteção (fx PROTECTED; golpe 'blocked', mas o golpe ANIMA para B) · boneco reage · A pula e B vê A no ar · HUD ·
 * toque: SOCO/CHUTE/ESQUIVA sempre visíveis · NPCs de ambiente no CENTRO reagem a soco/chute e ao taco tirado da RODA.
 * Capturas reais: docs/screenshots/round9/A_pulo.jpg, B_soco.jpg, C_chute.jpg, D_esquiva.jpg, I_hud_confronto.jpg,
 * L_npc_queda.jpg
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
// ao lado do spawn (antes zona de paz; agora COMBAT como toda a avenida); treino: 3 m a leste do boneco
const MANIFEST = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const SPN = MANIFEST.spawn.p;
const PEACE = { A: [SPN[0] + 6, SPN[1]], B: [SPN[0] + 6, SPN[1] + 1.1] };
// ponto de apoio de itens de confronto mais perto do boneco (combat_props.json supply.racks; mesma conta de pointOnAxis)
const AX = MANIFEST.pvAxis;
function pointOnAxis(t, side = 0) {
  const seg = []; let total = 0;
  for (let i = 0; i < AX.length - 1; i++) { const l = Math.hypot(AX[i + 1][0] - AX[i][0], AX[i + 1][1] - AX[i][1]); seg.push(l); total += l; }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const [ax, az] = AX[i], [bx, bz] = AX[i + 1];
      const u = seg[i] ? Math.min(1, want / seg[i]) : 0, dx = (bx - ax) / (seg[i] || 1), dz = (bz - az) / (seg[i] || 1);
      return { x: ax + (bx - ax) * u - dz * side, z: az + (bz - az) * u + dx * side };
    }
    want -= seg[i];
  }
  return { x: AX[0][0], z: AX[0][1] };
}
const rackDef = JSON.parse(readFileSync('public/gameplay/combat_props.json', 'utf8')).supply.racks.find((r) => r.id === 'apoio_campo_de_santana');
const RACK = pointOnAxis(rackDef.at.t, rackDef.at.side);
const FIGHT = { A: [D.x + 3.2, D.z], B: [D.x + 3.2, D.z + 1.1] };
const ZONES = JSON.parse(readFileSync('public/world/zones.json', 'utf8'));
const CENTRO = ZONES.zones.find((z) => z.id === 'CENTRO').anchor;
const CENTRO_P = pointOnAxis(CENTRO.t, CENTRO.side);

async function open(name, sp, phone = false) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1100, height: 640 }, protocolTimeout: 240000 });
  browsers.push(browser);
  const p = await browser.newPage();
  if (phone) await p.emulate(KnownDevices['iPhone 14']);
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=15:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
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
/** teleporte do servidor de TESTE (PV_TEST=1; o servidor põe o jogador no ponto) — trechos longos do roteiro */
const tp = async (p, to) => { await ev(p, (x, z) => window.__pvProg.tp(x, z), to[0], to[1]); await w(700); };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });
/** roda de ações de verdade (G → ITENS → rótulo), como o jogador: o pedido `prop` sai do mesmo clique */
async function wheelPick(p, label) {
  await ev(p, () => window.__pv.key('KeyG'));
  await until(p, () => !!document.querySelector('.action-wheel.open'), 2000);
  await ev(p, () => [...document.querySelectorAll('.aw-cat')].find((b) => b.textContent === 'ITENS')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await w(150);
  const found = await ev(p, (l) => { const b = [...document.querySelectorAll('.aw-act')].find((x) => x.textContent === l); b?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return !!b; }, label);
  await ev(p, () => window.__pv.key('Escape'));
  return found;
}
const npcHits = (p) => ev(p, () => { const n = window.__pv.npcs(); return n.peds.hits + n.rally.hits; });
/** persegue o NPC de ambiente mais perto e golpeia (`key`) até um reagir (NPCs andam; o golpe local decide na janela) */
async function hitNpc(p, key, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await ev(p, () => window.__pv.npcs(60));
    const t = n.list[0];
    if (!t) { await w(500); continue; }
    if (t.d > 1.25) { await ev(p, (x, z) => window.__pv.walkTo(x, z, true), t.x, t.z); await w(200); continue; }
    await ev(p, () => window.__pv.stopWalk());
    const before = await npcHits(p);
    const m = await me(p);
    await ev(p, (y) => window.__pv.face(y), Math.atan2(t.x - m.x, t.z - m.z));
    await w(60);
    await ev(p, (k) => window.__pv.cbt(k), key);
    if (await until(p, (b) => { const q = window.__pv.npcs(); return q.peds.hits + q.rally.hits > b; }, 1000, 50, before)) return true;
    await w(700); // recuperação/cooldown
  }
  return false;
}

const A = await open('Ana', PEACE.A);
const B = await open('Beto', PEACE.B);
try {
  check('A e B se veem', await until(A, () => window.__pv.mp().remotes.length >= 1, 8000) && await until(B, () => window.__pv.mp().remotes.length >= 1, 8000));
  check('os dois continuam PACÍFICOS (sem K)', (await mp(A)).self.interaction === 'pacifico' && (await mp(B)).self.interaction === 'pacifico');
  await w(5200); // proteção de entrada (5 s) termina

  // ---------------------------------------------------------------- 1. spawn, sem consentimento: pacíficos se acertam
  {
    const c = await cb(A);
    check('ao lado do spawn: política COMBAT e contexto de confronto (sem área de paz)', c.policy === 'COMBAT' && c.context, `política ${c.policy}`);
    await face(A, PEACE.B); await face(B, PEACE.A);
    const acts0 = (await cb(B)).stats.acts;
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    const hit = await until(B, () => window.__pv.combat().stats.hitsIn >= 1, 3000);
    const b = await cb(B), a = await cb(A);
    check('spawn: A pacífico soca B pacífico → impacto decidido pelo servidor', hit && b.condition < 100, `condição ${b.condition}`);
    check('spawn: B vê o golpe de A (cbt_act) e nada é negado por zona', b.stats.acts > acts0 && !a.stats.denied.includes('zona_paz'), JSON.stringify(a.stats.denied));
    await until(B, () => window.__pv.mp().self.status === 0 && !window.__pv.combat().locked, 3000);
  }

  // ---------------------------------------------------------------- 2. área de treino (COMBAT)
  await tp(A, FIGHT.A); await tp(B, FIGHT.B);
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
    await walk(B, FIGHT.B, 5000); // o soco empurrou B 0,35 m: volta para o alcance do chute
    await face(A, FIGHT.B);
    const before = (await cb(B)).stats.hitsIn;
    await ev(A, () => window.__pv.cbt('cbt_kick'));
    await w(300);
    await shot(A, 'C_chute');
    const kicked = await until(B, (n) => window.__pv.combat().stats.hitsIn > n, 3000, 100, before);
    const ka = await cb(A);
    check('chute acerta (servidor)', kicked, JSON.stringify({ denied: ka.stats.denied, last: ka.stats.lastHit, a: await me(A), b: await me(B) }));
  }
  // esquiva: B esquiva e A golpeia na janela → 'dodged'
  {
    await w(1200);
    await walk(B, FIGHT.B, 5000); await face(B, FIGHT.A); await face(A, FIGHT.B);
    await w(400);
    const before = (await cb(B)).stats.dodgedIn;
    // janela: invulnerável 320 ms; o soco de A fica ativo 120 ms depois do pedido (até 3 tentativas: navegadores
    // separados não disparam no mesmo milissegundo numa máquina carregada)
    let dodged = false;
    for (let k = 0; k < 3 && !dodged; k++) {
      if (k) { await w(1300); await walk(B, FIGHT.B, 5000); await face(B, FIGHT.A); await face(A, FIGHT.B); }
      await Promise.all([ev(A, () => window.__pv.cbt('cbt_punch')), w(30).then(() => ev(B, () => window.__pv.cbt('cbt_dodge')))]);
      await w(120);
      if (!k) { await look(B, FIGHT.A, 0.12, 4); await shot(B, 'D_esquiva'); }
      dodged = await until(B, (n) => window.__pv.combat().stats.dodgedIn > n, 2000, 100, before);
    }
    const a = await cb(A);
    check('B esquiva → servidor responde "dodged" (sem impacto)', dodged, `A viu ${a.stats.dodgedOut} esquivas`);
  }
  // taco (prop 11) → golpe de taco
  {
    await w(1000);
    await walk(B, FIGHT.B, 5000);
    // taco só se pega num ponto de apoio (posse no servidor — server/src/items): A vai até o apoio, T, e volta
    await tp(A, [RACK.x + 1, RACK.z]);
    await until(A, () => (window.__pv.r9b().items?.items ?? []).some((it) => it.prop === 11), 5000);
    const bat = await ev(A, () => (window.__pv.r9b().items?.items ?? []).find((it) => it.prop === 11) ?? null);
    if (bat) await tp(A, [bat.x + 0.4, bat.z]);
    await until(A, () => window.__pv.r9b().items?.near?.prop === 11, 4000);
    await ev(A, () => window.__pv.key('KeyT'));
    check('A pega o taco (servidor confirma o item)', await until(A, () => window.__pv.social().server?.prop === 11, 4000));
    await tp(A, FIGHT.A);
    await w(1800); // zona com histerese
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
    const before = (await cb(A)).stats.blocked, actsB0 = (await cb(B)).stats.acts;
    await ev(A, () => window.__pv.cbt('cbt_punch'));
    const blocked = await until(A, (n) => window.__pv.combat().stats.blocked > n, 3000, 100, before);
    check('golpe durante a proteção → "blocked", B intacto', blocked && (await cb(B)).condition === 100, `condição ${(await cb(B)).condition}`);
    check('golpe bloqueado ainda ANIMA para B (cbt_act)', (await cb(B)).stats.acts > actsB0, `acts ${(await cb(B)).stats.acts} > ${actsB0}`);
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
  // toque (iPhone emulado): SOCO/CHUTE/ESQUIVA sempre visíveis para jogador (a avenida toda é de confronto)
  {
    const M = await open('Toque', [PEACE.A[0] + 3, PEACE.A[1] - 2], true);
    const c0 = await cb(M);
    check('toque: botões de confronto visíveis no spawn, em modo pacífico', c0.touch === true && c0.context, JSON.stringify({ touch: c0.touch, ctx: c0.context }));
    await tp(M, [FIGHT.A[0] + 2, FIGHT.A[1] - 3]);
    check('toque: continuam visíveis na área de treino', await until(M, () => window.__pv.combat().touch === true, 4000));
    await ev(M, () => window.__pv.cbt('cbt_punch'));
    await w(250);
    await shot(M, 'J_toque_confronto');
    await tp(M, [CENTRO_P.x, CENTRO_P.z]);
    await w(1500);
    check('toque: continuam visíveis no CENTRO', (await cb(M)).touch === true);
  }
  // NPCs de ambiente (locais do cliente) no CENTRO: soco, chute e taco tirado da RODA
  {
    const N = await open('Npc', [CENTRO_P.x, CENTRO_P.z]);
    await w(5200); // proteção de entrada: não muda nada para NPC, mas o HUD estabiliza
    check('CENTRO: política COMBAT', (await cb(N)).policy === 'COMBAT', (await cb(N)).policy);
    check('CENTRO: há NPCs de ambiente perto', await until(N, () => window.__pv.npcs(60).list.length > 0, 15000, 300));
    const p0 = await ev(N, () => window.__pv.npcs());
    check('soco em NPC: ele reage (cambaleia)', await hitNpc(N, 'cbt_punch'), JSON.stringify((await ev(N, () => window.__pv.npcs())).peds));
    await w(900);
    check('chute em NPC: ele reage', await hitNpc(N, 'cbt_kick'));
    await w(4800); // rodada 9.1: o chute DERRUBA — espera o NPC levantar antes do teste do taco
    const it = (await ev(N, () => window.__pv.r9b().items));
    check('roda oferece taco/barra/spray sem apoio (freeCombatProps)', it?.free === true && [11, 12, 13].every((id) => it.wheel.includes(id)), JSON.stringify(it?.wheel));
    check('taco tirado da RODA (ITENS) vai para a mão (servidor aceita)', await wheelPick(N, 'Taco') && await until(N, () => window.__pv.social().server?.prop === 11, 4000));
    await w(400);
    const down0 = (await ev(N, () => window.__pv.npcs())).peds.down;
    const bat = await hitNpc(N, 'cbt_punch');
    const n1 = await ev(N, () => window.__pv.npcs());
    check('taco em NPC: ele cai (deitado)', bat && (n1.peds.down > down0 || n1.rally.reacting > 0), JSON.stringify({ peds: n1.peds, rally: n1.rally }));
    const lying = (await ev(N, () => window.__pv.npcs())).reacting.find((r) => r.kind === 'down');
    if (lying) { const m = await me(N); await ev(N, (y) => window.__pv.camera(y, 0.5, 4.5), Math.atan2(lying.x - m.x, lying.z - m.z) + 0.7); } // de lado: o próprio não tapa
    await w(900);
    await shot(N, 'L_npc_queda');
    check('NPC levanta sozinho (~4 s) e volta a andar', await until(N, () => window.__pv.npcs().peds.down === 0, 7000, 200));
    const st = (await cb(N)).stats;
    check('golpe em NPC fica no cliente (nenhum cbt_hit de NPC do servidor)', st.npcHits >= 3 && st.hitsOut === 0, `npcHits ${st.npcHits} (antes ${p0.peds.hits + p0.rally.hits})`);
  }
} catch (e) { console.error(e); check('roteiro sem exceção', false, String(e)); }
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length}`);
await cleanup();
process.exit(ok === results.length ? 0 : 1);
