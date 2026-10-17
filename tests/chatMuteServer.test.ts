/**
 * Rodada 8.1 — mute por IDENTIDADE na sala REAL (Colyseus + API no mesmo processo, banco em memória, PV_TEST=1) com
 * clientes do SDK mandando mensagens CRUAS. Contas reais (sessão → ticket → sala):
 *   A muta B ("Teste123") pela mensagem · B troca de apelido pela API · B fala em GERAL, PROXIMIDADE e GRUPO (perto e no
 *   mesmo grupo) → A não recebe nada · A sai (logout) e volta com sessão/conexão novas → continua mutado (vem do banco)
 *   · ref forjado de outro dono e userId enviado pelo cliente não servem · desmutar → A volta a receber.
 * Reinício do servidor (banco real): server/test/prismaStore.dbtest.ts (`npm run test:db`).
 * PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = 28100 + (process.pid % 400) * 2;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'spawn', 'correct', 'resume', 'denied'];
const SP = { x: -540, z: 255 };

type Msg = { id: string; ch: string; nick: string; text: string };
interface Peer { room: Room; chats: Msg[]; mutes: { list: { ref: string; nick: string }[]; hide?: string[] }[]; denied: { reason: string }[]; hello: { nick: string; history: Msg[] } | null }

let http: HttpServer, api = '';
let gameServer: { close(): Promise<void> } | null = null;
let store: import('../server/src/data/memory').MemoryDataStore;
let hashToken: (t: string) => string, COOKIE = '';
const peers: Peer[] = [];

async function account(nick: string, groupId: string | null) {
  const u = await store.users.create({ email: `${nick.toLowerCase()}@exemplo.test`, passwordHash: 'x' });
  await store.users.update(u.id, { emailVerified: true });
  await store.profiles.create({ userId: u.id, nickname: nick, nicknameKey: nick.toLowerCase() });
  await store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
  if (groupId) await store.events.setMembership(u.id, 'manifestacao', groupId);
  return { id: u.id, cookie: await login(u.id) };
}
/** "login": sessão NOVA (cookie novo) */
async function login(userId: string) {
  const token = `tok-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-sessao`;
  await store.sessions.create({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), uaHash: null });
  return `${COOKIE}=${token}`;
}
async function call(method: string, path: string, cookie: string, body?: unknown) {
  const r = await fetch(api + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as any };
}
async function enter(cookie: string, at: { x: number; z: number }): Promise<Peer> {
  const t = await call('POST', '/api/session/ticket', cookie, { role: 'player' });
  expect(t.status).toBe(200);
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, ticket: t.body.ticket, testSpawn: at });
  const p: Peer = { room, chats: [], mutes: [], denied: [], hello: null };
  for (const q of QUIET) room.onMessage(q, () => {});
  room.onMessage('*', () => {});
  room.onMessage('chat_hello', (h) => { p.hello = h; });
  room.onMessage('chat', (m: Msg) => p.chats.push(m));
  room.onMessage('chat_mutes', (m) => p.mutes.push(m));
  room.onMessage('chat_mute_denied', (d) => p.denied.push(d));
  room.onMessage('chat_denied', () => {});
  room.onMessage('chat_report_res', () => {});
  peers.push(p);
  for (let i = 0; i < 50 && !p.hello; i++) await w(40);
  expect(p.hello).not.toBeNull();
  return p;
}
const until = async (fn: () => unknown, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await w(40); } return false; };
const texts = (p: Peer) => p.chats.map((m) => m.text);

