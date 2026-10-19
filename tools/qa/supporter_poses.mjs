/**
 * Rodada 10 — camisas das torcidas: folhas de contato e checagem de atravessamento (clipping).
 *  1) folhas por camisa (dev/human.html ?sheet=kit): 4 corpos × frente/costas em LOD0 (peças), LOD2 e LOD3 (malha única)
 *     e a multidão instanciada VAT (&crowd=2/3&kit=) → docs/screenshots/round10/{B_flamengo,C_vasco,D_fluminense,E_botafogo}.jpg
 *     (os nomes dos arquivos seguem o pedido do dono; o código só conhece os ids dos designs)
 *  2) poses (dev/human.html, LOD0, 4 corpos): parado, andar, correr, pulo, dança, gestos, soco, chute, esquiva, queda,
 *     levantar → docs/screenshots/round10/G_poses_camisas.jpg
 *  3) montado (jogo real, servidor de teste): bicicleta, patinete, moto e carro → docs/screenshots/round10/H_montado_camisas.jpg
 * uso: npx vite --port 5181 --strictPort  →  node tools/qa/supporter_poses.mjs [http://localhost:5181] [só=1,2,3]
 *      PV_POSE_PORT (padrão 3152) para a parte 3
 */
import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5181';
const only = (process.argv[3] ?? '1,2,3').split(',');
const PORT = Number(process.env.PV_POSE_PORT ?? 3152);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round10', TMP = 'screenshots/tmp/round10';
mkdirSync(SHOTS, { recursive: true }); mkdirSync(TMP, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const sheet = (out, cols, width, files) => execFileSync('python3', ['tools/qa/contact_sheet.py', out, String(cols), String(width), ...files]);
const KITS = [[212, 'B_flamengo'], [213, 'C_vasco'], [214, 'D_fluminense'], [215, 'E_botafogo']];
const errs = [];

const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
async function human(file, query, vp = { width: 1800, height: 640 }) {
  const p = await b.newPage();
  await p.setViewport(vp);
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${base}/dev/human.html?${query}`);
  await p.waitForFunction('window.__humanReady', { timeout: 60000 });
  await w(1500);
  const info = await p.evaluate(() => window.__human.info()[0]);
  await p.screenshot({ path: file });
  await p.close();
  return info;
}

const report = {};
if (only.includes('1')) {
  for (const [kit, name] of KITS) {
    const files = [];
    for (const l of [0, 2, 3]) { const f = `${TMP}/${name}_lod${l}.png`; report[`${name}_lod${l}`] = await human(f, `sheet=kit&kit=${kit}&klod=${l}`); files.push(f); }
    for (const l of [2, 3]) { const f = `${TMP}/${name}_vat${l}.png`; await human(f, `crowd=${l}&kit=${kit}&ccam=close`); files.push(f); }
    sheet(`${SHOTS}/${name}.jpg`, 1, 1500, files);
    console.log(`folha ${name}`);
  }
}

if (only.includes('2')) {
  const POSES = [['parado', 'speed=0'], ['andar', 'speed=1.3'], ['correr', 'speed=4.2'], ['pulo', 'cbt=jump_loop&t=0.2'], ['danca', 'act=dance_lively&t=0.8'],
    ['gesto', 'act=arms_up&t=0.8'], ['soco', 'cbt=cbt_punch&t=0.18'], ['chute', 'cbt=cbt_kick&t=0.3'], ['esquiva', 'cbt=cbt_dodge&t=0.2'], ['queda', 'cbt=npc_down&t=0.6'], ['levantar', 'cbt=getup&t=0.6']];
  const files = [];
  for (const [kit] of KITS) for (const [n, q] of POSES) {
    const f = `${TMP}/pose_${kit}_${n}.png`;
    await human(f, `sheet=kit&kit=${kit}&klod=0&${q}`, { width: 1500, height: 560 });
    files.push(f);
  }
  sheet(`${SHOTS}/G_poses_camisas.jpg`, 4, 700, files);
  console.log('folha de poses');
}

if (only.includes('3')) {
  const man = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
  const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const log = [];
  S.stdout.on('data', (d) => log.push(d.toString()));
  for (let i = 0; i < 150 && !log.join('').includes('[pv3d-server]'); i++) await w(200);
  const files = [];
  try {
    const kinds = [['bicycle', 212, 'mulher'], ['scooter', 213, 'idoso'], ['moto', 214, 'homem'], ['car', 215, 'idosa']];
    for (const [kind, kit, body] of kinds) {
      const sp = man.vehicleSpawns.find((s) => s.kind === kind);
      const p = await b.newPage();
      await p.setViewport({ width: 1100, height: 700 });
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(`${base}/?autostart=1&welcome=0&quality=high&time=10:30&mp=ws://127.0.0.1:${PORT}&name=QA&spawn=${(sp.x + 1.2).toFixed(1)},${(sp.z + 1.2).toFixed(1)}`);
      await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 150000 });
      await p.evaluate((a) => window.__pv.setAppearance({ body: a[1], skin: 0xb98a68, hair: 0x2b1c12, top: 0x141414, bottom: 0x2c3a52, shoes: 0x111111, topStyle: 'camiseta', shirtDesign: a[0] }), [kit, body]);
      await w(1500);
      await p.evaluate((id) => window.__pv.rawEnter(id), sp.id);
      for (let i = 0; i < 40 && (await p.evaluate(() => window.__pv.riding())) !== kind; i++) await w(200);
      const riding = await p.evaluate(() => window.__pv.riding());
      await p.evaluate(() => window.__pv.camera(Math.PI * 0.75, 0.15, 3.2));
      await w(2500);
      const f = `${TMP}/montado_${kind}.png`;
      await p.screenshot({ path: f });
      report[`montado_${kind}`] = riding;
      files.push(f);
      await p.close();
    }
  } finally { try { process.kill(-S.pid, 'SIGTERM'); } catch { /* */ } }
  sheet(`${SHOTS}/H_montado_camisas.jpg`, 2, 900, files);
  console.log('folha montado');
}
await b.close();
console.log(JSON.stringify({ errs: errs.slice(0, 5), report: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, typeof v === 'object' && v ? { lod: v.lod, tris: v.tris, calls: v.calls } : v])) }, null, 1));
