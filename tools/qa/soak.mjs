/**
 * SOAK TEST (rodada 8): N minutos (padrão 60) de uso contínuo num Chrome real, medindo o heap PÓS-GC e a GPU (livro-razão)
 * periodicamente, para separar AQUECIMENTO DE CACHE (cresce e estabiliza) de VAZAMENTO (cresce ~linear).
 *
 * Sobe um servidor de TESTE próprio (PV_TEST=1, porta PV_SOAK_PORT ou 2690) com bots sociais (multidão da rede, ações,
 * bandeiras, cartazes) e entra como jogador. Ciclo de ~20 s por passo, alternando:
 *   zonas (Central → Campo de Santana → Centro → Rio Branco → Candelária) · perto/longe da multidão e do trio ·
 *   ações (dança, palmas, bandeira, cartaz) · pegar/largar itens · bicicleta (entra/anda/sai) · trio (sobe/desce) ·
 *   editor de pichação (abre/fecha) · chat (se existir: __pv.chat) · espectador (se existir: segunda página)
 * Amostra a cada AMOSTRA_S (120 s): CDP HeapProfiler.collectGarbage ×2 → Runtime.getHeapUsage; GPU pelo livro-razão
 * (?mem=1). Saída: screenshots/soak/<tag>.json + resumo (inclinação total, primeiros 20 min, últimos 30 min).
 *
 * Rodada 9 (SOAK_R9=1): também confronto no boneco de treino, itens (pegar/guardar/largar), queda e levantar, entrar/
 * sair de evento da agenda, debate (assistir/reagir), com bots em confronto (8%); amostra também listeners/nós do DOM
 * (CDP Performance), intervals ativos, ragdolls vivos (Rapier), remotos e itens no chão; `hud`: elementos por filho
 * do HUD (dois níveis abaixo de .hud, com descendentes) — rodada 9.1.
 *
 * Rodada 9.1 (SOAK_SNAP=10,16): nesses minutos (após a amostra) grava um heap snapshot do CDP e o livro-razão da GPU
 * agrupado (tipo, tamanho, formato) + categorias do relatório em screenshots/soak/<tag>_<min>.{heapsnapshot,gpu.json};
 * comparar com tools/qa/heap_diff.mjs. SOAK_HEAPSNAP=0: só o livro-razão (sem heap snapshot). SOAK_TRACK=1: pilhas de
 * criação de geometrias/texturas enviadas à GPU (tools/qa/leak_track.mjs) no mesmo .gpu.json. Amostras ganham
 * `postMB`/`gpuNoPostMB` (alvos do pós-processamento seguem a resolução dinâmica) e o resumo `slopesPerMin`.
 * Medir com build de produção (`npx vite build && npx vite preview`): o HMR do dev recarrega a página.
 *
 * Rodada 10 (SOAK_R10=1, implica SOAK_R9): troca de torcida (mensagem `sup`), carro/moto/patinete pelo
 * InteractionSystem (mesmo caminho do clique/E: entrar → dirigir → sair, montagem visual), áudio liberado por um
 * clique real no início e amostrado (AudioNodes vivos/criados, fontes, laços reais, vozes de multidão); bots com
 * veículos (10) além dos sociais/confronto.
 *
 * Rodada 11 (SOAK_R11=1, implica SOAK_R10): mouse e teclado REAIS do desktop — botão direito arrastando gira a câmera,
 * varredura de hover com o cursor, inventário (I) com seleção/prévia/equipar/desequipar de acessório e de peça de
 * roupa, acesso rápido (1–3 aperta e guarda), menu do jogo e ajustes pelo Esc; amostra também `pointerLock` (tem
 * de ser sempre nulo), camadas do Esc e o inventário (renderer de prévia, aberto/fechado).
 *
 * uso (com o dev server): node tools/qa/soak.mjs [minutos=60] [tag=soak] [bots=60]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { installLeakTrack } from './leak_track.mjs';

const MIN = Number(process.argv[2] ?? 60);
const TAG = process.argv[3] ?? 'soak';
const BOTS = Number(process.argv[4] ?? 60);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const PORT = Number(process.env.PV_SOAK_PORT ?? 2690);
const SAMPLE_S = Number(process.env.SOAK_SAMPLE_S ?? 120);
const R11 = process.env.SOAK_R11 === '1';
const R10 = process.env.SOAK_R10 === '1' || R11;
const R9 = process.env.SOAK_R9 === '1' || R10;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('screenshots/soak', { recursive: true });

const procs = [];
const start = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { cwd: 'server', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  procs.push(p);
  return p;
};
const cleanup = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// rodada 9.1: token de admin só do servidor de TESTE do soak — amostra a memória do SERVIDOR por /internal/health
const QA_ADMIN = 'soak-admin-token-0123456789abcdef0123456789';
const srv = start('npx', ['tsx', 'src/index.ts'], { PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_METRICS: '0', PV_ADMIN_TOKEN: QA_ADMIN });
const log = [];
srv.stdout.on('data', (d) => log.push(d.toString()));
for (let i = 0; i < 150 && !log.join('').includes('[pv3d-server]'); i++) await w(200);
if (BOTS > 0) start('npx', ['tsx', 'tools/bots.ts', String(BOTS), String(MIN * 60 + 600), `ws://127.0.0.1:${PORT}`, 'spread', '--social=0.6', ...(R9 ? ['--groups', '--combat=0.08'] : []), ...(R10 ? ['--vehicles=10'] : [])]);
await w(4000);

const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const zones = JSON.parse(readFileSync('public/world/zones.json', 'utf8')).zones;
const axis = m.pvAxis;
const trio = m.vehicleSpawns.find((v) => v.kind === 'trio');

const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info'], defaultViewport: { width: 1280, height: 720 } });
const page = await b.newPage();
// rodada 9: conta intervals ativos (vazamento de timer aparece como crescimento)
if (R9) await page.evaluateOnNewDocument(() => {
  const live = new Set(); const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = (...a) => { const id = si(...a); live.add(id); return id; };
  window.clearInterval = (id) => { live.delete(id); return ci(id); };
  window.__pvIntervals = () => live.size;
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// rodada 9.1: causa de aba fechada — travamento do processo da página (OOM/GPU) vs. fechamento; último passo e console
let lastStep = -1; const consoleTail = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { consoleTail.push(`${m.type()}: ${m.text()}`.slice(0, 300)); if (consoleTail.length > 30) consoleTail.shift(); } });
page.on('error', (e) => { console.log(`[soak] CRASH da página no passo ${lastStep}: ${e.message}`); console.log(consoleTail.slice(-15).join('\n')); });
page.on('close', () => console.log(`[soak] página FECHADA no passo ${lastStep}`));
b.on('disconnected', () => console.log(`[soak] navegador DESCONECTADO no passo ${lastStep}`));
await page.goto(`${BASE}/?autostart=1&welcome=0&welcome=0&quality=high&time=12:00&mem=1&mp=ws://127.0.0.1:${PORT}&name=Soak&spawn=${trio.x - 30},${trio.z}`);
await page.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 240000 });
if (R10) { // áudio só nasce de gesto real (autoplay): um clique de mouse na borda da tela
  await page.mouse.click(8, 360); await w(1500);
  console.log('[soak] áudio:', JSON.stringify(await page.evaluate(() => window.__pv.audio?.()?.ctxState ?? null).catch(() => null)));
}
// rodada 9.1 (SOAK_TRACK=1): pilhas de criação de geometrias/texturas enviadas à GPU (tools/qa/leak_track.mjs)
if (process.env.SOAK_TRACK === '1') await page.evaluate(installLeakTrack);
const cdp = await page.createCDPSession();
if (R9) await cdp.send('Performance.enable');
// espectador simultâneo no MESMO mundo (rodada 8) — só a página do jogador é medida
let spec = null;
if (process.env.SOAK_SPECTATOR !== '0') {
  const b2 = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 800, height: 500 } });
  spec = await b2.newPage();
  await spec.goto(`${BASE}/?autostart=1&welcome=0&spectate=1&quality=low&time=12:00&mp=ws://127.0.0.1:${PORT}`).catch(() => {});
  await spec.waitForFunction('window.__pvReady === true', { timeout: 240000 }).catch(() => { spec = null; });
  process.on('exit', () => { void b2.close(); });
}

let reloads = 0;
const heap = async () => {
  const raw = await cdp.send('Runtime.getHeapUsage'); // heap BRUTO (antes do GC forçado)
  let srvMem = {};
  if (R9) { try { const r = await fetch(`http://127.0.0.1:${PORT + 1}/internal/health`, { headers: { 'x-admin-token': QA_ADMIN } }); if (r.ok) { const j = await r.json(); srvMem = { srvHeapMB: j.memory?.heapUsedMB ?? null, srvRssMB: j.memory?.rssMB ?? null, srvWs: j.websockets ?? null, srvPlayers: j.players ?? null, srvTickMs: j.tick?.avgMs ?? j.tick?.avg ?? null }; } } catch { /* sem health */ } }
  for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage'); await w(300); }
  const u = await cdp.send('Runtime.getHeapUsage');
  const gpu = await page.evaluate(() => window.__pv.memoryReport(false)?.ledger?.totalMB ?? null).catch(() => null);
  // rodada 9.1: alvos do pós-processamento acompanham a resolução dinâmica (0,55–1 × tela) — ±50 MB sem vazar nada;
  // `gpuNoPostMB` tira do total os alvos do tamanho do buffer de desenho
  const post = await page.evaluate(() => {
    const L = window.__pvGpuLedger, c = document.querySelector('canvas.game-canvas');
    if (!L || !c) return {};
    let b = 0;
    for (const m of [L.textures, L.renderbuffers]) for (const o of m.values()) if (Math.round(o.w) === c.width && Math.round(o.h) === c.height) b += o.bytes;
    return { postMB: +(b / 1048576).toFixed(1), drawW: c.width };
  }).catch(() => ({}));
  // página recarregada (ex.: servidor de desenvolvimento) → espera o jogo de novo em vez de abortar o soak
  if (!(await page.evaluate(() => !!window.__pv?.metrics).catch(() => false))) { reloads++; await page.waitForFunction('window.__pvReady === true && window.__pv?.metrics', { timeout: 240000 }).catch(() => {}); }
  const mt = await page.evaluate(() => { const x = window.__pv.metrics(); return { fps: Math.round(x.fps), calls: x.calls, humans: x.crowd?.submitted ?? 0 }; }).catch(() => ({ fps: null, calls: null, humans: null }));
  let r9 = {};
  if (R9) {
    const pm = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const x = await page.evaluate(() => ({ hud: (() => { const m = {}; for (const e of document.querySelectorAll('.hud > * > *')) { const k = `${e.parentElement.classList[0] ?? e.parentElement.tagName.toLowerCase()}>${e.classList[0] ?? e.tagName.toLowerCase()}`; m[k] = (m[k] ?? 0) + 1 + e.querySelectorAll('*').length; } return m; })(), dom: (() => { const m = {}; for (const e of document.querySelectorAll('body *')) { const ch = []; for (let n = e; n && n !== document.body; n = n.parentElement) ch.unshift(n); const k = ch.slice(0, 2).map((n) => (n.classList?.[0] ?? n.tagName.toLowerCase())).join('>'); m[k] = (m[k] ?? 0) + 1; } return m; })(), intervals: window.__pvIntervals?.() ?? null, ragdolls: window.__pv.r9b?.().ragdollsLive ?? null, remotes: window.__pv.mp()?.remotes?.length ?? null, items: window.__pv.r9b?.().items?.items?.length ?? null })).catch(() => ({}));
    r9 = { listeners: pm.JSEventListeners, nodes: pm.Nodes, ...x };
    if (R10) {
      const a = await page.evaluate(() => { const q = window.__pv.audio?.(); return q ? { audioState: q.ctxState, audioNodesLive: q.counters.nodesLive, audioNodesCreated: q.counters.nodesCreated, audioSourcesLive: q.counters.sourcesLive, audioPeakNodes: q.counters.peakNodes, audioLoopsReal: q.loops.real, audioLoopsLogical: q.loops.logical, audioCrowdVoices: q.crowd.voices } : {}; }).catch(() => ({}));
      Object.assign(r9, a);
    }
    if (R11) {
      const b = await page.evaluate(() => ({ pointerLock: document.pointerLockElement ? 1 : 0, escLayers: window.__pv.input?.()?.esc?.length ?? null, invOpen: window.__pvInv?.info?.()?.open ? 1 : 0, preview: JSON.stringify(window.__pvInv?.info?.()?.preview ?? null).slice(0, 120) })).catch(() => ({}));
      Object.assign(r9, b);
    }
  }
  return { usedMB: +(u.usedSize / 1048576).toFixed(2), rawMB: +(raw.usedSize / 1048576).toFixed(2), gpuMB: gpu, ...post, gpuNoPostMB: gpu !== null && post.postMB !== undefined ? +(gpu - post.postMB).toFixed(1) : null, ...mt, ...r9, ...srvMem };
};

