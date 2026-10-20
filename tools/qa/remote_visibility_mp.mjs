/**
 * Rodada 12 (AGENTE F) — jogador REMOTO some (não é desenhado) enquanto o nome continua? Reprodução determinística.
 *
 * Cliente A (observador) amostra, A CADA QUADRO RENDERIZADO, cada remoto que deveria aparecer (projeção da altura do
 * peito dentro da tela, a menos de PV_VIS_MAXD m da câmera) contra o que foi EFETIVAMENTE desenhado nesse quadro:
 *  - esqueleto: alguma malha do avatar (grupo `remote_players`) teve `onAfterRender` neste quadro (passou por
 *    visibilidade, culling e foi submetida) E a pelve do esqueleto está a < 2,5 m da posição do remoto;
 *  - instanciado: a InstancedMesh da multidão (`crowd_instanced`) foi desenhada neste quadro e tem uma instância
 *    (entre 0 e count) a < 1,2 m da posição do remoto.
 * Nenhum dos dois = "sumiço" (com o estado de LOD/visibilidade do personagem e se o nome aparecia, para achar a causa).
 *
 * Cliente B (o que se move) roda um roteiro em laço: corre se afastando/aproximando cruzando todas as distâncias de
 * LOD (10/20/32/35/60/90 m), teleporte do servidor de teste (longe ↔ perto), teleporte local, troca de roupa (perto e
 * longe), veículo pessoal (sobe/desce), queda por empurrão de um robô; A também teleporta e gira a câmera.
 * Robôs (SDK) andando por perto disputam o orçamento de esqueletos (PV_BOTS, padrão 10).
 *
 * uso: node tools/qa/remote_visibility_mp.mjs [baseUrl] — PV_VIS_PORT (4612) · PV_VIS_SECS (240) · PV_BOTS (10) ·
 *      PV_VIS_QS (query extra do observador, p.ex. "crowdSkinned=3") · PV_VIS_QUALITY (high)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from '@colyseus/sdk';

const base = process.argv[2] ?? 'http://localhost:5216';
const PORT = Number(process.env.PV_VIS_PORT ?? 4612);
const SECS = Number(process.env.PV_VIS_SECS ?? 240);
const NBOTS = Number(process.env.PV_BOTS ?? 10);
const QS = process.env.PV_VIS_QS ?? '';
const QUALITY = process.env.PV_VIS_QUALITY ?? 'high';
const MAXD = Number(process.env.PV_VIS_MAXD ?? 70);
const OUT = process.env.PV_VIS_OUT ?? 'screenshots/tmp/remote_visibility';
mkdirSync(OUT, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const bots = [];
const cleanup = () => { for (const b of bots) { try { b.room.leave(); } catch { /* */ } } try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

// rua larga e reta (mesma de tools/qa/remote_motion.mjs): A parado, B corre ao longo do eixo
const X = -540, Z = 255, H = 2.0;
const ax = (k) => [X + Math.sin(H) * k, Z + Math.cos(H) * k];

async function open(name, sp, extra = '') {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 900, height: 560 }, protocolTimeout: 240000 });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=${QUALITY}&time=10:30&mem=1&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}${extra ? '&' + extra : ''}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);

const A = await open('Observa', ax(0), QS);
const B = await open('Movedor', ax(8));
const bSid = await ev(B, () => window.__pv.mp().session);
await ev(B, () => window.__pv.peds(0));

// robôs: andam em círculos de 4–30 m em volta de A (disputam o orçamento de esqueletos)
for (let i = 0; i < NBOTS; i++) {
  const r0 = 4 + (i * 26) / Math.max(1, NBOTS - 1), a0 = (i / NBOTS) * Math.PI * 2;
  const [cx, cz] = ax(0);
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { name: `Robo${i}`, body: ['homem', 'mulher', 'idoso', 'idosa'][i % 4], skin: i % 5, hair: i % 4, top: i % 6, bottom: i % 5, shoes: 1, testSpawn: { x: cx + Math.cos(a0) * r0, z: cz + Math.sin(a0) * r0 } });
  room.onMessage('*', () => {});
  bots.push({ room, r0, a0, cx, cz, seq: 0, sp: 0.25 + (i % 3) * 0.15 });
}
const t0 = Date.now();
let pushes = 0;
const botTick = setInterval(() => {
  const t = (Date.now() - t0) / 1000;
  for (const b of bots) {
    if (b.paused) continue;
    const a = b.a0 + t * b.sp / Math.max(1, b.r0 / 6);
    const x = b.cx + Math.cos(a) * b.r0, z = b.cz + Math.sin(a) * b.r0;
    b.room.send('move', [Math.round(x * 100) / 100, 0, Math.round(z * 100) / 100, Math.round((a + Math.PI / 2) * 1000) / 1000, 1.4, 1, ++b.seq]);
  }
}, 100);

