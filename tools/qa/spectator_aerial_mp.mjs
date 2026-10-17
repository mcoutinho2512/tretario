/**
 * Rodada 8.1 — ESPECTADOR AÉREO com a passeata inteira: servidor de teste próprio (PV_TEST=1) + 500 bots ao longo
 * da avenida (Central → Candelária, grupos do evento, vida social) + 2 espectadores (um navegador cada).
 *   · no alto (AGGREGATE) os dois recebem `spec_cells` e veem a MESMA distribuição (mesma assinatura das células)
 *   · células com gente na Central, Campo de Santana, Rio Branco e Candelária
 *   · descida na Candelária (alto → chão): camada vai a NEAR, entidades aparecem, impostores somem (sem duplicar), sem erros
 *   · bytes/s do espectador no chão × no alto, FPS no alto, tamanho das mensagens
 * Saída: docs/bench/round8_1_spectator_aerial.json · capturas A–H (JPEG) em docs/screenshots/round8_1/.
 * uso: node tools/qa/spectator_aerial_mp.mjs [baseUrl]   (vite com PV_API=http://127.0.0.1:<porta+1>)
 *      PV_AERIAL_PORT (padrão 2830) · PV_AERIAL_BOTS (padrão 500)
 */
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_AERIAL_PORT ?? 2830);
const NBOTS = Number(process.env.PV_AERIAL_BOTS ?? 500);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round8_1';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const procs = [];
const killAll = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } } };
process.on('exit', killAll);
process.on('SIGINT', () => process.exit(130));

// ---------------------------------------------------------------- servidor + bots
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_MAX_CLIENTS: '700' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
procs.push(server);
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const bots = spawn('npx', ['tsx', 'tools/bots.ts', String(NBOTS), '900', `ws://127.0.0.1:${PORT}`, 'spread', '--range=0.18,1', '--groups', '--social=0.3', '--wait-go'], { cwd: 'server', stdio: ['pipe', 'pipe', 'pipe'], detached: true });
procs.push(bots);
let botsOut = '';
bots.stdout.on('data', (d) => { botsOut += d.toString(); });
bots.stderr.on('data', (d) => { botsOut += d.toString(); });
for (let i = 0; i < 600 && !botsOut.includes('READY'); i++) await w(200);
bots.stdin.write('go\n');
check(`${NBOTS} bots entraram ao longo da avenida`, botsOut.includes('READY'), botsOut.split('\n').filter((l) => l.includes('falhou')).slice(0, 2).join(' | '));

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const zones = JSON.parse(readFileSync('public/world/zones.json', 'utf8')).zones;
const axis = manifest.pvAxis;
// mesmas funções do jogo (src/world/zones.ts) — eixo da avenida
function axisInfo() { const seg = []; let total = 0; for (let i = 0; i < axis.length - 1; i++) { const l = Math.hypot(axis[i + 1][0] - axis[i][0], axis[i + 1][1] - axis[i][1]); seg.push(l); total += l; } return { seg, total }; }
const AX = axisInfo();
function pointOnAxis(t) {
  let want = Math.max(0, Math.min(1, t)) * AX.total;
  for (let i = 0; i < AX.seg.length; i++) {
    if (want <= AX.seg[i] || i === AX.seg.length - 1) { const u = Math.min(1, want / AX.seg[i]); const [ax, az] = axis[i], [bx, bz] = axis[i + 1]; return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, heading: Math.atan2(bx - ax, bz - az) }; }
    want -= AX.seg[i];
  }
  return { x: axis[0][0], z: axis[0][1], heading: 0 };
}
function tOf(x, z) {
  let best = { t: 0, d: Infinity }, acc = 0;
  for (let i = 0; i < axis.length - 1; i++) {
    const [ax, az] = axis[i], [bx, bz] = axis[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * u - x, az + dz * u - z);
    if (d < best.d) best = { t: (acc + AX.seg[i] * u) / AX.total, d };
    acc += AX.seg[i];
  }
  return best;
}
const zone = (id) => zones.find((z) => z.id === id);
const zoneOfCell = (c) => { const p = tOf((c.cx + 0.5) * 40, (c.cz + 0.5) * 40); const z = zones.find((q) => p.t >= q.from && p.t < q.to && p.d <= q.halfWidth); return z?.id ?? null; };

