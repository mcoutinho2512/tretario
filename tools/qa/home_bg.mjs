/**
 * Fundo da tela inicial (rodada 8): captura REAL do nosso mundo (evento padrão, multidão, trio) → public/ui/home-bg.jpg.
 * Sem HUD, preset ALTO, fim de tarde. uso (com o dev server): BASE=http://localhost:5173 node tools/qa/home_bg.mjs [saida.jpg]
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const OUT = process.argv[2] ?? 'public/ui/home-bg.jpg';
const BASE = process.env.BASE ?? 'http://localhost:5173';
const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const trio = m.vehicleSpawns.find((v) => v.kind === 'trio');
const H = trio.heading, fx = Math.sin(H), fz = Math.cos(H), sx = Math.cos(H), sz = -Math.sin(H);
const at = (along, side) => [trio.x + fx * along + sx * side, trio.z + fz * along + sz * side];
const [ALONG, SIDE, YAW, PITCH, DIST] = (process.env.VIEW ?? '-46,-8,0.22,0.2,22').split(',').map(Number);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1920, height: 1080 } });
const page = await b.newPage();
await page.goto(`${BASE}/?autostart=1&welcome=0&quality=high&time=${process.env.TIME ?? '17:05'}`);
await page.waitForFunction('window.__pvReady === true', { timeout: 180000 });
const p = at(ALONG, SIDE);
await page.evaluate((p, h, cam) => { window.__pv.hud(false); window.__pv.teleport(p[0], p[1], h); window.__pv.camera(...cam); }, p, H, [H + YAW, PITCH, DIST]);
await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 30000))); // a concentração se forma e o LOD chega
await page.screenshot({ path: OUT, type: 'jpeg', quality: 78 });
await b.close();
console.log('ok', OUT);
