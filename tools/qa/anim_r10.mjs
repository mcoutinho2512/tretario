/**
 * Rodada 10 — folhas de contato (12 quadros) das animações de CONFRONTO e das transições, por linha do tempo
 * determinística (dev/human.html?tl=1 e dev/knock.html?tl=1): cada sequência parte da locomoção assentada, dispara o
 * golpe/reação e captura 12 instantes com passos fixos de 1/60 s; mede o deslizamento dos pés apoiados (parado).
 * uso (dev server): node tools/qa/anim_r10.mjs <devBase> <rótulo antes|depois> [só=nome1,nome2] [corpo=homem]
 * saída: docs/screenshots/round10/anim/<seq>_<rótulo>.jpg + anim_<rótulo>.json (deslizamento, alturas na queda)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [BASE = 'http://localhost:5185', TAG = 'depois', ONLY = '', BODY = 'homem'] = process.argv.slice(2);
const only = new Set(ONLY ? ONLY.split(',') : []);
const OUT = 'docs/screenshots/round10/anim';
const tmp = `${OUT}/_frames_${TAG}`;
mkdirSync(tmp, { recursive: true });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const jsonPath = `${OUT}/anim_${TAG}.json`;
const log = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : {};

/**
 * sequências: [nome, {pre (locomoção m/s), prop, yaw, passos}] — cada passo: {c: clipe de golpe} | {clip, loop} |
 * {stop} | {speed} | {wait s} | {shots: [instantes s relativos ao passo]} (o tempo corre só com os passos)
 */
const STEP = 1 / 60;
const SEQ = [
  ['soco', { yaw: 0.9, steps: [{ c: 'cbt_punch' }, { shots: sp(0.6) }] }],
  ['soco2', { yaw: 0.9, steps: [{ c: 'cbt_punch2' }, { shots: sp(0.6) }] }],
  ['chute', { yaw: 1.3, steps: [{ c: 'cbt_kick' }, { shots: sp(0.95) }] }],
  ['chute_final', { yaw: 1.3, steps: [{ c: 'cbt_kick_final' }, { shots: sp(1.0) }] }],
  ['esquiva', { yaw: 1.3, steps: [{ c: 'cbt_dodge' }, { shots: sp(0.7) }] }],
  ['taco', { yaw: 0.9, prop: 'bat', steps: [{ c: 'cbt_bat' }, { shots: sp(1.0) }] }],
  ['barra', { yaw: 1.2, prop: 'bar', steps: [{ c: 'cbt_bar' }, { shots: sp(1.1) }] }],
  ['spray', { yaw: 0.9, prop: 'spray', steps: [{ c: 'cbt_spray' }, { shots: sp(1.1) }] }],
  ['cambaleio', { yaw: 1.3, steps: [{ clip: 'stagger' }, { shots: sp(0.9) }] }],
  ['npc_queda_levantar', { yaw: 1.3, steps: [{ clip: 'npc_down', loop: true }, { shots: [0, 0.1, 0.2, 0.35, 1.2] }, { stop: 'npc_down' }, { clip: 'getup' }, { shots: [0.05, 0.25, 0.45, 0.7, 0.95, 1.2, 1.6] }] }],
  // transições
  ['andar_soco', { pre: 1.4, yaw: 0.9, steps: [{ shots: [0, 0.1] }, { c: 'cbt_punch' }, { shots: [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8] }] }],
  ['correr_soco', { pre: 5.0, yaw: 0.9, steps: [{ shots: [0, 0.08] }, { c: 'cbt_punch' }, { shots: [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8] }] }],
  ['andar_chute', { pre: 1.4, yaw: 1.3, steps: [{ shots: [0, 0.1] }, { c: 'cbt_kick' }, { shots: [0, 0.08, 0.16, 0.24, 0.32, 0.45, 0.6, 0.75, 0.9, 1.1] }] }],
  ['parado_andar_taco', { yaw: 0.9, prop: 'bat', steps: [{ c: 'cbt_bat' }, { shots: [0, 0.15, 0.27, 0.33, 0.45, 0.6] }, { speed: 1.4 }, { shots: [0.05, 0.12, 0.2, 0.3, 0.45, 0.6] }] }],
  ['combo', { yaw: 1.1, steps: [{ c: 'cbt_punch' }, { shots: [0.05, 0.13, 0.25] }, { c: 'cbt_punch2' }, { shots: [0.05, 0.12, 0.25] }, { c: 'cbt_kick_final' }, { shots: [0.1, 0.22, 0.3, 0.45, 0.62, 0.9] }] }],
];
/** 12 instantes de 0 a `d` */
function sp(d) { return Array.from({ length: 12 }, (_, k) => +((d * k) / 11).toFixed(3)); }
const KNOCK = [
  ['queda_costas_levantar', 'back'],
  ['queda_brucos_levantar', 'front'],
];
const KNOCK_SHOTS = [0.25, 0.7, 1.5, 2.5, 2.6, 2.72, 2.85, 3.0, 3.2, 3.45, 3.7, 4.1];

