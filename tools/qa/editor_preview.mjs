/**
 * Rodada 11 — QA do EDITOR DE PERSONAGEM e da PRÉVIA 3D compartilhada (navegador real, servidor de teste próprio):
 *  1. desktop 1920×1080: abre o editor (conta), troca CADA categoria (corpo, cabelo, camisa + camisa de futebol, calça,
 *     calçado, acessório + cor, torcida + vestir as cores), desfaz/refaz/restaura, item bloqueado (só prévia + motivo),
 *     gira (arrasto) e aproxima (roda) a prévia, frente/costas, Esc pela pilha única; salva, RECARREGA e confere a
 *     persistência (aparência validada pelo servidor + torcida)
 *  2. os 4 corpos com a camisa da torcida (vestir as cores) na prévia
 *  3. 1366×768 (cabe sem rolar a página; salvar visível) e smoke de celular (390×844)
 *  4. vazamento: abrir/fechar 30× e 20 roupas + 20 acessórios em sequência (tools/qa/editor_preview_bench.mjs),
 *     perda de contexto simulada (recriação), custo medido 2º contexto × render target + readPixels
 *  5. no jogo (overlay sobre o mundo): abre/fecha 10× com `__pv.memoryReport` do jogo antes/depois
 * Capturas: docs/screenshots/round11/{L_roupas_editor,M_torcida_editor,P_preview_3d,W_1366x768_editor}.jpg
 * Números: docs/bench/round11_preview.json (chave "after"; "before" = rodada 10, gerado com o mesmo bench)
 * uso: servidor de teste + Vite apontando para ele:
 *   (cd server && PORT=3910 PV_TEST=1 PV_STORE=memory PV_GRAFFITI_STORE=memory DATABASE_URL= npx tsx src/index.ts)
 *   PV_API=http://127.0.0.1:3911 npx vite --port 5203 --strictPort
 *   node tools/qa/editor_preview.mjs http://localhost:5203 --port=3910 [--skip-game]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chrome, w, CONTEXT_COUNTER, registerAndLogin, metrics, openEditor, cancelEditor, waitReady, runBench } from './editor_preview_bench.mjs';

const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5203';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(arg('port', 3910));
const SKIP_GAME = process.argv.includes('--skip-game');
const SHOTS = 'docs/screenshots/round11';
const BENCH = 'docs/bench/round11_preview.json';
mkdirSync(SHOTS, { recursive: true }); mkdirSync('screenshots/tmp', { recursive: true });
const URL0 = `${base}/?welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const shot = (p, name) => p.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 86 });
const look = (p) => p.evaluate(() => ({ ...window.__pvStart.look() }));
const tab = (p, t) => p.evaluate((t) => document.querySelector(`.ed-tab[data-tab=${t}]`).click(), t);
/** clica o primeiro botão LIVRE (sem cadeado) e diferente do atual no seletor; devolve o rótulo */
const pickFree = (p, sel) => p.evaluate((sel) => {
  const b = [...document.querySelectorAll(sel)].find((x) => !x.classList.contains('locked') && x.getAttribute('aria-pressed') !== 'true' && x.offsetParent !== null);
  b?.click();
  return b ? (b.textContent || b.getAttribute('aria-label') || '').trim() : null;
}, sel);
const settle = async (p) => { await w(250); await p.evaluate(() => window.__pvStart.preview.ready); await w(200); };
const esc = (p) => p.evaluate(async () => { const m = await import('/src/ui/escStack.ts'); return { layers: [...m.escLayers()] }; });
const out = existsSync(BENCH) ? JSON.parse(readFileSync(BENCH, 'utf8')) : {};

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1920, height: 1080 } });
try {
  // ---------------------------------------------------------------- 1. desktop 1920×1080
  const p = await browser.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.evaluateOnNewDocument(CONTEXT_COUNTER);
  const cdp = await p.createCDPSession();
  await cdp.send('Performance.enable');
  const acct = await registerAndLogin(p, URL0);
  check('conta de teste criada e logada', acct.reg === 201, `cadastro ${acct.reg}`);
  check('editor abre com a prévia 3D', (await openEditor(p)) === 'ok');
  const l0 = await look(p);
  const info0 = await p.evaluate(() => window.__pvStart.preview.info());
  check('prévia: um renderer, um handle', info0.renderersLive === 1 && info0.handlesLive === 1, JSON.stringify(info0));
  check('Esc: o editor está na pilha única (prioridade de diálogo)', (await esc(p)).layers.includes('editor'));
  check('cursor livre (sem pointer lock) no editor', await p.evaluate(() => !document.pointerLockElement));

  // CORPO
  await p.evaluate(() => document.querySelector('input[name=av][value=mulher]').click());
  await settle(p);
  check('CORPO: troca de corpo na prévia', (await look(p)).body === 'mulher' && await p.evaluate(() => window.__pvStart.preview.ready.then(() => true)));
  await pickFree(p, '.swatches[data-key=skin] .swatch');
  // CABELO
  await tab(p, 'CABELO');
  const hair = await pickFree(p, '.style-chips[data-slot=HAIR] .chip');
  await pickFree(p, '.swatches[data-key=hair] .swatch');
  await settle(p);
  check('CABELO: corte e cor', !!hair && (await look(p)).hairStyle !== l0.hairStyle, hair ?? '');
  // CAMISA (modelo, cor, camisa de futebol)
  await tab(p, 'CAMISA');
  await pickFree(p, '.style-chips[data-slot=SHIRT] .chip');
  await pickFree(p, '.swatches[data-key=top] .swatch');
  const des = await pickFree(p, '#shirt-designs .chip:not([data-design="0"])');
  await settle(p);
  const lc = await look(p);
  check('CAMISA: camisa de futebol vira modelo camiseta', lc.shirtDesign > 0 && lc.topStyle === 'camiseta', `${des} #${lc.shirtDesign}`);
  await shot(p, 'L_roupas_editor');
  // CALÇA
  await tab(p, 'CALCA');
  const pants = await pickFree(p, '.style-chips[data-slot=PANTS] .chip');
  await pickFree(p, '.swatches[data-key=bottom] .swatch');
  // CALÇADO
  await tab(p, 'CALCADO');
  const shoes = await pickFree(p, '.style-chips[data-slot=SHOES] .chip');
  await pickFree(p, '.swatches[data-key=shoes] .swatch');
  await settle(p);
  const lp = await look(p);
  check('CALÇA e CALÇADO', !!pants && !!shoes && lp.bottomStyle && lp.shoeStyle, `${pants} / ${shoes}`);
  // ACESSÓRIOS
  await tab(p, 'ACESSORIOS');
  await p.evaluate(() => document.querySelector('#acc-chips .chip[data-acc=oculos]').click());
  const accColorVisible = await p.evaluate(() => !document.getElementById('acc-color-wrap').classList.contains('hidden'));
  await pickFree(p, '.swatches[data-key=acc] .swatch');
  await settle(p);
  check('ACESSÓRIOS: óculos + cor', (await look(p)).accessory === 'oculos' && accColorVisible);
  // desfazer/refazer/restaurar
  const before = await look(p);
  await p.keyboard.down('Control'); await p.keyboard.press('KeyZ'); await p.keyboard.up('Control');
  const undone = await look(p);
  await p.evaluate(() => document.getElementById('ed-redo').click());
  const redone = await look(p);
  check('desfazer (Ctrl+Z) e refazer', undone.acc !== before.acc && redone.acc === before.acc, `acc ${before.acc}→${undone.acc}→${redone.acc}`);
  check('abas alteradas marcadas', await p.evaluate(() => document.querySelectorAll('.ed-tab.changed').length) >= 5);
  // item bloqueado: só prévia + motivo
  const lockedInfo = await p.evaluate(() => {
    const b = document.querySelector('#shirt-designs .chip.locked');
    if (!b) return null;
    const before = JSON.stringify(window.__pvStart.look());
    b.click();
    return { req: b.dataset.req, note: document.getElementById('editor-note').textContent, same: JSON.stringify(window.__pvStart.look()) === before };
  });
  check('bloqueado: cadeado com motivo, só na prévia (não entra no visual)', !lockedInfo || (lockedInfo.same && /Bloqueado/.test(lockedInfo.note) && !!lockedInfo.req), JSON.stringify(lockedInfo));
  // TORCIDA
  await tab(p, 'TORCIDA');
  await p.waitForSelector('#ed-sup .sup-card', { visible: true, timeout: 10000 });
  const supId = await p.evaluate(() => { const c = document.querySelectorAll('#ed-sup .sup-card')[1]; c.click(); return c.dataset.key; });
  await p.evaluate(() => document.getElementById('ed-wear').click());
  await settle(p);
  const lt = await look(p);
  const supState = await p.evaluate(() => window.__pvStart.editor.snapshot.sup);
  check('TORCIDA: escolha + vestir as cores (camisa da torcida)', supState === supId && lt.shirtDesign > 0 && lt.topStyle === 'camiseta', `${supId} camisa #${lt.shirtDesign}`);
  await shot(p, 'M_torcida_editor');
  // prévia: arrasto, roda, costas, pose
  const stage = await p.$('#avatar-stage');
  const bb = await stage.boundingBox();
  const yaw0 = await p.evaluate(() => window.__pvStart.preview.yawNow);
  await p.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(bb.x + bb.width * 0.5 + i * 18, bb.y + bb.height * 0.5); await w(16); }
  await p.mouse.up();
  await w(500);
  const yaw1 = await p.evaluate(() => window.__pvStart.preview.yawNow);
  await p.mouse.wheel({ deltaY: -400 });
  await w(400);
  const zoom = await p.evaluate(() => window.__pvStart.preview.zoomLevel);
  check('prévia: gira com arrasto e aproxima com a roda', Math.abs(yaw1 - yaw0) > 0.5 && zoom > 0.3, `yaw ${yaw0.toFixed(2)}→${yaw1.toFixed(2)}, zoom ${zoom.toFixed(2)}`);
  await p.evaluate(() => { document.querySelector('.pose-btn[data-view=back]').click(); document.querySelector('.pose-btn[data-pose=acenando]').click(); window.__pvStart.preview.zoom(0, 0.15); });
  await w(1400);
  const yawBack = await p.evaluate(() => window.__pvStart.preview.yawNow);
  check('prévia: costas', Math.abs(Math.cos(yawBack - (-0.35 + Math.PI))) > 0.95, yawBack.toFixed(2));
  await p.evaluate(() => { document.querySelector('.pose-btn[data-view=front]').click(); document.querySelector('.pose-btn[data-pose=dancando]').click(); window.__pvStart.preview.zoom(0, 0); });
  await w(1500);
  const card = await p.$('.preview-card');
  await card.screenshot({ path: `${SHOTS}/P_preview_3d.jpg`, type: 'jpeg', quality: 88 });
  // restaurar (desfazível) e voltar
  await p.evaluate(() => document.getElementById('ed-restore').click());
  const restored = await look(p);
  await p.evaluate(() => document.getElementById('ed-undo').click());
  check('restaurar volta ao salvo e pode ser desfeito', restored.body === l0.body && (await look(p)).shirtDesign === lt.shirtDesign);
  // salvar → servidor valida → recarrega → persistiu
  const want = await look(p);
  await p.evaluate(() => document.getElementById('explore').click());
  await p.waitForFunction(() => document.getElementById('start').classList.contains('hidden'), { timeout: 15000 });
  const server = await p.evaluate(async () => ({ app: (await (await fetch('/api/me/appearance')).json()).appearance, sup: (await (await fetch('/api/me/supporter')).json()).current }));
  const fields = ['body', 'skin', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'acc', 'topStyle', 'bottomStyle', 'shoeStyle', 'hairStyle', 'shirtDesign'];
  const same = (a, b) => fields.every((k) => (a[k] ?? null) === (b[k] ?? null));
  check('salvo no servidor (validado) igual ao editor', same(server.app, want) && server.sup === supId, fields.filter((k) => server.app[k] !== want[k]).join(',') || 'ok');
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('home-me')?.classList.contains('hidden'), { timeout: 30000 });
  check('recarregar: abre com o visual e a torcida salvos', (await openEditor(p)) === 'ok' && same(await look(p), want) && await p.evaluate(() => window.__pvStart.editor.snapshot.sup) === supId);
  // Esc pela pilha única fecha (sem salvar)
  await p.evaluate(() => document.querySelector('.swatches[data-key=skin] .swatch').click());
  const escR = await p.evaluate(async () => { const m = await import('/src/ui/escStack.ts'); return m.handleEsc(); });
  await w(300);
  check('Esc (handleEsc) fecha o editor e descarta o não salvo', escR === 'closed' && await p.evaluate(() => document.getElementById('start').classList.contains('hidden')) && (await esc(p)).layers.length === 0);

  // ---------------------------------------------------------------- 2. os 4 corpos com a camisa da torcida
  await openEditor(p);
  const bodies = [];
  for (const b of ['homem', 'mulher', 'idoso', 'idosa']) {
    await p.evaluate((b) => document.querySelector(`input[name=av][value=${b}]`).click(), b);
    await tab(p, 'TORCIDA');
    await p.evaluate(() => document.getElementById('ed-wear').click());
    await settle(p);
    const a = await look(p);
    bodies.push(`${b}:${a.topStyle}/#${a.shirtDesign}`);
    if (b === 'idosa') await p.screenshot({ path: 'screenshots/tmp/r11_torcida_idosa.jpg', type: 'jpeg', quality: 80 });
  }
  check('4 corpos vestem a camisa da torcida (modelo camiseta + design)', bodies.every((x) => /camiseta\/#\d+$/.test(x) && !/#0$/.test(x)), bodies.join(' '));
  await cancelEditor(p);

  // ---------------------------------------------------------------- 3. 1366×768 e celular
  await p.setViewport({ width: 1366, height: 768 });
  await openEditor(p);
  await tab(p, 'CAMISA');
  await w(600);
  const fit = await p.evaluate(() => {
    const r = document.getElementById('explore').getBoundingClientRect(), pv = document.getElementById('avatar-stage').getBoundingClientRect();
    return { saveBottom: Math.round(r.bottom), pageScrollW: document.documentElement.scrollWidth, startScroll: document.getElementById('start').scrollHeight - document.getElementById('start').clientHeight, pvW: Math.round(pv.width), pvH: Math.round(pv.height) };
  });
  check('1366×768: salvar visível, sem rolagem lateral, avatar grande', fit.saveBottom <= 768 && fit.pageScrollW <= 1366 && fit.pvH > 450, JSON.stringify(fit));
  await shot(p, 'W_1366x768_editor');
  await cancelEditor(p);
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await openEditor(p);
  await tab(p, 'CALCA');
  const mob = await pickFree(p, '.style-chips[data-slot=PANTS] .chip');
  await w(500);
  const mfit = await p.evaluate(() => ({ tabsScroll: document.getElementById('ed-tabs').scrollWidth > document.getElementById('ed-tabs').clientWidth, pageScrollW: document.documentElement.scrollWidth, pv: Math.round(document.getElementById('avatar-stage').getBoundingClientRect().height) }));
  await p.screenshot({ path: 'screenshots/tmp/r11_editor_celular.jpg', type: 'jpeg', quality: 80 });
  check('celular: abas roláveis, troca peça, sem rolagem lateral', !!mob && mfit.pageScrollW <= 390 && mfit.pv > 300, JSON.stringify(mfit));
  await cancelEditor(p);
  await p.setViewport({ width: 1920, height: 1080 });

  // ---------------------------------------------------------------- 4. vazamento + perda de contexto + custo
  const bench = await runBench(p, cdp, 'after');
  const live = bench.openClose30.contextsLive, created = bench.openClose30.contextsCreated;
  check('30× abrir/fechar: sem novos contextos/renderers', bench.openClose30.contextsCreated - bench.warm.contextsCreated === 0 && bench.previewUnavailableOpens === 0, `contextos criados ${bench.warm.contextsCreated}→${created}, vivos ${live}, renderers ${JSON.stringify(bench.previewInfoFirstLast.map((x) => x?.renderersCreated))}`);
  const [f, l] = bench.previewInfoFirstLast;
  check('30× abrir/fechar: geometrias/texturas/programas estáveis', f && l && l.geometries <= f.geometries && l.textures <= f.textures && l.programs <= f.programs + 2, `${JSON.stringify(f)} → ${JSON.stringify(l)}`);
  check('30× abrir/fechar: ouvintes e nós estáveis', bench.openClose30.listeners - bench.warm.listeners <= 5 && bench.openClose30.nodes - bench.warm.nodes <= 20, `ouvintes ${bench.warm.listeners}→${bench.openClose30.listeners}, nós ${bench.warm.nodes}→${bench.openClose30.nodes}, heap ${bench.warm.heapMB}→${bench.openClose30.heapMB} MB`);
  const s0 = bench.previewSequence.before, s1 = bench.previewSequence.after, s2 = bench.previewSequence.afterRound2;
  const gt = (x) => `geo ${x.geometries} tex ${x.textures} prog ${x.programs}`;
  check('20 roupas + 20 acessórios (2 rodadas): só o cache de peças da 1ª; a 2ª não cresce', s1 && s2 && s2.geometries <= s1.geometries && s2.textures <= s1.textures && s2.programs <= s1.programs + 1 && s2.handlesLive === 1 && s2.renderersCreated === s0.renderersCreated, `${gt(s0)} → ${gt(s1)} → ${gt(s2)}`);
  check('depois da sequência: ouvintes estáveis', bench.afterSequence.listeners - bench.warm.listeners <= 5, `${bench.warm.listeners}→${bench.afterSequence.listeners}`);
  // memória da cena da prévia, perda de contexto e custo
  await openEditor(p);
  const mem = await p.evaluate(() => { const r = window.__pvPreview.memoryReport(); return r && { renderer: r.renderer, totals: r.totals }; });
  bench.previewMemoryReport = mem;
  bench.cost = await p.evaluate(() => window.__pvPreview.benchReadback(60));
  const t0 = Date.now();
  await p.evaluate(() => window.__pvPreview.loseContext());
  const recovered = await p.waitForFunction(() => { const i = window.__pvPreview.info(); return i.contextsLost >= 1 && i.renderersLive === 1 && i.calls > 0; }, { timeout: 15000 }).then(() => true).catch(() => false);
  bench.contextLoss = { recovered, ms: Date.now() - t0, info: await p.evaluate(() => window.__pvPreview.info()) };
  check('perda de contexto: renderer recriado e volta a desenhar', recovered, JSON.stringify(bench.contextLoss));
  // custo de criar o renderer (uma vez por sessão do editor): fecha, descarta, reabre
  await cancelEditor(p);
  await p.evaluate(() => window.__pvPreview.dispose());
  const tOpen = Date.now();
  await openEditor(p);
  bench.coldOpenMs = Date.now() - tOpen;
  await cancelEditor(p);
  const tWarm = Date.now();
  await openEditor(p);
  bench.warmOpenMs = Date.now() - tWarm;
  await cancelEditor(p);
  bench.idle = await p.evaluate(async () => { const a = window.__pvPreview.info(); return { afterClose: a }; });
  bench.pageErrors = errs.slice();
  out.after = bench;
  check('sem erros na página (editor)', errs.length === 0, errs.slice(0, 3).join(' | '));

  // ---------------------------------------------------------------- 5. no jogo (overlay)
  if (!SKIP_GAME) {
    await p.evaluate(() => window.__pvLaunch({ role: 'player' }));
    await p.waitForFunction('window.__pvReady === true && !!window.__pv', { timeout: 240000 });
    await w(15000); // mundo e multidão assentam
    const gm = async () => { const r = await p.evaluate(() => { const m = window.__pv.memoryReport(false); return { geometries: m.totals.geometries, textures: m.totals.textures, materials: m.totals.materials, gpuEstMB: m.totals.gpuEstMB, rendererGeometries: m.renderer.geometries, rendererTextures: m.renderer.textures, programs: m.renderer.programs }; }); return { ...r, ...(await metrics(p, cdp)) }; };
    const g0 = await gm();
    const ft = async () => { await p.evaluate(() => window.__pv.takeFrames()); await w(3000); const f = await p.evaluate(() => window.__pv.takeFrames()); const s = f.slice().sort((a, b) => a - b); return { frames: f.length, avgMs: +(f.reduce((a, b) => a + b, 0) / Math.max(1, f.length)).toFixed(2), p95Ms: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(1) }; };
    const framesClosed = await ft();
    const opened = await p.evaluate(() => window.pvOpenCharacterEditor());
    await waitReady(p);
    const overlay = await p.evaluate(() => document.getElementById('start').classList.contains('overlay'));
    const framesOpen = await ft();
    await p.screenshot({ path: 'screenshots/tmp/r11_editor_no_jogo.jpg', type: 'jpeg', quality: 80 });
    check('no jogo: editor abre como overlay (o jogo segue por baixo)', opened && overlay && framesOpen.frames > 10, `quadros do jogo com o editor aberto: ${JSON.stringify(framesOpen)}; fechado ${JSON.stringify(framesClosed)}`);
    await p.evaluate(async () => { const m = await import('/src/ui/escStack.ts'); m.handleEsc(); });
    // linha de base DEPOIS da 1ª abertura: o 1º overlay coincide com o mundo terminando de carregar peças (aquecimento
    // único, ~+40 texturas); vazamento é crescer a CADA ciclo (sonda de 30 ciclos: ciclos 10→20 = +1 textura, 0 ouvintes)
    await w(1500);
    const g0w = await gm();
    const tCycle = Date.now();
    for (let i = 0; i < 10; i++) {
      await p.evaluate(() => window.pvOpenCharacterEditor());
      await waitReady(p);
      await p.evaluate(() => document.getElementById('ed-cancel').click());
      await w(200);
    }
    await w(1000);
    const g1 = await gm();
    const cycleMs = Date.now() - tCycle;
    // controle: o mesmo tempo SEM editor (o mundo/multidão muda sozinho)
    await w(cycleMs);
    const g2 = await gm();
    out.after.inGame = { before: g0, afterFirstOpen: g0w, after10: g1, controlSameTimeNoEditor: g2, cycleMs, framesClosed, framesOpen };
    const d = (k) => (g1[k] ?? 0) - (g0w[k] ?? 0), dc = (k) => (g2[k] ?? 0) - (g1[k] ?? 0);
    check('no jogo: 10× abrir/fechar — só 1 contexto de prévia (reutilizado), renderer do jogo sem crescer além do controle', g1.contextsCreated - g0.contextsCreated <= 1 && g1.contextsLive - g0.contextsLive <= 1 && d('rendererGeometries') <= Math.max(20, dc('rendererGeometries') + 20) && d('rendererTextures') <= Math.max(10, dc('rendererTextures') + 10) && d('programs') <= 4 && d('listeners') <= 10,
      `Δ editor: contextos +${d('contextsCreated')}, geo ${d('rendererGeometries')}, tex ${d('rendererTextures')}, prog ${d('programs')}, ouvintes ${d('listeners')} · Δ controle: geo ${dc('rendererGeometries')}, tex ${dc('rendererTextures')}`);
  }
} catch (e) {
  check(`execução sem exceção (${e.message})`, false);
  console.error(e);
} finally {
  await browser.close().catch(() => {});
}
out.qa = { date: new Date().toISOString(), pass: results.filter((r) => r.ok).length, total: results.length, results };
writeFileSync(BENCH, JSON.stringify(out, null, 2) + '\n');
const pass = results.filter((x) => x.ok).length;
console.log(`\n[editor_preview] ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