// ponto ao longo do eixo (fração t, deslocamento lateral)
const along = (t, side = 0) => {
  let total = 0; const seg = [];
  for (let i = 0; i < axis.length - 1; i++) { const l = Math.hypot(axis[i + 1][0] - axis[i][0], axis[i + 1][1] - axis[i][1]); seg.push(l); total += l; }
  let want = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const u = Math.min(1, want / seg[i]), dx = (axis[i + 1][0] - axis[i][0]) / seg[i], dz = (axis[i + 1][1] - axis[i][1]) / seg[i];
      return [axis[i][0] + (axis[i + 1][0] - axis[i][0]) * u - dz * side, axis[i][1] + (axis[i + 1][1] - axis[i][1]) * u + dx * side, Math.atan2(dx, dz)];
    }
    want -= seg[i];
  }
  return [axis[0][0], axis[0][1], 0];
};
const ev = (fn, ...a) => page.evaluate(fn, ...a).catch((e) => ({ err: e.message }));

// rodada 9: confronto, itens, queda, eventos, debate (servidor de teste; o servidor valida tudo)
function r9Steps() {
  const D = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')).dummies[0];
  const racks = JSON.parse(readFileSync('public/gameplay/combat_props.json', 'utf8')).supply.racks;
  const tp = (x, z) => ev((x, z) => window.__pvProg?.tp(x, z), x, z);
  const entry = (fmt) => ev((f) => (window.__pvR9?.feed?.list ?? []).find((e) => (!f || e.format === f) && ['REGISTRATION', 'STARTING', 'ACTIVE'].includes(e.state)) ?? null, fmt);
  return [
    // treino: boneco (soco, chute, esquiva, soco)
    async () => {
      await tp(D.x + 1.6, D.z); await w(1500);
      await ev((y) => window.__pv.face(y), Math.atan2(-1, 0));
      for (const c of ['cbt_punch', 'cbt_punch', 'cbt_kick', 'cbt_dodge', 'cbt_punch']) { await ev((c) => window.__pv.cbt(c), c); await w(700); }
    },
    // itens: apoio → pegar (T), guardar/sacar (X), largar (Z)
    async () => {
      const r = racks[(k >> 1) % racks.length]; const [x, z] = along(r.at.t, r.at.side ?? 0);
      await tp(x + 1, z); await w(2000);
      await ev(() => window.__pv.key('KeyT')); await w(1200);
      await ev(() => window.__pv.key('KeyX')); await w(800); await ev(() => window.__pv.key('KeyX')); await w(800);
      await ev(() => window.__pv.key('KeyZ')); await w(800);
    },
    // queda e levantar (estado forçado pelo servidor de teste → ragdoll Rapier no cliente)
    async () => { await ev(() => window.__pv.netSend('qa_status', { st: 1 })); await w(5500); },
    // evento da agenda: entra e sai
    async () => { const e = await entry(null); if (e && !e.err) { await ev((i) => window.__pv.netSend('evt_join', { inst: i }), e.inst); await w(4000); await ev((i) => window.__pv.netSend('evt_leave', { inst: i }), e.inst); } },
    // rodada 9.1: a conexão cai e volta (graça de reconexão: mesma entidade, inscrição e progresso mantidos)
    async () => { await ev(() => window.__pv.netDrop()); await w(8000); },
    // debate: assistir e reagir
    async () => {
      const e = await entry('debate');
      if (e && !e.err) { await ev((i) => window.__pv.netSend('dbt_watch', { inst: i, on: true }), e.inst); await w(2500); await ev((i) => window.__pv.netSend('dbt_react', { inst: i, r: 'aplauso' }), e.inst); await w(2500); await ev((i) => window.__pv.netSend('dbt_watch', { inst: i, on: false }), e.inst); }
    },
  ];
}

