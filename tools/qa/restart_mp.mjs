/**
 * Rodada 9.1 — REINÍCIO DO SERVIDOR com o jogo aberto (navegador real, conta real no PostgreSQL, sem recarregar a página):
 *  1. conta liberada (cadastro → código de DEV → verificação → CLI grant-access) entra JOGANDO pelo navegador
 *  2. reinício GRACIOSO (SIGTERM): o cliente recebe `server_restarting`, mostra "SERVIDOR REINICIANDO — RECONECTANDO…";
 *     o processo novo sobe → o cliente entra de novo SOZINHO como entidade nova, com a MESMA conta (ticket novo,
 *     papel jogador, apelido da conta) e o mesmo progresso; a página não recarrega
 *  3. QUEDA do processo (SIGKILL, sem aviso): "RECONECTANDO…" → reconexão falha (sala sumiu) → entra de novo, idem
 *  4. queda de rede curta com o servidor de pé: volta na MESMA entidade (graça) — controle
 * Um espectador do SDK confere que o mundo tem exatamente UMA entidade com o apelido da conta depois de cada volta.
 *
 * uso: node tools/qa/restart_mp.mjs [baseUrl] [--port=2960] [--schema=p91_b_restart]
 *   O Vite em baseUrl precisa ter PV_API=http://127.0.0.1:<port+1> (proxy da API → cookie de sessão na mesma origem).
 */
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVER = `${ROOT}server`;
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:5312';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(arg('port', 2960));
const API = `http://127.0.0.1:${PORT + 1}`;
const SCHEMA = arg('schema', 'p91_b_restart');
if (SCHEMA === 'public' || !/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('schema inválido');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const until = async (fn, ms = 10000, step = 150) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await w(step); } return null; };

