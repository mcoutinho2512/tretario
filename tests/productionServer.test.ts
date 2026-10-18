/**
 * Rodada 9.1 — servidor REAL (subprocesso, PV_TEST=1, memória) atrás de um proxy HTTP local que REMOVE o prefixo
 * `/game` (como o Nginx do deploy/CONTRACT.md: `location /game/` → `http://127.0.0.1:PORT/`, com Upgrade):
 *  - o SDK 0.18 com endpoint `ws://…/game` faz o matchmaking HTTP e o WebSocket pelo prefixo, e RECONECTA por ele;
 *  - protocolo diferente → erro 4010 (protocolo); ausente aceito fora de produção;
 *  - lotação por papel (MAX_PLAYERS_PER_ROOM=2, MAX_SPECTATORS_PER_ROOM=1) com clientes forjados: recusa clara
 *    (4011 sala_cheia / 4012), sem travar; o espectador continua entrando quando só os jogadores lotaram;
 *  - /health/live, /health/ready, /api/status, /internal/health (token).
 *  - processo REAL: SIGTERM com cliente conectado → `server_restarting` + fechamento 4001, sai com 0 em < 15 s, logs
 *    JSON (PV_LOG_FORMAT=json) válidos e sem dado sensível; NODE_ENV=production com PV_TEST → recusa subir (sai com 1).
 * PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { JOIN_ERROR, PROTOCOL_VERSION } from '../src/net/protocol';

const PORT = 28300 + (process.pid % 300) * 4;
const PROXY = PORT + 2;
const API = `http://127.0.0.1:${PORT + 1}`;
const EP = `ws://127.0.0.1:${PROXY}/game`;
const TOKEN = 'qa-token-0123456789abcdefghijklmnopqrstuv';
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'spawn', 'correct', 'chat_hello', 'chat', 'chat_mutes', 'ads', 'evt', 'evt_agenda', 'prog', 'items', 'server_restarting'];
const skip = process.env.PV_SKIP_NET_TESTS === '1';

/** proxy mínimo: só `/game/*`, prefixo removido; HTTP por http.request e Upgrade por túnel TCP (como o Nginx) */
function prefixProxy(target: number): Server {
  const strip = (u = '/') => (u === '/game' ? '/' : u.slice('/game'.length));
  const srv = createServer((req, res) => {
    if (!req.url?.startsWith('/game/') && req.url !== '/game') { res.writeHead(404); res.end(); return; }
    const up = request({ host: '127.0.0.1', port: target, method: req.method, path: strip(req.url), headers: { ...req.headers, 'x-forwarded-for': '203.0.113.9' } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  srv.on('upgrade', (req, sock, head) => {
    if (!req.url?.startsWith('/game/')) { sock.destroy(); return; }
    const up = connect(target, '127.0.0.1', () => {
      const lines = [`${req.method} ${strip(req.url)} HTTP/1.1`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`), '', ''];
      up.write(lines.join('\r\n'));
      if (head?.length) up.write(head);
      up.pipe(sock); sock.pipe(up);
    });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  return srv;
}

let srv: ChildProcess | null = null;
let proxy: Server | null = null;
const rooms: Room[] = [];
async function join(o: Record<string, unknown>, ep = EP): Promise<Room> {
  const r = await new Client(ep).joinOrCreate('presidente_vargas', { ...APP, pv: PROTOCOL_VERSION, ...o });
  for (const t of QUIET) r.onMessage(t, () => {});
  r.onMessage('*', () => {});
  rooms.push(r);
  return r;
}
const codeOf = async (p: Promise<unknown>) => { try { await p; return 0; } catch (e) { return (e as { code?: number }).code ?? -1; } };

describe.skipIf(skip)('produção (rodada 9.1) — prefixo /game, protocolo, lotação, saúde', () => {
  beforeAll(async () => {
    srv = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { // como em produção (systemd): um processo só, o sinal chega direto ao node
      cwd: 'server', detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_ADMIN_TOKEN: TOKEN, MAX_PLAYERS_PER_ROOM: '2', MAX_SPECTATORS_PER_ROOM: '1', PV_GRACE_S: '8' },
    });
    let ready = false;
    srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; });
    srv.stderr!.on('data', () => {});
    for (let i = 0; i < 150 && !ready; i++) await w(100);
    if (!ready) throw new Error('servidor de teste não subiu');
    proxy = prefixProxy(PORT);
    await new Promise<void>((r) => proxy!.listen(PROXY, '127.0.0.1', () => r()));
  }, 30_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(1500)]);
    proxy?.close();
    if (srv?.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
  });

  it('saúde e status', async () => {
    expect(await (await fetch(`${API}/health/live`)).json()).toEqual({ ok: true });
    const ready = await fetch(`${API}/health/ready`);
    expect(ready.status).toBe(200);
    const st = await (await fetch(`${API}/api/status`)).json() as Record<string, unknown>;
    expect(Object.keys(st).sort()).toEqual(['online', 'protocol', 'version']);
    expect(st.online).toBe(true); expect(st.protocol).toBe(PROTOCOL_VERSION);
    expect((await fetch(`${API}/internal/health`)).status).toBe(401);
    expect((await fetch(`${API}/internal/health`, { headers: { 'x-admin-token': `${TOKEN}x` } })).status).toBe(401);
    const ih = await (await fetch(`${API}/internal/health`, { headers: { 'x-admin-token': TOKEN } })).json() as Record<string, any>;
    for (const k of ['uptimeS', 'version', 'commit', 'buildTime', 'db', 'players', 'spectators', 'rooms', 'tick', 'eventLoop', 'memory', 'websockets']) expect(ih).toHaveProperty(k);
    expect(ih.db.kind).toBe('memory');
    expect(typeof ih.eventLoop.p99Ms).toBe('number');
  });

  it('SDK pelo prefixo /game (proxy que remove o prefixo): entra, troca mensagens e reconecta na mesma entidade', async () => {
    const A = await join({ name: 'A', testSpawn: { x: -540, z: 255 } });
    const pong = new Promise<boolean>((res) => { A.onMessage('pong', () => res(true)); setTimeout(() => res(false), 3000); });
    A.send('ping', Date.now());
    expect(await pong).toBe(true);
    const sid = A.sessionId;
    const back = new Promise<boolean>((res) => { A.onReconnect(() => res(true)); setTimeout(() => res(false), 8000); });
    A.reconnection.minUptime = 0;
    (A as unknown as { connection: { transport: { ws: { close(): void } } } }).connection.transport.ws.close(); // queda sem consentimento (1005/1006)
    expect(await back).toBe(true);
    expect(A.sessionId).toBe(sid);
    const ih = await (await fetch(`${API}/internal/health`, { headers: { 'x-admin-token': TOKEN } })).json() as Record<string, number>;
    expect(ih.players).toBeGreaterThanOrEqual(1);
    expect(ih.websockets).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('protocolo diferente → 4010; ausente aceito fora de produção', async () => {
    expect(await codeOf(new Client(EP).joinOrCreate('presidente_vargas', { ...APP, pv: PROTOCOL_VERSION + 1 }))).toBe(JOIN_ERROR.protocol);
    expect(await codeOf(new Client(EP).joinOrCreate('presidente_vargas', { ...APP, pv: 'x' }))).toBe(JOIN_ERROR.protocol);
    const ok = await new Client(EP).joinOrCreate('presidente_vargas', { ...APP, role: 'spectator' }); // sem pv
    for (const t of QUIET) ok.onMessage(t, () => {}); ok.onMessage('*', () => {});
    await ok.leave();
  });

  it('lotação: 3º jogador recusado na hora com sala_cheia; espectador entra; 2º espectador recusado', async () => {
    // A (teste anterior) já é jogador; B completa 2
    await join({ name: 'B', testSpawn: { x: -530, z: 255 } });
    const t0 = Date.now();
    let err: { code?: number; message?: string } = {};
    try { await join({ name: 'C' }); } catch (e) { err = e as typeof err; }
    expect(err.code).toBe(JOIN_ERROR.roomFull);
    expect(err.message).toBe('sala_cheia');
    expect(Date.now() - t0).toBeLessThan(3000); // sem espera
    const S = await join({ role: 'spectator' });
    expect(S.sessionId).toBeTruthy();
    expect(await codeOf(join({ role: 'spectator' }))).toBe(JOIN_ERROR.spectatorsFull);
    // continua UM mundo só (o joinOrCreate não abriu outra sala por lotação)
    const ih = await (await fetch(`${API}/internal/health`, { headers: { 'x-admin-token': TOKEN } })).json() as Record<string, number>;
    expect(ih.rooms).toBe(1);
    expect(ih.players).toBe(2);
  }, 20_000);
});

describe.skipIf(skip)('processo real — desligamento gracioso (SIGTERM) e travas de produção', () => {
  const P2 = PORT + 3 + 1000;
  it('SIGTERM: avisa os clientes, fecha com 4001, grava e sai com 0 em < 15 s; logs JSON', async () => {
    const lines: string[] = [];
    const p = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { // como em produção (systemd): um processo só, o sinal chega direto ao node
      cwd: 'server', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(P2), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_LOG_FORMAT: 'json' },
    });
    let buf = '';
    const eat = (d: Buffer) => { buf += String(d); let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } };
    p.stdout!.on('data', eat); p.stderr!.on('data', eat);
    const exited = new Promise<number | null>((r) => p.once('exit', (c) => r(c)));
    for (let i = 0; i < 150 && !lines.some((l) => l.includes('"evt":"startup"') && l.includes('apiPort')); i++) await w(100);
    const r = await new Client(`ws://127.0.0.1:${P2}`).joinOrCreate('presidente_vargas', { ...APP, pv: PROTOCOL_VERSION, name: 'Z' });
    for (const t of QUIET) r.onMessage(t, () => {});
    r.onMessage('*', () => {});
    let warned = false;
    r.onMessage('server_restarting', () => { warned = true; });
    const left = new Promise<number>((res) => r.onLeave((c) => res(c)));
    await w(500);
    const t0 = Date.now();
    p.kill('SIGTERM'); // direto ao node (sem o wrapper npx, que no Linux morre pelo sinal e devolve código null)
    const code = await Promise.race([exited, w(16_000).then(() => 'timeout' as const)]);
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(warned).toBe(true);
    expect(await left).toBe(4001);
    const json = lines.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l) as Record<string, unknown>);
    const evts = json.map((j) => j.evt);
    expect(evts).toEqual(expect.arrayContaining(['startup', 'ws.join', 'shutdown']));
    expect(json.find((j) => j.evt === 'shutdown' && j.msg === 'encerrado')).toBeTruthy();
    // nenhuma linha fora do JSON (sem banner) e nada sensível
    expect(lines.filter((l) => l.trim() && !l.startsWith('{'))).toEqual([]);
    for (const l of lines) expect(l).not.toMatch(/"(password|token|cookie|email|ticket|ip)"/i);
  }, 30_000);

  it('NODE_ENV=production com PV_TEST/segredo fraco → recusa subir (sai com 1, sem abrir porta)', async () => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { // como em produção (systemd): um processo só, o sinal chega direto ao node
      cwd: 'server', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(P2 + 4), NODE_ENV: 'production', PV_TEST: '1', PV_STORE: 'memory', PV_SESSION_SECRET: 'dev-only-change-me', DATABASE_URL: '' },
    });
    let out = '';
    p.stdout!.on('data', (d) => { out += d; }); p.stderr!.on('data', (d) => { out += d; });
    const code = await new Promise<number | null>((r) => p.once('exit', (c) => r(c)));
    expect(code).toBe(1);
    expect(out).toContain('PV_TEST é proibido em produção');
    expect(out).toContain('PV_SESSION_SECRET');
    expect(out).not.toContain('[pv3d-server]');
  }, 30_000);
});