const br = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 300, height: 420 } });
for (const [name, s] of SEQ) {
  if (only.size && !only.has(name)) continue;
  const pg = await br.newPage();
  await pg.goto(`${BASE}/dev/human.html?body=${BODY}&lod=0&cam=sheet&tl=1&yaw=${s.yaw}`);
  await pg.waitForFunction('window.__humanReady && window.__human.chars[0].animator', { timeout: 90000 });
  await w(1500);
  await pg.evaluate((pre, prop) => { const t = window.__human.tl; t.prop(prop ?? null); t.speed(pre ?? 0); t.step(1 / 60, 90); }, s.pre ?? 0, s.prop ?? null);
  const files = [];
  let slide = 0, clock = 0;
  for (const st of s.steps) {
    if (st.c) await pg.evaluate((n) => window.__human.tl.combat(n), st.c);
    else if (st.clip) await pg.evaluate((n, l) => window.__human.tl.clip(n, l), st.clip, !!st.loop);
    else if (st.stop) await pg.evaluate((n) => window.__human.tl.stop(n), st.stop);
    else if (st.speed !== undefined) await pg.evaluate((v) => window.__human.tl.speed(v), st.speed);
    else if (st.shots) {
      let t = 0;
      for (const at of st.shots) {
        const n = Math.round((at - t) / STEP);
        if (n > 0) slide = Math.max(slide, await pg.evaluate((dt, n) => window.__human.tl.step(dt, n), STEP, n));
        else await pg.evaluate(() => window.__human.tl.step(1 / 60, 0));
        t += n * STEP; clock += n * STEP;
        const f = `${tmp}/${name}_${String(files.length).padStart(2, '0')}_${clock.toFixed(2)}s.jpg`;
        await pg.screenshot({ path: f, type: 'jpeg', quality: 80 });
        files.push(f);
      }
    }
  }
  await pg.close();
  execFileSync('python3', ['tools/qa/contact_sheet.py', `${OUT}/${name}_${TAG}.jpg`, '6', '300', ...files]);
  log[name] = { slideCm: +(slide * 100).toFixed(2), moving: !!s.pre };
  console.log(name, s.pre ? '' : `deslizamento ${(slide * 100).toFixed(2)} cm`);
}
for (const [name, dir] of KNOCK) {
  if (only.size && !only.has(name)) continue;
  const pg = await br.newPage();
  await pg.setViewport({ width: 360, height: 300 });
  await pg.goto(`${BASE}/dev/knock.html?tl=1&dir=${dir}&cam=side`);
  await pg.waitForFunction('window.__humanReady && window.__knock', { timeout: 90000 });
  await w(2500);
  await pg.evaluate(() => window.__knock.step(1 / 60, 40));
  await pg.evaluate(() => window.__knock.knock());
  await w(400);
  const files = [];
  let t = 0;
  const m = { feetMaxGetup: -1, headMinGetup: 9, frames: [] };
  for (const at of KNOCK_SHOTS) {
    const n = Math.round((at - t) / STEP);
    const r = await pg.evaluate((dt, n) => window.__knock.step(dt, n), STEP, n);
    t += n * STEP;
    m.frames.push({ t: +t.toFixed(2), ...r });
    if (t > 2.6) { m.feetMaxGetup = Math.max(m.feetMaxGetup, r.feetMax); m.headMinGetup = Math.min(m.headMinGetup, r.headMin); }
    const f = `${tmp}/${name}_${String(files.length).padStart(2, '0')}_${t.toFixed(2)}s.jpg`;
    await pg.screenshot({ path: f, type: 'jpeg', quality: 80 });
    files.push(f);
  }
  await pg.close();
  execFileSync('python3', ['tools/qa/contact_sheet.py', `${OUT}/${name}_${TAG}.jpg`, '6', '360', ...files]);
  log[name] = m;
  console.log(name, `pés no levantar até ${m.feetMaxGetup} m`);
}
await br.close();
writeFileSync(jsonPath, JSON.stringify(log, null, 1));
rmSync(tmp, { recursive: true });
