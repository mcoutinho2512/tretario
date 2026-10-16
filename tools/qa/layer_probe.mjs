/** Personagem com camadas ocultas, para achar quem atravessa a roupa. uso: node tools/qa/layer_probe.mjs <out-prefixo> "<query>" CAMADA[,CAMADA...] */
import puppeteer from 'puppeteer-core';
const [out, query, hide = ''] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1000, height: 1200 } });
const p = await b.newPage();
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/dev/human.html?${query}`);
await p.waitForFunction('window.__humanReady', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
const layers = await p.evaluate(() => { const s = new Set(); window.__human.chars[0].root.traverse((o) => { if (o.isMesh && o.userData.layer) s.add(o.userData.layer); }); return [...s]; });
console.log('camadas', layers.join(' '));
for (const h of hide.split(',').filter(Boolean)) {
  await p.evaluate((h) => window.__human.chars[0].root.traverse((o) => { if (o.isMesh) o.visible = o.userData.layer !== h; }), h);
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: `${out}_${h}.png` });
}
await b.close();
