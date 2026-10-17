/**
 * Rodada 8 — teste PONTA A PONTA de persistência de conta (HTTP + SDK do Colyseus, PostgreSQL real):
 *   cadastro → código na caixa de saída de DEV → verificação → aparência salva → ticket SEM concessão (espectador)
 *   → concessão pela CLI → ticket → entra JOGANDO → logout → REINICIA o servidor → login → GET /api/me igual
 *   → entra jogando de novo → suspensão pela CLI → a sala derruba (4002) → novo ticket só de espectador.
 *
 * Uso: node tools/qa/persistence_e2e.mjs [--port=2710] [--schema=e2e_auth]
 *   Precisa do banco local (docker compose up -d db) e de server/.env (DATABASE_URL). Usa um schema PRÓPRIO
 *   (recriado a cada execução; nunca `public`). Sobe e derruba o servidor sozinho.
 */
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVER = `${ROOT}server`;
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PORT = Number(arg('port', 2710));
const API = `http://127.0.0.1:${PORT + 1}`;
const SCHEMA = arg('schema', 'e2e_auth');
if (SCHEMA === 'public' || !/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('schema inválido');

const env0 = Object.fromEntries(readFileSync(`${SERVER}/.env`, 'utf8').split('\n').map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const u = new URL(process.env.DATABASE_URL ?? env0.DATABASE_URL);
u.searchParams.set('schema', SCHEMA);
const DB = u.toString();
const ENV = { ...process.env, DATABASE_URL: DB, PV_STORE: 'prisma', PORT: String(PORT), PV_DEV_MAIL: '1', PV_GRAFFITI_STORE: 'memory', PV_IDENTITY_RECHECK_MS: '1000', NODE_ENV: 'development' };

let ok = 0;
const check = (cond, msg) => { if (!cond) { console.error(`  FALHOU: ${msg}`); throw new Error(msg); } ok++; console.log(`  ok  ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- schema próprio, migrado do zero
const pgUrl = new URL(DB); pgUrl.searchParams.delete('schema');
const { default: pg } = await import(`${SERVER}/node_modules/pg/lib/index.js`);
const c = new pg.Client({ connectionString: pgUrl.toString() });
await c.connect();
await c.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); await c.query(`CREATE SCHEMA "${SCHEMA}"`);
await c.end();
execSync('npx prisma migrate deploy', { cwd: SERVER, env: ENV, stdio: 'ignore' });
console.log(`[e2e] schema ${SCHEMA} migrado`);

// --- servidor
let proc = null;
async function startServer() {
  proc = spawn('npx', ['tsx', 'src/index.ts'], { cwd: SERVER, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${API}/api/health`)).ok) return; } catch { /* subindo */ }
    if (proc.exitCode !== null) break;
    await sleep(250);
  }
  console.error(log);
  throw new Error('servidor não subiu');
}
async function stopServer() {
  if (!proc) return;
  const p = proc; proc = null;
  p.kill('SIGTERM');
  await new Promise((r) => { p.once('exit', r); setTimeout(r, 4000); });
}

// --- HTTP com "pote" de cookies (como o navegador: HttpOnly, mesma origem)
const jar = new Map();
async function http(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'user-agent': 'pv-e2e' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const sc of res.headers.getSetCookie()) {
    const [kv] = sc.split(';'); const i = kv.indexOf('=');
    const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
    if (/Max-Age=0/.test(sc)) jar.delete(k); else jar.set(k, v);
  }
  return { status: res.status, body: await res.json(), setCookie: res.headers.getSetCookie() };
}
const cli = (...a) => execSync(`npx tsx tools/admin.ts ${a.join(' ')}`, { cwd: SERVER, env: ENV, encoding: 'utf8' });

async function join(ticket) {
  const client = new Client(`ws://127.0.0.1:${PORT}`);
  const room = await client.joinOrCreate('presidente_vargas', { ticket, role: 'player', body: 'mulher' });
  const spawnMsg = await new Promise((res, rej) => { room.onMessage('spawn', res); room.onMessage('*', () => {}); setTimeout(() => rej(new Error('sem spawn')), 8000); });
  return { room, spawn: spawnMsg };
}

