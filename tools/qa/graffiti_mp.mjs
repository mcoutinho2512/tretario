/**
 * Pichação/grafite no multiplayer (rodada 7) com clientes REAIS (um navegador por cliente):
 *  A desenha (B não recebe nada) → A publica → B vê · C distante não recebe · D entra depois e recebe ·
 *  cliente modificado (bytes inválidos, superfície falsa, longe) é recusado sem vazar nada · denúncias (2) ocultam ·
 *  ocultar localmente · expiração por TTL curto · persistência no JSON local · admin com token.
 * Também mede bytes (conteúdo e mensagem) e a memória de GPU por grafite.
 * Servidor de teste próprio (PV_TEST=1, porta PV_GF_PORT ou 2674), grafites num arquivo temporário.
 * uso: node tools/qa/graffiti_mp.mjs [baseUrl]   (requer o Vite rodando; padrão http://localhost:5173)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from 'msgpackr';

const base = process.argv[2] ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_GF_PORT ?? 2674);
const TTL = 45_000;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'screenshots/round7/graffiti';
mkdirSync(SHOTS, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const gfFile = join(mkdtempSync(join(tmpdir(), 'pv-gf-')), 'graffiti.json');
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: 'server', detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_GRAFFITI_FILE: gfFile, PV_GRAFFITI_TTL_MS: String(TTL), PV_GRAFFITI_REPORTS: '2', PV_GRAFFITI_COOLDOWN_MS: '1500', PV_GRAFFITI_SAVE_MS: '500', PV_ADMIN_TOKEN: 'qa-token' },
});
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 100 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const kill = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', kill);

// superfícies (mesmo arquivo do jogo): tapume mais perto do spawn e uma área de chão próxima
const gf = JSON.parse(readFileSync('public/world/graffiti_surfaces.json', 'utf8'));
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const sp = manifest.spawn.p;
const byDist = (k) => gf.surfaces.filter((s) => s.kind === k).sort((a, b) => Math.hypot(a.o[0] - sp[0], a.o[2] - sp[1]) - Math.hypot(b.o[0] - sp[0], b.o[2] - sp[1]))[0];
const tap = byDist('tapume'), ground = byDist('ground');
const front = (s, d = 1.3) => {
  if (s.kind === 'ground') return [s.o[0] + s.w / 2, s.o[2] - s.h / 2 + 1.0];
  const mx = s.o[0] + s.u[0] * s.w / 2, mz = s.o[2] + s.u[2] * s.w / 2;
  return [mx - s.u[2] * d, mz + s.u[0] * d];
};
const yawTo = (s) => Math.atan2(s.u[2], -s.u[0]); // olhando para a parede (−normal)
const far = manifest.pvAxis[manifest.pvAxis.length - 1]; // perto da Candelária, ~1,5 km

const browsers = [];
async function open(name, at, extra = '') {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1000, height: 600 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${at[0].toFixed(2)},${at[1].toFixed(2)}${extra}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const info = (p) => ev(p, () => window.__pv.graffiti());
const until = async (p, fn, ms = 8000, ...a) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(p, fn, ...a)) return true; await w(200); } return false; };

const A = await open('A', front(tap));
const B = await open('B', front(tap, 6));
const C = await open('C', far);
await ev(A, (y) => window.__pv.teleport(window.__pv.metrics().player.x, window.__pv.metrics().player.z, y), yawTo(tap));
await w(2500);
check('A vê o prompt de pichar', (await info(A)).near === tap.id, `perto de ${(await info(A)).near}`);

// ---- A desenha (local) — B não recebe nada
await ev(A, () => window.__pv.key('KeyE'));
check('A abre o editor (E)', await until(A, () => window.__pv.graffiti().editing, 3000));
const cv = await (await A.$('.gf-canvas')).boundingBox();
const mx = (u) => cv.x + u * cv.width, my = (v) => cv.y + v * cv.height;
await A.click('[data-color="2"]'); await A.click('[data-w="2"]');
await A.mouse.move(mx(0.08), my(0.7)); await A.mouse.down();
for (let i = 0; i <= 24; i++) await A.mouse.move(mx(0.08 + i * 0.03), my(0.7 - Math.sin(i / 3) * 0.3), { steps: 2 });
await A.mouse.up();
await A.click('[data-color="3"]'); await A.click('[data-tool="stamp"]'); await A.click('[data-sym="1"]');
await A.mouse.click(mx(0.85), my(0.35));
await A.click('[data-color="2"]'); await A.click('[data-sym="0"]');
await A.mouse.click(mx(0.13), my(0.3));
await A.click('[data-size="2"]');
await A.click('[data-tool="text"]'); await A.click('[data-color="1"]'); await A.click('[data-w="2"]');
await A.type('.gf-text', 'Ocupa a Vargas');
await A.mouse.click(mx(0.45), my(0.25));
await A.screenshot({ path: `${SHOTS}/A_editor.jpg`, quality: 85 });
await w(1500);
const bMid = await info(B);
check('durante o desenho B não recebe nada', bMid.received.add === 0 && bMid.list.length === 0, JSON.stringify(bMid.received));

// ---- publica
await A.click('[data-act="send"]');
check('A publica (servidor aceita, editor fecha)', await until(A, () => !window.__pv.graffiti().editing && window.__pv.graffiti().lastRes?.ok === true, 5000), JSON.stringify((await info(A)).lastRes));
check('B vê o grafite de A', await until(B, () => window.__pv.graffiti().list.some((g) => g.author === 'A'), 5000));
const ia = await info(A), ib = await info(B);
const g1 = ib.list.find((g) => g.author === 'A');
check('A vê como seu (mine) e B como de A', ia.list.some((g) => g.id === g1?.id && g.mine) && g1 && !g1.mine && g1.state === 'ACTIVE', `id ${g1?.id} · ${g1?.bytes} B · ${g1?.items} itens`);
check('B recebeu só conteúdo válido', ib.received.invalid === 0 && ib.received.add === 1, JSON.stringify(ib.received));
await w(1500);
check('C (distante) não recebe', (await info(C)).received.add === 0 && (await info(C)).list.length === 0, JSON.stringify((await info(C)).received));

// ---- tamanhos de mensagem (msgpack igual ao do Colyseus; + ~2 bytes de cabeçalho e o nome do tipo)
const wireBytes = g1.bytes;
const addMsg = pack([{ i: g1.id, s: tap.id, d: new Uint8Array(wireBytes), a: 'A', t: Date.now(), e: Date.now() + TTL, st: 0 }]).length + 'gf_add'.length + 2;
const newMsg = pack({ s: tap.id, d: new Uint8Array(wireBytes), n: 1 }).length + 'gf_new'.length + 2;
check('tamanhos', wireBytes < 4096, `conteúdo ${wireBytes} B · gf_new ≈ ${newMsg} B · gf_add ≈ ${addMsg} B`);

// ---- cliente modificado: lixo, superfície falsa, longe, texto proibido → recusado, nada vaza
await ev(C, (s) => window.__pv.gf.rawBytes('gf_new', s, [1, 0, 0, 0, 0, 160, 0, 80, 0, 1, 0, 33]), tap.id);
await w(600);
check('C longe/lixo: recusado', (await info(C)).lastRes?.ok === false, (await info(C)).lastRes?.r);
await ev(B, () => window.__pv.gf.raw('gf_new', { s: 'nao_existe', d: new Uint8Array(20), n: 5 }));
await w(600);
check('superfície inexistente: recusado', (await info(B)).lastRes?.r === 'superficie', (await info(B)).lastRes?.r);
await ev(B, (s) => window.__pv.gf.rawBytes('gf_new', s, [1, 100, 0, 30, 0, 160, 0, 80, 0, 1, 0, 0x21, 2, 50, 50, 100, 60]), tap.id);
await w(600);
// conteúdo VÁLIDO (17 B: 1 traço), mas B está a 6 m da parede
check('B a 6 m: recusado por distância', (await info(B)).lastRes?.r === 'distancia', (await info(B)).lastRes?.r);
check('nada inválido chegou a ninguém', (await info(A)).received.add === 1 && (await info(B)).received.add === 1 && (await info(B)).received.invalid === 0);

// ---- segundo grafite de A no chão (temporário; expira com o TTL curto)
await ev(A, (x, z) => window.__pv.walkTo(x, z, false), ...front(ground));
await until(A, () => window.__pv.arrived(), 20000);
await ev(A, () => window.__pv.teleport(window.__pv.metrics().player.x, window.__pv.metrics().player.z, Math.PI));
await w(1800);
const t2 = Date.now();
await ev(A, () => window.__pv.key('KeyE'));
const opened2 = await until(A, () => window.__pv.graffiti().editing, 3000);
if (opened2) {
  const c2 = await (await A.$('.gf-canvas')).boundingBox();
  await A.click('[data-tool="stamp"]'); await A.click('[data-sym="3"]'); await A.click('[data-color="4"]'); await A.click('[data-w="2"]');
  await A.mouse.click(c2.x + c2.width * 0.5, c2.y + c2.height * 0.5);
  await A.click('[data-act="send"]');
}
check('A pinta o chão (2º grafite)', opened2 && await until(A, () => window.__pv.graffiti().list.filter((g) => g.mine).length === 2, 5000), JSON.stringify((await info(A)).lastRes));

// ---- screenshot J: grafite na parede (tapume), visto por B com câmera livre (A já saiu da frente)
{
  const mxs = tap.o[0] + tap.u[0] * tap.w / 2, mzs = tap.o[2] + tap.u[2] * tap.w / 2, nx = -tap.u[2], nz = tap.u[0];
  await ev(B, (...a) => { window.__pv.hud(false); window.__pv.lookFrom(...a); }, mxs + nx * 3.4 + tap.u[0] * 1.2, 1.75, mzs + nz * 3.4 + tap.u[2] * 1.2, mxs, 1.35, mzs);
  await w(2000);
  await B.screenshot({ path: `${SHOTS}/J_grafite_tapume_visto_por_B.jpg`, quality: 85 });
  await ev(B, () => { window.__pv.lookFrom(); window.__pv.hud(true); });
}

// ---- D entra depois, perto: recebe os grafites existentes
const D = await open('D', front(tap, 4));
check('D (entrou depois) recebe o existente', await until(D, (id) => window.__pv.graffiti().list.some((g) => g.id === id), 6000, g1.id));

// ---- denúncia: B denuncia → REPORTED (D vê o estado); D denuncia → HIDDEN para todos (limiar 2 no teste)
await ev(B, (id) => window.__pv.gf.report(id), g1.id);
check('B denuncia (aceito) e passa a não ver (oculto para quem denunciou)', await until(B, () => window.__pv.graffiti().lastRes?.op === 'report' && window.__pv.graffiti().lastRes?.ok, 3000) && (await info(B)).list.find((g) => g.id === g1.id)?.hidden === true);
check('D vê o estado REPORTED', await until(D, (id) => window.__pv.graffiti().list.find((g) => g.id === id)?.state === 'REPORTED', 3000, g1.id));
await ev(A, (id) => window.__pv.gf.report(id), g1.id);
await w(600);
check('autor não denuncia o próprio', (await info(A)).lastRes?.r === 'proprio', (await info(A)).lastRes?.r);
await ev(D, (id) => window.__pv.gf.report(id), g1.id);
check('2 denúncias → HIDDEN: some para A e D', await until(D, (id) => !window.__pv.graffiti().list.some((g) => g.id === id), 3000, g1.id) && await until(A, (id) => !window.__pv.graffiti().list.some((g) => g.id === id), 3000, g1.id));

// ---- ocultar localmente (localStorage)
const g2 = (await info(A)).list.find((g) => g.mine && g.surface === ground.id);
await ev(D, (x, z) => window.__pv.walkTo(x, z, true), ...front(ground, 0));
const dSees = await until(D, (id) => window.__pv.graffiti().list.some((g) => g.id === id), 20000, g2?.id);
await ev(D, (id) => window.__pv.gf.hide(id), g2?.id);
const hidden = await ev(D, () => localStorage.getItem('pv.graffiti.hidden'));
check('D oculta localmente (fica no localStorage)', dSees && hidden?.includes(String(g2?.id)), hidden ?? '');

// ---- persistência: arquivo JSON local
await w(1200);
const saved = existsSync(gfFile) ? JSON.parse(readFileSync(gfFile, 'utf8')) : null;
const s1 = saved?.records?.find((r) => r.id === g1.id);
check('persistido no JSON local (estado e autor)', !!s1 && s1.state === 2 && s1.author.name === 'A' && s1.author.clientId.length >= 8, saved ? `${saved.records.length} registros` : 'sem arquivo');

// ---- admin (token): listar e restaurar
await ev(B, () => window.__pv.gf.raw('gf_admin', { token: 'errado', op: 'list' }));
await w(500);
check('admin sem token correto: recusado', (await info(B)).lastRes?.r === 'token');
await ev(B, (id) => window.__pv.gf.raw('gf_admin', { token: 'qa-token', op: 'restore', i: id }), g1.id);
check('admin restaura → volta para D', await until(D, (id) => window.__pv.graffiti().list.some((g) => g.id === id), 5000, g1.id) || await until(A, (id) => window.__pv.graffiti().list.some((g) => g.id === id), 3000, g1.id));

// ---- memória (GPU) por grafite: tiles do atlas
const mem = (await info(A)).renderer;
check('memória do atlas', mem.pages <= 4, `${mem.tiles} tiles em ${mem.pages} página(s) · ${(mem.gpuBytes / 1e6).toFixed(1)} MB GPU · ${(mem.tileBytes / 1024).toFixed(0)} KB/tile`);

// ---- expiração (TTL curto): os temporários somem para todos
const left = TTL - (Date.now() - t2) + 2500;
console.log(`aguardando a expiração (${(left / 1000).toFixed(0)} s)…`);
await w(Math.max(0, left));
check('TTL: 2º grafite expira e some para A', await until(A, (id) => !window.__pv.graffiti().list.some((g) => g.id === id), 5000, g2?.id));
const saved2 = JSON.parse(readFileSync(gfFile, 'utf8'));
check('expirados saem do armazenamento', !saved2.records.some((r) => r.id === g2?.id), `${saved2.records.length} registros`);

for (const b of browsers) await b.close();
kill();
const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULTADO: ${ok}/${results.length} verificações passaram`);
console.log(log.filter((l) => /\[graffiti\]/.test(l)).slice(0, 30).join('\n'));
writeFileSync(`${SHOTS}/graffiti_mp.json`, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
process.exit(ok === results.length ? 0 : 1);
