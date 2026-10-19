/**
 * Rodada 11 — medição de VAZAMENTO da prévia 3D do editor (docs/bench/round11_preview.json):
 *   abre/fecha o editor 30× e troca 20 roupas + 20 acessórios na prévia, contando contextos WebGL (criados/vivos),
 *   renderer.info da prévia (geometrias, texturas, programas), CDP Performance.getMetrics (ouvintes, nós, heap) após GC.
 *   Funciona com o editor antigo (rodada 10: AvatarPreview com WebGLRenderer próprio a cada abertura) e com o novo
 *   (src/ui/preview/sharedPreview.ts) — usa só seletores que os dois têm e `window.__pvStart.preview`.
 * uso: (servidor de teste em --port, Vite com PV_API=http://127.0.0.1:<port+1>)
 *      node tools/qa/editor_preview_bench.mjs <baseUrl> --port=3910 --label=before|after [--out=docs/bench/round11_preview.json]
 * Também é importado por tools/qa/editor_preview.mjs (função `runBench`).
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const w = (ms) => new Promise((r) => setTimeout(r, ms));

/** conta contextos WebGL criados e perdidos (forceContextLoss/descartes) — injetado antes de qualquer script */
export const CONTEXT_COUNTER = () => {
  const s = (window.__pvGl = { created: 0, lost: 0 });
  const orig = HTMLCanvasElement.prototype.getContext;
  const seen = new WeakSet();
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const ctx = orig.call(this, type, ...a);
    if (ctx && /webgl/.test(type) && !seen.has(ctx)) {
      seen.add(ctx);
      s.created++;
      this.addEventListener('webglcontextlost', () => { s.lost++; });
    }
    return ctx;
  };
};

/** cria conta (servidor de teste: caixa de saída de DEV) e entra; volta com a home logada */
export async function registerAndLogin(page, url) {
  await page.goto(url);
  await page.waitForSelector('#btn-join', { visible: true, timeout: 60000 });
  const id = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
  const r = await page.evaluate(async (id) => {
    const j = (m, p, b) => fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async (x) => ({ s: x.status, b: await x.json().catch(() => null) }));
    const email = `ed${id}@exemplo.test`, password = 'Lapa#Arcos2026';
    const reg = await j('POST', '/api/auth/register', { email, password, confirm: password, nickname: `Ed${id}`.slice(0, 16) });
    const box = await j('GET', `/api/dev/outbox?email=${encodeURIComponent(email)}`);
    const code = box.b?.messages?.find((m) => m.kind === 'EMAIL_VERIFY')?.code;
    const ver = code ? await j('POST', '/api/auth/verify-email', { code }) : { s: 0 };
    return { reg: reg.s, ver: ver.s, email, password };
  }, id);
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('home-me')?.classList.contains('hidden'), { timeout: 30000 });
  return r;
}

export async function metrics(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await w(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const gl = await page.evaluate(() => ({ ...window.__pvGl }));
  return { contextsCreated: gl.created, contextsLive: gl.created - gl.lost, listeners: m.JSEventListeners, nodes: m.Nodes, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1) };
}

/** renderer.info da prévia aberta (antigo: campo privado `renderer`; novo: `info()`) */
export const previewInfo = (page) => page.evaluate(() => {
  const p = window.__pvStart?.preview;
  if (!p) return null;
  if (typeof p.info === 'function') return p.info();
  const i = p.renderer?.info;
  return i ? { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, renderers: null } : null;
});

/** espera a prévia ficar pronta; 'unavailable' = o editor mostrou "Prévia 3D indisponível" (falha de contexto) */
export const waitReady = (page) => page.waitForFunction(() => {
  const l = document.getElementById('preview-loading');
  if (/indispon/i.test(l?.textContent ?? '')) return 'unavailable';
  return window.__pvStart?.preview && l?.classList.contains('hidden') ? 'ok' : false;
}, { timeout: 60000 }).then((h) => h.jsonValue()).then(async (st) => { if (st === 'ok') { await page.evaluate(() => window.__pvStart.preview.ready); await w(150); } return st; });