await w(6000);

// ---------------------------------------------------------------- amostrador em A (a cada quadro renderizado)
await ev(A, (MAXD) => {
  const scene = window.__pvScene;
  const S = window.__vis = { frame: 0, rendered: 0, samples: 0, expected: 0, bySkin: 0, byInst: 0, both: 0, missing: 0, missFrames: 0, events: [], streak: {}, maxStreak: {}, perName: {}, cam: null, maxMs: 0 };
  const prevB = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, c, rt) { if (c && c.isPerspectiveCamera && !S.cam) S.cam = c; S.didRender = true; return prevB.call(this, r, s, c, rt); };
  const hook = (o) => {
    if (o.__visHook || !(o.isMesh || o.isSkinnedMesh || o.isInstancedMesh)) return false;
    o.__visHook = true;
    const prev = o.onAfterRender;
    o.onAfterRender = function (...a) { this.__df = S.frame; return prev.apply(this, a); };
    return true;
  };
  let V = null;
  const loop = () => {
    requestAnimationFrame(loop);
    const t1 = performance.now();
    if (!S.didRender) return; // quadro sem render (limite de FPS): nada a comparar
    S.didRender = false;
    S.rendered++;
    const cam = S.cam;
    S.cam = null;
    const rp = scene.getObjectByName('remote_players'), ci = scene.getObjectByName('crowd_instanced');
    if (!cam || !rp || S.frame === 0) { if (rp) for (const a of rp.children) a.traverse(hook); if (ci) for (const m of ci.children) hook(m); S.frame++; return; } // 1º quadro: só instala os ganchos
    V ??= cam.position.constructor;
    const v = new V(), pel = new V();
    // instâncias desenhadas neste quadro
    const inst = [];
    if (ci) for (const m of ci.children) { if (!m.isInstancedMesh) continue; hook(m); if (m.__df !== S.frame) continue; const e = m.instanceMatrix.array; for (let i = 0; i < m.count; i++) inst.push(e[i * 16 + 12], e[i * 16 + 14]); }
    const avatars = [];
    for (const a of rp.children) {
      let fresh = false;
      a.traverse((o) => { if (hook(o)) fresh = true; }); // malha nova (troca de LOD/peça): desenhada antes do gancho
      let drawn = false;
      a.traverse((o) => { if (o.__df === S.frame) drawn = true; });
      const h = a.children.find((c) => c.userData.pvHuman)?.userData.pvHuman;
      const pb = h?.bones?.get('pelvis');
      if (pb) pb.getWorldPosition(pel); else pel.copy(a.position);
      avatars.push({ a, h, drawn, fresh, x: a.position.x, z: a.position.z, px: pel.x, pz: pel.z });
    }
    const remotes = window.__pvRemotes() ?? [];
    let missThis = 0;
    for (const r of remotes) {
      S.samples++;
      const d = Math.hypot(r.x - cam.position.x, r.y - cam.position.y, r.z - cam.position.z);
      v.set(r.x, r.y + 0.9, r.z).project(cam);
      const inView = v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.92;
      if (!inView || d > MAXD) { S.streak[r.name] = 0; continue; }
      S.expected++;
      const pn = (S.perName[r.name] ??= { expected: 0, skin: 0, inst: 0, miss: 0, inVehicle: 0, down: 0 });
      pn.expected++;
      if (r.vehicle) pn.inVehicle = (pn.inVehicle ?? 0) + 1;
      if (r.status) pn.down = (pn.down ?? 0) + 1;
      const tol = r.vehicle ? 3.5 : r.status ? 4 : 2.5; // caído: o ragdoll pode rolar o corpo para longe do ponto do servidor
      let av = null, bd = tol; // o avatar MAIS PRÓXIMO (dois remotos podem estar a < tol um do outro)
      for (const x of avatars) { const dd = Math.hypot(x.x - r.x, x.z - r.z); if (dd < bd) { bd = dd; av = x; } }
      if (av?.fresh) { S.fresh = (S.fresh ?? 0) + 1; continue; } // sem como saber neste quadro
      const sk = !!av && av.drawn && Math.hypot(av.px - r.x, av.pz - r.z) < tol;
      let ins = false;
      for (let i = 0; i < inst.length && !ins; i += 2) if (Math.hypot(inst[i] - r.x, inst[i + 1] - r.z) < 1.2) ins = true;
      if (sk) { S.bySkin++; pn.skin++; }
      if (ins) { S.byInst++; pn.inst++; }
      if (sk && ins) S.both++;
      if (sk || ins) { S.streak[r.name] = 0; continue; }
      S.missing++; pn.miss++; missThis++;
      const st = (S.streak[r.name] = (S.streak[r.name] ?? 0) + 1);
      S.maxStreak[r.name] = Math.max(S.maxStreak[r.name] ?? 0, st);
      if ((st === 1 || st === 30 || st === 300) && S.events.length < 400) {
        const h = av?.h;
        const shown = [...document.querySelectorAll('.name-label')].filter((e) => !e.hidden && e.style.display !== 'none').map((e) => e.textContent);
        S.events.push({
          rpos: [r.x, r.z], t: +(performance.now() / 1000).toFixed(2), frame: S.frame, streak: st, name: r.name, d: +d.toFixed(1), ndc: [+v.x.toFixed(2), +v.y.toFixed(2)], vehicle: r.vehicle, status: r.status,
          avatar: av ? { visible: av.a.visible, drawn: av.drawn, pelvisOff: +Math.hypot(av.px - r.x, av.pz - r.z).toFixed(2), root: [+av.x.toFixed(2), +av.z.toFixed(2)], pelvisLocal: av.h?.bones?.get('pelvis')?.position.toArray().map((x) => +x.toFixed(2)), arm: av.h?.armature ? [...av.h.armature.position.toArray(), av.h.armature.rotation.x, av.h.armature.rotation.z].map((x) => +x.toFixed(2)) : null, fx: (() => { try { return av.h.animator?.fxClips; } catch { return null; } })() } : null,
          nAvatars: avatars.length, nearest: avatars.length ? +Math.min(...avatars.map((x) => Math.hypot(x.x - r.x, x.z - r.z))).toFixed(2) : null,
          human: h ? { want: h.want, shown: h.shown, loading: [...h.loading], lods: h.lods.map((l) => (l ? (l.group.visible ? 'V' : 'h') + l.meshes.filter((m) => m.visible).length : '-')), disposed: h.disposed } : null,
          instCount: inst.length / 2, label: shown.some((s) => s && r.name.startsWith(s.replace('…', ''))),
          crowd: (() => { const c = window.__pv.metrics().crowd; return { skinned: c.skinned, instanced: c.instanced, hidden: c.hidden, drawn: c.drawnInstanced }; })(),
        });
      }
    }
    if (missThis) S.missFrames++;
    S.frame++;
    S.maxMs = Math.max(S.maxMs, performance.now() - t1);
  };
  requestAnimationFrame(loop);
}, MAXD);