// rodada 10: torcida, veículos pelo InteractionSystem (entrar/dirigir/sair com montagem), áudio
function r10Steps() {
  const ride = (kind) => async () => {
    const v = await ev((kd) => { const p = window.__pv.metrics().player; return window.__pv.vehicles('all').filter((i) => i.kind === kd && !i.occupant).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; }, kind);
    if (!v || v.err) return;
    await ev((x, z, h) => window.__pv.teleport(x + Math.cos(h) * 1.6, z - Math.sin(h) * 1.6, h), v.x, v.z, v.heading); await w(1500);
    await ev(() => window.__pv.ixUse()); await w(2000); // mesmo caminho do clique/E
    await ev(() => window.__pv.press('KeyW', 4000)); await w(1000);
    await ev(() => window.__pv.press('KeyA', 1200)); await w(3500);
    await ev(() => window.__pv.ixUse()); await w(2000); // sair
  };
  let sup = 0;
  return [
    async () => { sup = (sup + 1) % 5; await ev((i) => window.__pv.netSend('sup', i), sup); await w(1500); },
    ride('car'), ride('moto'), ride('scooter'),
  ];
}

// rodada 11: desktop de verdade (mouse/teclado reais), inventário, acesso rápido, menu do jogo
function r11Steps() {
  const W = 1280, H = 720;
  const drag = async () => { await page.mouse.move(W * 0.6, H * 0.5); await page.mouse.down({ button: 'right' }); for (let i = 1; i <= 12; i++) await page.mouse.move(W * 0.6 + i * 18, H * 0.5 - i * 3, { steps: 2 }); await page.mouse.up({ button: 'right' }); };
  const hover = async () => { for (let i = 0; i < 20; i++) await page.mouse.move(80 + (i * 57) % (W - 160), 160 + (i * 89) % (H - 320), { steps: 3 }); };
  let n = 0;
  return [
    async () => { await drag(); await w(500); await hover(); await drag(); },
    async () => {
      await page.keyboard.press('KeyI'); await w(1200);
      const e = await ev(() => window.__pvInv.entries());
      const acc = (e || []).filter((i) => i.category === 'ACESSORIOS' && i.state !== 'locked');
      const top = (e || []).filter((i) => i.category === 'ROUPAS' && i.state !== 'locked' && i.slot === 'TORSO');
      const pick = (a) => a.length ? a[n++ % a.length].key : null;
      for (const k of [pick(acc), pick(top), pick(acc)].filter(Boolean)) { await ev((key) => window.__pvInv.inv.select(key), k); await w(700); await ev((key) => window.__pvInv.inv.equip(key), k); await w(900); }
      const a2 = pick(acc); if (a2) await ev((key) => window.__pvInv.inv.unequip(key), a2);
      await w(600); await page.keyboard.press('Escape'); await w(800);
    },
    async () => { for (const k of ['Digit1', 'Digit2', 'Digit3']) { await page.keyboard.press(k); await w(1500); await page.keyboard.press(k); await w(800); } },
    async () => { await page.keyboard.press('Escape'); await w(800); await page.keyboard.press('Escape'); await w(500); await page.keyboard.press('Escape'); await w(500); },
  ];
}

