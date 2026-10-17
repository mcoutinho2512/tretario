/**
 * WALKTHROUGH MULTIPLAYER REPRODUZÍVEL (vertical slice) — 3 clientes reais (Chrome headless).
 *
 * Sobe o PRÓPRIO servidor em modo de teste (porta 2600, PV_TEST=1: só permite escolher o ponto de spawn,
 * para montar a cena; todas as regras de autoridade são as normais). Requer o cliente: `npm run dev`.
 *
 * uso: node tools/qa/walkthrough.mjs [baseUrl] [latência RTT ms] [jitter ms]
 *
 * Cena: calçada externa da Pres. Vargas, junto ao primeiro carro estacionado (car0, sentido do trânsito).
 * Roteiro: A (homem), B (mulher), C (idoso) entram · todos se veem · A e B andam juntos · mesmo semáforo ·
 * SEM trânsito NPC (avenida fechada) · A tenta atravessar o prédio (servidor impede) · carro parado e disponível ·
 * A entra no carro · B tenta o mesmo carro (servidor impede) · A dirige, freia, dá ré · A sai (carro fica parado e
 * disponível) · A ativa interação · B pacífico (A não empurra) · B ativa interação · A empurra B · B cai (ragdoll) ·
 * B levanta · proteção anti-griefing · impacto de veículo (ambos em interação) · carro NÃO derruba C pacífico (para
 * antes) · moto, bicicleta e patinete (entrar, andar, os outros veem, sair, disponível) · área de interesse.
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
  cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_METRICS: '0', PV_EVENT: process.env.PV_EVENT ?? 'cotidiano' /* modo interação (empurrão) só em evento 'opcional'; o ato é pacífico */, PV_COMBAT_ZONES: '*' /* rodada 9: o empurrão obedece à política de zona — aqui se testa a MECÂNICA (zonas de paz: combat_mp/items_zones_mp) */, ...(lag ? { COLYSEUS_LATENCY: String(lag), PV_JITTER: String(jitter) } : {}) },
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
// carro da cena: precisa de uma FACHADA de prédio à direita (lado da calçada) a até ~14 m — o teste de colisão
// empurra A para dentro dela; escolhido pelos dados (robusto a mudanças nas vagas do pipeline)
const insidePoly = (ring, p) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };
const buildingAt = (x, z) => {
  const ch = manifest.chunks.find((c) => c.key === `${Math.floor(x / 250)}_${Math.floor(z / 250)}`);
  if (!ch) return null;
  return JSON.parse(readFileSync(`public/world/${ch.file}`, 'utf8')).buildings.find((bd) => !bd.canopy && insidePoly(bd.poly.outer, [x, z]));
};
const car = manifest.vehicleSpawns.filter((v) => v.kind === 'car').find((v) => {
  const R2 = [-Math.cos(v.heading), Math.sin(v.heading)];
  // prédio à direita (8–14 m) e calçada livre atrás (a cena usa até 22 m para trás)
  return [8, 11, 14].some((d) => buildingAt(v.x + R2[0] * d, v.z + R2[1] * d)) && !buildingAt(v.x - Math.sin(v.heading) * 15, v.z - Math.cos(v.heading) * 15);
}) ?? manifest.vehicleSpawns.find((v) => v.id === 'car0');
console.log(`cena: ${car.id} (${car.x}, ${car.z})`);
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
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=16:30&mp=ws://127.0.0.1:${PORT}&avatar=${avatar}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}${lag ? `&jitter=${jitter}` : ''}`);
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

// ------------------------------------------------------------------ 3. semáforos (cenário/pedestres) e SEM trânsito NPC
{
  const states = await Promise.all([A, B].map((c) => ev(c, () => Array.from({ length: 135 }, (_, j) => window.__pv.signalState(j, 0)).join(''))));
  const same = [...states[0]].filter((ch, i) => ch === states[1][i]).length;
  check('A e B veem o mesmo estado em todos os semáforos', same >= 133, `${same}/135 iguais no mesmo instante`);
  const nt = await Promise.all([A, B, C].map((c) => ev(c, () => window.__pv.npcTraffic())));
  check('não existe trânsito NPC (nenhum cliente recebe ou renderiza trânsito)', nt.every((t) => !t.group && t.messages === 0), JSON.stringify(nt));
}

