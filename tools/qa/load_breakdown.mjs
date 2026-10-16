/** Lista o que é baixado até o jogo ficar jogável (build de produção, servidor estilo produção). uso: node tools/qa/load_breakdown.mjs */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const PORT = 4181, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['tools/qa/static_server.mjs', String(PORT)], { stdio: 'ignore', detached: true });
process.on('exit', () => { try { process.kill(-srv.pid); } catch { /* */ } });
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal'] });
const p = await b.newPage();
const cdp = await p.target().createCDPSession();
await cdp.send('Network.enable');
const url = new Map(), rows = [];
let phase = 'home';
cdp.on('Network.requestWillBeSent', (e) => url.set(e.requestId, e.request.url.replace(BASE, '')));
cdp.on('Network.loadingFinished', (e) => rows.push({ phase, url: url.get(e.requestId), kb: e.encodedDataLength / 1e3 }));
await p.goto(`${BASE}/?quality=high`);
await p.waitForFunction(() => !document.getElementById('explore').disabled);
phase = 'jogo';
await p.click('#explore');
await p.waitForFunction('window.__pvReady === true', { timeout: 300000 });
phase = 'depois';
await new Promise((r) => setTimeout(r, 20000));
const groups = {};
for (const r of rows) {
  const k = `${r.phase} ${r.url.replace(/\/(chunk_|collision\.)[^/]*/, '/$1*').replace(/-[A-Za-z0-9_]{8}\.(js|css)$/, '.$1').replace(/\?.*/, '')}`;
  groups[k] = (groups[k] ?? 0) + r.kb;
}
Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log(v.toFixed(0).padStart(6), 'KB', k));
console.log('total', (rows.reduce((s, r) => s + r.kb, 0) / 1e3).toFixed(2), 'MB');
await b.close();
process.exit(0);
