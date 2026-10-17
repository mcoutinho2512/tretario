/** Quadros do jogador caminhando no jogo (câmera lateral) para checar contato com o chão. uso: node tools/qa/walk_frames.mjs <pasta> [avatar=homem] */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const [out = 'screenshots/walk', avatar = 'homem'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 900, height: 700 } });
const p = await b.newPage();
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/?autostart=1&welcome=0&quality=high&time=10:30&avatar=${avatar}`);
await p.waitForFunction('window.__pvReady === true', { timeout: 180000 });
await p.evaluate(() => { window.__pv.hud(false); window.__pv.teleport(-540, 255, 2.0); });
await new Promise((r) => setTimeout(r, 7000)); // LOD0 chega depois de jogável
await p.evaluate((RUN) => { window.__pv.walkTo(-540 + Math.sin(2.0) * 40, 255 + Math.cos(2.0) * 40, RUN); }, process.env.RUN === '1');
await new Promise((r) => setTimeout(r, 1500));
for (let i = 0; i < 8; i++) {
  await p.evaluate(() => window.__pv.camera(2.0 + Math.PI / 2, 0.02, 4.2));
  await p.screenshot({ path: `${out}/f${i}.jpg`, type: 'jpeg', quality: 85 });
  await new Promise((r) => setTimeout(r, 90));
}
await b.close();
