/**
 * Rodada 11 — INVENTÁRIO no multiplayer real: servidor de teste (PV_TEST=1, banco em memória) e DOIS navegadores
 * (A troca pelo inventário/acesso rápido; B confere o que vê de A). Mede:
 *   - abrir/fechar o inventário 100× (CDP Memory.getDOMCounters: nós e ouvintes JS; heap; renderer do jogo e prévias
 *     vivas; __pv.memoryReport antes/depois)
 *   - 20 prévias de roupa + 20 de acessório em sequência (um renderer só; memória do renderer da prévia estável)
 *   - B vê em A a roupa, o acessório, o item na mão e a torcida trocados pelo inventário; HUD = mão = servidor = avatar
 *   - título ganho (conquista BOA CONVERSA) equipado pelo inventário → painel da pessoa em B mostra título e nível
 * Capturas em docs/screenshots/round11/ (J…P, H, I); resumo em docs/bench/round11_inventory.json.
 * uso: PV_API=http://127.0.0.1:3821 npx vite --port 5202 --strictPort  →  node tools/qa/inventory_mp.mjs [http://localhost:5202]
 *      PV_INV_PORT (padrão 3820; API em 3821)
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5202';
const PORT = Number(process.env.PV_INV_PORT ?? 3820);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = 'docs/screenshots/round11';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const procs = [], browsers = [];
const cleanup = async () => {
  await Promise.allSettled(browsers.map((b) => b.close()));
  for (const p of procs) { try { process.kill(-p.pid, 'SIGTERM'); } catch { /* */ } }
};
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });
mkdirSync(SHOTS, { recursive: true }); mkdirSync('docs/bench', { recursive: true });

// ponto de partida: perto da Central, A e B lado a lado
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const sp = manifest.spawn.p;
const SA = [sp[0] + 2, sp[1] + 2], SB = [sp[0] + 5.5, sp[1] + 3.5];

// ---------------------------------------------------------------- servidor
try { await fetch(`http://127.0.0.1:${PORT + 1}/api/health`); console.error(`porta ${PORT} ocupada`); process.exit(2); } catch { /* livre */ }
const S = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
procs.push(S);
S.log = [];
S.stdout.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
S.stderr.on('data', (d) => S.log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 150 && !S.log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);