const steps = [
  // zonas e multidão
  ...zones.map((z) => async () => { const [x, zz, h] = along(z.anchor?.t ?? (z.from + z.to) / 2, 10); await ev((x, z, h) => window.__pv.teleport(x, z, h), x, zz, h); }),
  async () => { await ev((x, z) => window.__pv.teleport(x, z, 0), trio.x - 15, trio.z); await ev(() => window.__pv.act('dance_party')); },
  async () => { await ev(() => window.__pv.prop('flag_large', 'brasil')); await w(500); await ev(() => window.__pv.act('flag_wave')); await ev(() => window.__pv.press('KeyW', 4000)); },
  async () => { await ev(() => window.__pv.prop('sign_small', 'democracia')); await w(500); await ev(() => window.__pv.act('sign_raise')); },
  async () => { await ev(() => window.__pv.prop(null)); await ev(() => window.__pv.act('clap')); },
  // bicicleta: vai até a mais próxima, entra, anda, sai
  async () => {
    const v = await ev(() => { const p = window.__pv.metrics().player; return window.__pv.vehicles('all').filter((i) => i.kind === 'bicycle' && !i.occupant).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; });
    if (v && !v.err) {
      await ev((x, z) => window.__pv.teleport(x + 1.2, z, 0), v.x, v.z); await w(1500);
      await ev((id) => window.__pv.rawEnter(id), v.id); await w(1500);
      await ev(() => window.__pv.press('KeyW', 3000)); await w(3500);
      await ev(() => window.__pv.key('KeyE')); await w(1500);
    }
  },
  // trio: pé da escada, sobe, desce
  async () => {
    const ladder = await ev(() => window.__pv.vehicles('trio')[0]);
    if (ladder && !ladder.err) {
      await ev((x, z, h) => window.__pv.teleport(x - Math.sin(h) * 7.6, z - Math.cos(h) * 7.6, h), ladder.x, ladder.z, ladder.heading); await w(1500);
      await ev(() => window.__pv.key('KeyE')); await w(3000); await ev(() => window.__pv.act('arms_up')); await w(3000);
      await ev(() => window.__pv.key('KeyE')); await w(2000);
    }
  },
  // pichação: abre o editor numa superfície e fecha
  async () => {
    const s = await ev(() => { const p = window.__pv.metrics().player; return window.__pv.gf?.surfacesNear(p.x, p.z, 120)?.[0]; });
    if (s && !s.err) { await ev((f) => window.__pv.teleport(f[0], f[1], 0), s.front); await w(1500); await ev(() => window.__pv.gf.open()); await w(2500); await ev(() => window.__pv.gf.close()); }
  },
  // chat (rodada 8, se existir)
  async () => { await ev((t) => { const c = window.__pv.chat?.(); c?.type?.(t, 'geral'); }, `passando pela avenida ${Date.now() % 1000}`); },
  // espectador simultâneo (outra página): troca de câmera 1–6
  async () => { if (spec) await spec.evaluate((k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${k}`, key: String(k) })), 1 + (k % 6)).catch(() => {}); },
  ...(R9 ? r9Steps() : []),
  ...(R10 ? r10Steps() : []),
  ...(R11 ? r11Steps() : []),
  // longe de tudo (descarrega multidão/LOD) e volta
  async () => { const [x, z, h] = along(0.05, 0); await ev((x, z, h) => window.__pv.teleport(x, z, h), x, z, h); },
];

// rodada 9.1: heap snapshot + livro-razão agrupado nos minutos de SOAK_SNAP
const SNAPS = (process.env.SOAK_SNAP ?? '').split(',').filter(Boolean).map(Number);
const snapshot = async (min) => {
  const gpu = await page.evaluate(() => {
    const L = window.__pvGpuLedger; const hist = {};
    if (L) for (const [kind, m] of [['tex', L.textures], ['buf', L.buffers], ['rb', L.renderbuffers]]) for (const o of m.values()) {
      const k = kind === 'buf' ? `buf:${o.fmt}:${o.bytes < 4096 ? '<4K' : o.bytes < 65536 ? '<64K' : o.bytes < 1048576 ? '<1M' : '>=1M'}` : `${kind}:${o.w}x${o.h}x${o.d}:${o.fmt}${o.mip ? ':mip' : ''}`;
      const h = (hist[k] ??= { n: 0, bytes: 0 }); h.n++; h.bytes += o.bytes;
    }
    const r = window.__pv.memoryReport(false);
    // personagens remotos (vivos e no pool): malhas, esqueletos distintos e peças por LOD
    const human = (v) => { const h = v?.human; if (!h) return null; return { lods: h.lods.map((i) => (i ? { meshes: i.meshes.length, skels: new Set(i.meshes.map((m) => m.skeleton)).size, parts: i.parts.length, children: i.group.children.length, loads: i.pieceLoads.size } : null)) }; };
    const net = window.__pvEvents?.net;
    const avatars = net ? { pool: [...net.pool].map(([b, l]) => [b, l.map(human)]), remotes: [...net.remotes.values()].filter((x) => x.visual).slice(0, 12).map((x) => human(x.visual)), self: null } : null;
    return { hist, ledger: r.ledger, categories: r.categories, renderer: r.renderer, totals: r.totals, leaks: window.__pvLeakTrack?.() ?? null, avatars };
  }).catch((e) => ({ err: e.message }));
  writeFileSync(`screenshots/soak/${TAG}_${min}.gpu.json`, JSON.stringify(gpu, null, 1));
  if (process.env.SOAK_HEAPSNAP === '0') return;
  const chunks = [];
  const onChunk = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  writeFileSync(`screenshots/soak/${TAG}_${min}.heapsnapshot`, chunks.join(''));
  console.log(`[soak] snapshot ${min} min gravado`);
};

const t0 = Date.now();
const samples = [{ t: 0, ...(await heap()) }];
console.log(`[soak] início: heap ${samples[0].usedMB} MB, GPU ${samples[0].gpuMB} MB`);
let k = 0, nextSample = SAMPLE_S * 1000;
while (Date.now() - t0 < MIN * 60_000) {
  lastStep = k % steps.length; await steps[k++ % steps.length]();
  await w(6000);
  if (Date.now() - t0 >= nextSample) {
    const s = { t: Math.round((Date.now() - t0) / 1000), ...(await heap()) };
    samples.push(s);
    nextSample += SAMPLE_S * 1000;
    if (SNAPS.includes(Math.round(s.t / 60))) await snapshot(Math.round(s.t / 60));
    console.log(`[soak] ${(s.t / 60).toFixed(1)} min: heap ${s.usedMB} MB · GPU ${s.gpuMB} MB · ${s.fps} FPS · ${s.humans} humanos`);
  }
}
// inclinação por mínimos quadrados (MB/min) num intervalo de minutos
const slope = (from, to, key = 'usedMB') => {
  const pts = samples.filter((s) => s.t / 60 >= from && s.t / 60 <= to && typeof s[key] === 'number');
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.t / 60), ys = pts.map((p) => p[key]);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return +(num / den).toFixed(3);
};
const gpuVals = samples.map((s) => s.gpuMB).filter((x) => x !== null);
const summary = {
  minutes: MIN, bots: BOTS, samples: samples.length, errors: errors.slice(0, 10), reloads,
  heap: { first: samples[0].usedMB, last: samples.at(-1).usedMB, min: Math.min(...samples.map((s) => s.usedMB)), max: Math.max(...samples.map((s) => s.usedMB)) },
  slopeMBperMin: { total: slope(0, MIN), first20: slope(0, 20), last30: slope(Math.max(0, MIN - 30), MIN) },
  // rodada 9.1: inclinações por minuto nos últimos 15 e 20 min (heap, GPU, GPU sem os alvos da resolução dinâmica, nós)
  slopesPerMin: Object.fromEntries([15, 20].map((n) => [`last${n}`, Object.fromEntries(['usedMB', 'gpuMB', 'gpuNoPostMB', 'nodes'].map((k) => [k, slope(Math.max(0, MIN - n), MIN, k)]))])),
  gpu: { first: gpuVals[0] ?? null, last: gpuVals.at(-1) ?? null, max: gpuVals.length ? Math.max(...gpuVals) : null },
  ...(R9 ? { r9: Object.fromEntries(['pointerLock', 'escLayers', 'invOpen', 'rawMB', 'listeners', 'nodes', 'intervals', 'ragdolls', 'remotes', 'items', 'srvHeapMB', 'srvRssMB', 'srvWs', 'srvPlayers', 'srvTickMs'].map((k) => { const v = samples.map((s) => s[k]).filter((x) => typeof x === 'number'); return [k, v.length ? { first: v[0], last: v.at(-1), min: Math.min(...v), max: Math.max(...v) } : null]; })) } : {}),
};
summary.verdict = summary.slopeMBperMin.last30 !== null && Math.abs(summary.slopeMBperMin.last30) < 0.1 ? 'ESTABILIZOU (aquecimento de cache)' : 'CONTINUA CRESCENDO — investigar';
writeFileSync(`screenshots/soak/${TAG}.json`, JSON.stringify({ summary, samples }, null, 1));
console.log(JSON.stringify(summary, null, 1));
await b.close();
cleanup();
process.exit(0);
