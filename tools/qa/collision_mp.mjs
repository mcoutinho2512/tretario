/**
 * Rodada 12 — COLISÃO ENTRE AVATARES no multiplayer: 2 jogadores reais (um Chrome cada) + bots densos (clientes do
 * SDK, tools/qa/collision_bots.ts) num servidor de teste próprio (PV_TEST=1, PV_STORE=memory, porta PV_COLL_PORT ou
 * 4160). Requer o dev server (Vite) — uso: node tools/qa/collision_mp.mjs [http://localhost:5211]
 *
 * Roteiro: B parado; A anda (autopiloto) contra B → para no contato, sem atravessar e sem correção do servidor (a
 * predição já respeita) · A na diagonal desliza e passa · 30 bots em 3 fileiras fecham a avenida → A não passa e NÃO é
 * teleportado ("unstuck" só preso de verdade) · 16 bots atravessam por cima de A com desvio local (steerAround) →
 * contornam sem encostar · custo do cliente (__pv.bodies) · encostados (0,64 m) o soco acerta.
 * Capturas: docs/screenshots/round12/I_humano_bloqueado.jpg (encostado, parado no contato), J_multidao_bloqueando.jpg
 * (30 corpos fecham a passagem), K_avoidance.jpg (contorno: desliza pela tangente ao lado de B). O fluxo de bots com
 * desvio local é medido (chegadas, distância mínima) — no Chrome headless os bots ANDANDO às vezes não desenham.
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const base = process.argv[2] ?? 'http://localhost:5211';
const PORT = Number(process.env.PV_COLL_PORT ?? 4160);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'docs/screenshots/round12';
mkdirSync(OUT, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const measures = {};
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_EVENT: 'cotidiano', PV_PROTECT_MS: '300', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const kids = [];
const cleanup = async () => { for (const b of browsers) await b.close().catch(() => {}); for (const k of kids) { try { process.kill(-k.pid, 'SIGTERM'); } catch { /* */ } } try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

const MANIFEST = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const SPN = MANIFEST.spawn.p;
// trecho aberto da pista ao lado do spawn (o mesmo do QA de confronto)
const P0 = [SPN[0] + 6, SPN[1]];

