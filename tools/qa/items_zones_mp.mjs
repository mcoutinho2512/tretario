/**
 * Rodada 9 (agente B) — itens de confronto no mundo, zonas (política), proteção de retorno, quedas e desorientação
 * com 2 clientes reais (um navegador cada) num servidor de TESTE próprio (PV_TEST=1, porta PV_ITEMS_PORT ou 2971).
 *
 *  · apoio do Campo de Santana: A pega o TACO → B vê na mão de A · A larga (Z) → item no chão para os dois → B pega
 *  · B troca para BARRA e SPRAY no apoio (o anterior cai no lugar) · item de confronto não sai da roda (negado)
 *  · proteção de retorno visível (fx + brilho) ao entrar e some sozinha · aviso de zona com a política
 *    (DISPUTA no apoio → ZONA DE PAZ ao andar para a Central; ZONA DE CONFRONTO ao andar para a Cidade Nova)
 *  · queda SEM `knock` (status) → o outro entra na queda; empurrão (knock + status) → uma queda só; mundos do Rapier
 *    liberados depois de levantar · cambaleio e desorientação (normal e reduzida) — efeitos forçados pelo QA do
 *    servidor de teste (qa_status / qa_fx): o sistema de confronto é quem aplica de verdade
 *  · capturas em docs/screenshots/round9/ (E_taco, F_barra, G_spray*, H_queda_ragdoll, J_zona_de_paz, K_zona_de_confronto)
 * uso: node tools/qa/items_zones_mp.mjs [baseUrl]   (requer o Vite rodando)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5302';
const PORT = Number(process.env.PV_ITEMS_PORT ?? 2971);
const SHOTS = 'docs/screenshots/round9';
mkdirSync(SHOTS, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

// eixo da avenida (mesma conta de src/world/zones.ts pointOnAxis)
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const AX = manifest.pvAxis;
function pointOnAxis(t, side = 0) {
  const seg = []; let total = 0;
  for (let i = 0; i < AX.length - 1; i++) { const l = Math.hypot(AX[i + 1][0] - AX[i][0], AX[i + 1][1] - AX[i][1]); seg.push(l); total += l; }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const [ax, az] = AX[i], [bx, bz] = AX[i + 1];
      const u = seg[i] ? Math.min(1, want / seg[i]) : 0;
      const dx = (bx - ax) / (seg[i] || 1), dz = (bz - az) / (seg[i] || 1);
      return { x: ax + (bx - ax) * u - dz * side, z: az + (bz - az) * u + dx * side };
    }
    want -= seg[i];
  }
  return { x: AX[0][0], z: AX[0][1] };
}
const supply = JSON.parse(readFileSync('public/gameplay/combat_props.json', 'utf8')).supply;
const rackDef = supply.racks.find((r) => r.id === 'apoio_campo_de_santana');
const RACK = pointOnAxis(rackDef.at.t, rackDef.at.side);

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_EVENT: 'cotidiano' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const cleanup = async () => { for (const b of browsers) { try { await b.close(); } catch { /* */ } } try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } });

