/**
 * Captura de grafite numa superfície (single-player, sem servidor: o grafite fica local). Usa o editor de verdade
 * (mouse no canvas), publica e fotografa a parede com câmera livre. Também salva a tela do editor.
 * uso: node tools/qa/graffiti_shot.mjs [baseUrl] [idDaSuperfície=w0] [qualidade=high]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const [base = 'http://localhost:5173', sid = 'w0', quality = 'high'] = process.argv.slice(2);
const OUT = 'screenshots/round7/graffiti';
mkdirSync(OUT, { recursive: true });
const sf = JSON.parse(readFileSync('public/world/graffiti_surfaces.json', 'utf8')).surfaces.find((s) => s.id === sid);
if (!sf) { console.error(`superfície ${sid} não existe`); process.exit(2); }
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const nx = -sf.u[2], nz = sf.u[0];
const mid = [sf.o[0] + sf.u[0] * sf.w / 2, sf.o[2] + sf.u[2] * sf.w / 2];
const front = sf.kind === 'ground' ? [mid[0], sf.o[2] - sf.h / 2 + 1] : [mid[0] + nx * 1.3, mid[1] + nz * 1.3];
const yaw = sf.kind === 'ground' ? Math.PI : Math.atan2(sf.u[2], -sf.u[0]);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1280, height: 720 } });
const p = await browser.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto(`${base}/?autostart=1&welcome=0&quality=${quality}&time=10:30`);
await p.waitForFunction('window.__pvReady === true', { timeout: 120000 });
await p.evaluate((x, z, y) => window.__pv.teleport(x, z, y), front[0], front[1], yaw);
await w(4000);
await p.evaluate(() => window.__pv.key('KeyE'));
await p.waitForFunction('window.__pv.graffiti().editing', { timeout: 5000 });
const bb = await (await p.$('.gf-canvas')).boundingBox();
const mx = (u) => bb.x + u * bb.width, my = (v) => bb.y + v * bb.height;
const stroke = async (pts) => { await p.mouse.move(mx(pts[0][0]), my(pts[0][1])); await p.mouse.down(); for (const [u, v] of pts.slice(1)) await p.mouse.move(mx(u), my(v), { steps: 3 }); await p.mouse.up(); };
await p.click('[data-size="2"]');
// faixa amarela e onda verde (cores da bandeira), texto, coração e estrela
await p.click('[data-color="3"]'); await p.click('[data-w="2"]');
await stroke(Array.from({ length: 30 }, (_, i) => [0.06 + i * 0.03, 0.78 + Math.sin(i / 2.5) * 0.06]));
await p.click('[data-color="4"]');
await stroke(Array.from({ length: 30 }, (_, i) => [0.06 + i * 0.03, 0.9 + Math.sin(i / 2.5 + 1) * 0.04]));
await p.click('[data-tool="text"]'); await p.click('[data-color="1"]');
await p.type('.gf-text', 'EDUCAÇÃO JÁ');
await p.mouse.click(mx(0.5), my(0.42));
await p.click('[data-tool="stamp"]'); await p.click('[data-sym="0"]'); await p.click('[data-color="2"]');
await p.mouse.click(mx(0.07), my(0.16));
await p.click('[data-sym="1"]'); await p.click('[data-color="3"]');
await p.mouse.click(mx(0.93), my(0.16));
await p.click('[data-w="0"]'); await p.click('[data-tool="text"]'); await p.click('[data-color="0"]');
await p.type('.gf-text', 'ocupa a vargas');
await p.mouse.click(mx(0.5), my(0.64));
await p.screenshot({ path: `${OUT}/editor_${sid}.jpg`, quality: 85 });
await p.click('[data-act="send"]');
await w(1500);
const info = await p.evaluate(() => window.__pv.graffiti());
const g = info.list.at(-1);
console.log(`grafite ${g?.id} em ${g?.surface}: ${g?.bytes} B, ${g?.items} itens, tile ${g?.tiled}`);
const cx = mid[0], cz = mid[1];
// o personagem sai da frente (offline: teleporte local)
await p.evaluate((x, z, y) => window.__pv.teleport(x, z, y), cx + nx * 1.5 - sf.u[0] * 3.2, cz + nz * 1.5 - sf.u[2] * 3.2, yaw);
await p.evaluate((...a) => { window.__pv.hud(false); window.__pv.lookFrom(...a); }, cx + nx * 4.2 + sf.u[0] * 1.6, 1.7, cz + nz * 4.2 + sf.u[2] * 1.6, cx, 1.4, cz);
await w(2500);
await p.screenshot({ path: `${OUT}/J_grafite_parede_${sid}.jpg`, quality: 85 });
console.log(`${OUT}/J_grafite_parede_${sid}.jpg`);
await browser.close();