// ------------------------------------------------------------------ 4. A tenta atravessar o prédio (cliente modificado)
{
  const chunkOf = (x, z) => manifest.chunks.find((c) => c.key === `${Math.floor(x / 250)}_${Math.floor(z / 250)}`);
  const inside = (ring, p) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };
  const pa = await me(A);
  // passos de 0,5 m a cada 70 ms (velocidade "legal") em direção ao prédio (lado direito do carro)
  const corr0 = (await mp(A)).corrections;
  // alvo: 3 m DENTRO do prédio mais próximo de A (ponto mais próximo das fachadas) — robusto a mudanças de cena
  let dir = R, firstIn = 0;
  {
    let best = Infinity, bp = null;
    for (let cx = Math.floor(pa.x / 250) - 1; cx <= Math.floor(pa.x / 250) + 1; cx++) for (let cz = Math.floor(pa.z / 250) - 1; cz <= Math.floor(pa.z / 250) + 1; cz++) {
      const ch = manifest.chunks.find((c) => c.key === `${cx}_${cz}`);
      if (!ch) continue;
      for (const bd of JSON.parse(readFileSync(`public/world/${ch.file}`, 'utf8')).buildings) {
        if (bd.canopy || bd.height < 6) continue;
        const r = bd.poly.outer;
        for (let i = 0; i < r.length; i++) {
          const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((pa.x - ax) * dx + (pa.z - az) * dz) / l2));
          const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(qx - pa.x, qz - pa.z);
          if (d < best && d > 0.5) { best = d; bp = [qx, qz]; }
        }
      }
    }
    if (bp) { dir = [(bp[0] - pa.x) / best, (bp[1] - pa.z) / best]; firstIn = Math.ceil(best / 0.5); }
  }
  const steps = [];
  for (let k = 1; k <= (firstIn || 30) + 6; k++) steps.push([pa.x + dir[0] * k * 0.5, pa.z + dir[1] * k * 0.5]);
  const target = steps[steps.length - 1];
  const bld = buildingAt(target[0], target[1]);
  for (const s of steps) { await ev(A, (x, z) => window.__pv.cheatMove(x, z), s[0], s[1]); await w(70); }
  await w(1200);
  const seen = (await mp(B)).remotes.find((r) => r.name === 'Jogador_A');
  const corr1 = (await mp(A)).corrections;
  check('servidor impede A de atravessar o prédio',
    !!bld && !inside(bld.poly.outer, [seen.x, seen.z]) && corr1 > corr0,
    `alvo dentro do prédio ${bld ? bld.id : '?'}; posição autoritativa (vista por B) ficou fora; ${corr1 - corr0} correções`);
}

// ------------------------------------------------------------------ 5. A entra no carro; B tenta o mesmo
{
  const v0 = (await ev(A, () => window.__pv.vehicles())).find((v) => v.id === car.id);
  check('carro inicialmente parado na vaga e disponível', Math.hypot(v0.x - car.x, v0.z - car.z) < 0.3 && !v0.occupant && v0.state === 0, `estado ${v0.state}`);
}
await walk(A, at(-3.3, 0));
await ev(A, () => window.__pv.key('KeyE'));
check('A entrou no carro (servidor confirmou)', await until(A, () => window.__pv.riding() === 'car', 6000), `${car.id} · montado em ${await ev(A, () => window.__pv.riding())} · negativa ${await ev(A, () => window.__pv.lastDenial())} · prompt ${await ev(A, () => document.querySelector('.use-prompt')?.textContent)}`);
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
{
  await w(1500);
  const before = (await ev(B, () => window.__pv.vehicles())).find((v) => v.id === car.id);
  await w(1500);
  const after = (await ev(B, () => window.__pv.vehicles())).find((v) => v.id === car.id);
  check('carro fica parado e volta a ficar disponível (visto por B)', !after.occupant && after.state === 0 && Math.hypot(after.x - before.x, after.z - before.z) < 0.05, `estado ${after.state}`);
}

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

  // ---------------------------------------------------------------- 11. modo pacífico: carro NÃO derruba C (para antes)
  await w(5500); // imunidade de B termina (irrelevante: o alvo agora é C, pacífico)
  const cv = (await ev(A, () => window.__pv.vehicles())).find((x) => x.id === car.id);
  const h = await ev(A, () => window.__pv.carHeading());
  const tgt = [cv.x + Math.sin(h) * 8, cv.z + Math.cos(h) * 8];
  await walk(B, [tgt[0] - Math.cos(h) * 10, tgt[1] + Math.sin(h) * 10], true); // B sai do caminho
  await walk(C, tgt, true);
  check('C continua pacífico', (await mp(C)).self.interaction === 'pacifico');
  await ev(A, () => window.__pv.press('KeyW', 3500));
  const cDown = await until(C, () => window.__pv.isDown(), 4500, 80);
  const pc = await me(C);
  const carNow = (await ev(C, () => window.__pv.vehicles())).find((x) => x.id === car.id);
  const along = (pc.x - carNow.x) * Math.sin(h) + (pc.z - carNow.z) * Math.cos(h);
  check('carro não derruba jogador em modo pacífico (para antes de encostar)', !cDown && along > 2.2, `C ${cDown ? 'caiu' : 'de pé'} · ${along.toFixed(2)} m à frente do centro do carro`);
  await ev(A, () => window.__pv.key('KeyE'));
  await until(A, () => window.__pv.riding() === null, 5000);
}