const env0 = Object.fromEntries(readFileSync(`${SERVER}/.env`, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const u = new URL(process.env.DATABASE_URL ?? env0.DATABASE_URL);
u.searchParams.set('schema', SCHEMA);
const DB = u.toString();
const ENV = { ...process.env, DATABASE_URL: DB, PV_STORE: 'prisma', PORT: String(PORT), PV_DEV_MAIL: '1', PV_GRAFFITI_STORE: 'memory', NODE_ENV: 'development', PV_GRACE_S: '8', PV_LOG_QUIET: '1' };

const { default: pg } = await import(`${SERVER}/node_modules/pg/lib/index.js`);
const pgUrl = new URL(DB); pgUrl.searchParams.delete('schema');
async function sql(q) { const c = new pg.Client({ connectionString: pgUrl.toString() }); await c.connect(); try { await c.query(q); } finally { await c.end(); } }
await sql(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); await sql(`CREATE SCHEMA "${SCHEMA}"`);
execSync('npx prisma migrate deploy', { cwd: SERVER, env: ENV, stdio: 'ignore' });
console.log(`[restart] schema ${SCHEMA} migrado`);

let proc = null;
const serverLog = [];
async function startServer() {
  proc = spawn('npx', ['tsx', 'src/index.ts'], { cwd: SERVER, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => serverLog.push(...String(d).split('\n').filter(Boolean)));
  proc.stderr.on('data', (d) => serverLog.push(...String(d).split('\n').filter(Boolean)));
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`${API}/health/ready`)).ok) return; } catch { /* subindo */ }
    if (proc.exitCode !== null) break;
    await w(250);
  }
  console.error(serverLog.slice(-30).join('\n'));
  throw new Error('servidor não subiu');
}
async function stopServer(signal) {
  if (!proc) return null;
  const p = proc; proc = null;
  const t0 = Date.now();
  // npx → tsx → node: o SIGKILL tem de chegar ao node de verdade (quem escuta a porta)
  if (signal === 'SIGKILL') { try { execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN | xargs kill -9`, { stdio: 'ignore' }); } catch { /* */ } }
  p.kill(signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
  const code = await new Promise((r) => { p.once('exit', (c) => r(c)); setTimeout(() => r('timeout'), 16000); });
  for (let i = 0; i < 40; i++) { try { execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { stdio: 'ignore' }); await w(100); } catch { break; } }
  return { code, ms: Date.now() - t0 };
}

// --- conta pelo HTTP (pote de cookies próprio — o navegador entra depois com a MESMA conta)
const jar = new Map();
async function http(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const sc of res.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))); }
  return { status: res.status, body: await res.json() };
}
const email = `restart+${Date.now()}@exemplo.test`, password = 'Lapa#Arcos2026', nickname = `Rst_${Date.now().toString(36).slice(-5)}`;
const appearance = { body: 'mulher', skin: 0xc68b62, hair: 0x2b1c12, top: 0xd23c3c, bottom: 0x2c3a52, shoes: 0x222222, scale: 1, accessory: 'nenhum', acc: 0x222222 };

let browser = null;
let observer = null;
/** espectador do SDK: entidades com o apelido da conta no mundo */
async function observe() {
  observer = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { role: 'spectator', pv: 1, specCam: { x: -580, z: 280 } });
  observer.onMessage('*', () => {});
}
const namedInWorld = () => { let n = 0; observer?.state?.players?.forEach((p) => { if (p.name === nickname) n++; }); return n; };

try {
  await startServer();
  const reg = await http('POST', '/api/auth/register', { email, password, confirm: password, nickname });
  const code = (await http('GET', `/api/dev/outbox?email=${encodeURIComponent(email)}`)).body.messages.find((m) => m.kind === 'EMAIL_VERIFY')?.code;
  await http('POST', '/api/auth/verify-email', { code });
  await http('PUT', '/api/me/appearance', { appearance });
  execSync(`npx tsx tools/admin.ts grant-access ${email}`, { cwd: SERVER, env: ENV, stdio: 'ignore' });
  check('conta criada, verificada e liberada (PLAYER)', reg.status === 201 && (await http('GET', '/api/me')).body.access?.state === 'PLAYER');

  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 900, height: 560 } });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pagina] ERRO', e.message));
  const url = `${base}/?welcome=0&quality=low&time=10:30&mp=ws://127.0.0.1:${PORT}`;
  await page.goto(url);
  const login = await page.evaluate(async (e, p) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).status, email, password);
  check('login pelo navegador (mesma origem, proxy do Vite)', login === 200, `status ${login}`);
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('home-who')?.classList.contains('hidden') && typeof window.__pvLaunch === 'function', { timeout: 60000 });
  await page.evaluate(() => { window.__pvMarker = 'mesma-pagina'; window.__pvLaunch({ role: 'player' }); });
  await page.waitForFunction('window.__pvReady === true && window.__pv?.mp()?.session && window.__pv.mp().status === "online"', { timeout: 180000 });
  const mp = () => page.evaluate(() => { const m = window.__pv.mp(); return { session: m.session, role: m.role, link: m.link, status: m.status, reconnects: m.reconnects, rejoins: m.rejoins, marker: window.__pvMarker, badge: document.querySelector('.net-link')?.textContent ?? '', badgeOn: !!document.querySelector('.net-link.show') }; });
  const progress = () => page.evaluate(async () => { const r = await fetch('/api/me/progress'); return r.ok ? JSON.stringify(await r.json()) : `http_${r.status}`; });
  const m0 = await mp();
  const p0 = await progress();
  check('entrou JOGANDO com a conta', m0.role === 'player' && m0.status === 'online', JSON.stringify(m0));
  await observe();
  check('o mundo tem UMA entidade com o apelido da conta', !!(await until(async () => namedInWorld() === 1, 6000)), `${namedInWorld()}`);

  // ---------------------------------------------------------------- 2. reinício gracioso (SIGTERM)
  const stop1 = stopServer('SIGTERM');
  const badge1 = await until(async () => { const m = await mp(); return m.badgeOn && /REINICIANDO/.test(m.badge) ? m : null; }, 6000, 50);
  check('SIGTERM: cliente mostra "SERVIDOR REINICIANDO — RECONECTANDO…"', !!badge1, badge1?.badge ?? (await mp()).badge);
  const s1 = await stop1;
  check('SIGTERM: processo sai com 0 em < 15 s', s1.code === 0 && s1.ms < 15000, JSON.stringify(s1));
  check('servidor gravou e encerrou (log "encerrado")', serverLog.some((l) => l.includes('[shutdown] encerrado')));
  await w(2500);
  const mid = await mp();
  check('servidor fora: continua RECONECTANDO, sem recarregar a página', mid.badgeOn && mid.marker === 'mesma-pagina', `${mid.badge} · status ${mid.status}`);
  const tUp = Date.now();
  await startServer();
  const r1 = await until(async () => { const m = await mp(); return m.status === 'online' && m.rejoins >= 1 ? m : null; }, 60000, 200);
  check('processo novo: cliente entrou de novo sozinho (entidade nova)', !!r1 && r1.session !== m0.session, r1 ? `${Date.now() - tUp} ms depois de o servidor subir · ${r1.session} ≠ ${m0.session}` : JSON.stringify(await mp()));
  check('mesma CONTA: papel jogador (ticket novo, não virou visitante)', r1?.role === 'player');
  check('página NÃO recarregou; selo some', r1?.marker === 'mesma-pagina' && !(await until(async () => (await mp()).badgeOn === false ? true : null, 3000) === null));
  check('progresso da conta preservado (GET /api/me/progress igual)', (await progress()) === p0);
  await observe();
  check('depois do reinício: UMA entidade com o apelido da conta', !!(await until(async () => namedInWorld() === 1, 8000)), `${namedInWorld()}`);

  // ---------------------------------------------------------------- 3. queda do processo (SIGKILL, sem aviso)
  const k = await stopServer('SIGKILL');
  check('SIGKILL: processo morto', k.code !== 0, JSON.stringify(k));
  const badge2 = await until(async () => { const m = await mp(); return m.badgeOn && /RECONECTANDO/.test(m.badge) ? m : null; }, 6000, 50);
  check('queda: cliente mostra RECONECTANDO…', !!badge2, badge2?.badge ?? '');
  await w(3000);
  await startServer();
  const r2 = await until(async () => { const m = await mp(); return m.status === 'online' && m.rejoins >= 2 ? m : null; }, 60000, 200);
  check('depois da queda: entrou de novo sozinho, mesma conta (jogador)', !!r2 && r2.role === 'player' && r2.session !== r1?.session, r2 ? `${r2.session} rejoins=${r2.rejoins}` : JSON.stringify(await mp()));
  check('página NÃO recarregou', r2?.marker === 'mesma-pagina');
  await observe();
  check('depois da queda: UMA entidade com o apelido da conta', !!(await until(async () => namedInWorld() === 1, 8000)), `${namedInWorld()}`);

  // ---------------------------------------------------------------- 4. controle: queda de rede curta → mesma entidade
  const before = await mp();
  await page.evaluate(() => window.__pv.netDrop());
  const r3 = await until(async () => { const m = await mp(); return m.status === 'online' && m.reconnects > before.reconnects ? m : null; }, 12000, 150);
  check('queda curta (servidor de pé): volta na MESMA entidade (graça)', !!r3 && r3.session === before.session && r3.rejoins === before.rejoins, r3 ? r3.session : JSON.stringify(await mp()));
} catch (e) {
  check(`execução sem exceção (${e.message})`, false);
} finally {
  try { await observer?.leave(); } catch { /* */ }
  await browser?.close().catch(() => {});
  await stopServer('SIGTERM');
  await sql(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`).catch(() => {});
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n[restart] ${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
