/**
 * Rodada 9 — PALCO DE DEBATE no multiplayer: 3 jogadores reais (um navegador cada) perto do palco (stage0).
 *  painel abre sozinho na plateia · A e B entram na fila pelo botão · A fala no turno (campo só no turno) · B (fora da
 *  vez) forja dbt_say → recusado, ninguém recebe · C assiste e reage pelos botões (gesto do personagem; plateia NPC
 *  reage) · rajada de reações limitada · o relógio passa a vez para B · C denuncia a fala de A (Report no servidor)
 *  · "Acontecendo agora" + AGENDA (alimentador LOCAL da agenda: o agendador é de outro agente) · telão com evento.
 * Capturas (docs/screenshots/round9/): O_acontecendo_agora, P_agenda, U_debate, V_plateia, Y_telao_evento.
 * Servidor de teste próprio (PV_TEST=1, PV_STORE=memory, porta PV_DEBATE_PORT ou 3002, dados tests/fixtures/debate_qa.json).
 * uso: node tools/qa/debate_mp.mjs [baseUrl]   (requer o vite: PV_API=… npx vite --port 5305)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:5305';
const PORT = Number(process.env.PV_DEBATE_PORT ?? 3002);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'docs/screenshots/round9';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };

const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: 'server', detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_DEBATE_FILE: fileURLToPath(new URL('../../tests/fixtures/debate_qa.json', import.meta.url)) },
});
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
server.stderr.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
const killServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* já saiu */ } };
process.on('exit', killServer);
for (let i = 0; i < 150 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

const browsers = [];
const closeAll = async () => { await Promise.allSettled(browsers.map((b) => b.close())); killServer(); };
process.on('SIGINT', async () => { await closeAll(); process.exit(130); });

/** frente do palco stage0 (manifest 593.52, −143.25, rumo 4.97): o palco olha para (−0,967, 0,256) */
const ST = { x: 593.52, z: -143.25, h: 4.97 };
const F = { x: Math.sin(ST.h), z: Math.cos(ST.h) };
const front = (d, lat = 0) => [ST.x + F.x * d + F.z * lat, ST.z + F.z * d - F.x * lat];

async function open(name, sp, vp = { width: 800, height: 500 }) {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: vp });
  browsers.push(browser);
  const p = await browser.newPage();
  p.on('pageerror', (e) => console.log(`[${name}] ERR`, e.message));
  await p.goto(`${base}/?autostart=1&quality=low&time=16:40&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${sp[0].toFixed(1)},${sp[1].toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvR9', { timeout: 120000 });
  // registra o que este cliente manda (prova de que o botão da agenda/painel enviou a mensagem certa)
  await p.evaluate(() => {
    const n = window.__pvR9.debate.net; window.__sent = []; const s = n.send.bind(n); n.send = (t, m) => { window.__sent.push([t, m]); s(t, m); };
    window.__adsLog = []; n.on('ads', (m) => { for (const x of m.slots) if (x.id === 'STAGE_SCREEN_01') window.__adsLog.push([Math.round(performance.now() / 100) / 10, x.c?.kind]); });
  });
  return p;
}
const ev = (p, fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(150); } return null; };
const dinfo = (p) => ev(p, () => window.__pvR9.debate.info());
const click = (p, sel) => ev(p, (s) => { const b = document.querySelector(s); if (!b || b.disabled || b.hidden) return false; b.click(); return true; }, sel);
const shot = async (p, file) => { mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 86 }); console.log(`   captura ${OUT}/${file}.jpg`); };

try {
  const A = await open('Ana', front(9, 1.5), { width: 1280, height: 720 });
  const B = await open('Bruno', front(10, -2.5));
  const C = await open('Carla', front(16, 4), { width: 1280, height: 720 });
  for (const p of [A, B, C]) await ev(p, () => window.__pv.camera(Math.PI * 0.62, 0.22, 11));

  // ---- plateia por proximidade: painel abre sozinho (estado `dbt` só para quem está perto)
  const opened = await until(async () => (await Promise.all([A, B, C].map(dinfo))).every((i) => i.open && i.state?.active));
  const iA = await dinfo(A);
  check('painel do debate abre sozinho perto do palco (A, B, C)', !!opened, `tema "${iA.state?.topic}", turno ${iA.state?.turnSeconds} s (dados)`);

  // ---- fila pelos botões (A depois B): servidor decide a ordem e os lugares
  check('A clica "Entrar na fila"', await click(A, '.debate-panel .dp-q'));
  await until(async () => (await dinfo(A)).me?.speaking);
  check('B clica "Entrar na fila"', await click(B, '.debate-panel .dp-q'));
  const st1 = await until(async () => { const s = (await dinfo(C)).state; return s?.speaker === 'Ana' && s.queue[0] === 'Bruno' ? s : null; });
  check('servidor: A fala, B é o 1º da fila; lugares no palco', !!st1, st1 ? `lugares ${JSON.stringify(st1.seats)}` : '');
  const meB = (await dinfo(B)).me;
  check('B vê a própria posição (1º) e não tem campo de texto', meB?.pos === 1 && (await ev(B, () => document.querySelector('.dp-form').hidden)), JSON.stringify(meB));
  check('A (orador) tem o campo de texto e a contagem regressiva', !(await ev(A, () => document.querySelector('.dp-form').hidden)) && /\d\d:\d\d/.test(await ev(A, () => document.querySelector('.dp-time').textContent)));

  // ---- A fala pelo campo (Enter)
  const LINE = 'Proposta: mais árvores e bebedouros ao longo da avenida';
  await ev(A, (t) => { const f = document.querySelector('.dp-field'); f.value = t; f.form.requestSubmit(); }, LINE);
  const gotC = await until(async () => (await dinfo(C)).shown.includes(LINE));
  check('A fala no turno → C (plateia) recebe a fala', !!gotC);
  await ev(A, () => { const f = document.querySelector('.dp-field'); f.value = 'E sombra nos pontos de ônibus'; f.form.requestSubmit(); });
  await until(async () => (await dinfo(C)).shown.includes('E sombra nos pontos de ônibus'));

  // ---- B forja dbt_say fora da vez
  await ev(B, (inst) => window.__pvR9.debate.net.send('dbt_say', { inst, text: 'Fala forjada fora da vez' }), st1?.inst);
  await w(1200);
  const notesB = await ev(B, () => document.querySelector('.dp-note').textContent);
  check('B (não é a vez) manda dbt_say forjado → recusado e ninguém recebe', !(await dinfo(C)).shown.includes('Fala forjada fora da vez') && /vez/.test(notesB), notesB);

  // ---- C reage pelos botões; o personagem faz o gesto; a plateia NPC reage
  const npc0 = (await ev(A, () => window.__pvR9.info().stage?.npcReactions)) ?? 0;
  for (const s of ['.dp-aplauso', '.dp-aplauso', '.dp-positiva', '.dp-aplauso']) { await click(C, s); await w(250); }
  // captura V (plateia) logo após as reações: câmera atrás da multidão, olhando o palco; painel com as reações
  {
    const [px, pz] = front(23, 7), [tx, tz] = front(7, -1);
    await w(500);
    await ev(C, (q) => window.__pv.lookFrom(q.px, 3.4, q.pz, q.tx, 1.4, q.tz), { px, pz, tx, tz });
    await C.mouse.move(500, 300); await C.mouse.move(520, 320);
    await w(500);
    await shot(C, 'V_plateia');
    await ev(C, () => window.__pv.lookFrom());
  }
  const r1 = await until(async () => { const s = (await dinfo(A)).state; return s && s.reactions.aplauso + s.reactions.positiva >= 4 ? s.reactions : null; });
  check('C reage (3 aplausos + 1 positiva) → contagem agregada do turno para a plateia', !!r1 && r1.aplauso === 3 && r1.positiva === 1, JSON.stringify(r1));
  const summary = await ev(A, () => document.querySelector('.dp-reacts').textContent);
  check('texto "reações da plateia" (nunca resultado/votação)', /^reações da plateia: 3 aplausos · 1 positiva · 0 negativas$/.test(summary) && !/venc|ganh|vot|placar|resultado/i.test(summary), summary);
  const act = await until(async () => { const s = await ev(C, () => window.__pv.social()); return s?.server?.act ? s : null; }, 3000);
  check('personagem de C faz o gesto (ação social existente, validada pelo servidor)', !!act, JSON.stringify(act?.server));
  const npc1 = await until(async () => { const n = await ev(A, () => window.__pvR9.info().stage?.npcReactions); return n > npc0 ? n : null; }, 4000);
  check('plateia NPC perto do palco reage (local, determinística)', !!npc1, `NPCs reagindo: ${npc1 ?? 0}`);

  // captura U (debate): A no turno, painel com tema, orador, relógio, fila e falas
  await ev(A, () => window.__pv.camera(Math.PI * 0.55, 0.2, 9));
  await w(600);
  await shot(A, 'U_debate');

  // ---- rajada de reações forjada: limite por minuto (dados: 8)
  await ev(C, (inst) => { for (let i = 0; i < 30; i++) window.__pvR9.debate.net.send('dbt_react', { inst, r: 'negativa' }); }, st1?.inst);
  await w(1500);
  const r2 = (await dinfo(A)).state.reactions;
  const tot = r2.aplauso + r2.positiva + r2.negativa;
  check('rajada de 30 reações forjadas → só até reactionsPerMin (8) contam', tot === 8, JSON.stringify(r2));

  // ---- denúncia: C denuncia a fala de A pelo menu da fala
  const opened2 = await ev(C, (t) => { const li = [...document.querySelectorAll('.dp-line')].find((l) => l.querySelector('.dp-text').textContent === t); li?.querySelector('.dp-more').click(); return !!li; }, LINE);
  const clicked = opened2 && await click(C, '.dp-menu button');
  const rep = await until(async () => { const n = await ev(C, () => document.querySelector('.dp-note').textContent); return /Denúncia registrada/.test(n) ? n : null; });
  await w(300);
  check('C denuncia a fala de A pelo menu → servidor registra (DEBATE_LINE)', clicked && !!rep && log.some((l) => /\[debate\] denúncia .* da fala d/.test(l)), log.find((l) => l.includes('[debate] denúncia')) ?? '');

  // ---- o relógio passa a vez para B (turno dos dados + pausa)
  const st2 = await until(async () => { const s = (await dinfo(C)).state; return s?.speaker === 'Bruno' ? s : null; }, 32000);
  check('o tempo do turno acaba → B fala (A sai do palco)', !!st2 && st2.reactions.aplauso === 0, st2 ? `turno ${st2.turn}` : '');
  check('B agora tem o campo de texto; A não', !(await ev(B, () => document.querySelector('.dp-form').hidden)) && (await ev(A, () => document.querySelector('.dp-form').hidden)));
  await ev(B, () => { const f = document.querySelector('.dp-field'); f.value = 'Concordo com a sombra; também mais banheiros públicos'; f.form.requestSubmit(); });
  check('B fala no turno dele → A recebe', !!(await until(async () => (await dinfo(A)).shown.includes('Concordo com a sombra; também mais banheiros públicos'))));

  // ---- "Acontecendo agora" + AGENDA (alimentador LOCAL — o agendador/mensagem `agenda` é de outro agente)
  await ev(A, () => {
    const now = window.__pvR9.feed.now();
    const E = (o) => ({ id: o.inst.split('@')[0], endsAt: now + 900_000, count: 0, capacity: 0, ...o });
    window.__pvR9.feed.apply({ list: [
      E({ inst: 'debate_palco@1', format: 'debate', name: 'Debate no palco', zone: 'RIO_BRANCO', state: 'ACTIVE', startsAt: now - 120_000, count: 2, capacity: 20 }),
      E({ inst: 'caminhada@1', format: 'caminhada', name: 'Caminhada', zone: 'CENTRAL', state: 'SCHEDULED', startsAt: now + 222_000 }),
      E({ inst: 'corrida@1', format: 'corrida', name: 'Corrida de bicicleta', zone: 'CENTRO', state: 'REGISTRATION', startsAt: now + 480_000, count: 9, capacity: 20 }),
      E({ inst: 'trio@1', format: 'show', name: 'Trio', zone: 'CAMPO_DE_SANTANA', state: 'ACTIVE', startsAt: now - 600_000 }),
      E({ inst: 'encontro@1', format: 'encontro', name: 'Encontro na Candelária', zone: 'CANDELARIA', state: 'SCHEDULED', startsAt: now + 40 * 60_000 }),
      E({ inst: 'patinete@0', format: 'corrida', name: 'Corrida de patinete', zone: 'CENTRO', state: 'FINISHED', startsAt: now - 1_500_000, endsAt: now - 600_000, count: 6, capacity: 12 }),
    ] });
  });
  await w(400);
  const nh = await ev(A, () => [...document.querySelectorAll('.nh-row:not([hidden])')].map((r) => r.textContent));
  check('"Acontecendo agora": 3 itens relevantes (acontecendo, inscrições n/cap)', nh.length === 3 && nh.some((t) => /inscrições 9\/20/.test(t)) && nh.some((t) => /acontecendo/.test(t)), JSON.stringify(nh));
  const t0 = await ev(A, () => window.__pvR9.now.renders);
  await w(2100);
  const t1 = await ev(A, () => window.__pvR9.now.renders);
  check('"Acontecendo agora" atualiza a ≤ 1 Hz (sem DOM por quadro)', t1 - t0 >= 1 && t1 - t0 <= 3, `${t1 - t0} renderizações em 2,1 s`);
  await ev(A, () => { window.__pvR9.debate.toggle(false); window.__pv.camera(Math.PI * 0.62, 0.24, 13); });
  await w(700);
  await A.mouse.move(600, 300); await A.mouse.move(640, 340); // HUD aparece (auto-ocultar)
  await w(500);
  await shot(A, 'O_acontecendo_agora');
  // clique num item → direção: alvo no minimapa (mapa expandido) + aviso com distância
  await click(A, '.nh-row:not([hidden])');
  await w(500);
  const tgt = await ev(A, () => ({ target: window.__pvR9.map.target(), expanded: window.__pvR9.map.expanded(), flash: document.querySelector('.hud-status').textContent, me: window.__pv.metrics().player }));
  const first = nh[0]?.match(/^[A-ZÀ-Ü ]+[A-ZÀ-Ü]/)?.[0] ?? '?';
  check('clique em "Acontecendo agora" → direção: alvo no minimapa expandido + distância (sem teleporte)', tgt.target?.label === first && tgt.expanded && tgt.flash.startsWith(first) && / m daqui|já está aqui/.test(tgt.flash) && Math.hypot(tgt.me.x - 585, tgt.me.z + 139.5) < 20, JSON.stringify(tgt));
  await ev(A, () => window.__pvR9.debate.toggle(false));
  // AGENDA pelo menu ☰
  await click(A, '.hud-btns .hud-icon[aria-label="Menu"]');
  const menuOk = await ev(A, () => { const b = [...document.querySelectorAll('.hud-menu button')].find((x) => x.textContent === 'Agenda da avenida'); b?.click(); return !!b; });
  await w(500);
  const ap = await ev(A, () => ({ open: !document.querySelector('.agenda-panel').hidden, now: document.querySelectorAll('.ap-sec:nth-of-type(1) .ap-item:not([hidden])').length, rows: [...document.querySelectorAll('.agenda-panel .ap-item:not([hidden])')].map((i) => i.textContent) }));
  check('AGENDA DA AVENIDA pelo menu: agora / a seguir / encerrados', menuOk && ap.open && ap.rows.length === 6, JSON.stringify(ap.rows));
  // agenda LOCAL (sem agendador nesta sala): o botão não envia evt_join (mensagem sem handler derrubaria a conexão)
  const sent0 = await ev(A, () => { const li = [...document.querySelectorAll('.ap-item')].find((i) => /CORRIDA DE BICICLETA/.test(i.textContent)); li?.querySelector('.ap-join:not([disabled])')?.click(); return { sent: window.__sent.filter(([t]) => t === 'evt_join'), flash: document.querySelector('.hud-status').textContent }; });
  check('"Participar" com agenda sem servidor → nada enviado, aviso claro', sent0.sent.length === 0 && /indisponíveis/.test(sent0.flash), JSON.stringify(sent0));
  // com agenda vinda do servidor (simulada no transporte) → evt_join {inst}; o servidor decide (evt_res)
  const sent = await ev(A, () => {
    const f = window.__pvR9.feed, real = f.net, out = [];
    f.net = { send: (t, m) => out.push([t, m]), on() {} }; f.serverDriven = true;
    const li = [...document.querySelectorAll('.ap-item')].find((i) => /CORRIDA DE BICICLETA/.test(i.textContent)); li?.querySelector('.ap-join:not([disabled])')?.click();
    f.net = real; f.serverDriven = false;
    return out;
  });
  check('botão "Participar" (agenda do servidor) manda evt_join {inst}', sent.length === 1 && sent[0][0] === 'evt_join' && sent[0][1].inst === 'corrida@1', JSON.stringify(sent));
  await ev(A, () => window.__pvR9.map.close());
  await w(300);
  await A.mouse.move(640, 360); await A.mouse.move(700, 380); // HUD aparece (auto-ocultar)
  await w(400);
  await shot(A, 'P_agenda');
  await ev(A, () => window.__pvR9.agenda.toggle(false));

  // ---- telão do palco com o EVENTO da agenda (AdSlot STAGE_SCREEN_01: conteúdo interno, servidor escolhe)
  const scr = await until(async () => { const l = await ev(A, () => window.__pvR9.screens()); return l.find((s) => s.id === 'stage0' && s.slide === 'event') ? l : null; }, 90000);
  const adsA = await ev(A, () => window.__pvR9.info().ads);
  if (!scr) console.log('   telões:', JSON.stringify(await ev(A, () => window.__pvR9.screens())), JSON.stringify(adsA?.STAGE_SCREEN_01), JSON.stringify(await ev(A, () => window.__adsLog)));
  check('telão do palco mostra o evento da agenda (slide "event"); painéis de LED com texto interno', !!scr && Object.values(adsA).every((c) => !c || ['SYSTEM', 'EVENT', 'CAMPAIGN'].includes(c.kind)), JSON.stringify(scr));
  const [cx, cz] = front(15, 1.5);
  await ev(A, (p) => window.__pv.lookFrom(p.cx, 4.4, p.cz, p.x, 5.4, p.z), { cx, cz, x: ST.x, z: ST.z });
  await w(1200);
  await shot(A, 'Y_telao_evento');
  await ev(A, () => window.__pv.lookFrom());

  // ---- sair da plateia: longe do palco o painel fecha (dbt_bye)
  const [fx, fz] = front(105, -2);
  await ev(B, (p) => window.__pv.walkTo(p.fx, p.fz, true), { fx, fz });
  const closed = await until(async () => !(await dinfo(B)).open, 30000);
  check('B sai de perto do palco → sai da plateia (painel fecha)', !!closed);
} catch (e) {
  console.log('falhou:', e);
  results.push({ name: 'execução', ok: false });
} finally {
  await closeAll();
}
const errs = log.filter((l) => /Error|exception|    at /.test(l));
if (errs.length) console.log('servidor — erros:\n' + errs.slice(0, 20).join('\n'));
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} verificações OK`);
process.exit(ok === results.length ? 0 : 1);
