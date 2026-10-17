/** Sonda: dirigir o carro sob latência/jitter e contar correções do servidor por motivo. */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [lag = '150', jit = '30'] = process.argv.slice(2);
const w = (ms) => new Promise((r) => setTimeout(r, ms));
try { await fetch('http://127.0.0.1:2631/metrics'); console.error('porta 2630 ocupada — abortando'); process.exit(2); } catch { /* livre */ }
const srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: '2630', PV_TEST: '1', COLYSEUS_LATENCY: lag, PV_JITTER: jit }, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
await w(5000);
const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const car = m.vehicleSpawns.find((v) => v.id === 'car0');
const sp = [car.x - Math.sin(car.heading) * 3.3, car.z - Math.cos(car.heading) * 3.3];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal'], defaultViewport: { width: 800, height: 500 } });
const p = await b.newPage();
await p.goto(`http://localhost:5173/?autostart=1&welcome=0&quality=low&mp=ws://127.0.0.1:2630&name=D&spawn=${sp[0]},${sp[1]}&jitter=${jit}`);
await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session', { timeout: 120000 });
await w(1500);
console.log('antes de entrar', JSON.stringify(await p.evaluate(() => window.__pv.mp().correctionReasons)));
await p.evaluate(() => window.__pv.key('KeyE')); await w(2000);
console.log('depois de entrar', JSON.stringify(await p.evaluate(() => window.__pv.mp().correctionReasons)));
console.log('riding', await p.evaluate(() => window.__pv.riding()), 'negativa', await p.evaluate(() => window.__pv.lastDenial()), JSON.stringify(await p.evaluate(() => window.__pv.metrics().player)));
await p.evaluate(() => { window.__pv.press('KeyW', 6000); window.__pv.press('KeyA', 1700); setTimeout(() => window.__pv.press('KeyD', 1100), 2600); });
for (let i = 0; i < 7; i++) { await w(1000); console.log(JSON.stringify(await p.evaluate(() => { const x = window.__pv.metrics().player; const mp = window.__pv.mp(); return { x: +x.x.toFixed(1), z: +x.z.toFixed(1), corr: mp.correctionReasons }; }))); }
await b.close(); process.kill(-srv.pid, 'SIGTERM'); process.exit(0);
