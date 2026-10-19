/**
 * Rodada 10 — custo de CPU da ANIMAÇÃO com N lutadores perto (dev/human.html?tl=1&fighters=N): todos trocam golpes
 * (soco, soco 2, chute, chute final, esquiva, taco) a cada 0,4 s, parados e andando; mede ms por quadro do update
 * (mixer + camadas + ajustes) de todos. Repete 5× e devolve a mediana.
 * uso: node tools/qa/anim_cost_r10.mjs <devBase> [N=20] [lod=0]
 */
import puppeteer from 'puppeteer-core';

const [BASE = 'http://localhost:5185', N = '20', LOD = '0'] = process.argv.slice(2);
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 640, height: 400 } });
const pg = await br.newPage();
await pg.goto(`${BASE}/dev/human.html?tl=1&fighters=${N}&lod=${LOD}&cam=wide`);
await pg.waitForFunction('window.__humanReady && window.__human.chars.every((c) => c.animator)', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
const res = await pg.evaluate(() => {
  const t = window.__human.tl;
  const clips = ['cbt_punch', 'cbt_punch2', 'cbt_kick', 'cbt_kick_final', 'cbt_dodge', 'cbt_bat'];
  const run = (speed) => {
    t.speed(speed);
    t.bench(60);
    let ms = 0, n = 0;
    for (let r = 0; r < 24; r++) { t.combat(clips[r % clips.length]); ms += t.bench(24) * 24; n += 24; }
    return ms / n;
  };
  const out = { idle: [], walk: [] };
  for (let k = 0; k < 5; k++) { out.idle.push(run(0)); out.walk.push(run(1.4)); }
  const med = (a) => a.sort((x, y) => x - y)[2];
  return { idleMs: +med(out.idle).toFixed(3), walkMs: +med(out.walk).toFixed(3) };
});
console.log(JSON.stringify({ fighters: Number(N), lod: Number(LOD), ...res }));
await br.close();