// ---------------------------------------------------------------- espectadores
const browsers = [];
async function openSpectator(name) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1280, height: 720 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.errors = [];
  p.on('pageerror', (e) => { p.errors.push(e.message); console.log(`[${name}] ERR`, e.message); });
  await p.goto(`${base}/?quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}`);
  await p.waitForFunction('typeof window.__pvLaunch === "function"', { timeout: 60000 });
  await p.evaluate(() => { void window.__pvLaunch({ role: 'spectator' }); });
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(200); } return null; };
const cells = (p) => ev(p, () => window.__pv.specCells());
const shot = (p, f) => p.screenshot({ path: `${SHOTS}/${f}`, type: 'jpeg', quality: 86 });
/** pose ao longo do eixo em t, olhando no sentido da Candelária */
const along = (t, pitch, dist) => { const a = pointOnAxis(t); return [a.x, a.z, a.heading, pitch, dist]; };
const pose = (p, x, z, yaw, pitch, dist, snap = true) => ev(p, (a) => window.__pv.specPose(...a), [x, z, yaw, pitch, dist, snap]);
/** média de bytes/s recebidos e FPS durante `ms` */
async function measure(p, ms = 6000) {
  const s = [];
  for (let i = 0; i < ms / 1000; i++) { await w(1000); s.push(await ev(p, () => ({ bw: window.__pv.mp().bandwidth, m: window.__pv.metrics(), c: window.__pv.specCells() }))); }
  const avg = (f) => +(s.reduce((a, x) => a + f(x), 0) / s.length).toFixed(1);
  const last = s.at(-1);
  return { inBps: Math.round(avg((x) => x.bw.inBps)), outBps: Math.round(avg((x) => x.bw.outBps)), fps: avg((x) => x.m.fps), frameMs: avg((x) => x.m.frameMs), calls: Math.round(avg((x) => x.m.calls)), tier: last.c.tier, remotes: last.m.crowd?.net ?? null, impostors: last.c.impostors?.drawn ?? 0, cellBytes: last.c.stats.bytes, cellMsgs: last.c.stats.msgs };
}

mkdirSync(SHOTS, { recursive: true });
mkdirSync('docs/bench', { recursive: true });
const B = await openSpectator('B');
const C = await openSpectator('C');
const out = { bots: NBOTS, port: PORT, date: new Date().toISOString() };

// ---------------------------------------------------------------- chão (NEAR) no meio da multidão: referência de banda
const tC = zone('CENTRAL').anchor.t;
await pose(B, ...along(tC, 0.3, 30));
await w(4000);
out.groundCentral = await measure(B);
check('B no chão (Central): camada NEAR, sem células, entidades da rede', out.groundCentral.tier === 'NEAR' && out.groundCentral.impostors === 0, JSON.stringify(out.groundCentral));

