/**
 * WALKTHROUGH MULTIPLAYER REPRODUZÍVEL (vertical slice) — 3 clientes reais (Chrome headless).
 *
 * Sobe o PRÓPRIO servidor em modo de teste (porta 2600, PV_TEST=1: só permite escolher o ponto de spawn,
 * para montar a cena; todas as regras de autoridade são as normais). Requer o cliente: `npm run dev`.
 *
 * uso: node tools/qa/walkthrough.mjs [baseUrl] [latência RTT ms] [jitter ms]
 *
 * Cena: calçada externa da Pres. Vargas, junto ao primeiro carro estacionado (car0, sentido do trânsito).
 * Roteiro: A (homem), B (mulher), C (idoso) entram · todos se veem · A e B andam juntos · mesmo semáforo e
 * mesmo trânsito · A tenta atravessar o prédio (servidor impede) · A entra no carro · B tenta o mesmo carro
 * (servidor impede) · A dirige, freia, dá ré · A sai · A ativa interação · B pacífico (A não empurra) ·
 * B ativa interação · A empurra B · B cai (ragdoll) · B levanta · proteção anti-griefing · impacto de veículo.
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const lag = Number(process.argv[3] ?? 0), jitter = Number(process.argv[4] ?? 0);
const PORT = Number(process.env.PV_WALKTHROUGH_PORT ?? 2600); // porta própria via env para não colidir com outro walkthrough
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = `screenshots/walkthrough${lag ? `_lag${lag}` : ''}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

// ------------------------------------------------------------------ servidor de teste
// proteção: nunca falar com um servidor antigo esquecido na porta
try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada por outro servidor — abortando`); process.exit(2); } catch { /* livre */ }
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_METRICS: '0', ...(lag ? { COLYSEUS_LATENCY: String(lag), PV_JITTER: String(jitter) } : {}) },
  stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => serverLog.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !serverLog.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const cleanup = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', cleanup);

// ------------------------------------------------------------------ cena
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const car = manifest.vehicleSpawns.find((v) => v.id === 'car0');
const F = [Math.sin(car.heading), Math.cos(car.heading)]; // frente do carro (sentido do trânsito)
const L = [Math.cos(car.heading), -Math.sin(car.heading)]; // esquerda = pista
const R = [-L[0], -L[1]]; // direita = prédio
const at = (f, r) => [car.x + F[0] * f + R[0] * r, car.z + F[1] * f + R[1] * r];
const SP = { A: at(-3.3, 0), B: at(-5.5, 0.3), C: at(-22, 0.6) };

