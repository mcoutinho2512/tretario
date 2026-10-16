/**
 * Contato com o chão nas ações de corpo inteiro (rodada 7): para cada corpo e LOD, toca cada ação ao vivo na página
 * de teste e amostra por quadro o pé mais baixo (sola = osso + 1,2 cm) e a pelve acima do chão (y = 0).
 * Também mede o crossfade (idle → ação → idle) para pegar flutuação/afundamento na transição.
 * uso (com o servidor de desenvolvimento): node tools/qa/emote_ground.mjs [corpos] [lods=0,2] [ações]
 * BASE=http://localhost:5181 para outra porta.
 */
import puppeteer from 'puppeteer-core';
const [bodiesArg = 'homem,mulher,idoso,idosa', lodsArg = '0,2', actsArg = 'photo,sit,jump_cheer,dance_simple,dance_lively,dance_arms,dance_party,dance_classic,clap,flag_wave'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 400, height: 400 } });
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { min: +s[0].toFixed(3), p50: +s[Math.floor(s.length / 2)].toFixed(3), max: +s.at(-1).toFixed(3) }; };
const out = {};
for (const body of bodiesArg.split(',')) for (const lod of lodsArg.split(',')) {
  const p = await b.newPage();
  await p.goto(`${BASE}/dev/human.html?body=${body}&lod=${lod}`);
  await p.waitForFunction('window.__humanReady', { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  for (const act of actsArg.split(',')) {
    const prop = act.startsWith('flag') ? 'flag_small' : null;
    // ação ao vivo por 3,2 s (inclui a entrada), depois desliga e mede a saída por 0,8 s
    const s = await p.evaluate((act, prop) => new Promise((res) => {
      window.__human.setAct(act, prop, null, 0, 0);
      const rows = []; const t0 = performance.now(); let off = false;
      const f = () => {
        const g = window.__human.ground()[0];
        rows.push({ t: (performance.now() - t0) / 1000, foot: g.foot, pelvis: g.pelvis, off });
        const el = performance.now() - t0;
        if (el > 3200 && !off) { off = true; window.__human.setAct(null, null, null, 0, 0); }
        if (el < 4000) requestAnimationFrame(f); else res(rows);
      };
      requestAnimationFrame(f);
    }), act, prop);
    const on = s.filter((r) => !r.off && r.t > 0.5), all = s;
    out[`${body} LOD${lod} ${act}`] = { pe: stat(on.map((r) => r.foot)), pe_transicao: stat(all.map((r) => r.foot)), pelve: stat(on.map((r) => r.pelvis)) };
    console.log(body, `LOD${lod}`, act, JSON.stringify(out[`${body} LOD${lod} ${act}`]));
  }
  await p.close();
}
await b.close();