export async function openEditor(page) {
  await page.evaluate(() => document.getElementById('btn-edit-char').click());
  await page.waitForFunction(() => !document.getElementById('start').classList.contains('hidden'), { timeout: 10000 });
  return waitReady(page);
}
export async function cancelEditor(page) {
  await page.evaluate(() => (document.getElementById('ed-cancel') ?? document.getElementById('btn-back')).click());
  await page.waitForFunction(() => document.getElementById('start').classList.contains('hidden'), { timeout: 10000 });
}

/** clica (via DOM, independe da aba visível) o i-ésimo botão do seletor; devolve se existiu */
export const clickNth = (page, sel, i) => page.evaluate((sel, i) => { const all = [...document.querySelectorAll(sel)].filter((b) => !b.classList.contains('locked')); const b = all[i % all.length]; b?.click(); return !!b; }, sel, i);

export async function runBench(page, cdp, label) {
  const out = { label, date: new Date().toISOString() };
  await openEditor(page);
  await cancelEditor(page);
  out.warm = await metrics(page, cdp);
  // abrir/fechar 30×
  const infos = [];
  let unavailable = 0;
  for (let i = 0; i < 30; i++) {
    if ((await openEditor(page)) !== 'ok') unavailable++;
    if (i === 0 || i === 29) infos.push(await previewInfo(page));
    await cancelEditor(page);
  }
  out.openClose30 = await metrics(page, cdp);
  out.previewInfoFirstLast = infos;
  out.previewUnavailableOpens = unavailable;
  // 20 roupas + 20 acessórios na prévia — duas rodadas: a 1ª pode baixar/enviar peças ainda não vistas (cache de
  // HumanAssets, limitado ao catálogo); a 2ª, com as mesmas peças, não pode crescer
  const seq = async () => {
    const clothes = ['.style-chips[data-slot=SHIRT] .chip', '#shirt-designs .chip', '.style-chips[data-slot=PANTS] .chip', '.style-chips[data-slot=SHOES] .chip', '.swatches[data-key=top] .swatch'];
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) { await clickNth(page, clothes[i % clothes.length], Math.floor(i / clothes.length) + i); await w(250); await page.evaluate(() => window.__pvStart.preview.ready); }
    const t1 = Date.now();
    for (let i = 0; i < 20; i++) {
      await clickNth(page, '#acc-chips .chip', (i % 5) + 1);
      await clickNth(page, '.swatches[data-key=acc] .swatch', i);
      await w(200);
    }
    await w(800);
    return { info: await previewInfo(page), clothesMs: t1 - t0, accessoriesMs: Date.now() - t1 };
  };
  out.sequenceOpen = await openEditor(page);
  const i0 = await previewInfo(page);
  const r1 = await seq();
  const r2 = await seq();
  out.previewSequence = { before: i0, after: r1.info, afterRound2: r2.info, clothesMs: r1.clothesMs, accessoriesMs: r1.accessoriesMs };
  await cancelEditor(page);
  out.afterSequence = await metrics(page, cdp);
  return out;
}

// ---------------------------------------------------------------- uso direto
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = process.argv[2] ?? 'http://localhost:5203';
  const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const PORT = Number(arg('port', 3910)), label = arg('label', 'after'), outFile = arg('out', 'docs/bench/round11_preview.json');
  const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1920, height: 1080 } });
  try {
    const page = await b.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.evaluateOnNewDocument(CONTEXT_COUNTER);
    const cdp = await page.createCDPSession();
    await cdp.send('Performance.enable');
    await registerAndLogin(page, `${base}/?welcome=0&quality=low&mp=ws://127.0.0.1:${PORT}`);
    const r = await runBench(page, cdp, label);
    r.pageErrors = errs;
    console.log(JSON.stringify(r, null, 2));
    mkdirSync('docs/bench', { recursive: true });
    const prev = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
    prev[label] = r;
    writeFileSync(outFile, JSON.stringify(prev, null, 2) + '\n');
  } finally { await b.close(); }
}