async function open(avatar, name, sp, look = null) {
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 960, height: 600 } });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  const cdp = await p.target().createCDPSession();
  await cdp.send('Network.enable');
  const net = { wsIn: 0, wsOut: 0, wsMsgsIn: 0, wsMsgsOut: 0, http: 0 };
  cdp.on('Network.webSocketFrameReceived', (e) => { net.wsIn += e.response.payloadData.length * (e.response.opcode === 2 ? 0.75 : 1); net.wsMsgsIn++; });
  cdp.on('Network.webSocketFrameSent', (e) => { net.wsOut += e.response.payloadData.length * (e.response.opcode === 2 ? 0.75 : 1); net.wsMsgsOut++; });
  cdp.on('Network.loadingFinished', (e) => { net.http += e.encodedDataLength; });
  // visual salvo pela tela inicial (localStorage) — testa a sincronização do acessório
  if (look) await p.evaluateOnNewDocument((l) => localStorage.setItem('pv3d.look', l), JSON.stringify(look));
  await p.goto(`${base}/?autostart=1&quality=low&time=16:30&mp=ws://127.0.0.1:${PORT}&avatar=${avatar}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}${lag ? `&jitter=${jitter}` : ''}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return { b, p, name, net };
}
const ev = (c, fn, ...args) => c.p.evaluate(fn, ...args);
const mp = (c) => ev(c, () => window.__pv.mp());
const me = (c) => ev(c, () => window.__pv.metrics().player);
const until = async (c, fn, ms = 15000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(c, fn)) return true; await w(step); } return false; };
const walk = async (c, p, run = false) => { await ev(c, (x, z, run) => window.__pv.walkTo(x, z, run), p[0], p[1], run); return until(c, () => window.__pv.arrived(), 20000); };
const look = async (c, target, pitch = 0.15, d = 5) => { const m = await me(c); await ev(c, (y, p, dd) => window.__pv.camera(y, p, dd), Math.atan2(target[0] - m.x, target[1] - m.z), pitch, d); };
const shot = async (c, file) => { await w(500); await c.p.screenshot({ path: `${OUT}/${file}` }); };
const record = (c, name, ms, fps = 8) => (async () => {
  mkdirSync(`${OUT}/frames_${name}`, { recursive: true });
  const n = Math.round((ms / 1000) * fps);
  for (let i = 0; i < n; i++) { const t = Date.now(); await c.p.screenshot({ path: `${OUT}/frames_${name}/${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 70 }); await w(Math.max(0, 1000 / fps - (Date.now() - t))); }
})();
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------ 1. entram
const A = await open('homem', 'Jogador_A', SP.A);
const B = await open('mulher', 'Jogadora_B', SP.B);
const C = await open('idoso', 'Jogador_C', SP.C, { body: 'idoso', skin: 0xe0ac85, hair: 0xd6d2cc, top: 0xe8e6e0, bottom: 0x6b5a45, shoes: 0x5a3a22, scale: 1, accessory: 'chapeu', acc: 0x2b4a7a });
await w(2500);
{
  const [a, b, c] = await Promise.all([mp(A), mp(B), mp(C)]);
  check('A, B e C conectados à mesma sala', [a, b, c].every((x) => x && x.session));
  check('cada um vê os outros 2', a.remotes.length === 2 && b.remotes.length === 2 && c.remotes.length === 2, `A:${a.remotes.length} B:${b.remotes.length} C:${c.remotes.length}`);
  const bodies = Object.fromEntries(a.remotes.map((r) => [r.name, r.body]));
  check('avatares sincronizados (B=mulher, C=idoso vistos por A)', bodies.Jogadora_B === 'mulher' && bodies.Jogador_C === 'idoso', JSON.stringify(bodies));
  const accs = Object.fromEntries(a.remotes.map((r) => [r.name, r.accessory]));
  check('visual da tela inicial sincronizado (C de chapéu visto por A)', accs.Jogador_C === 'chapeu' && accs.Jogadora_B === 'nenhum', JSON.stringify(accs));
}

// ------------------------------------------------------------------ 2. A e B andam juntos pela calçada
await Promise.all([walk(A, at(-15, 0)), walk(B, at(-16.5, 0.6))]);
await w(800);
{
  const pa = await me(A), pb = await me(B);
  const seen = (await mp(B)).remotes.find((r) => r.name === 'Jogador_A');
  check('A e B caminharam juntos', dist(pa, pb) < 3, `distância ${dist(pa, pb).toFixed(2)} m`);
  check('B vê A onde A realmente está', dist(seen, pa) < 0.6, `erro ${dist(seen, pa).toFixed(2)} m`);
  await look(C, [pa.x, pa.z], 0.1, 4);
  await shot(C, '01_tres_jogadores.png');
}