// ------------------------------------------------------------------ 12. moto, bicicleta e patinete
for (const [kind, label] of [['moto', 'moto'], ['bicycle', 'bicicleta'], ['scooter', 'patinete']]) {
  const pa0 = await me(A);
  const list = await ev(A, (k) => window.__pv.vehicles(k), kind);
  const v = list.filter((x) => !x.occupant).sort((x, y) => Math.hypot(x.x - pa0.x, x.z - pa0.z) - Math.hypot(y.x - pa0.x, y.z - pa0.z))[0];
  if (!v) { check(`${label} funciona`, false, 'nenhum disponível'); continue; }
  // chega pela lateral (lado da calçada/afastado da pista)
  const side = [v.x - Math.cos(v.heading) * 1.1, v.z + Math.sin(v.heading) * 1.1];
  const walkFar = async (c, p) => { await ev(c, (x, z) => window.__pv.walkTo(x, z, true), p[0], p[1]); return until(c, () => window.__pv.arrived(), 70000); };
  await Promise.all([walkFar(A, side), walkFar(B, [side[0] - Math.cos(v.heading) * 2.5, side[1] + Math.sin(v.heading) * 2.5])]);
  // pede ESTE veículo (estações/duplas têm vizinhos a < 1 m; o E pegaria o mais próximo — testado no carro)
  await ev(A, (id) => window.__pv.rawEnter(id), v.id);
  const entered = await until(A, () => window.__pv.riding() !== null, 6000);
  const p0 = await me(A);
  await ev(A, () => window.__pv.press('KeyW', 2500));
  await w(2900);
  const p1 = await me(A);
  const seen = (await ev(B, (k) => window.__pv.vehicles(k), kind)).find((x) => x.id === v.id);
  await ev(A, () => window.__pv.press('KeyS', 900));
  await w(1000);
  await ev(A, () => window.__pv.key('KeyE'));
  const out = await until(A, () => window.__pv.riding() === null, 5000);
  await w(1200);
  const after = (await ev(B, (k) => window.__pv.vehicles(k), kind)).find((x) => x.id === v.id);
  check(`${label} funciona: entra, anda, B vê, sai e fica disponível`,
    entered && dist(p1, p0) > 3 && seen && Math.hypot(seen.x - p1.x, seen.z - p1.z) < 2.5 && out && !after.occupant && after.state === 0,
    `${v.id}: andou ${dist(p1, p0).toFixed(1)} m · B vê a ${seen ? Math.hypot(seen.x - p1.x, seen.z - p1.z).toFixed(2) : '?'} m · saiu ${out} · estado ${after?.state}`);
}

// ------------------------------------------------------------------ 13. área de interesse dos veículos
{
  const pa = await me(A);
  const inView = (await mp(A)).vehiclesInView;
  const all = await ev(A, () => window.__pv.vehicles('all')); // posições atuais (veículos dirigidos mudam de lugar)
  const far = inView.map((id) => all.find((s) => s.id === id)).filter(Boolean).filter((s) => Math.hypot(s.x - pa.x, s.z - pa.z) > 253 + 40);
  check('área de interesse: só veículos próximos são enviados', inView.length > 0 && inView.length < all.length && far.length === 0,
    `${inView.length} de ${all.length} veículos na vista; ${far.length} além do raio`);
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