// ---------------------------------------------------------------- alto (AGGREGATE): os dois espectadores
for (const p of [B, C]) await pose(p, ...along(0.6, 1.18, 400));
const agg = await until(async () => { const [b, c] = [await cells(B), await cells(C)]; return b.tier === 'AGGREGATE' && c.tier === 'AGGREGATE' && b.cells > 20 && c.cells > 20 ? [b, c] : null; }, 15000);
check('B e C no alto: camada AGGREGATE com células da avenida inteira', !!agg, agg ? `B ${agg[0].cells} células (${agg[0].players} jogadores + ${agg[0].env} ambiente) · C ${agg[1].cells}` : JSON.stringify(await cells(B)));
await w(2500);
out.aerial = await measure(B, 8000);
check('no alto: nenhuma entidade completa da rede, impostores desenhados', out.aerial.impostors > NBOTS * 0.8, JSON.stringify(out.aerial));
// mesma distribuição: assinaturas iguais (as duas aplicam o mesmo conjunto do mesmo período)
let same = null, tries = [];
for (let i = 0; i < 12 && !same; i++) {
  const [b, c] = await Promise.all([cells(B), cells(C)]);
  tries.push(`${b.digest}/${c.digest}`);
  if (b.digest === c.digest && b.cells === c.cells) same = { b, c };
  else await w(330);
}
check('B e C veem a MESMA distribuição (células, contagens, grupos, seeds)', !!same, same ? `assinatura ${same.b.digest} · ${same.b.cells} células · ${same.b.players} jogadores` : tries.join(' '));
const ref = same?.b ?? (await cells(B));
const perZone = {};
for (const c of ref.list) { const z = zoneOfCell(c); if (!z) continue; perZone[z] ??= { cells: 0, players: 0, env: 0, groups: {} }; const q = perZone[z]; q.cells++; q.players += c.players; q.env += c.env; for (const [k, v] of Object.entries(c.groups)) q.groups[k] = (q.groups[k] ?? 0) + v; }
out.perZone = perZone;
for (const id of ['CENTRAL', 'CAMPO_DE_SANTANA', 'RIO_BRANCO', 'CANDELARIA']) check(`células com gente: ${zone(id).name}`, (perZone[id]?.players ?? 0) > 0, JSON.stringify(perZone[id] ?? null));
const gsum = {};
for (const q of Object.values(perZone)) for (const [k, v] of Object.entries(q.groups)) gsum[k] = (gsum[k] ?? 0) + v;
out.groups = gsum;
check('grupos distribuídos sem vantagem (13 / 22 / neutro com a mesma contagem ±2 %)', ['grupo-13', 'grupo-22', 'neutro'].every((k) => Math.abs((gsum[k] ?? 0) - NBOTS / 3) <= NBOTS * 0.02 + 2), JSON.stringify(gsum));
check(`teto de banda das células (≤ ${6000} B/s)`, out.aerial.cellMsgs > 0 && (await ev(B, () => window.__pv.specCells().stats)).bytes / Math.max(1, out.aerial.cellMsgs) < 6000, `${out.aerial.cellMsgs} msgs · ${out.aerial.cellBytes} B no total`);

// ---------------------------------------------------------------- capturas A (Central → Candelária), B (passeata), G (lado a lado), H (HUD)
await pose(B, ...along(tC - 0.03, 0.82, 320));
await w(6500);
await shot(B, 'A_aerea_central_candelaria.jpg');
for (const p of [B, C]) await pose(p, ...along(0.42, 0.7, 320));
await w(6500);
await shot(B, 'B_passeata_do_alto.jpg');
for (const p of [B, C]) await pose(p, ...along(0.62, 1.2, 320));
await w(6500);
await shot(B, 'espectador_B.jpg'); await shot(C, 'espectador_C.jpg');
execFileSync('python3', ['tools/qa/contact_sheet.py', `${SHOTS}/G_dois_espectadores.jpg`, '2', '960', `${SHOTS}/espectador_B.jpg`, `${SHOTS}/espectador_C.jpg`]);
await ev(B, () => window.__pv.toggleMap());
await w(2500);
await shot(B, 'H_hud_minimapa_aereo.jpg');
const hudB = await ev(B, () => ({ hud: window.__pv.hudInfo(), label: window.__pv.hudInfo().mode ?? '' }));
out.minimap = hudB.hud?.minimap ?? null;
check('minimapa no alto usa as células (calor com a passeata inteira)', !out.minimap || out.minimap.densityTotal > NBOTS * 0.8, JSON.stringify(out.minimap ?? hudB.label));
await ev(B, () => window.__pv.toggleMap());