// ------------------------------------------------------------------ 3. mesmo semáforo e trânsito
{
  const states = await Promise.all([A, B].map((c) => ev(c, () => Array.from({ length: 135 }, (_, j) => window.__pv.signalState(j, 0)).join(''))));
  const same = [...states[0]].filter((ch, i) => ch === states[1][i]).length;
  check('A e B veem o mesmo estado em todos os semáforos', same >= 133, `${same}/135 iguais no mesmo instante`);
  const pa = await me(A);
  const [ta, tb] = await Promise.all([A, B].map((c) => ev(c, (x, z) => window.__pv.trafficIds(x, z, 150), pa.x, pa.z)));
  const mb = new Map(tb.map((v) => [v.id, v]));
  const common = ta.filter((v) => mb.has(v.id));
  const errs = common.map((v) => Math.hypot(v.x - mb.get(v.id).x, v.z - mb.get(v.id).z)).sort((x, y) => x - y);
  const med = errs.length ? errs[Math.floor(errs.length / 2)] : NaN;
  check('A e B veem o mesmo trânsito perto deles', ta.length > 3 && common.length / Math.max(ta.length, tb.length) > 0.85 && med < 3,
    `A:${ta.length} B:${tb.length} em comum:${common.length} · erro mediano ${med.toFixed(2)} m`);
}

// ------------------------------------------------------------------ 4. A tenta atravessar o prédio (cliente modificado)
{
  const chunkOf = (x, z) => manifest.chunks.find((c) => c.key === `${Math.floor(x / 250)}_${Math.floor(z / 250)}`);
  const inside = (ring, p) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };
  const pa = await me(A);
  // passos de 0,5 m a cada 70 ms (velocidade "legal") em direção ao prédio (lado direito do carro)
  const corr0 = (await mp(A)).corrections;
  const steps = [];
  for (let k = 1; k <= 30; k++) steps.push([pa.x + R[0] * k * 0.5, pa.z + R[1] * k * 0.5]);
  const target = steps[steps.length - 1];
  const chunk = JSON.parse(readFileSync(`public/world/${chunkOf(target[0], target[1]).file}`, 'utf8'));
  const bld = chunk.buildings.find((bd) => !bd.canopy && inside(bd.poly.outer, target));
  for (const s of steps) { await ev(A, (x, z) => window.__pv.cheatMove(x, z), s[0], s[1]); await w(70); }
  await w(1200);
  const seen = (await mp(B)).remotes.find((r) => r.name === 'Jogador_A');
  const corr1 = (await mp(A)).corrections;
  check('servidor impede A de atravessar o prédio',
    !!bld && !inside(bld.poly.outer, [seen.x, seen.z]) && corr1 > corr0,
    `alvo dentro do prédio ${bld ? bld.id : '?'}; posição autoritativa (vista por B) ficou fora; ${corr1 - corr0} correções`);
}

// ------------------------------------------------------------------ 5. A entra no carro; B tenta o mesmo
await walk(A, at(-3.3, 0));
await ev(A, () => window.__pv.key('KeyE'));
check('A entrou no carro (servidor confirmou)', await until(A, () => window.__pv.riding() === 'car', 6000), car.id);
await walk(B, at(-5.0, 0.3));
await ev(B, () => window.__pv.key('KeyE')); // cliente normal: nem pede (estado do servidor diz "ocupado")
await w(500);
await ev(B, (id) => window.__pv.rawEnter(id), car.id); // cliente MODIFICADO: pede mesmo assim
await w(1200);
check('servidor responde "ocupado" ao pedido forçado de B', (await ev(B, () => window.__pv.lastDenial())) === 'enter:ocupado');
{
  const occ = (await ev(B, () => window.__pv.vehicles())).find((v) => v.id === car.id).occupant;
  check('B não entrou; ocupante continua sendo A', (await ev(B, () => window.__pv.riding())) === null && occ === (await mp(A)).session);
}

