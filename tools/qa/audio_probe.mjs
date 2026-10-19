/**
 * QA do ÁUDIO (rodada 10, docs/AUDIO_SYSTEM.md) num Chrome real (headless, política de autoplay "precisa de gesto").
 * Sobe o PRÓPRIO servidor de teste (PV_TEST=1, memória, porta AUDIO_PORT ou 3410) e bots (server/tools/bots.ts).
 *
 *  autoplay   antes de qualquer gesto: sem AudioContext, sem erro no console → clique → contexto rodando, sons gerados
 *  ambiente   vento + cidade tocando; nós vivos estáveis
 *  trio       perto: música forte · 120 m: mais fraca e abafada · 400 m: virtual (sem voz real)
 *  câmera     vista aérea (lookFrom) e volta: ouvinte pula, sem erro, rampas longas
 *  veículos   carro, moto, bicicleta, patinete: monta (E), acelera (W) → laço do motor/rolagem com taxa subindo
 *  combate    B na frente de A: A soca → whoosh em A e impacto (servidor decide) nos dois
 *  ajustes    painel aberto (S_config_audio), volume geral 40 % salvo em pv3d.audio, silenciar suspende, volta
 *  carga      50 e 500 bots na concentração: fontes lógicas, vozes reais, nós vivos ao longo do tempo, ms do áudio
 *             no thread principal e CPU (todos os processos do Chrome) com som × silenciado
 *
 * uso (Vite rodando): node tools/qa/audio_probe.mjs [baseUrl=http://localhost:5184] [contagens=50,500]
 * saída: docs/bench/round10_audio.json · docs/screenshots/S_config_audio.png · docs/screenshots/R_trio_audio_hud.png
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

const BASE = process.argv[2] ?? 'http://localhost:5184';
const COUNTS = (process.argv[3] ?? '50,500').split(',').filter(Boolean).map(Number);
const PORT = Number(process.env.AUDIO_PORT ?? 3410);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const out = { checks: results, numbers: {}, timeline: {} };
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
mkdirSync('docs/screenshots', { recursive: true });
mkdirSync('docs/bench', { recursive: true });

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const procs = new Set();
const start = (cmd, args, env = {}, stdio = ['ignore', 'pipe', 'pipe']) => {
  const p = spawn(cmd, args, { cwd: 'server', env: { ...process.env, ...env }, stdio, detached: true });
  procs.add(p); p.on('exit', () => procs.delete(p));
  return p;
};
const killGroup = (p) => { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } };
const browsers = [];
const cleanup = () => { for (const p of procs) killGroup(p); for (const b of browsers) b.process()?.kill('SIGKILL'); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });

const server = start('npx', ['tsx', 'src/index.ts'], { PORT: String(PORT), PV_TEST: '1', PV_METRICS: '0', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' });
let up = false;
server.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) up = true; });
for (let i = 0; i < 150 && !up; i++) await w(200);
if (!up) { console.error('servidor não subiu'); process.exit(1); }

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const spawns = manifest.vehicleSpawns;
const trio = spawns.find((s) => s.kind === 'trio');
const L2W = (v, lx, lz) => [v.x + lx * Math.cos(v.heading) + lz * Math.sin(v.heading), v.z - lx * Math.sin(v.heading) + lz * Math.cos(v.heading)];

const consoleErr = [];
async function open(name, sp, w0 = 1280, h0 = 720) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--autoplay-policy=user-gesture-required'], defaultViewport: { width: w0, height: h0 } });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => { consoleErr.push(`[${name}] ${e.message}`); console.log(`[${name}] ERRO`, e.message); });
  // (recurso HTTP 5xx do servidor de teste sem banco — ex. /api/me — não é do áudio: registrado à parte)
  p.on('console', (m) => { const t = m.text(); if (/Failed to load resource/.test(t)) { out.numbers.httpErrors = (out.numbers.httpErrors ?? 0) + 1; return; } if (m.type() === 'error' || /AudioContext|autoplay/i.test(t)) consoleErr.push(`[${name}] ${m.type()}: ${t}`); });
  await p.goto(`${BASE}/?autostart=1&welcome=0&quality=low&time=16:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(2)},${sp[1].toFixed(2)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvAudio', { timeout: 180000 });
  return { p, browser };
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const A = (p) => ev(p, () => window.__pvAudio());
const until = async (p, fn, ms = 10000, ...a) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(p, fn, ...a)) return true; await w(200); } return false; };
const loopG = (s, key) => s.loops.playing.filter((x) => x.key === key).reduce((m, x) => Math.max(m, x.g), 0);

// ------------------------------------------------------------------------------------------- autoplay
const spA = L2W(trio, 9, 0);
const { p: pa, browser: ba } = await open('A', spA);
await w(2500);
let s = await A(pa);
check('autoplay: antes do gesto não há AudioContext (som bloqueado, sem erro)', s.state === 'locked' && s.ctxState === null && consoleErr.filter((e) => /audio/i.test(e)).length === 0, `state=${s.state} erros=${consoleErr.length}`);
await pa.mouse.click(640, 400);
const ok = await until(pa, () => window.__pvAudio().ctxState === 'running', 8000);
s = await A(pa);
check('autoplay: clique libera (contexto rodando, sink registrado)', ok && s.state === 'running', `ctx=${s.ctxState} sr=${s.sampleRate} lat=${s.baseLatency}`);
await until(pa, () => window.__pvAudio().buffers.ready >= 40, 15000);
s = await A(pa);
check('sons gerados no Worker (sem travar o quadro)', s.buffers.ready >= 40 && s.buffers.worker, `${s.buffers.ready} sons · ${s.buffers.MB} MB · ${s.counters.genMs} ms de síntese no Worker`);
out.numbers.synth = { sounds: s.buffers.ready, MB: s.buffers.MB, genMs: s.counters.genMs };
check('ambiente: vento + cidade tocando', s.counters.sourcesLive >= 2, `fontes vivas ${s.counters.sourcesLive} · nós vivos ${s.counters.nodesLive}`);

// ------------------------------------------------------------------------------------------- trio perto/longe
await w(1500);
s = await A(pa);
const gNear = loopG(s, 'trio_music');
check('trio perto (≈9 m): música própria tocando forte', gNear > 0.5, `ganho ${gNear} · laços ${JSON.stringify(s.loops.playing)}`);
const away = (d) => L2W(trio, 9 + d, 0);
let q = away(110);
await ev(pa, (x, z) => window.__pvProg.tp(x, z), q[0], q[1]);
await w(2200);
s = await A(pa);
const gMid = loopG(s, 'trio_music');
const cutMid = s.loops.playing.find((x) => x.key === 'trio_music')?.cutoff ?? null;
check('trio a ~120 m: mais fraco e abafado (passa-baixa de ar)', gMid > 0 && gMid < gNear * 0.5 && cutMid !== null && cutMid < 6000, `ganho ${gMid} · corte ${cutMid} Hz`);
q = away(420);
await ev(pa, (x, z) => window.__pvProg.tp(x, z), q[0], q[1]);
await w(2200);
s = await A(pa);
check('trio a ~430 m: virtual (sem voz real, sem fonte lógica)', loopG(s, 'trio_music') === 0 && !s.loops.kinds.trio_music, `kinds ${JSON.stringify(s.loops.kinds)}`);
out.numbers.trio = { near: gNear, mid: gMid, midCutoff: cutMid };
await ev(pa, (x, z) => window.__pvProg.tp(x, z), spA[0], spA[1]);
await w(1800);

// ------------------------------------------------------------------------------------------- troca de câmera
const errs0 = consoleErr.length;
await ev(pa, (x, z) => window.__pv.lookFrom(x, 260, z - 120, x, 0, z), spA[0], spA[1]);
await w(1500);
s = await A(pa);
const aerialG = loopG(s, 'trio_music');
check('câmera aérea: ouvinte no alto, trio bem mais fraco, sem erro', s.listener.y > 150 && aerialG < gNear && consoleErr.length === errs0, `y=${s.listener.y} trio=${aerialG}`);
await ev(pa, () => window.__pv.lookFrom());
await w(1500);
s = await A(pa);
check('câmera volta à 3ª pessoa: trio forte de novo', loopG(s, 'trio_music') > 0.4, `trio=${loopG(s, 'trio_music')}`);

// ------------------------------------------------------------------------------------------- R_trio_audio_hud
await ev(pa, (y) => window.__pv.camera(y, 0.12, 7), Math.atan2(trio.x - spA[0], trio.z - spA[1])); // olhando para o trio
await w(1200);
await ev(pa, () => {
  const a = window.__pvAudio();
  const d = document.createElement('div');
  d.id = 'qa-audio';
  d.style.cssText = 'position:fixed;left:12px;top:60px;z-index:99;background:rgba(10,14,18,.82);color:#e8f0f4;font:12px/1.5 ui-monospace,monospace;padding:10px 12px;border-radius:8px;max-width:560px;white-space:pre-wrap';
  d.textContent = `ÁUDIO (QA)\ncontexto ${a.ctxState} · ${a.sampleRate} Hz\nlaços reais ${a.loops.real}/${a.budget.loops} · lógicos ${a.loops.logical}\n${a.loops.playing.map((x) => `  ${x.key.padEnd(15)} g=${x.g} pan=${x.pan} corte=${x.cutoff}`).join('\n')}\none-shots ${a.oneShots.busy}/${a.budget.oneShots} (${a.counters.crowdEvents} reações da multidão)\nmultidão ${a.crowd.voices}/${a.budget.crowdVoices} vozes · ${a.crowd.cells.map((c) => `${c.density}p ${c.profile}`).join(' · ')}\nnós vivos ${a.counters.nodesLive} · fontes ${a.counters.sourcesLive} · ${a.counters.updateMs} ms/quadro`;
  document.body.appendChild(d);
});
await pa.screenshot({ path: 'docs/screenshots/R_trio_audio_hud.png' });
await ev(pa, () => document.getElementById('qa-audio')?.remove());

// ------------------------------------------------------------------------------------------- veículos
for (const kind of ['car', 'moto', 'bicycle', 'scooter']) {
  const vs = await ev(pa, (k) => window.__pv.vehicles(k), kind);
  const v = vs.find((x) => !x.occupant);
  if (!v) { check(`${kind}: há veículo livre`, false); continue; }
  const side = kind === 'car' ? 1.7 : 0.9;
  await ev(pa, (x, z) => window.__pvProg.tp(x, z), v.x + Math.cos(v.heading) * side, v.z - Math.sin(v.heading) * side);
  await w(600);
  await ev(pa, () => window.__pv.key('KeyE'));
  const mounted = await until(pa, (k) => window.__pv.riding() === k, 5000, kind);
  if (!mounted) { check(`${kind}: montou`, false); continue; }
  await w(700);
  const key = { car: 'car_engine', moto: 'moto_engine', bicycle: 'bike_roll', scooter: 'scooter_motor' }[kind];
  const s0 = await A(pa);
  const idle = s0.loops.playing.find((x) => x.key === key);
  await ev(pa, () => window.__pv.press('KeyW', 2600));
  await w(2200);
  const s1 = await A(pa);
  const run = s1.loops.playing.find((x) => x.key === key);
  const doorish = (s1.byId.veh_door ?? 0) + (s1.byId.veh_mount ?? 0);
  check(`${kind}: laço ${key} toca e a taxa sobe ao acelerar`, run && run.g > 0.3 && (!idle || run.rate > idle.rate) , `parado ${idle ? `g=${idle.g} r=${idle.rate}` : '—'} · andando g=${run?.g} r=${run?.rate} · porta/montar ${doorish}`);
  await w(800);
  await ev(pa, () => window.__pv.key('KeyE'));
  await until(pa, () => window.__pv.riding() === null, 4000);
  await w(500);
}
s = await A(pa);
check('veículos: freio/porta/montar soaram', (s.byId.veh_door ?? 0) + (s.byId.veh_mount ?? 0) >= 2, JSON.stringify({ door: s.byId.veh_door, mount: s.byId.veh_mount, brake: s.byId.veh_brake, bikeBrake: s.byId.bike_brake }));

// ------------------------------------------------------------------------------------------- combate
await ev(pa, (x, z) => window.__pvProg.tp(x, z), spA[0] + 30, spA[1]);
const { p: pb, browser: bb } = await open('B', [spA[0] + 30, spA[1] + 1.0], 640, 400);
await pb.mouse.click(320, 200);
await until(pb, () => window.__pvAudio().ctxState === 'running', 8000);
await until(pb, () => window.__pvAudio().buffers.ready >= 20, 12000);
await w(5000); // proteção de entrada de B passa
const hitA0 = await A(pa), hitB0 = await A(pb);
for (let i = 0; i < 3; i++) { await ev(pa, () => window.__pv.cbt('cbt_punch')); await w(900); }
await w(800);
const hitA = await A(pa), hitB = await A(pb);
const dA = (k) => (hitA.byId[k] ?? 0) - (hitA0.byId[k] ?? 0), dB = (k) => (hitB.byId[k] ?? 0) - (hitB0.byId[k] ?? 0);
check('combate: A ouve o próprio golpe (whoosh) e o resultado do servidor', dA('whoosh') >= 1 && dA('punch') + dA('blocked') + dA('dodge') >= 1, `A whoosh ${dA('whoosh')} punch ${dA('punch')} impact ${dA('impact')} blocked ${dA('blocked')}`);
check('combate: B (alvo) ouve o golpe do remoto e o impacto', dB('whoosh') + dB('punch') + dB('impact') >= 1, `B whoosh ${dB('whoosh')} punch ${dB('punch')} impact ${dB('impact')} fall ${dB('fall')}`);
await bb.close();
browsers.splice(browsers.indexOf(bb), 1);
await ev(pa, (x, z) => window.__pvProg.tp(x, z), spA[0], spA[1]);

// ------------------------------------------------------------------------------------------- ajustes
await ev(pa, () => window.__pv.hudSet({ settings: true }));
await w(500);
await ev(pa, () => { const i = document.querySelector('input[data-vol="master"]'); i.value = '40'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await w(300);
await pa.screenshot({ path: 'docs/screenshots/S_config_audio.png' });
const saved = await ev(pa, () => JSON.parse(localStorage.getItem('pv3d.audio') ?? 'null'));
s = await A(pa);
check('ajustes: painel com volumes por categoria; volume geral 40 % salvo em pv3d.audio', saved?.master === 0.4 && s.byId.ui_open >= 1, JSON.stringify(saved));
await ev(pa, () => document.querySelector('input[data-vol="muted"]').click());
const muted = await until(pa, () => window.__pvAudio().ctxState === 'suspended', 3000);
check('silenciar tudo: contexto suspenso (CPU de áudio ≈ 0)', muted && (await ev(pa, () => JSON.parse(localStorage.getItem('pv3d.audio')).muted)) === true);
await ev(pa, () => document.querySelector('input[data-vol="muted"]').click());
const unm = await until(pa, () => window.__pvAudio().ctxState === 'running', 3000);
check('tirar o silêncio: contexto volta a rodar', unm);
await ev(pa, () => { const i = document.querySelector('input[data-vol="master"]'); i.value = '80'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await ev(pa, () => window.__pv.hudSet({ settings: false }));
await pa.reload();
await pa.waitForFunction('window.__pvReady === true && window.__pvAudio', { timeout: 180000 });
s = await A(pa);
check('recarregar: volumes persistem (e o som espera um novo gesto)', s.settings.master === 0.8 && s.state === 'locked', `master ${s.settings.master} · state ${s.state}`);
await pa.mouse.click(640, 400);
await until(pa, () => window.__pvAudio().ctxState === 'running' && window.__pvAudio().buffers.ready >= 40, 15000);

// ------------------------------------------------------------------------------------------- carga: 50 / 500 bots
const cdp = await ba.target().createCDPSession();
const cpuTotal = async () => { const r = await cdp.send('SystemInfo.getProcessInfo'); return r.processInfo.reduce((t, x) => t + x.cpuTime, 0); };
const m = manifest;
const a11 = m.pvAxis[11], a12 = m.pvAxis[12];
const C = { x: (a11[0] + a12[0]) / 2, z: (a11[1] + a12[1]) / 2 };
const along = Math.atan2(a12[0] - a11[0], a12[1] - a11[1]);
async function startBots(n) {
  const list = [], ready = [];
  for (let k = 0; k * 100 < n; k++) {
    const cnt = Math.min(100, n - k * 100);
    const p = start('npx', ['tsx', 'tools/bots.ts', String(cnt), '3600', `ws://127.0.0.1:${PORT}`, 'dense', `--offset=${k * 100}`, `--total=${n}`, '--wait-go', '--social=0.5'], {}, ['pipe', 'pipe', 'inherit']);
    const rl = createInterface({ input: p.stdout });
    ready.push(new Promise((res) => rl.on('line', (l) => { if (l.trim() === 'READY') res(); })));
    list.push(p);
  }
  await Promise.all(ready);
  for (const p of list) p.stdin.write('go\n');
  return list;
}
async function window_(label, secs) {
  const t0 = Date.now(), c0 = await cpuTotal();
  const tl = [];
  for (let i = 0; i < secs * 2; i++) { const a = await A(pa); tl.push({ t: +((Date.now() - t0) / 1000).toFixed(1), logical: a.loops.logical, realLoops: a.loops.real, oneShots: a.oneShots.busy, crowdVoices: a.crowd.voices, nodesLive: a.counters.nodesLive, sourcesLive: a.counters.sourcesLive, updateMs: a.counters.updateMs, worldMs: a.world.ms, cellsIn: a.crowd.cellsIn, aggAdded: a.world.aggAdded, crowdEvents: a.counters.crowdEvents }); await w(500); }
  const c1 = await cpuTotal();
  const cpuPct = +(((c1 - c0) / ((Date.now() - t0) / 1000)) * 100).toFixed(1);
  return { label, cpuPct, tl };
}
for (const n of COUNTS) {
  const bots = await startBots(n);
  await ev(pa, (x, z) => window.__pvProg.tp(x, z), C.x, C.z);
  await ev(pa, (y) => window.__pv.camera(y, 0.22, 7), along);
  await w(8000);
  const on = await window_(`${n} bots · som`, 12);
  await ev(pa, () => window.__pv.hudSet({ settings: true }));
  await ev(pa, () => document.querySelector('input[data-vol="muted"]').click());
  await ev(pa, () => window.__pv.hudSet({ settings: false }));
  await w(1500);
  const off = await window_(`${n} bots · silenciado`, 8);
  await ev(pa, () => window.__pv.hudSet({ settings: true }));
  await ev(pa, () => document.querySelector('input[data-vol="muted"]').click());
  await ev(pa, () => window.__pv.hudSet({ settings: false }));
  const last = await A(pa);
  const metrics = await ev(pa, () => window.__pv.metrics());
  const mx = (k) => Math.max(...on.tl.map((x) => x[k]));
  const nodes = on.tl.map((x) => x.nodesLive);
  out.timeline[n] = on.tl;
  out.numbers[`bots${n}`] = {
    humans: metrics.crowd?.submitted, remotes: metrics.net?.remotes, far: metrics.crowd?.farNet,
    maxLogicalLoops: mx('logical'), maxRealLoops: mx('realLoops'), maxOneShots: mx('oneShots'), maxCrowdVoices: mx('crowdVoices'),
    nodesLiveMin: Math.min(...nodes), nodesLiveMax: Math.max(...nodes), peakNodes: last.counters.peakNodes, peakSources: last.counters.peakSources, nodesCreated: last.counters.nodesCreated,
    audioMainMs: +(on.tl.reduce((t, x) => t + x.updateMs + x.worldMs, 0) / on.tl.length).toFixed(3), cpuPctSound: on.cpuPct, cpuPctMuted: off.cpuPct, cpuAudioPct: +(on.cpuPct - off.cpuPct).toFixed(1),
    crowdCells: last.crowd.cells, aggAdded: mx('aggAdded'), fps: metrics.fps, crowdEvents: last.counters.crowdEvents,
  };
  console.log(JSON.stringify(out.numbers[`bots${n}`]));
  const b = out.numbers[`bots${n}`];
  check(`${n} bots: ≤ 4 vozes de multidão, ≤ 8 laços reais, ≤ 24 one-shots`, b.maxCrowdVoices <= 4 && b.maxRealLoops <= 8 && b.maxOneShots <= 24, `multidão ${b.maxCrowdVoices} · laços ${b.maxRealLoops}/${b.maxLogicalLoops} lógicos · one-shots ${b.maxOneShots}`);
  check(`${n} bots: nós vivos estáveis (sem crescimento)`, b.nodesLiveMax - b.nodesLiveMin <= 40 && b.nodesLiveMax < 220, `${b.nodesLiveMin}–${b.nodesLiveMax} vivos · pico ${b.peakNodes} · criados ${b.nodesCreated}`);
  check(`${n} bots: multidão agregada (${b.aggAdded} humanos → ${b.crowdCells.length} células)`, b.crowdCells.length >= 1 && b.crowdCells.length <= 4, JSON.stringify(b.crowdCells));
  bots.forEach(killGroup);
  await w(4000);
}
out.numbers.badParams = (await A(pa)).counters.badParams;
check('nenhum erro no console durante o roteiro', consoleErr.length === 0, consoleErr.slice(0, 5).join(' | '));
writeFileSync('docs/bench/round10_audio.json', JSON.stringify(out, null, 1));
const okAll = results.every((r) => r.ok);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ok`);
cleanup();
process.exit(okAll ? 0 : 1);