// ---------------------------------------------------------------- roteiro
const stepLog = [];
const step = (s) => { stepLog.push({ t: +((Date.now() - t0) / 1000).toFixed(1), s }); };
const me = (p) => ev(p, () => window.__pv.metrics().player);
/** câmera de A atrás do jogador, virada para B */
const aim = async () => {
  const [a, b] = await Promise.all([me(A), me(B)]);
  await ev(A, (y) => window.__pv.camera(y, 0.12, 5), Math.atan2(b.x - a.x, b.z - a.z));
};
const tpB = (k, lat = 0) => { const [x, z] = ax(k); return ev(B, (x, z) => window.__pvProg.tp(x, z), x + Math.cos(H) * lat, z - Math.sin(H) * lat); };
const looks = [
  { body: 'homem', skin: 0xc68b62, hair: 0x222222, top: 0x2255aa, bottom: 0x333333, shoes: 0x111111, scale: 1, accessory: 'nenhum', topStyle: 'regata' },
  { body: 'homem', skin: 0x8d5524, hair: 0x111111, top: 0xaa2222, bottom: 0x224422, shoes: 0x222222, scale: 1, accessory: 'bone', shirtDesign: 3 },
  { body: 'homem', skin: 0xe0ac69, hair: 0x6b4423, top: 0xffffff, bottom: 0x1a1a5a, shoes: 0x333333, scale: 1, accessory: 'oculos', bottomStyle: 'bermuda' },
];
let li = 0;
const deadline = t0 + SECS * 1000;
let cycle = 0;
const aimer = setInterval(() => { aim().catch(() => {}); }, 400);
async function runFor(ms) { const e = Date.now() + ms; while (Date.now() < e && Date.now() < deadline) await w(200); }
while (Date.now() < deadline) {
  cycle++;
  // 1) corre para longe (≈ 110 m) e volta, cruzando todas as distâncias de LOD
  step(`ciclo ${cycle}: corre para longe`);
  { const [x, z] = ax(115); await ev(B, (x, z) => window.__pv.walkTo(x, z, true), x, z); }
  await runFor(20000);
  step('corre de volta');
  { const [x, z] = ax(6); await ev(B, (x, z) => window.__pv.walkTo(x, z, true), x, z); }
  await runFor(20000);
  await ev(B, () => window.__pv.stopWalk());
  // 2) teleportes do servidor: longe → perto → médio → perto (troca brusca de LOD/tier)
  for (const [k, lat] of [[140, 0], [5, 1.5], [45, -3], [12, 2], [3, -1], [80, 0], [7, 0]]) { step(`tp servidor ${k} m`); await tpB(k, lat); await runFor(2500 + (cycle % 3) * 2200); }
  // 3) troca de roupa perto e longe
  step('roupa perto');
  await ev(B, (a) => window.__pv.setAppearance(a), looks[li++ % looks.length]);
  await runFor(3000);
  await tpB(50);
  await runFor(1500);
  step('roupa longe');
  await ev(B, (a) => window.__pv.setAppearance(a), looks[li++ % looks.length]);
  await runFor(2500);
  await tpB(9);
  await runFor(7000); // passa pelo adiamento do LOD0 (~6 s)
  // 4) veículo pessoal: sobe, anda, desce
  step('veículo pessoal');
  const kind = ['bicycle', 'scooter', 'moto', 'car'][cycle % 4];
  await ev(B, (k) => window.__pvPveh?.request(k), kind);
  await runFor(3000);
  await ev(B, () => window.__pv.press('KeyW', 2500));
  await runFor(3500);
  await ev(B, (k) => window.__pvPveh?.toggle(k), kind);
  await runFor(2500);
  // 5) queda: um robô encosta em B e empurra
  step('queda (empurrão de robô)');
  {
    const b = await me(B);
    const bot = bots[0];
    if (bot) {
      bot.paused = true;
      for (let i = 0; i < 6; i++) { bot.room.send('move', [b.x + 0.7, 0, b.z, -Math.PI / 2, 0, 0, ++bot.seq]); await w(120); }
      bot.room.send('push', bSid); pushes++;
      await runFor(5000);
      bot.paused = false;
    }
  }
  // 6) teleporte LOCAL de B (o servidor corrige) e de A (o observador)
  step('teleporte local de B');
  { const [x, z] = ax(25); await ev(B, (x, z) => window.__pv.teleport(x, z), x, z); }
  await runFor(2500);
  step('teleporte do observador (longe e de volta)');
  { const [x, z] = ax(-90); await ev(A, (x, z) => window.__pvProg.tp(x, z), x, z); }
  await runFor(3000);
  { const [x, z] = ax(0); await ev(A, (x, z) => window.__pvProg.tp(x, z), x, z); }
  await runFor(4000);
  const s = await ev(A, () => ({ samples: window.__vis.samples, expected: window.__vis.expected, missing: window.__vis.missing }));
  console.log(`[vis] ciclo ${cycle} t=${((Date.now() - t0) / 1000).toFixed(0)} s`, JSON.stringify(s));
}
clearInterval(aimer);
clearInterval(botTick);
const res = await ev(A, () => { const S = window.__vis; return { frame: S.frame, rendered: S.rendered, samples: S.samples, expected: S.expected, bySkin: S.bySkin, byInst: S.byInst, both: S.both, missing: S.missing, missFrames: S.missFrames, maxStreak: S.maxStreak, perName: S.perName, events: S.events, maxMs: +S.maxMs.toFixed(2), fresh: S.fresh ?? 0 }; });
const bStatus = await ev(A, () => window.__pvRemotes().find((r) => r.name === 'Movedor') ?? null);
const report = { when: new Date().toISOString(), secs: SECS, bots: NBOTS, qs: QS, quality: QUALITY, maxD: MAXD, pushes, steps: stepLog, bStatusEnd: bStatus, ...res };
writeFileSync(`${OUT}/report_${Date.now()}.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ rendered: res.rendered, samples: res.samples, expected: res.expected, bySkin: res.bySkin, byInst: res.byInst, both: res.both, missing: res.missing, missFrames: res.missFrames, maxStreak: res.maxStreak, perNameMovedor: res.perName.Movedor, events: res.events.length, maxMs: res.maxMs, fresh: res.fresh }));
for (const e of res.events.slice(0, 40)) console.log('  ', JSON.stringify(e));
for (const b of browsers) await b.close().catch(() => {});
cleanup();
process.exit(0);