// ------------------------------------------------------------------ 6. A dirige, freia e dá ré
{
  const p0 = await me(A);
  const rec = record(A, 'dirigindo', 6000, 6);
  // sai da vaga para a esquerda (pista) e contraesterça para alinhar
  await ev(A, () => { window.__pv.press('KeyW', 5200); window.__pv.press('KeyA', 1700); setTimeout(() => window.__pv.press('KeyD', 1100), 2600); });
  await w(5500);
  await rec;
  await shot(A, '02_A_dirigindo.png');
  const p1 = await me(A);
  const carSeen = (await ev(B, () => window.__pv.vehicles())).find((v) => v.id === car.id);
  const onRoad = (await ev(A, (x, z) => window.__pv.groundAt(x, z), p1.x, p1.z)) < 0.1;
  check('A dirige o carro (sai da vaga para a pista)', dist(p1, p0) > 8 && onRoad, `${dist(p1, p0).toFixed(1)} m, na pista: ${onRoad}`);
  check('B vê o carro na nova posição', Math.hypot(carSeen.x - p1.x, carSeen.z - p1.z) < 2.5, `erro ${Math.hypot(carSeen.x - p1.x, carSeen.z - p1.z).toFixed(2)} m`);
  await ev(A, () => window.__pv.press('KeyS', 1000)); // freia
  await w(1200);
  const pr0 = await me(A);
  await ev(A, () => window.__pv.press('KeyS', 2200)); // ré
  await w(2500);
  const pr1 = await me(A);
  check('freio e ré funcionam', dist(pr1, pr0) > 0.8, `${dist(pr1, pr0).toFixed(1)} m de ré`);
}

// ------------------------------------------------------------------ 7. A sai do carro
await ev(A, () => window.__pv.key('KeyE'));
check('A saiu do carro', await until(A, () => window.__pv.riding() === null, 5000));

// ------------------------------------------------------------------ 8. modos: B pacífico
await ev(A, () => window.__pv.key('KeyK'));
check('A ativou modo interação (servidor)', await until(A, () => window.__pv.mp().self.interaction === 'interacao', 4000));
const meet = at(-9, 0.4);
await walk(C, at(-22, 0.6));
await walk(B, meet);
const facing = async () => {
  // A se aproxima pelo lado +F (vindo do carro), ficando de frente para B; C fica bem atrás de B
  const pb = await me(B);
  await walk(A, [pb.x + F[0] * 1.3, pb.z + F[1] * 1.3]);
  // vira para B
  await ev(A, (x, z) => window.__pv.walkTo(x, z, false), pb.x, pb.z);
  await w(200);
  await ev(A, () => window.__pv.stopWalk());
};
await facing();
await ev(A, () => window.__pv.key('KeyF'));
await w(1200);
{
  const d = await ev(A, () => window.__pv.lastDenial()), pa = await me(A), pb = await me(B);
  check('servidor nega o empurrão em alvo pacífico', d === 'push:pacifico_alvo', `negativa=${d} · distância ${dist(pa, pb).toFixed(2)} m`);
  check('B pacífico NÃO é empurrado', (await ev(B, () => window.__pv.isDown())) === false);
}

// ------------------------------------------------------------------ 9. B ativa interação; A empurra B
await ev(B, () => window.__pv.key('KeyK'));
check('B ativou modo interação', await until(B, () => window.__pv.mp().self.interaction === 'interacao', 4000));
await w(1100); // cooldown do atacante
await facing();
{ const pb = await me(B); await look(A, [pb.x, pb.z], 0.2, 6); }
const recPush = record(A, 'empurrao', 6500, 8);
await w(200);
await ev(A, () => window.__pv.key('KeyF'));
const fell = await until(B, () => window.__pv.isDown(), 4000, 80);
{ const d = await ev(A, () => window.__pv.lastDenial()); check('servidor validou o empurrão e B caiu (ragdoll)', fell, fell ? '' : `negativa=${d}`); }
await w(700);
await A.p.screenshot({ path: `${OUT}/03_B_caida_ragdoll.png` });
check('A vê B caída (estado do servidor)', ((await mp(A)).remotes.find((r) => r.name === 'Jogadora_B')?.status ?? 0) >= 1);
await recPush;
check('B levanta e recupera o controle', await until(B, () => !window.__pv.isDown() && window.__pv.mp().self.status === 0, 8000));
// anti-griefing: pedido IMEDIATAMENTE após levantar → negado (imunidade de 5 s)
await ev(A, (t) => window.__pv.rawPush(t), (await mp(B)).session);
await w(800);
check('servidor nega empurrão durante a proteção pós-queda', (await ev(A, () => window.__pv.lastDenial())) === 'push:imune');
// cliente modificado tentando empurrar C (pacífico, longe)
await ev(A, (t) => window.__pv.rawPush(t), (await mp(C)).session);
await w(800);
{ const d = await ev(A, () => window.__pv.lastDenial()); check('empurrão forçado em C (pacífico/longe) é negado', d.startsWith('push:') && d !== 'push:imune', d); }

