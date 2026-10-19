/**
 * Rodada 12 (agente D) — capturas da apresentação da população: servidor de TESTE (porta 4480) com bots marcados como
 * autônomos (PV_QA_BOT_KIND=1, apelidos do autonomous.json), cliente no meio.
 *   B_personagens_com_nomes   multidão com nomes (LOD/teto/oclusão)
 *   C_com_e_sem_nomes         mesma cena anotada: anel verde = tem nome (regra), cinza = autônomo sem nome
 *   D_painel_autonomo         painel da pessoa de um autônomo (sem SILENCIAR/DENUNCIAR)
 *   E_olhando                 cabeças/troncos olhando para o jogador (QA: __pvR12.lookAtMe)
 *   F_minimapa_eventos        focos dinâmicos agregados no minimapa expandido (QA: __pvR12.dyn)
 * uso: node tools/qa/round12_people_shots.mjs [baseUrl=http://localhost:5214]
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5214';
const OUT = 'docs/screenshots/round12';
mkdirSync(OUT, { recursive: true });
const PORT = 4480;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const M = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const a = M.pvAxis[11], b = M.pvAxis[12];
const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
const server = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_QA_BOT_KIND: '1' }, stdio: ['ignore', 'pipe', 'ignore'], detached: true });
const log = [];
server.stdout.on('data', (d) => log.push(...d.toString().split('\n').filter(Boolean)));
for (let i = 0; i < 225 && !log.some((l) => l.includes('[pv3d-server]')); i++) await w(200);
const bots = spawn('npx', ['tsx', 'tools/bots.ts', '70', '900', `ws://127.0.0.1:${PORT}`, 'dense', '--social=0.3', '--names'], { cwd: 'server', stdio: 'ignore', detached: true });
const kill = () => { try { process.kill(-bots.pid, 'SIGTERM'); } catch { /* */ } try { process.kill(-server.pid, 'SIGTERM'); } catch { /* */ } };
process.on('exit', kill);
const info = {};
let browser = null;
try {
  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', protocolTimeout: 600000, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 720 } });
  const p = await browser.newPage();
  await p.goto(`${base}/?autostart=1&welcome=0&quality=high&crowdSkinned=32&time=10:30&mp=ws://127.0.0.1:${PORT}&name=Fotografo&spawn=${cx.toFixed(1)},${cz.toFixed(1)}`);
  await p.waitForFunction('window.__pvReady === true && window.__pv.mp()?.session && window.__pvR12', { timeout: 240000 });
  await p.evaluate((x, z) => { window.__pvProg?.tp(x, z); window.__pv.teleport(x, z, 0); }, cx, cz);
  for (let i = 0; i < 60; i++) { const n = await p.evaluate(() => window.__pv.metrics().net?.remotes ?? 0); if (n >= 45) break; await w(1000); }
  await p.evaluate(() => { window.__pv.camera(0.5, 0.2, 6); window.__pv.hudSet({ names: 'PROXIMOS' }); });
  await w(5000);
  await p.screenshot({ path: `${OUT}/B_personagens_com_nomes.jpg`, type: 'jpeg', quality: 82 });
  info.B = await p.evaluate(() => window.__pvR12.labels());
  // C: anotação (anel verde = tem nome pela regra; cinza = autônomo sem nome) — só para a captura
  const people = await p.evaluate(() => window.__pvR12.people());
  info.C = { total: people.length, tagged: people.filter((x) => x.tagged).length, untagged: people.filter((x) => !x.tagged).length, shown: people.filter((x) => x.shown).length, untaggedShown: people.filter((x) => !x.tagged && x.shown).length };
  await p.evaluate((list) => {
    const lay = document.createElement('div'); lay.id = 'qa-ann'; lay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
    for (const q of list) {
      const d = document.createElement('div');
      const r = Math.max(8, 26 - q.d * 0.5);
      d.style.cssText = `position:absolute;left:${q.px - r}px;top:${q.py - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;border:2px solid ${q.tagged ? '#3ddc84' : '#9aa0a6'};${q.tagged ? '' : 'border-style:dashed;'}`;
      lay.append(d);
    }
    const leg = document.createElement('div');
    leg.style.cssText = 'position:absolute;left:16px;bottom:120px;background:rgba(0,0,0,.65);color:#fff;font:600 13px system-ui;padding:8px 10px;border-radius:6px';
    leg.innerHTML = '<span style="color:#3ddc84">●</span> com nome (perto: aparece) &nbsp; <span style="color:#9aa0a6">◌</span> sem nome (regra: parte dos personagens)';
    lay.append(leg);
    document.body.append(lay);
  }, people);
  await w(300);
  await p.screenshot({ path: `${OUT}/C_com_e_sem_nomes.jpg`, type: 'jpeg', quality: 82 });
  await p.evaluate(() => document.getElementById('qa-ann')?.remove());
  // D: painel de um autônomo com nome, perto
  const near = people.filter((x) => x.kind === 1 && x.tagged).sort((x, y) => x.d - y.d)[0];
  if (near) {
    await p.evaluate((n) => window.__pvInv?.showPerson(n), near.name);
    await w(600);
    await p.screenshot({ path: `${OUT}/D_painel_autonomo.jpg`, type: 'jpeg', quality: 82 });
    info.D = await p.evaluate(() => window.__pv.person?.() ?? null);
    await p.keyboard.press('Escape');
  }
  // E: olhar para o jogador
  await p.evaluate(() => { window.__pvR12.lookAtMe(true); window.__pv.camera(3.3, 0.12, 4.5); });
  await w(3500);
  await p.screenshot({ path: `${OUT}/E_olhando.jpg`, type: 'jpeg', quality: 82 });
  info.E = await p.evaluate(() => window.__pvR12.lookStats());
  await p.evaluate(() => window.__pvR12.lookAtMe(false));
  // F: focos dinâmicos no minimapa (agregados)
  info.F = await p.evaluate((x, z) => window.__pvR12.dyn({ events: [
    { id: 'f1', kind: 'FESTA', x: x + 40, z: z - 20, r: 25, participants: 40 },
    { id: 'b1', kind: 'BRIGA', x: x - 60, z: z + 30, r: 12, escalation: 'CONFRONTO', participants: 8, watchers: 20 },
    { id: 'c1', kind: 'CONCENTRACAO', x: x + 160, z: z + 60, r: 40, participants: 90 },
  ] }), cx, cz);
  await p.evaluate(() => window.__pv.hudSet({ map: true }));
  await w(1500);
  await p.screenshot({ path: `${OUT}/F_minimapa_eventos.jpg`, type: 'jpeg', quality: 82 });
  info.audio = await p.evaluate(() => window.__pv.audio?.().world ?? null);
  writeFileSync(`${OUT}/round12_people_shots.json`, JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  try { await browser?.close(); } catch { /* */ }
  kill();
  process.exit(process.exitCode ?? 0);
}
