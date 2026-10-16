/**
 * Folha de contato das ações sociais (rodada 7): cada ação de src/social/actions.ts e cada pose de carregar item,
 * nos quatro corpos, de frente e de costas, num instante representativo; algumas também ANDANDO (camada superior
 * sobre a caminhada). Saída: screenshots/round7/emotes/<corpo>_<vista>.jpg (folha) e cells/<corpo>_<vista>_<ação>.jpg.
 * uso (com o servidor de desenvolvimento): node tools/qa/emote_sheet.mjs [corpos=homem,mulher,idoso,idosa] [lod=0] [vistas=front,back] [filtro]
 * BASE=http://localhost:5181 para outra porta. `filtro`: lista de chaves (ex.: wave,clap,carry:flag_small).
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const [bodiesArg = 'homem,mulher,idoso,idosa', lod = '0', viewsArg = 'front,back', filter = ''] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? 'screenshots/round7/emotes';
/** vista: sheet (corpo inteiro), upper (tronco e mãos), side (perfil) */
const W = Number(process.env.CELL_W ?? 300), H = Number(process.env.CELL_H ?? 420);
mkdirSync(`${OUT}/cells`, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: W, height: H } });
const errs = [];
for (const body of bodiesArg.split(',')) {
  const p = await b.newPage();
  p.on('pageerror', (e) => errs.push(`${body}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${body}: ${m.text().slice(0, 200)}`); });
  await p.goto(`${BASE}/dev/human.html?body=${body}&lod=${lod}&cam=${process.env.CAM ?? 'sheet'}&proxy=1&yaw=0.35`);
  await p.waitForFunction('window.__humanReady', { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1500));
  const { actions, props } = await p.evaluate(() => ({ actions: window.__human.actions, props: window.__human.props }));
  // lista de quadros: ações (item exigido na mão), poses de carregar e algumas combinações andando
  const items = [];
  for (const a of actions) {
    const t = a.mode === 'once' ? (a.duration ?? 2) * 0.45 : 0.7;
    items.push({ key: a.key, label: a.label, act: a.key, prop: a.needs?.[0] ?? null, t, speed: 0 });
  }
  for (const k of props) items.push({ key: `carry:${k}`, label: `carregar ${k}`, act: null, prop: k, t: 0.5, speed: 0 });
  for (const [act, prop] of [['clap', null], ['flag_wave', 'flag_small'], ['sign_raise', 'sign_small'], [null, 'sign_small'], [null, 'flag_small'], ['megaphone', 'megaphone']]) {
    items.push({ key: `walk:${act ?? `carry_${prop}`}`, label: `andando: ${act ?? `carregar ${prop}`}`, act, prop, t: 0.9, speed: 1.3 });
  }
  let sel = filter ? items.filter((it) => filter.split(',').includes(it.key)) : items;
  // STRIP=n: em vez de um instante, n quadros ao longo do ciclo de cada ação (conferir ritmo e continuidade)
  const strip = Number(process.env.STRIP ?? 0);
  if (strip > 0) {
    sel = sel.flatMap((it) => {
      const dur = actions.find((a) => a.key === it.act)?.duration ?? 4;
      return Array.from({ length: strip }, (_, k) => ({ ...it, key: `${it.key}_${k}`, label: `${it.label} t=${((k * dur) / strip).toFixed(2)}`, t: (k * dur) / strip }));
    });
  }
  for (const view of viewsArg.split(',')) {
    await p.evaluate((y) => window.__human.yaw(y), view === 'back' ? 0.35 + Math.PI : 0.35);
    const cells = [];
    for (const it of sel) {
      await p.evaluate((it) => window.__human.setAct(it.act, it.prop, it.t, 0, it.speed), it);
      await new Promise((r) => setTimeout(r, 180));
      const buf = await p.screenshot({ type: 'jpeg', quality: 82 });
      writeFileSync(`${OUT}/cells/${body}_lod${lod}_${view}_${it.key.replace(/[^a-z0-9_]+/gi, '_')}.jpg`, buf);
      cells.push({ label: it.label, data: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` });
    }
    // folha: grade montada num canvas da própria página
    const cols = 8, rows = Math.ceil(cells.length / cols);
    const sheet = await b.newPage();
    await sheet.setViewport({ width: cols * W / 2, height: rows * (H / 2 + 16) + 28 });
    await sheet.setContent('<body style="margin:0;background:#222"><canvas id="c"></canvas></body>');
    const png = await sheet.evaluate(async (cells, cols, W, H, title) => {
      const cw = W / 2, ch = H / 2 + 16;
      const cv = document.getElementById('c');
      cv.width = cols * cw; cv.height = Math.ceil(cells.length / cols) * ch + 28;
      const g = cv.getContext('2d');
      g.fillStyle = '#222'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.fillText(title, 8, 20);
      for (let i = 0; i < cells.length; i++) {
        const img = new Image(); img.src = cells[i].data; await img.decode();
        const x = (i % cols) * cw, y = 28 + Math.floor(i / cols) * ch;
        g.drawImage(img, x, y, cw, H / 2);
        g.fillStyle = '#ddd'; g.font = '11px sans-serif'; g.fillText(cells[i].label.slice(0, 26), x + 4, y + H / 2 + 12);
      }
      return cv.toDataURL('image/jpeg', 0.85);
    }, cells, cols, W, H, `${body} · LOD${lod} · ${view === 'back' ? 'costas' : 'frente'}`);
    writeFileSync(`${OUT}/${body}_lod${lod}_${view}.jpg`, Buffer.from(png.split(',')[1], 'base64'));
    await sheet.close();
    console.log(`${body} ${view}: ${cells.length} quadros`);
  }
  await p.close();
}
console.log(JSON.stringify({ errs }));
await b.close();