async function open(name, sp) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1100, height: 640 }, protocolTimeout: 240000 });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=15:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 180000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const me = (p) => ev(p, () => window.__pv.metrics().player);
const mp = (p) => ev(p, () => window.__pv.mp());
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });
const look = async (p, to, pitch = 0.18, dist = 4.6) => { const m = await me(p); await ev(p, (y, pi, d) => window.__pv.camera(y, pi, d), Math.atan2(to[0] - m.x, to[1] - m.z), pitch, dist); };
const tp = async (p, to) => { await ev(p, (x, z) => window.__pvProg.tp(x, z), to[0], to[1]); await w(800); };
/** remotos vistos por `p` (posição interpolada) */
const remotes = async (p) => (await mp(p)).remotes;
async function bots(mode, c, n, secs) {
  const k = spawn('npx', ['tsx', 'tools/qa/collision_bots.ts', `ws://127.0.0.1:${PORT}`, mode, String(c[0]), String(c[1]), String(n), String(secs)], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  kids.push(k);
  const rl = createInterface({ input: k.stdout });
  let res = null;
  const ready = new Promise((r) => rl.on('line', (l) => { if (l.trim() === 'READY') r(); if (l.startsWith('{')) res = JSON.parse(l); }));
  const done = new Promise((r) => k.on('exit', () => r(res)));
  await ready;
  return done;
}

try {
  const A = await open('Ana', P0);
  const B = await open('Beto', [P0[0], P0[1] + 3]);
  await w(2500);
  const bSid = (await mp(B)).session;

  // 1 — A anda contra B parado (de frente): para no contato; captura no contato
  await ev(A, () => window.__pv.bodies(true));
  await look(A, [P0[0], P0[1] + 3], 0.22, 4.4);
  await ev(A, (x, z) => window.__pv.walkTo(x, z, false), P0[0], P0[1] + 6);
  let minD = Infinity, contactAt = null, passedOver = false, prevZ = -Infinity;
  for (let i = 0; i < 60; i++) {
    await w(100);
    const a = await me(A), rb = (await remotes(A)).find((r) => r.id === bSid);
    if (!rb) continue;
    const d = Math.hypot(a.x - rb.x, a.z - rb.z);
    minD = Math.min(minD, d);
    // "atravessar" = cruzar a linha de B por dentro do corpo (|dx| < contato no instante em que passa) — contornar
    // pelo lado é deslizar pela tangente
    if (prevZ < rb.z && a.z >= rb.z && Math.abs(a.x - rb.x) < 0.6) passedOver = true;
    prevZ = a.z;
    if (!contactAt && d < 0.7) {
      contactAt = { a, rb };
      // câmera de lado (≈ 70°), para ver os dois corpos encostados
      await ev(A, () => window.__pv.stopWalk());
      await ev(A, (y) => window.__pv.camera(y, 0.16, 3.4), Math.atan2(rb.x - a.x, rb.z - a.z) + 1.25);
      await w(400); await shot(A, 'I_humano_bloqueado');
      await ev(A, (x, z) => window.__pv.walkTo(x, z, false), P0[0], P0[1] + 6);
    }
  }
  const a1 = await me(A), b1 = await me(B), m1 = await mp(A);
  await ev(A, () => window.__pv.stopWalk());
  check('A contra B parado: não atravessa (distância mínima ≥ contato − 0,04 m)', minD >= 0.6, `mín ${minD.toFixed(3)} m`);
  check('A nunca cruza B por dentro do corpo (no máximo contorna pelo lado)', !passedOver && !!contactAt, `final A ${a1.x.toFixed(2)}, ${a1.z.toFixed(2)} · B ${b1.x.toFixed(2)}, ${b1.z.toFixed(2)}`);
  check('B não foi empurrado (servidor: quem está parado nunca é corrigido)', Math.hypot(b1.x - P0[0], b1.z - (P0[1] + 3)) < 0.05, `${b1.x.toFixed(2)}, ${b1.z.toFixed(2)}`);
  check('predição respeita a colisão: nenhuma correção "corpo" do servidor', !(m1.correctionReasons?.corpo > 2), JSON.stringify(m1.correctionReasons));
  measures.encontro = { minD: +minD.toFixed(3), correcoes: m1.correctionReasons, cliente: await ev(A, () => window.__pv.bodies()) };

  // 2 — diagonal: um TERCEIRO jogador (C) passa raspando em B — desliza pela tangente e passa; captura K no meio do
  // contorno, logo depois de C entrar (no Chrome headless os remotos com esqueleto às vezes somem depois da troca de
  // detalhe adiada de ~6 s; a captura acontece antes)
  await ev(A, (x, z) => window.__pv.walkTo(x, z, false), P0[0] - 3, P0[1]);
  await w(3000);
  await ev(A, () => window.__pv.stopWalk());
  const C = await open('Caio', [P0[0] + 0.45, P0[1] - 0.5]);
  await ev(C, (x, z) => window.__pv.walkTo(x, z, false), P0[0] + 0.15, P0[1] + 6);
  let kShot = false;
  for (let i = 0; i < 70; i++) {
    await w(100);
    const c = await me(C), rb = (await remotes(C)).find((r) => r.id === bSid);
    if (!kShot && rb && c.z > rb.z - 0.35) {
      kShot = true;
      await ev(C, () => window.__pv.stopWalk());
      await ev(C, (y) => window.__pv.camera(y, 0.18, 3.4), Math.atan2(rb.x - c.x, rb.z - c.z) + 1.3);
      await w(300); await shot(C, 'K_avoidance');
      measures.contorno = { lateral: +Math.abs(c.x - rb.x).toFixed(3), d: +Math.hypot(c.x - rb.x, c.z - rb.z).toFixed(3) };
      await ev(C, (x, z) => window.__pv.walkTo(x, z, false), P0[0] + 0.15, P0[1] + 6);
    }
  }
  const c2 = await me(C);
  await ev(C, () => window.__pv.stopWalk());
  check('diagonal: desliza pela tangente e passa por B (sem atravessar)', c2.z > P0[1] + 3.5 && kShot && measures.contorno.d >= 0.6, `C.z ${c2.z.toFixed(2)} (B em ${(P0[1] + 3).toFixed(2)}) · ao lado de B: ${JSON.stringify(measures.contorno)}`);
  await browsers.pop().close().catch(() => {});

  // 3 — fluxo de 16 bots por cima de B (parado) com desvio local; captura pela câmera de B (o próprio corpo de B é o
  // obstáculo no meio do fluxo)
  const F0 = [P0[0] - 20, P0[1] + 12];
  await tp(A, [F0[0] + 6, F0[1] + 4]); // A sai do caminho
  await tp(B, F0);
  await w(800);
  const flowRun = bots('flow', F0, 16, 30);
  const flow = await flowRun;
  const bF = await me(B);
  check('desvio local: os 16 atravessam contornando B (≥ 12 chegam)', flow && flow.done >= 12, JSON.stringify(flow));
  check('desvio local: ninguém entra em B além da tolerância do servidor', flow && flow.minD >= 0.44, `mín ${flow?.minD?.toFixed(3)}`);
  check('B não foi deslocado pelo fluxo (humano parado é duro para os outros)', Math.hypot(bF.x - F0[0], bF.z - F0[1]) < 0.35, `${Math.hypot(bF.x - F0[0], bF.z - F0[1]).toFixed(2)} m`);
  measures.fluxo = flow;

  // 4 — 30 bots em 3 fileiras fecham a passagem
  await tp(B, [P0[0] + 30, P0[1] - 10]); // B sai da cena
  await tp(A, [P0[0], P0[1] + 12]);
  const W0 = [P0[0], P0[1] + 16];
  const wallRun = bots('wall', W0, 30, 22);
  await w(1500);
  await ev(A, () => window.__pv.bodies(true));
  await ev(A, (x, z) => window.__pv.walkTo(x, z, false), W0[0] + 0.2, W0[1] + 5);
  await w(9000);
  await look(A, [W0[0], W0[1] + 0.6], 0.32, 6.2);
  await w(700);
  await shot(A, 'J_multidao_bloqueando');
  const a3 = await me(A), info3 = await ev(A, () => window.__pv.bodies());
  await ev(A, () => window.__pv.stopWalk());
  check('30 corpos fechando a passagem: A não passa', a3.z < W0[1], `A.z ${a3.z.toFixed(2)} · fileira em ${W0[1].toFixed(2)}`);
  check('sem teleporte falso: empurrar a multidão não pede "unstuck" (tem saída para trás)', info3.stuckRequests === 0, JSON.stringify(info3));
  // e consegue sair de lado/para trás (sem deadlock)
  await ev(A, (x, z) => window.__pv.walkTo(x, z, false), a3.x + 3, a3.z - 3);
  await w(3500);
  const a3b = await me(A);
  await ev(A, () => window.__pv.stopWalk());
  check('sem deadlock: sai da multidão pela diagonal para trás', Math.hypot(a3b.x - a3.x, a3b.z - a3.z) > 2, `${Math.hypot(a3b.x - a3.x, a3b.z - a3.z).toFixed(2)} m`);
  measures.multidao = { cliente: info3, bots: await wallRun };

  // 5 — custo do cliente por quadro
  const cost = await ev(A, () => window.__pv.bodies());
  check('custo da colisão no cliente < 0,2 ms/quadro (média)', cost && cost.avgMs < 0.2, JSON.stringify(cost));
  measures.custoCliente = cost;

  // 6 — encostados, o soco acerta (servidor decide)
  await tp(B, [F0[0] + 10, F0[1]]);
  await tp(A, [F0[0] + 10, F0[1] - 0.66]);
  await w(900);
  const bA = await me(A), bB = await me(B);
  await ev(A, (y) => window.__pv.face(y), Math.atan2(bB.x - bA.x, bB.z - bA.z));
  await w(300);
  const hits0 = (await ev(B, () => window.__pv.combat()))?.stats?.hitsIn ?? 0;
  await ev(A, () => window.__pv.cbt('cbt_punch'));
  await w(1200);
  const cB = await ev(B, () => window.__pv.combat());
  const dAB = Math.hypot(bA.x - bB.x, bA.z - bB.z);
  check('encostados (0,64–0,7 m): o soco acerta (condição de B cai)', (cB?.condition ?? 100) < 100 || (cB?.stats?.hitsIn ?? 0) > hits0, `d ${dAB.toFixed(2)} m · condição ${cB?.condition}`);

  const sm = await (await fetch(`http://127.0.0.1:${PORT + 1}/metrics`)).json();
  measures.servidor = { collisionMs: sm.collisionMs, collisionMaxMs: sm.collisionMaxMs, neighborQueries: sm.neighborQueries, bodyCorrections: sm.bodyCorrections, unstucks: sm.unstucks };
} catch (e) {
  console.error(e);
  check('roteiro sem exceção', false, String(e?.message ?? e));
}
writeFileSync(`${OUT}/collision_mp.json`, JSON.stringify({ results, measures }, null, 2));
await cleanup();
const ok = results.filter((r) => r.ok).length;
console.log(`${ok}/${results.length}`);
process.exit(ok === results.length ? 0 : 1);