describe.skipIf(skip)('mute por identidade — sala real', () => {
  beforeAll(async () => {
    process.env.PV_TEST = '1';
    process.env.PV_STORE = 'memory';
    process.env.PV_GRAFFITI_STORE = 'memory';
    const { MemoryDataStore } = await import('../server/src/data/memory');
    const { TicketService } = await import('../server/src/identity/tickets');
    const { setServices } = await import('../server/src/services');
    const { seedEvents } = await import('../server/src/events/seed');
    store = new MemoryDataStore();
    setServices({ store, tickets: new TicketService() });
    await seedEvents(store);
    const sess = await import('../server/src/http/session');
    hashToken = sess.hashToken; COOKIE = sess.SESSION_COOKIE;
    const { router } = await import('../server/src/http/router');
    // caminho fora do literal: o tsc da raiz não segue para os módulos do servidor com imports `.ts` (o vitest resolve)
    const srvMod = (m: string) => import(/* @vite-ignore */ `../server/src/${m}`);
    await srvMod('http/routes.ts');
    http = createServer(async (req, res) => { if (!(await router.handle(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    api = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const { listenGameServer } = await srvMod('testServer.ts') as { listenGameServer(port: number): Promise<{ close(): Promise<void> }> };
    gameServer = await listenGameServer(PORT);
  }, 60_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(peers.map((p) => p.room.leave())), w(1500)]);
    await Promise.race([gameServer?.close(), w(2000)]);
    await new Promise<void>((r) => http.close(() => r()));
  });

  it('A muta B; B troca de apelido e fala em GERAL/PROXIMIDADE/GRUPO; logout/login de A; ref/userId forjados; desmutar', async () => {
    const groups = await store.events.groups('manifestacao');
    const g = groups[0].id;
    const A = await account('Alvorada', g), B = await account('Teste123', g), C = await account('Cidadela', g);
    let a = await enter(A.cookie, SP);
    let b = await enter(B.cookie, { x: SP.x + 3, z: SP.z + 2 });
    const c = await enter(C.cookie, { x: SP.x - 3, z: SP.z });
    await w(300);

    // A muta B pela mensagem que recebeu (o cliente não sabe nem manda o userId de B)
    b.room.send('chat_send', { ch: 'geral', text: 'oi, sou o Teste123' });
    expect(await until(() => a.chats.some((m) => m.nick === 'Teste123'))).toBe(true);
    const mid = a.chats.find((m) => m.nick === 'Teste123')!.id;
    a.room.send('chat_mute', { msg: mid, on: true });
    expect(await until(() => a.mutes.at(-1)?.list.length === 1)).toBe(true);
    const entry = a.mutes.at(-1)!.list[0];
    expect(entry.nick).toBe('Teste123');
    expect(a.mutes.at(-1)!.hide).toContain(mid);
    expect(JSON.stringify(a.mutes)).not.toContain(B.id);
    await w(100);
    expect(await store.mutes.list(A.id)).toMatchObject([{ mutedUserId: B.id, mutedNicknameAtTime: 'Teste123' }]);

    // B troca de apelido pela API e reconecta (o apelido novo vale na sala) — continua mutado
    expect((await call('PUT', '/api/me/nickname', B.cookie, { nickname: 'Outro456' })).status).toBe(200);
    await b.room.leave();
    b = await enter(B.cookie, { x: SP.x + 3, z: SP.z + 2 });
    expect(b.hello!.nick).toBe('Outro456');
    await w(300);
    const say = async (p: Peer, list: [string, string][]) => { for (const [ch, text] of list) { p.room.send('chat_send', { ch, text }); await w(150); } };
    await say(b, [['geral', 'geral do apelido novo'], ['proximidade', 'perto do apelido novo'], ['grupo', 'grupo do apelido novo']]);
    expect(await until(() => ['geral do apelido novo', 'perto do apelido novo', 'grupo do apelido novo'].every((t) => texts(c).includes(t)))).toBe(true);
    await w(200);
    expect(texts(a).filter((t) => t.includes('apelido novo'))).toEqual([]);

    // segurança: userId do cliente ignorado; ref de outro dono não serve; ninguém lê a lista alheia
    c.room.send('chat_mute', { userId: B.id, on: true });
    c.room.send('chat_mute', { ref: entry.ref, on: false });
    expect(await until(() => c.denied.length >= 2)).toBe(true);
    expect(c.denied.map((d) => d.reason)).toEqual(['alvo_invalido', 'alvo_invalido']);
    expect(c.mutes.every((m) => m.list.length === 0)).toBe(true);
    expect((await store.mutes.list(A.id))).toHaveLength(1);
    expect(await store.mutes.list(C.id)).toEqual([]);

    // A sai (logout) e volta com sessão e conexão novas: a lista vem do banco, o histórico de entrada já vem filtrado
    expect((await call('POST', '/api/auth/logout', A.cookie)).status).toBe(200);
    await a.room.leave();
    a = await enter(await login(A.id), SP);
    expect(a.hello!.history.filter((m) => m.text.includes('apelido novo'))).toEqual([]);
    expect(await until(() => a.mutes.at(-1)?.list[0]?.ref === entry.ref)).toBe(true); // ref estável para o par
    await w(8200); // janela do anti-flood de B (5 mensagens / 8 s por conta)
    await say(b, [['geral', 'geral depois do login'], ['proximidade', 'perto depois do login'], ['grupo', 'grupo depois do login']]);
    expect(await until(() => texts(c).includes('grupo depois do login'))).toBe(true);
    await w(200);
    expect(texts(a).filter((t) => t.includes('depois do login'))).toEqual([]);

    // desmutar pelo ref → volta a receber nos três canais
    a.room.send('chat_mute', { ref: entry.ref, on: false });
    expect(await until(() => a.mutes.at(-1)?.list.length === 0)).toBe(true);
    await w(100);
    expect(await store.mutes.list(A.id)).toEqual([]);
    await w(8200); // janela do anti-flood de B
    await say(b, [['geral', 'geral desmutado'], ['proximidade', 'perto desmutado'], ['grupo', 'grupo desmutado']]);
    expect(await until(() => ['geral desmutado', 'perto desmutado', 'grupo desmutado'].every((t) => texts(a).includes(t)))).toBe(true);

    // pela ENTIDADE no mundo (nid do estado, o que o nome acima do jogador conhece): C muta B; o apelido é o atual
    const nidB = (c.room.state as { players: Map<string, { nid: number }> }).players.get(b.room.sessionId)?.nid;
    expect(nidB).toBeGreaterThan(0);
    c.room.send('chat_mute', { nid: nidB, on: true });
    expect(await until(() => c.mutes.at(-1)?.list[0]?.nick === 'Outro456')).toBe(true);
    await w(100);
    expect(await store.mutes.list(C.id)).toMatchObject([{ mutedUserId: B.id }]);
  }, 60_000);
});
