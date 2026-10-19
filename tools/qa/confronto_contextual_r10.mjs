/**
 * Rodada 10 — captura W_confronto_contextual: dois jogadores reais trocando golpes no CENTRO, perto dos NPCs de
 * ambiente (servidor de teste próprio, PV_TEST=1, porta PV_CTX_PORT ou 3520). Vista de um terceiro cliente
 * (câmera livre no cliente de B, HUD real visível); folha de contato com os quadros + um quadro avulso. Obs.: numa
 * tentativa com a câmera livre no cliente de A (HUD escondido) a vista de A não mostrava B nem a multidão — não
 * investigado nesta rodada (pendência anotada em docs/COMBAT.md); a vista de B mostra tudo.
 * uso (dev server): node tools/qa/confronto_contextual_r10.mjs <baseUrl> [rótulo=depois]
 * saída: docs/screenshots/round10/anim/W_confronto_contextual[_<rótulo>].jpg (+ _quadro.jpg)
 */
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5185';
const TAG = process.argv[3] ?? 'depois';
const PORT = Number(process.env.PV_CTX_PORT ?? 3520);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'docs/screenshots/round10/anim';
const tmp = `${OUT}/_ctx_${TAG}`;
mkdirSync(tmp, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_EVENT: 'cotidiano', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n')));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n')));
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const browsers = [];
const cleanup = async () => { for (const b of browsers) await b.close().catch(() => {}); try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };

const MANIFEST = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
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
const ZONES = JSON.parse(readFileSync('public/world/zones.json', 'utf8'));
const C = pointOnAxis(ZONES.zones.find((z) => z.id === 'CENTRO').anchor.t, ZONES.zones.find((z) => z.id === 'CENTRO').anchor.side);

async function open(name, sp, vp = { width: 1100, height: 640 }) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: vp, protocolTimeout: 240000 });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=15:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pv.combat()', { timeout: 180000 });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const me = (p) => ev(p, () => window.__pv.metrics().player);
const face = async (p, to) => { const m = await me(p); await ev(p, (y) => window.__pv.face(y), Math.atan2(to[0] - m.x, to[1] - m.z)); await w(250); };
let ok = 0, total = 0;
const check = (n, c, d = '') => { total++; if (c) ok++; console.log(`${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };

try {
  const A = await open('Ana', [C.x, C.z]);
  // ponto de concentração mais forte (carro de som/trio): a luta acontece na borda da multidão
  const rp = await ev(A, () => { const r = window.__pv.rallyCrowd().rally.filter((p) => p.strength > 0).sort((a, b) => b.strength - a.strength); return r[0] ?? null; });
  const R = rp ? [rp.x, rp.z] : [C.x + 8, C.z];
  const PA = [R[0] + 6.5, R[1] + 0.6], PB = [R[0] + 6.5, R[1] + 1.7];
  const B = await open('Beto', PB);
  const tp = async (p, to) => { await ev(p, (x, z) => window.__pvProg.tp(x, z), to[0], to[1]); await w(700); };
  await tp(A, PA); await tp(B, PB);
  await w(6500); // proteção de entrada + LOD0 + NPCs ao redor
  await face(A, PB); await face(B, PA);
  const npcs = await ev(B, () => window.__pv.npcs(12).list.length);
  check('NPCs de ambiente perto da luta', npcs > 0, `${npcs} a ≤ 12 m`);
  // câmera fixa do lado oposto à multidão, olhando o meio da dupla (a multidão fica ao fundo)
  const mid = [(PA[0] + PB[0]) / 2, (PA[1] + PB[1]) / 2];
  const dir = [mid[0] - R[0], mid[1] - R[1]], dl = Math.hypot(dir[0], dir[1]) || 1;
  const camP = [mid[0] + (dir[0] / dl) * 4.2 - (dir[1] / dl) * 1.2, mid[1] + (dir[1] / dl) * 4.2 + (dir[0] / dl) * 1.2];
  const cam = () => ev(B, (c, m) => window.__pv.lookFrom(c[0], 1.75, c[1], m[0], 1.0, m[1]), camP, mid);
  const files = [];
  const snap = async (label) => { await cam(); const f = `${tmp}/${String(files.length).padStart(2, '0')}_${label}.jpg`; await B.screenshot({ path: f, type: 'jpeg', quality: 85 }); files.push(f); };
  // roteiro: A soca, B soca de volta, A chuta, B esquiva, A combo (soco, soco, chute final)
  await cam(); await w(1500);
  const seq = [
    [A, 'cbt_punch', [60, 140, 330], 'A_soco'], [B, 'cbt_punch', [60, 140, 330], 'B_soco'],
    [B, 'cbt_dodge', [80, 200], 'B_esquiva'], [A, 'cbt_punch', [120], 'A_combo1'], [A, 'cbt_punch', [130], 'A_combo2'], [A, 'cbt_kick', [150, 300, 600], 'A_combo3_chute_final'],
  ];
  let acts = 0;
  for (const [P, key, shots, label] of seq) {
    await face(P, P === A ? PB : PA);
    const t0 = Date.now();
    await ev(P, (k) => window.__pv.cbt(k), key);
    for (const at of shots) { const d = at - (Date.now() - t0); if (d > 0) await w(d); await snap(`${label}_${at}ms`); }
    await w(key === 'cbt_kick' ? 900 : label.startsWith('A_combo') ? 120 : 450);
    acts++;
  }
  const seen = await ev(B, () => window.__pv.combat().stats.acts);
  check('B viu os golpes de A pela rede (cbt_act)', seen >= 3, `acts ${seen}`);
  const fx = await ev(A, () => window.__pv.mp().remotes.map((r) => r.fx ?? null));
  void fx;
  execFileSync('python3', ['tools/qa/contact_sheet.py', `${OUT}/W_confronto_contextual${TAG === 'depois' ? '' : '_' + TAG}.jpg`, '4', '480', ...files]);
  // quadro avulso: o impacto do chute (A_chute 240 ms)
  const best = files.find((f) => f.includes('A_combo3_chute_final_300ms')) ?? files[0];
  execFileSync('cp', [best, `${OUT}/W_confronto_contextual${TAG === 'depois' ? '' : '_' + TAG}_quadro.jpg`]);
  check('capturas', files.length >= 12, `${files.length} quadros, ${acts} golpes`);
} catch (e) {
  console.error(e);
  check('roteiro', false, String(e));
} finally {
  await cleanup();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}