// ------------------------------------------------------------------ 10. impacto de veículo (ambos em modo interação)
{
  await w(5200); // fim da imunidade
  const v = (await ev(A, () => window.__pv.vehicles())).find((x) => x.id === car.id);
  await walk(A, [v.x - Math.sin(v.heading) * 3.1, v.z - Math.cos(v.heading) * 3.1]);
  await ev(A, () => window.__pv.key('KeyE'));
  check('A volta ao carro', await until(A, () => window.__pv.riding() === 'car', 6000));
  let hit = false, attempt = 0;
  while (!hit && attempt++ < 3) {
    const cv = (await ev(A, () => window.__pv.vehicles())).find((x) => x.id === car.id);
    const h = await ev(A, () => window.__pv.carHeading());
    // espera o trecho à frente ficar livre de veículos do trânsito
    for (let k = 0; k < 15; k++) {
      const n = await ev(A, (x, z, hh) => window.__pv.trafficIds(x + Math.sin(hh) * 9, z + Math.cos(hh) * 9, 9).length, cv.x, cv.z, h);
      if (!n) break;
      await w(2000);
    }
    const tgt = [cv.x + Math.sin(h) * 9, cv.z + Math.cos(h) * 9];
    await walk(B, tgt, true);
    await walk(C, [tgt[0] - Math.cos(h) * 8, tgt[1] + Math.sin(h) * 8], true);
    await look(C, tgt, 0.12, 4);
    const rec = attempt === 1 ? record(C, 'impacto', 5000, 8) : null;
    const p0 = await me(A);
    await ev(A, () => window.__pv.press('KeyW', 2600));
    hit = await until(B, () => window.__pv.isDown(), 4000, 80);
    const p1 = await me(A);
    console.log(`   tentativa ${attempt}: carro andou ${dist(p1, p0).toFixed(1)} m · B ${hit ? 'caiu' : 'de pé'}`);
    await ev(A, () => window.__pv.press('KeyS', 900));
    await w(900);
    if (hit) await C.p.screenshot({ path: `${OUT}/04_impacto_veiculo.png` });
    if (rec) await rec;
    if (!hit) { await ev(A, () => window.__pv.press('KeyS', 2400)); await w(2600); }
  }
  check('impacto de veículo: servidor valida e B cai (sem dano)', hit, `tentativas: ${attempt}`);
  check('B levanta após o impacto', await until(B, () => !window.__pv.isDown() && window.__pv.mp().self.status === 0, 9000));
  await ev(A, () => window.__pv.key('KeyE'));
}

// ------------------------------------------------------------------ relatório
const report = { lag, jitter, results, serverEvents: serverLog.filter((l) => /negado|queda|entrou em/.test(l)), clients: {} };
for (const c of [A, B, C]) {
  const m = await ev(c, () => window.__pv.metrics());
  const n = await mp(c);
  report.clients[c.name] = { fps: m.fps, cpuMs: m.cpuMs, gpuMs: m.gpuMs, calls: m.calls, triangles: m.triangles, heapMB: m.heapMB, bandwidth: m.bandwidth, httpBytes: c.net.http, wsInTotal: Math.round(c.net.wsIn), wsOutTotal: Math.round(c.net.wsOut), wsMsgsIn: c.net.wsMsgsIn, wsMsgsOut: c.net.wsMsgsOut, interp: n.interpDelay, rtt: n.rtt, corrections: n.corrections };
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
console.log('eventos do servidor:\n  ' + report.serverEvents.join('\n  '));
for (const c of [A, B, C]) await c.b.close();
cleanup();
process.exit(ok === results.length ? 0 : 1);