async function open(name, at, vp = { width: 1366, height: 820 }) {
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--enable-precise-memory-info'], defaultViewport: vp });
  browsers.push(b);
  const p = await b.newPage();
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(`${base}/?autostart=1&welcome=0&quality=medium&time=10:30&mp=ws://127.0.0.1:${PORT}&name=${name}&spawn=${at[0].toFixed(1)},${at[1].toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvInv', { timeout: 150000 });
  p.cdp = await p.createCDPSession();
  return p;
}
const E = (p, fn, ...a) => p.evaluate(fn, ...a);
const counters = async (p) => {
  await p.cdp.send('HeapProfiler.collectGarbage');
  const c = await p.cdp.send('Memory.getDOMCounters');
  const heap = await E(p, () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null));
  const m = await E(p, () => { const r = window.__pv.memoryReport(false); return { renderer: r.renderer, materials: r.totals.materials, textures: r.totals.textures, geometries: r.totals.geometries }; });
  const pv = await E(p, () => window.__pvInv.info().preview);
  return { nodes: c.nodes, listeners: c.jsEventListeners, documents: c.documents, heapMB: heap, game: m, preview: pv };
};
const statusText = (p) => E(p, () => document.querySelector('.hud-status')?.textContent ?? '');

const out = { date: new Date().toISOString(), port: PORT };
try {
  const A = await open('Ana', SA);
  const B = await open('Bruno', SB);
  await w(2500);
  const nameOf = async (p, n) => (await E(p, () => window.__pvInv.players())).find((x) => x.name === n);
  check('B vê A na rede', !!(await nameOf(B, 'Ana')));

  // ---------------------------------------------------------------- catálogo real (contagens por categoria)
  await E(A, () => window.__pvInv.inv.openPanel());
  await w(400);
  const info0 = await E(A, () => window.__pvInv.info());
  out.categories = info0.byCat;
  check('categorias só com conteúdo', JSON.stringify(info0.panel.cats) === JSON.stringify(['ROUPAS', 'ACESSORIOS', 'ITENS', 'MANIFESTACAO', 'BANDEIRAS', 'EQUIPAMENTOS', 'VEICULOS', 'TORCIDA', 'TITULOS']), info0.panel.cats.join(','));
  // o mundo não pausa: quadros continuam sendo desenhados com o painel aberto
  const fr = await E(A, async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return n; });
  check('o mundo não pausa com o inventário aberto', fr > 10, `${fr} quadros em 1 s`);
  await E(A, () => window.__pvInv.inv.close());
  // tecla I abre, Esc (pilha única) fecha
  await A.keyboard.press('KeyI');
  await w(500);
  const byKey = await E(A, () => window.__pvInv.inv.open);
  await A.keyboard.press('Escape');
  await w(400);
  check('I abre e Esc fecha o inventário', byKey && !(await E(A, () => window.__pvInv.inv.open)));

  // ---------------------------------------------------------------- 100 ciclos abrir/fechar
  await E(A, () => { window.__pvInv.inv.openPanel(); window.__pvInv.inv.close(); }); // aquece (chunk/CSS/GLB)
  await w(1500);
  const cycles = async () => {
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      await E(A, () => window.__pvInv.inv.openPanel());
      await E(A, () => new Promise((r) => requestAnimationFrame(() => r())));
      await E(A, () => window.__pvInv.inv.close());
    }
    await w(1500);
    return Date.now() - t0;
  };
  // controle: o mundo sozinho (streaming, multidão, o outro jogador) no mesmo tempo, sem abrir nada
  const idle0 = await counters(A);
  const c0ms = await cycles(); // 1ª leva: aquece caches compartilhados (peças/texturas do personagem)
  const idleA = await counters(A);
  await w(c0ms); // controle ANTES: mesmo tempo sem abrir nada
  const before = await counters(A);
  const ms = await cycles(); // 2ª leva: medida
  const after = await counters(A);
  await w(ms);
  const idle1 = await counters(A);
  await cycles(); // 3ª leva: um vazamento por abertura cresceria de novo aqui
  const after3 = await counters(A);
  out.cycles100 = { warmup: { from: idle0, ms: c0ms }, idleBefore: idleA, before, after, ms, idleAfterSameTime: idle1, after3 };
  const g = (x) => x.game.renderer.textures + x.game.materials;
  const drift = Math.max(g(before) - g(idleA), g(idle1) - g(after));
  check('100× abrir/fechar: ouvintes JS estáveis', after.listeners - before.listeners <= 2, `${before.listeners} → ${after.listeners}`);
  check('100× abrir/fechar: nós DOM estáveis (sem órfãos)', after.nodes - before.nodes <= 60, `${before.nodes} → ${after.nodes}`);
  check('100× abrir/fechar: nenhum handle vivo; renderer da prévia reutilizado (≤ 1)', after.preview.live === 0 && after.preview.created - before.preview.created === 100 && (after.preview.memory?.renderersLive ?? 0) <= 1 && after.preview.memory.renderersCreated - before.preview.memory.renderersCreated <= 1, `handles ${after.preview.created - before.preview.created}, vivos ${after.preview.live}, renderers criados ${before.preview.memory?.renderersCreated}→${after.preview.memory?.renderersCreated}`);
  const rr = (x) => x.game.renderer;
  // o renderer do JOGO cresce com o mundo (multidão/chão em streaming) mesmo parado — a sonda tools/qa/inventory_probe.mjs
  // separa: parado +0…+17, 100 ciclos COM prévia +1, sem prévia +8 (docs/bench/round11_inventory_probe.json). Aqui: programas iguais
  check('100× abrir/fechar: renderer do jogo sem programas novos (texturas: ver sonda)', rr(after3).programs === rr(idle1).programs, `3ª leva ${JSON.stringify(rr(idle1))} → ${JSON.stringify(rr(after3))}; deriva do mundo parado ${drift}; `+ `aquecimento ${JSON.stringify(idle0.game.renderer)} → ${JSON.stringify(before.game.renderer)}; medida → ${JSON.stringify(after.game.renderer)}`);
  check('100× abrir/fechar: materiais/texturas da cena (informativo)', true, `mat ${before.game.materials}→${after.game.materials} tex ${before.game.textures}→${after.game.textures} (aquecimento mat ${idle0.game.materials}→${before.game.materials})`);
  check('100× abrir/fechar: heap estável', after.heapMB - before.heapMB < 15, `${before.heapMB} → ${after.heapMB} MB`);

  // ---------------------------------------------------------------- 40 prévias (20 roupas + 20 acessórios)
  await E(A, () => window.__pvInv.inv.openPanel());
  await E(A, () => window.__pvInv.inv.panel.setCategory('ROUPAS'));
  await w(2500);
  const roupas = (await E(A, () => window.__pvInv.entries())).filter((e) => e.category === 'ROUPAS').slice(0, 20).map((e) => e.key);
  const accs = (await E(A, () => window.__pvInv.entries())).filter((e) => e.category === 'ACESSORIOS').map((e) => e.key);
  const pv0 = await E(A, () => window.__pvInv.info().preview);
  const c0 = await counters(A);
  const memSeries = [];
  const round = async () => {
    await E(A, () => window.__pvInv.inv.panel.setCategory('ROUPAS'));
    for (const k of roupas) { await E(A, (key) => window.__pvInv.inv.select(key), k); await w(300); memSeries.push((await E(A, () => window.__pvInv.info().preview.memory))); }
    await E(A, () => window.__pvInv.inv.panel.setCategory('ACESSORIOS'));
    for (let i = 0; i < 20; i++) { await E(A, (key) => window.__pvInv.inv.select(key), accs[i % accs.length]); await w(300); memSeries.push((await E(A, () => window.__pvInv.info().preview.memory))); }
  };
  await round(); // 1ª: peças entram no cache (uma vez)
  const r1 = memSeries.at(-1);
  await round(); // 2ª: as mesmas 40 — nada pode crescer
  const c1 = await counters(A);
  const pv1 = await E(A, () => window.__pvInv.info().preview);
  const ml = memSeries.at(-1);
  out.previews40 = { roupas: roupas.length, acessorios: 20, distinctAccessories: accs.length, before: c0, after: c1, previewMemory: { first: memSeries[0], afterRound1: r1, afterRound2: ml } };
  check('40 prévias (×2): um renderer só, um handle', pv1.created === pv0.created && pv1.live === 1 && ml.renderersLive === 1 && ml.renderersCreated === memSeries[0].renderersCreated, `handles criados ${pv1.created - pv0.created}, vivos ${pv1.live}, renderers ${ml.renderersLive}`);
  check('40 prévias: 2ª rodada sem crescer texturas/geometrias/programas', ml.textures <= r1.textures && ml.geometries <= r1.geometries && ml.programs <= r1.programs, `${JSON.stringify(memSeries[0])} → 1ª ${JSON.stringify(r1)} → 2ª ${JSON.stringify(ml)}`);
  check('40 prévias: ouvintes/nós estáveis', c1.listeners - c0.listeners <= 2 && c1.nodes - c0.nodes <= 80, `ouvintes ${c0.listeners}→${c1.listeners}, nós ${c0.nodes}→${c1.nodes}`);
  await E(A, () => window.__pvInv.inv.close());
  const c2 = await counters(A);
  check('fechar descarta o handle da prévia', c2.preview.live === 0, `vivos ${c2.preview.live}`);

  // ---------------------------------------------------------------- capturas do painel
  const shotPanel = async (cat, file, sel, extra) => {
    await E(A, (c) => { const inv = window.__pvInv.inv; inv.openPanel(); inv.panel.filter = 'TODOS'; inv.panel.setCategory(c); }, cat);
    if (sel) await E(A, (k) => window.__pvInv.inv.select(k), sel);
    if (extra) await extra();
    await w(2200);
    await A.screenshot({ path: `${SHOTS}/${file}.jpg`, type: 'jpeg', quality: 86 });
  };
  await shotPanel('ROUPAS', 'J_inventario', 'shirt:208'); // bloqueada: motivo da progressão
  await shotPanel('ROUPAS', 'L_roupas', 'top:polo');
  await shotPanel('ACESSORIOS', 'K_acessorios', 'acc:chapeu');
  await shotPanel('ACESSORIOS', 'P_preview_3d_inventario', 'acc:mochila', async () => { await w(1200); await A.click('[data-pv="back"]'); });
  const supEntries = (await E(A, () => window.__pvInv.entries())).filter((e) => e.category === 'TORCIDA');
  const grp = supEntries.find((e) => e.key.startsWith('sup:'))?.key;
  await shotPanel('TORCIDA', 'M_torcida', grp);
  await E(A, () => window.__pvInv.inv.close());

  // ---------------------------------------------------------------- equipar pelo inventário: roupa, acessório, torcida
  const eq = async (k) => { await E(A, (key) => window.__pvInv.inv.equip(key), k); await w(300); };
  await E(A, () => window.__pvInv.inv.openPanel());
  await eq('top:polo');
  await eq('acc:oculos');
  const grp2 = supEntries.filter((e) => e.key.startsWith('sup:'))[1]?.key;
  await eq(grp2);
  // bloqueado: o painel recusa (e o servidor recusaria — tests/inventoryServer.test.ts)
  await eq('shirt:208');
  const st208 = await statusText(A);
  check('item bloqueado: aviso curto com o motivo', /bloqueado/i.test(st208), st208);
  await E(A, () => window.__pvInv.inv.close());
  await w(1200);
  const supIdx = Number(grp2 ? supEntries.filter((e) => e.key.startsWith('sup:')).findIndex((e) => e.key === grp2) + 1 : 0);
  const seenA = await nameOf(B, 'Ana');
  check('B vê em A a parte de cima trocada', seenA?.topStyle === 'polo', JSON.stringify(seenA));
  check('B vê em A o acessório trocado', seenA?.accessory === 'oculos', seenA?.accessory);
  check('B vê em A a torcida trocada', seenA?.sup === supIdx, `sup ${seenA?.sup} (esperado ${supIdx})`);

  // ---------------------------------------------------------------- acesso rápido: 1 = bandeira; HUD = mão = servidor = avatar
  await E(A, () => document.exitPointerLock?.()); // cursor visível (com o mouse capturado o clique vai para o canvas)
  await A.keyboard.press('Digit1');
  await w(1200);
  const hs = await E(A, () => window.__pvInv.handSync());
  check('tecla 1: bandeira na mão (HUD = social = servidor = avatar)', hs.social === 1 && hs.server === 1 && hs.visible === 1 && hs.hud === hs.label, JSON.stringify(hs));
  check('B vê o item na mão de A', (await nameOf(B, 'Ana'))?.prop === 1);
  const q1 = await E(A, () => window.__pvInv.info().quick.slots);
  check('slot 1 aceso', q1[0]?.on === true && q1.filter((s) => s.on).length === 1);
  // 2 = cartaz: troca guarda o anterior
  const el2 = await E(A, () => { const b = document.querySelector('.inv-q[data-q="1"]'); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return top === b || b.contains(top) ? 'ok' : (top?.className || top?.tagName); });
  out.slot2Target = el2;
  await A.click('.inv-q[data-q="1"]');
  await w(1200);
  const hs2 = await E(A, () => window.__pvInv.handSync());
  out.afterClick = await E(A, () => { const i = window.__pvInv.info(); return { stats: i.stats, log: i.log.slice(-6), layout: i.layout, status: document.querySelector('.hud-status')?.textContent }; });
  check('clique no slot 2: cartaz substitui a bandeira', hs2.social === 3 && hs2.server === 3 && hs2.visible === 3, JSON.stringify(hs2));
  // fixa o taco no 4 e usa (rodada 12: não há zona de paz — o taco vale em qualquer lugar)
  await E(A, () => { window.__pvInv.inv.openPanel(); window.__pvInv.inv.pin('prop:11', 3); window.__pvInv.inv.close(); });
  await A.keyboard.press('Digit4');
  await w(1200);
  const hs3 = await E(A, () => window.__pvInv.handSync());
  const st4 = await statusText(A);
  const pol = await E(A, () => window.__pv.combat?.()?.policy ?? null);
  check('tecla 4: taco na mão (posse do servidor/livre pelos dados)', hs3.server === 11 && hs3.visible === 11, JSON.stringify(hs3));
  check('sem zona de paz: nenhum aviso de "não pode ser usado nesta zona"', pol !== 'PEACE' && !/não pode ser usado nesta zona/.test(st4), `${pol} · ${st4}`);
  await A.keyboard.press('Digit4'); // de novo: guarda
  await w(1000);
  check('tecla 4 de novo: mão livre', (await E(A, () => window.__pvInv.handSync())).server === 0);
  await A.keyboard.press('Digit1');
  await w(1200);
  // N: item equipado (bandeira) no avatar + O: acesso rápido no HUD
  await E(A, () => window.__pv.camera?.(Math.PI * 0.85, 0.22, 5.2));
  await w(1500);
  await A.screenshot({ path: `${SHOTS}/N_item_equipado.jpg`, type: 'jpeg', quality: 86 });
  const qb = await A.$('.inv-quick');
  const bb = await qb.boundingBox();
  await A.screenshot({ path: `${SHOTS}/O_quickbar.jpg`, type: 'jpeg', quality: 90, clip: { x: Math.max(0, bb.x - 260), y: Math.max(0, bb.y - 120), width: Math.min(1366, bb.width + 520), height: Math.min(820 - Math.max(0, bb.y - 120), bb.height + 200) } });

  // ---------------------------------------------------------------- título (conquista BOA CONVERSA) + painel da pessoa em B
  // mesma mensagem do painel de chat (o servidor conta a conquista e paga o título)
  await E(A, () => window.__pvInv.send('chat_send', { ch: 'geral', text: 'oi, avenida' }));
  for (let i = 0; i < 40; i++) { const t = await E(A, () => window.__pvProg?.ui?.p?.titles ?? []); if (t.includes('Boa de papo')) break; await w(250); }
  const titles = await E(A, () => window.__pvProg?.ui?.p?.titles ?? []);
  check('conquista BOA CONVERSA → título ganho', titles.includes('Boa de papo'), titles.join(','));
  await E(A, () => window.__pvInv.inv.openPanel());
  await E(A, () => window.__pvInv.inv.panel.setCategory('TITULOS'));
  await eq('title:Boa de papo');
  await w(1500);
  await E(A, () => window.__pvInv.inv.close());
  const seenT = await nameOf(B, 'Ana');
  check('B vê o título e o nível de A (públicos)', seenT?.title === 'Boa de papo' && seenT?.lvl >= 1, JSON.stringify({ title: seenT?.title, lvl: seenT?.lvl }));
  // H: B seleciona A (painel da pessoa)
  await E(B, () => window.__pv.camera?.(Math.PI * 1.2, 0.2, 6));
  await w(800);
  check('B abre o painel de A', await E(B, () => window.__pvInv.showPerson('Ana')));
  await w(1200);
  const pp = await E(B, () => window.__pv.person?.() ?? null);
  await B.screenshot({ path: `${SHOTS}/H_jogador_selecionado.jpg`, type: 'jpeg', quality: 86 });
  const ppText = await E(B, () => document.querySelector('.person-panel')?.innerText ?? '');
  check('painel da pessoa: título e nível no cabeçalho', /Boa de papo/.test(ppText) && /Nível \d/.test(ppText), ppText.replace(/\n/g, ' | ').slice(0, 160));
  await E(B, () => document.querySelector('.person-panel .pp-btn')?.click());
  await w(600);
  const ppText2 = await E(B, () => document.querySelector('.person-panel')?.innerText ?? '');
  check('VER PERFIL: apelido, título, nível, torcida', /Título/.test(ppText2) && /Nível/.test(ppText2) && /Torcida/.test(ppText2) && !/@/.test(ppText2), ppText2.replace(/\n/g, ' | ').slice(0, 200));
  await B.screenshot({ path: `${SHOTS}/I_perfil_contextual.jpg`, type: 'jpeg', quality: 86 });
  out.person = { pp, header: ppText, profile: ppText2 };

  check('navegadores sem erros', !A.errs.length && !B.errs.length, [...A.errs, ...B.errs].slice(0, 3).join(' | '));
} catch (e) {
  check('execução', false, String(e?.stack ?? e));
} finally {
  out.results = results;
  writeFileSync('docs/bench/round11_inventory.json', JSON.stringify(out, null, 2));
  await cleanup();
  if (results.some((r) => !r.ok)) { console.log(S.log.slice(-15).join('\n')); process.exitCode = 1; }
}
