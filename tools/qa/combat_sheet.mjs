/**
 * Rodada 9 — folha de contato dos clipes de CONFRONTO (golpes, esquiva, cambaleio): cada clipe de
 * public/gameplay/combat.json (+ cbt_stagger) em N instantes, de lado e de frente, num corpo.
 * uso (dev server): BASE=http://localhost:5173 node tools/qa/combat_sheet.mjs [corpo=homem] [instantes=4]
 * saída: screenshots/round9/clips/<clipe>_<vista>_<k>.jpg
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const [body = 'homem', nArg = '4'] = process.argv.slice(2);
const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = 'screenshots/round9/clips';
mkdirSync(OUT, { recursive: true });
const data = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8'));
const dur = { cbt_punch: 0.45, cbt_punch2: 0.46, cbt_kick: 0.72, cbt_kick_final: 0.79, cbt_dodge: 0.5, cbt_bat: 0.8, cbt_bar: 0.9, cbt_spray: 0.92, stagger: 0.55 };
const clips = [...new Set([...data.actions.map((a) => a.animation).filter((n) => n !== 'push'), 'stagger'])];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 300, height: 420 } });
const n = Number(nArg);
for (const clip of clips) {
  for (const [view, yaw] of [['lado', 1.57], ['frente', 0.35]]) {
    for (let k = 1; k <= n; k++) {
      const t = ((dur[clip] ?? 0.6) * k) / (n + 1);
      const p = await b.newPage();
      await p.goto(`${BASE}/dev/human.html?body=${body}&lod=0&cam=sheet&yaw=${yaw}&cbt=${clip}&t=${t.toFixed(3)}`);
      await p.waitForFunction('window.__humanReady', { timeout: 90000 });
      await new Promise((r) => setTimeout(r, 900));
      await p.screenshot({ path: `${OUT}/${clip}_${view}_${k}.jpg`, type: 'jpeg', quality: 80 });
      await p.close();
    }
  }
  console.log(clip);
}
await b.close();