// ---------------------------------------------------------------- zonas (FAR sobre cada uma): C, D, E
const zoneShots = [['CENTRAL', 'C_central.jpg'], ['CAMPO_DE_SANTANA', 'D_campo_de_santana.jpg'], ['CANDELARIA', 'E_candelaria.jpg']];
out.far = {};
for (const [id, f] of zoneShots) {
  const a = pointOnAxis(zone(id).anchor.t - (id === 'CANDELARIA' ? 0.02 : 0)); // o ponto do eixo na Candelária cai num quarteirão
  await pose(B, a.x, a.z, a.heading, 1.15, 190); // quase de cima: a câmera não fica atrás de prédio (oclusão aproxima)
  // FAR já centrado na zona: todas as células a ≤ farRadius (+1 célula) do foco novo, com gente
  const r = await until(async () => { const c = await cells(B); return c.tier === 'FAR' && c.players > 0 && c.list.every((q) => Math.hypot((q.cx + 0.5) * 40 - a.x, (q.cz + 0.5) * 40 - a.z) <= 260 + 40) ? c : null; }, 15000);
  await w(2500);
  out.far[id] = r ? { cells: r.cells, players: r.players, env: r.env, impostors: (await cells(B)).impostors?.drawn } : null;
  check(`FAR sobre ${zone(id).name}: só células perto do foco, com gente`, !!r && r.cells < ref.cells, JSON.stringify(out.far[id]));
  await shot(B, f);
}

// ---------------------------------------------------------------- descida na Candelária: alto → chão
const k = pointOnAxis(zone('CANDELARIA').anchor.t - 0.02);
await pose(B, k.x, k.z, k.heading, 1.1, 300);
await until(async () => (await cells(B)).tier === 'AGGREGATE', 10000);
await w(2000);
await shot(B, '1_alto.jpg');
await pose(B, k.x, k.z, k.heading, 0.75, 170, false); // desce suave (amortecimento da câmera)
await w(2200);
await shot(B, '2_descendo.jpg');
await pose(B, k.x, k.z, k.heading, 0.3, 34, false);
const near = await until(async () => { const c = await cells(B); return c.tier === 'NEAR' ? c : null; }, 15000);
await w(3000);
const nearState = await ev(B, () => ({ c: window.__pv.specCells(), remotes: window.__pv.mp().remotes.length, crowd: window.__pv.metrics().crowd }));
await shot(B, '3_chao.jpg');
execFileSync('python3', ['tools/qa/contact_sheet.py', `${SHOTS}/F_transicao_alto_chao.jpg`, '3', '640', `${SHOTS}/1_alto.jpg`, `${SHOTS}/2_descendo.jpg`, `${SHOTS}/3_chao.jpg`]);
out.descent = { tier: nearState.c.tier, remotes: nearState.remotes, impostors: nearState.c.impostors, cells: nearState.c.cells, pedsVisible: nearState.c.pedsVisible, crowd: nearState.crowd };
check('descida na Candelária: camada NEAR, entidades aparecem, sem impostores (sem duplicar), pedestres/concentração locais de volta', !!near && nearState.remotes > 5 && nearState.c.cells === 0 && nearState.c.impostors?.drawn === 0 && nearState.c.pedsVisible, JSON.stringify(out.descent));
out.groundCandelaria = await measure(B);
check('sem erros de página nos dois espectadores', !B.errors.length && !C.errors.length, [...B.errors, ...C.errors].slice(0, 3).join(' | '));

// tamanho das mensagens (do lado do servidor, pelo cliente C ainda no alto)
const cs = (await cells(C)).stats;
out.messages = { spec_cells_msgs: cs.msgs, spec_cells_bytes: cs.bytes, avgBytes: Math.round(cs.bytes / Math.max(1, cs.msgs)), fulls: cs.fulls };
out.summary = {
  groundInKBps: +(out.groundCentral.inBps / 1024).toFixed(1), aerialInKBps: +(out.aerial.inBps / 1024).toFixed(1),
  aerialFps: out.aerial.fps, groundFps: out.groundCentral.fps, avgCellMsgBytes: out.messages.avgBytes,
};
console.log(JSON.stringify(out.summary));
writeFileSync('docs/bench/round8_1_spectator_aerial.json', JSON.stringify({ ...out, results }, null, 2));
for (const f of ['espectador_B.jpg', 'espectador_C.jpg', '1_alto.jpg', '2_descendo.jpg', '3_chao.jpg']) { try { execFileSync('rm', [`${SHOTS}/${f}`]); } catch { /* */ } }

for (const b of browsers) await b.close();
killAll();
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
process.exit(ok === results.length ? 0 : 1);
