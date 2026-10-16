/**
 * Gera os retratos estáticos da tela inicial (public/ui/portraits/<corpo>.png → .webp) com a aparência padrão,
 * usando o mesmo renderizador da prévia. uso (com `npm run dev`): node tools/qa/make_portraits.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
const p = await b.newPage();
await p.goto(`${process.env.BASE ?? 'http://localhost:5173'}/`);
await p.waitForFunction('window.__pvStart', { timeout: 60000 });
const urls = await p.evaluate(async () => {
  const D = {
    homem: { body: 'homem', skin: 0xb98a68, hair: 0x1d1714, top: 0x2f6f8f, bottom: 0x2c3a52, shoes: 0xe8e8e2, scale: 1, accessory: 'nenhum' },
    mulher: { body: 'mulher', skin: 0xc68b62, hair: 0x2b1c12, top: 0xd23c3c, bottom: 0x1f2430, shoes: 0xe8e8e2, scale: 1, accessory: 'nenhum' },
    idoso: { body: 'idoso', skin: 0xe0ac85, hair: 0xd6d2cc, top: 0xe8e6e0, bottom: 0x6b5a45, shoes: 0x5a3a22, scale: 1, accessory: 'nenhum' },
    idosa: { body: 'idosa', skin: 0xa86e4a, hair: 0xbdb8b0, top: 0x8c4a9e, bottom: 0x24395e, shoes: 0x222222, scale: 1, accessory: 'nenhum' },
  };
  return window.__pvStart.preview.portraits(Object.values(D), 256);
});
mkdirSync('public/ui/portraits', { recursive: true });
['homem', 'mulher', 'idoso', 'idosa'].forEach((n, i) => writeFileSync(`public/ui/portraits/${n}.png`, Buffer.from(urls[i].split(',')[1], 'base64')));
await b.close();
