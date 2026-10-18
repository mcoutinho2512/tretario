/**
 * Sequências de MOVIMENTO do jogador local (rodada 9.1): andar, correr, curva de 90°, parar, pulo, queda + levantar —
 * no jogo (câmera de lado acompanhando), 12 quadros por ação numa folha de contato; e os golpes (soco, chute, taco,
 * barra, esquiva) pela página de desenvolvimento, congelando o clipe em 12 instantes.
 * uso: node tools/qa/motion_frames.mjs <jogoUrl> <devUrl|-> <pasta> <rótulo> [ações=walk,run,turn,stop,jump,fall,cbt]
 * saída: <pasta>/<ação>_<rótulo>.jpg (+ <pasta>/motion_<rótulo>.json com os tempos reais de cada quadro)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [GAME, DEV, OUT = 'docs/screenshots/round9_1', TAG = 'depois', ONLY = 'walk,run,turn,stop,jump,fall,cbt'] = process.argv.slice(2);
const only = new Set(ONLY.split(','));
const tmp = `${OUT}/_frames_${TAG}`;
mkdirSync(tmp, { recursive: true });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const log = {};
const sheet = (name, files) => { execFileSync('python3', ['tools/qa/contact_sheet.py', `${OUT}/${name}_${TAG}.jpg`, '6', '300', ...files]); };

if (GAME && GAME !== '-') {
  const br = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 520, height: 640 } });
  const p = await br.newPage();
  await p.goto(`${GAME}/?autostart=1&welcome=0&quality=high&time=10:30&mem=1`);
  await p.waitForFunction('window.__pvReady === true', { timeout: 240000 });
  const H = 2.0, X = -540, Z = 255;
  await p.evaluate(() => { window.__pv.hud(false); window.__pv.peds(0); });
  const reset = async () => {
    await p.evaluate((x, z, h) => { window.__pv.stopWalk(); window.__pv.teleport(x, z, h); }, X, Z, H);
    await w(1500);
  };
  await reset();
  await w(7000); // LOD0 do avatar
  /** 12 quadros a cada `gap` ms com a câmera de lado (ângulo `side` em relação ao rumo inicial) depois de `start()` */
  const run = async (name, start, gap, mid) => {
    await reset();
    const files = [], times = [];
    const t0 = Date.now();
    await p.evaluate(start, X, Z, H);
    for (let i = 0; i < 12; i++) {
      if (mid && i === mid.at) await p.evaluate(mid.fn, X, Z, H);
      await p.evaluate((h) => window.__pv.camera(h + Math.PI / 2, 0.03, 4.4), H);
      const f = `${tmp}/${name}_${String(i).padStart(2, '0')}_${((Date.now() - t0) / 1000).toFixed(2)}s.jpg`;
      times.push(Date.now() - t0);
      await p.screenshot({ path: f, type: 'jpeg', quality: 82 });
      files.push(f);
      await w(gap);
    }
    log[name] = times;
    sheet(name, files);
    console.log(name, times.join(','));
  };
  const far = (x, z, h) => window.__pv.walkTo(x + Math.sin(h) * 60, z + Math.cos(h) * 60, false);
  if (only.has('walk')) await run('andar', far, 70);
  if (only.has('run')) await run('correr', (x, z, h) => window.__pv.walkTo(x + Math.sin(h) * 80, z + Math.cos(h) * 80, true), 60);
  if (only.has('turn')) await run('curva90', far, 80, { at: 3, fn: (x, z, h) => { const m = window.__pv.metrics().player; window.__pv.walkTo(m.x + Math.sin(h + Math.PI / 2) * 40, m.z + Math.cos(h + Math.PI / 2) * 40, false); } });
  if (only.has('stop')) await run('parar', far, 80, { at: 3, fn: () => window.__pv.stopWalk() });
  if (only.has('jump')) await run('pulo', () => window.__pv.jump(), 60);
  if (only.has('fall')) await run('queda_levantar', () => window.__pv.fall(), 330);
  await br.close();
}

if (DEV && DEV !== '-' && only.has('cbt')) {
  // golpes: o clipe congelado em 12 instantes (página de desenvolvimento), de lado e na diagonal
  const clips = { soco: ['cbt_punch', 0.45], chute: ['cbt_kick', 0.72], taco: ['cbt_bat', 0.8], barra: ['cbt_bar', 0.9], esquiva: ['cbt_dodge', 0.5] };
  const br = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 300, height: 420 } });
  for (const [name, [clip, dur]] of Object.entries(clips)) {
    const files = [];
    for (let k = 0; k < 12; k++) {
      const t = (dur * k) / 11;
      const pg = await br.newPage();
      await pg.goto(`${DEV}/dev/human.html?body=homem&lod=0&cam=sheet&yaw=0.9&cbt=${clip}&t=${t.toFixed(3)}`);
      await pg.waitForFunction('window.__humanReady', { timeout: 90000 });
      await w(700);
      const f = `${tmp}/${name}_${String(k).padStart(2, '0')}_${t.toFixed(2)}s.jpg`;
      await pg.screenshot({ path: f, type: 'jpeg', quality: 80 });
      files.push(f);
      await pg.close();
    }
    sheet(name, files);
    console.log(name);
  }
  await br.close();
}
writeFileSync(`${OUT}/motion_${TAG}.json`, JSON.stringify(log, null, 1));
rmSync(tmp, { recursive: true });