async function open(name, sp, vp = { width: 1000, height: 620 }) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: vp });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|WebSocket|ERR_CONNECTION/.test(m.text())) console.log(`[${name}] console.error`, m.text().slice(0, 200)); });
  await goto(p, name, sp);
  return p;
}
async function goto(p, name, sp) {
  await p.goto(`${base}/?autostart=1&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp.x.toFixed(1)},${sp.z.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
const remote = async (P, name) => (await ev(P, () => window.__pv.mp().remotes)).find((r) => r.name === name);
const r9b = (P) => ev(P, () => window.__pv.r9b());
const key = (P, code) => ev(P, (c) => window.__pv.key(c), code);
async function walk(P, x, z, ms = 20000, run = false) { await ev(P, (a, b, r) => window.__pv.walkTo(a, b, r), x, z, run); return until(() => ev(P, () => window.__pv.arrived()), ms); }
const shot = async (P, name) => { await P.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 }); console.log(`   📷 ${SHOTS}/${name}.jpg`); };
const hideHelp = (P) => ev(P, () => { document.querySelector('.hud-hint')?.remove(); document.querySelector('.lock-hint')?.remove(); });

try {
  const A = await open('A', { x: RACK.x + 3, z: RACK.z + 3 }, { width: 1280, height: 720 });
  // proteção de retorno: A acabou de entrar
  // o brilho no próprio personagem (o carregamento pode passar dos 4 s da entrada): proteção forçada pelo QA
  await ev(A, () => window.__pv.netSend('qa_fx', { fx: 2, ms: 2500 }));
  const own = await until(async () => { const r = await r9b(A); return r.fx.aura && (r.self.fx & 2) ? r : null; }, 3000);
  check('brilho de proteção no próprio personagem enquanto o bit está ligado', !!own);
  // observa A desde ANTES de B terminar de carregar: os 4 s de proteção começam quando B entra na sala
  const watch = until(async () => { const b = await remote(A, 'B'); return b && (b.fx & 2) ? b : null; }, 240000);
  const B = await open('B', { x: RACK.x + 4, z: RACK.z + 1 });
  const seenBit = await Promise.race([watch, w(5000).then(() => null)]);
  check('B entrou com proteção de retorno: A recebe o bit PROTECTED de B', !!seenBit);
  // brilho no esqueleto remoto: A olha para B (esqueleto só no campo de visão — orçamento da multidão)
  const lookAtB = async () => { const b = await remote(A, 'B'); await ev(A, (x, z) => { const g = window.__pv.groundAt(x, z); window.__pv.lookFrom(x - 3.5, g + 1.9, z - 3.5, x, g + 1, z); }, b.x, b.z); };
  await until(async () => !(((await remote(A, 'B'))?.fx ?? 2) & 2), 8000);
  await lookAtB();
  await until(async () => (await remote(A, 'B'))?.fxVisual, 8000);
  await ev(B, () => window.__pv.netSend('qa_fx', { fx: 2, ms: 2500 }));
  const seenProt = await until(async () => { const b = await remote(A, 'B'); return b && (b.fx & 2) && b.fxVisual?.aura ? b : null; }, 3000);
  check('A vê o brilho de proteção em B (esqueleto remoto)', !!seenProt, JSON.stringify(seenProt?.fxVisual ?? (await remote(A, 'B'))?.fxVisual ?? null));
  await ev(A, () => window.__pv.lookFrom());
  const expired = await until(async () => { const b = await remote(A, 'B'); return b && !(b.fx & 2) && !b.fxVisual?.aura ? b : null; }, 8000);
  check('a proteção some sozinha (≈ 4 s)', !!expired);
  await hideHelp(A);

  // zona no apoio: Campo de Santana = DISPUTA
  const h0 = await ev(A, () => window.__pv.hudInfo());
  check('zona do apoio: Campo de Santana com política DISPUTA no aviso/minimapa', h0.zone === 'CAMPO_DE_SANTANA' && h0.policy === 'CONTESTED' && h0.banner.policy === 'Disputa', `${h0.zone} · ${h0.policy} · "${h0.banner.policy}"`);

  // itens do apoio na lista dos dois
  const listA = await until(async () => { const r = await r9b(A); return r.items.items.length >= 3 ? r.items.items : null; });
  const listB = await until(async () => { const r = await r9b(B); return r.items.items.length >= 3 ? r.items.items : null; });
  check('os dois recebem os itens do apoio (item_list na área de interesse)', listA && listB, `A ${listA?.length} · B ${listB?.length}`);
  const PROP = { bat: 11, bar: 12, spray: 13 };
  const itemOf = (list, prop) => list.find((i) => i.prop === prop && i.state === 0);

  // roda de ações não dá item de confronto
  await ev(A, () => window.__pv.prop('bat'));
  await w(800);
  const den = await ev(A, () => ({ d: window.__pv.lastDenial(), prop: window.__pv.r9b().self.prop }));
  check('item de confronto não sai da roda: `prop` sem possuir é negado (sem_item)', den.d === 'prop:sem_item' && den.prop === 0, JSON.stringify(den));

  // A pega o taco
  const bat = itemOf(listA, PROP.bat);
  await walk(A, bat.x, bat.z);
  await key(A, 'KeyR');
  const aBat = await until(async () => { const r = await r9b(A); return r.self.prop === PROP.bat && r.items.carried.c === PROP.bat ? r : null; });
  check('A pega o TACO no apoio (R) → na mão de A (servidor)', !!aBat, JSON.stringify(aBat?.items.carried ?? null));
  const seenBat = await until(async () => { const a = await remote(B, 'A'); return a && a.prop === PROP.bat && (a.visualProp === null || a.visualProp === PROP.bat) ? a : null; });
  check('B vê o taco na mão de A', !!seenBat, `prop ${seenBat?.prop} · visual ${seenBat?.visualProp}`);
  const hand = (await r9b(A)).items.hand;
  check('indicador MÃOS mostra o item atual', /Taco/.test(hand.item), JSON.stringify(hand));
  await ev(A, () => window.__pv.portrait(3.2));
  await w(900);
  await shot(A, 'E_taco_carregando');
  await ev(A, () => window.__pv.portrait(3.4, Math.PI * 0.62));
  await ev(A, () => window.__pv.r9bClip('swing_bat', 0.38));
  await w(400);
  await shot(A, 'E_taco');
  await ev(A, () => window.__pv.r9bClip(null));

  // A larga longe do apoio → item no chão para os dois → B pega
  await walk(A, RACK.x + 6, RACK.z + 5);
  await key(A, 'KeyZ');
  const dropped = await until(async () => { const r = await r9b(A); return r.items.carried.c === 0 && r.self.prop === 0 ? r.items.items.find((i) => i.prop === PROP.bat && i.state === 1) : null; });
  check('A larga (Z) → mão vazia e o taco aparece NO CHÃO para A', !!dropped, JSON.stringify(dropped ?? null));
  const dropB = dropped && await until(async () => (await r9b(B)).items.items.find((i) => i.id === dropped.id && i.state === 1));
  check('o taco no chão aparece para B (mesmo item, estado chão)', !!dropB);
  if (dropB) {
    await walk(B, dropB.x, dropB.z);
    await key(B, 'KeyR');
  }
  const bBat = await until(async () => { const r = await r9b(B); return r.self.prop === PROP.bat ? r : null; });
  check('B pega o taco do chão', !!bBat);
  const goneA = await until(async () => !(await r9b(A)).items.items.some((i) => i.id === dropped?.id));
  check('o item some do chão para A quando B pega', !!goneA);
  const aSeesB = await until(async () => { const b = await remote(A, 'B'); return b && b.prop === PROP.bat ? b : null; });
  check('A vê o taco na mão de B', !!aSeesB);

  // troca no apoio: barra e spray (o anterior cai)
  const listB2 = (await r9b(B)).items.items;
  const bar = itemOf(listB2, PROP.bar), spray = itemOf(listB2, PROP.spray);
  await walk(B, bar.x, bar.z);
  await key(B, 'KeyR');
  const bBar = await until(async () => { const r = await r9b(B); return r.self.prop === PROP.bar && r.items.items.some((i) => i.prop === PROP.bat && i.state === 1) ? r : null; });
  const batBack = bBar?.items.items.find((i) => i.prop === PROP.bat && i.state === 1);
  check('B troca para a BARRA (R no apoio): barra na mão, taco cai no lugar', !!bBar && !!batBack, `carregado ${bBar?.items.carried.c} · taco no chão ${!!batBack}`);
  check('A vê a barra na mão de B', !!(await until(async () => (await remote(A, 'B'))?.prop === PROP.bar)));
  await ev(B, () => window.__pv.portrait(3.0));
  await hideHelp(B);
  await w(900);
  await ev(B, () => window.__pv.portrait(3.2, Math.PI * 0.62));
  await ev(B, () => window.__pv.r9bClip('swing_bar', 0.34));
  await w(400);
  await shot(B, 'F_barra');
  await ev(B, () => window.__pv.r9bClip(null));
  await w(300);
  // do lado de fora do spray (o taco largado ficou na vaga da barra, mais perto do que o spray)
  const ox = spray.x - bar.x, oz = spray.z - bar.z, ol = Math.hypot(ox, oz) || 1;
  await walk(B, spray.x + (ox / ol) * 1.2, spray.z + (oz / ol) * 1.2);
  await w(300);
  await key(B, 'KeyR');
  const bSpray = await until(async () => { const r = await r9b(B); return r.self.prop === PROP.spray ? r : null; });
  check('B troca para o SPRAY', !!bSpray);
  check('A vê o spray na mão de B', !!(await until(async () => (await remote(A, 'B'))?.prop === PROP.spray)));
  // guardar/sacar (X): mão livre, item continua possuído
  await key(B, 'KeyX');
  const stowed = await until(async () => { const r = await r9b(B); return r.self.prop === 0 && r.items.carried.c === PROP.spray ? r : null; });
  check('X guarda o spray (mão livre, continua com ele)', !!stowed, JSON.stringify(stowed?.items.hand ?? null));
  await w(300);
  await key(B, 'KeyX');
  const drawn = await until(async () => (await r9b(B)).self.prop === PROP.spray);
  check('X saca de novo', !!drawn, drawn ? '' : JSON.stringify({ d: await ev(B, () => window.__pv.lastDenial()), r: (await r9b(B)).items.hand }));
  await ev(B, () => window.__pv.portrait(2.6));
  await w(900);
  await ev(B, () => window.__pv.portrait(2.8, Math.PI * 0.6));
  await ev(B, () => window.__pv.r9bClip('spray_use', 0.5));
  await w(400);
  await shot(B, 'G_spray');
  await ev(B, () => window.__pv.r9bClip(null));

  // B olha para A (o esqueleto remoto só existe para quem está no campo de visão — orçamento da multidão)
  const lookAtA = async () => { const a = await remote(B, 'A'); await ev(B, (x, z) => { const g = window.__pv.groundAt(x, z); window.__pv.lookFrom(x + 3.5, g + 1.9, z + 3.5, x, g + 1.0, z); }, a.x, a.z); await w(400); };
  await lookAtA();
  // desorientação (efeito forçado pelo servidor de teste): A sofre → véu na tela de A; B vê mãos no rosto
  await ev(A, () => window.__pv.netSend('qa_fx', { fx: 1, ms: 12000 }));
  const dis = await until(async () => { const r = await r9b(A); return r.disorient?.on && !r.disorient.reduced ? r : null; });
  check('DESORIENTADO: véu de tela só para A (normal: desfoque/dessaturação/vinheta)', !!dis, JSON.stringify(dis?.disorient ?? null));
  const disB = await until(async () => { const a = await remote(B, 'A'); return a && (a.fx & 1) && a.fxVisual?.clips.includes('disoriented') ? a : null; });
  check('B vê a reação "disoriented" em A (mãos no rosto) e B não tem véu', !!disB && !(await r9b(B)).disorient.on);
  await ev(A, () => window.__pv.camera(0, -0.1, 4.5));
  await w(1000);
  await shot(A, 'G_spray_desorientado_normal');
  await ev(A, () => window.__pv.r9bPrefs({ reduceEffects: true }));
  const red = await until(async () => { const r = await r9b(A); return r.disorient?.on && r.disorient.reduced ? r : null; });
  check('"Reduzir efeitos visuais": só ícone + tom leve', !!red);
  await w(700);
  await shot(A, 'G_spray_desorientado_reduzido');
  await ev(A, () => window.__pv.r9bPrefs({ reduceEffects: false }));
  const off = await until(async () => { const r = await r9b(A); return !r.disorient?.on ? r : null; }, 16000);
  check('o efeito sai sozinho (bit DISORIENTED expira)', !!off);
  const writes = (await r9b(A)).disorient.writes;
  check('véu: DOM só muda nas trocas de estado (sem escrita por quadro)', writes <= 6, `${writes} trocas`);

  // cambaleio
  const st0 = (await remote(B, 'A'))?.fxVisual?.staggers ?? 0;
  await ev(A, () => window.__pv.netSend('qa_status', { st: 3, ms: 900 }));
  const stg = await until(async () => { const a = await remote(B, 'A'); return a && a.fxVisual?.staggers > st0 ? a : null; }, 4000);
  check('CAMBALEIO (status 3) → B toca o clipe `stagger` em A', !!stg);
  await w(1500);

  // queda SEM knock: só a mudança de NetPlayer.status
  const sf0 = (await r9b(B)).statusFalls;
  await ev(A, () => window.__pv.netSend('qa_status', { st: 1 }));
  const fallB = await until(async () => { const a = await remote(B, 'A'); return a && a.status === 1 && a.fxVisual?.fall === 'down' ? a : null; }, 3000);
  const sf1 = (await r9b(B)).statusFalls;
  check('queda só por status (sem `knock`): B vê A cair (ragdoll/queda)', !!fallB && sf1 === sf0 + 1, `statusFalls ${sf0}→${sf1} · ragdoll ${fallB?.fxVisual?.ragdoll}`);
  check('o próprio A também entra na queda pelo status', await ev(A, () => window.__pv.isDown()));
  // câmera livre de B enquadrando A no chão
  const ap = await remote(B, 'A');
  await ev(B, (x, z) => { const g = window.__pv.groundAt(x, z); window.__pv.lookFrom(x + 3.2, g + 2.2, z + 2.4, x, g + 0.4, z); }, ap.x, ap.z);
  await w(500);
  await shot(B, 'H_queda_ragdoll');
  await ev(B, () => window.__pv.lookFrom());
  await w(4600);
  const freed = await until(async () => { const [a, b] = [await r9b(A), await r9b(B)]; return a.ragdollsLive === 0 && b.ragdollsLive === 0 ? [a, b] : null; }, 4000);
  check('depois de levantar: nenhum mundo Rapier vivo (sem vazamento) e item volta à mão', !!freed && !(await ev(A, () => window.__pv.isDown())), `vivos A ${freed?.[0].ragdollsLive} B ${freed?.[1].ragdollsLive}`);

  // empurrão (knock + status): UMA queda só
  await ev(A, () => window.__pv.netSend('mode', 'interacao'));
  await ev(B, () => window.__pv.netSend('mode', 'interacao'));
  await w(600);
  const bp = await remote(A, 'B');
  await walk(A, bp.x + 0.3, bp.z + 0.3);
  await w(500);
  const sfA0 = (await r9b(A)).statusFalls;
  const bSid = await ev(B, () => window.__pv.mp().session);
  let pushed = null;
  for (let i = 0; i < 4 && !pushed; i++) {
    const me = await ev(A, () => window.__pv.mp().self);
    const bb = await remote(A, 'B');
    await ev(A, (x, z) => window.__pv.walkTo(x, z, false), bb.x, bb.z);
    await w(350);
    await ev(A, (s) => window.__pv.rawPush(s), bSid);
    pushed = await until(async () => { const b = await remote(A, 'B'); return b && b.status === 1 ? b : null; }, 1500);
    void me;
  }
  await w(400);
  const sfA1 = (await r9b(A)).statusFalls;
  const bFall = await remote(A, 'B');
  check('empurrão: `knock` + status DOWN → A vê B cair UMA vez (status não redispara)', !!pushed && sfA1 === sfA0 && bFall?.fxVisual?.fall !== 'none', `queda ${!!pushed} · statusFalls ${sfA0}→${sfA1} · ${await ev(A, () => window.__pv.lastDenial())}`);
  const bDrop = await until(async () => { const r = await r9b(B); return r.items.carried.c === 0 ? r : null; }, 3000);
  check('quem cai larga o item de confronto (servidor) — o spray fica no chão', !!bDrop && bDrop.items.items.some((i) => i.prop === PROP.spray && i.state === 1));
  await w(4500);

  // reconexão (mesma entidade): proteção de retorno de novo — B vê
  await ev(A, () => window.__pv.netDrop());
  const back = await until(async () => { const m = await ev(A, () => window.__pv.mp()); return m.link === 'CONNECTED' && m.reconnects >= 1 ? m : null; }, 15000);
  const reProt = back && await until(async () => { const a = await remote(B, 'A'); return a && (a.fx & 2) ? a : null; }, 4000);
  check('reconectou (mesma entidade) → proteção de retorno de novo (B vê)', !!reProt, `reconexões ${back?.reconnects}`);

  // zonas: andar do apoio (DISPUTA) para a Central (PAZ)
  await ev(A, () => window.__pv.netSend('mode', 'pacifico'));
  const toPeace = pointOnAxis(0.31, 0);
  await ev(A, (x, z) => window.__pv.walkTo(x, z, true), toPeace.x, toPeace.z);
  // o aviso aparece ao trocar de zona (≈ 3,4 s): observa durante a caminhada
  const hp = await until(async () => { const h = await ev(A, () => window.__pv.hudInfo()); return h.policy === 'PEACE' && h.banner.shown ? h : null; }, 70000);
  check('andando para a Central: aviso "ZONA DE PAZ"', !!hp && hp.banner.policy === 'Zona de paz', `${hp?.zone} · "${hp?.banner.policy}"`);
  if (hp) { await ev(A, () => window.__pv.camera(Math.PI, 0.18, 7)); await w(300); await shot(A, 'J_zona_de_paz'); }

  // zonas: da Central para a Cidade Nova (CONFRONTO)
  await goto(A, 'A', pointOnAxis(0.187, 0));
  await hideHelp(A);
  await w(2500);
  const toCombat = pointOnAxis(0.16, 0);
  await ev(A, (x, z) => window.__pv.walkTo(x, z, true), toCombat.x, toCombat.z);
  const hc = await until(async () => { const h = await ev(A, () => window.__pv.hudInfo()); return h.policy === 'COMBAT' && h.banner.shown ? h : null; }, 60000);
  check('andando para a Cidade Nova: aviso "ZONA DE CONFRONTO" e minimapa com a política', !!hc && hc.banner.policy === 'Zona de confronto', `${hc?.zone} · "${hc?.banner.policy}"`);
  if (hc) { await ev(A, () => window.__pv.camera(0, 0.18, 7)); await w(300); await shot(A, 'K_zona_de_confronto'); }
} catch (e) {
  console.log('ERRO', e);
  check('roteiro sem exceção', false, String(e?.message ?? e));
}
await cleanup();
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
process.exit(ok === results.length ? 0 : 1);