const email = `e2e+${Date.now()}@exemplo.test`, password = 'Lapa#Arcos2026', nickname = `E2e_${Date.now().toString(36).slice(-5)}`;
const appearance = { body: 'mulher', skin: 0xc68b62, hair: 0x2b1c12, top: 0xd23c3c, bottom: 0x2c3a52, shoes: 0x222222, scale: 1.02, accessory: 'bone', acc: 0x1e2a44 };

try {
  await startServer();
  console.log('[e2e] servidor no ar (1ª vez)');

  const reg = await http('POST', '/api/auth/register', { email, password, confirm: password, nickname });
  check(reg.status === 201, 'cadastro 201');
  check(reg.setCookie.some((s) => /pv_sid=.*HttpOnly.*SameSite=Lax/.test(s)), 'cookie de sessão HttpOnly + SameSite=Lax');
  check(!JSON.stringify(reg.body).includes(email), 'resposta não expõe o e-mail');
  const box = await http('GET', `/api/dev/outbox?email=${encodeURIComponent(email)}`);
  const code = box.body.messages.find((m) => m.kind === 'EMAIL_VERIFY')?.code;
  check(/^\d{6}$/.test(code ?? ''), 'código na caixa de saída de DEV');
  const ver = await http('POST', '/api/auth/verify-email', { code });
  check(ver.body.me?.user?.emailVerified === true, 'e-mail verificado');
  const ap = await http('PUT', '/api/me/appearance', { appearance });
  check(ap.status === 200, 'aparência salva');

  let t = await http('POST', '/api/session/ticket', { role: 'player' });
  check(t.body.role === 'spectator' && t.body.access.state === 'REGISTERED', 'sem concessão: ticket só de espectador');
  let j = await join(t.body.ticket);
  check(j.spawn.role === 'spectator', 'sala: entrou como ESPECTADOR mesmo pedindo player');
  await j.room.leave();

  check(/concedido/.test(cli('grant-access', email)), 'CLI concedeu acesso');
  t = await http('POST', '/api/session/ticket', { role: 'player' });
  check(t.body.role === 'player' && t.body.access.state === 'PLAYER', 'ticket de jogador após a concessão');
  j = await join(t.body.ticket);
  check(j.spawn.role === 'player', 'sala: entrou JOGANDO');
  await j.room.leave();

  const meBefore = (await http('GET', '/api/me')).body;
  await http('POST', '/api/auth/logout');
  check((await http('GET', '/api/me')).body.authenticated === false, 'logout encerra a sessão');

  await stopServer();
  console.log('[e2e] servidor REINICIADO');
  await startServer();

  check((await http('POST', '/api/auth/login', { email, password: 'errada-123' })).body.error === 'credenciais_invalidas', 'senha errada → erro genérico');
  const login = await http('POST', '/api/auth/login', { email: email.toUpperCase(), password });
  check(login.status === 200, 'login após reinício (e-mail em maiúsculas normalizado)');
  const meAfter = (await http('GET', '/api/me')).body;
  check(JSON.stringify(meAfter) === JSON.stringify(meBefore), 'GET /api/me idêntico antes e depois do reinício');
  check(meAfter.user.nickname === nickname && meAfter.appearance?.top === appearance.top && meAfter.access.state === 'PLAYER', 'perfil, aparência e acesso persistidos');
  check(meAfter.membership === null, 'sem grupo escolhido (membership null)');

  t = await http('POST', '/api/session/ticket', { role: 'player' });
  j = await join(t.body.ticket);
  check(j.spawn.role === 'player', 'entra jogando de novo após o reinício');
  const closed = new Promise((res) => j.room.onLeave((code) => res(code)));
  cli('suspend', email, '--hours=1', '--reason=teste-e2e');
  const code2 = await Promise.race([closed, sleep(6000).then(() => 'timeout')]);
  check(code2 === 4002, `suspensão pela CLI: sala desconectou com 4002 (recebido ${code2})`);
  t = await http('POST', '/api/session/ticket', { role: 'player' });
  check(t.body.role === 'spectator' && t.body.access.state === 'SUSPENDED', 'suspenso: só ticket de espectador');
  j = await join(t.body.ticket);
  check(j.spawn.role === 'spectator', 'suspenso entra como espectador');
  await j.room.leave();
  cli('unsuspend', email);

  console.log(`\n[e2e] PASSOU — ${ok} verificações`);
} catch (e) {
  console.error(`\n[e2e] FALHOU após ${ok} verificações: ${e.message}`);
  process.exitCode = 1;
} finally {
  await stopServer();
}
