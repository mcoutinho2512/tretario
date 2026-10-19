/**
 * Rodada 9 — palco de debate na sala REAL (Colyseus + API no mesmo processo, banco em memória, PV_TEST=1) com
 * clientes do SDK mandando mensagens CRUAS (forjadas): quem não é o orador manda `dbt_say` → recusado e ninguém
 * recebe; rajada de `dbt_react` → só reactionsPerMin contam; estado `dbt` só para a plateia (perto do palco);
 * turno avança pelo tempo dos dados; denúncia de fala vira Report DEBATE_LINE. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { freePortBlock } from './fixtures/freePort';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = await freePortBlock(2);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'spawn', 'correct', 'resume', 'denied', 'chat_hello', 'chat_mutes', 'chat', 'ads'];
/** frente do palco stage0 (manifest: 593.52, −143.25, rumo 4.97) */
const FRONT = { x: 583.9, z: -140.7 };

interface Peer { room: Room; dbt: any[]; lines: any[]; denied: any[]; me: any[]; reports: any[]; ads: any[] }
let http: HttpServer, api = '';
let gameServer: { close(): Promise<void> } | null = null;
let store: import('../server/src/data/memory').MemoryDataStore;
let hashToken: (t: string) => string, COOKIE = '';
const peers: Peer[] = [];

async function account(nick: string) {
  const u = await store.users.create({ email: `${nick.toLowerCase()}@exemplo.test`, passwordHash: 'x' });
  await store.users.update(u.id, { emailVerified: true });
  await store.profiles.create({ userId: u.id, nickname: nick, nicknameKey: nick.toLowerCase() });
  await store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
  const token = `tok-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-sessao`;
  await store.sessions.create({ userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), uaHash: null });
  return { id: u.id, cookie: `${COOKIE}=${token}` };
}
async function enter(cookie: string, at: { x: number; z: number }): Promise<Peer> {
  const r = await fetch(`${api}/api/session/ticket`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'player' }) });
  const t = await r.json() as { ticket: string };
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, ticket: t.ticket, testSpawn: at });
  const p: Peer = { room, dbt: [], lines: [], denied: [], me: [], reports: [], ads: [] };
  for (const q of QUIET) room.onMessage(q, () => {});
  room.onMessage('*', () => {});
  room.onMessage('dbt', (m) => p.dbt.push(m));
  room.onMessage('dbt_line', (m) => p.lines.push(m));
  room.onMessage('dbt_denied', (m) => p.denied.push(m));
  room.onMessage('dbt_me', (m) => p.me.push(m));
  room.onMessage('dbt_report_res', (m) => p.reports.push(m));
  room.onMessage('dbt_bye', () => {});
  room.onMessage('dbt_hide', () => {});
  room.onMessage('ads', (m) => p.ads.push(m));
  peers.push(p);
  return p;
}
const until = async (fn: () => unknown, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await w(40); } return false; };

describe.skipIf(skip)('palco de debate — sala real, clientes forjados', () => {
  beforeAll(async () => {
    process.env.PV_TEST = '1';
    process.env.PV_STORE = 'memory';
    process.env.PV_GRAFFITI_STORE = 'memory';
    process.env.PV_DEBATE_FILE = fileURLToPath(new URL('./fixtures/debate_teste.json', import.meta.url));
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
    const srvMod = (m: string) => import(/* @vite-ignore */ `../server/src/${m}`);
    await srvMod('http/routes.ts');
    http = createServer(async (req, res) => { if (!(await router.handle(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    api = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const { listenGameServer } = await srvMod('testServer.ts') as { listenGameServer(port: number): Promise<{ close(): Promise<void> }> };
    gameServer = await listenGameServer(PORT);
  }, 60_000);
  afterAll(async () => {
    delete process.env.PV_DEBATE_FILE;
    await Promise.race([Promise.allSettled(peers.map((p) => p.room.leave())), w(1500)]);
    await Promise.race([gameServer?.close(), w(2000)]);
    await new Promise<void>((r) => http.close(() => r()));
  });

  it('fila, orador, dbt_say forjado de quem não fala, spam de reações limitado, turno avança, denúncia DEBATE_LINE', async () => {
    const [A, B, C, L] = await Promise.all(['Orador1', 'Orador2', 'Plateia3', 'Longe4'].map((n) => account(n)));
    const a = await enter(A.cookie, { x: FRONT.x, z: FRONT.z + 2 });
    const b = await enter(B.cookie, { x: FRONT.x + 2, z: FRONT.z - 2 });
    const c = await enter(C.cookie, { x: FRONT.x - 6, z: FRONT.z + 3 });
    const far = await enter(L.cookie, { x: -540, z: 255 });
    // plateia por proximidade (1 Hz): estado só para quem está perto do palco
    expect(await until(() => a.dbt.length && b.dbt.length && c.dbt.length)).toBe(true);
    expect(c.dbt.at(-1)).toMatchObject({ active: true, turnSeconds: 8, topic: 'Calor na cidade: árvores, sombra e água nas ruas' });
    expect(far.dbt).toHaveLength(0);
    expect(a.ads.at(0)?.full).toBe(true); // telões: conteúdo interno ao entrar

    a.room.send('dbt_queue', { on: true });
    expect(await until(() => a.me.at(-1)?.speaking)).toBe(true);
    b.room.send('dbt_queue', { on: true });
    expect(await until(() => c.dbt.at(-1)?.speaker === 'Orador1' && c.dbt.at(-1)?.queue?.[0] === 'Orador2')).toBe(true);
    const inst = c.dbt.at(-1).inst as string;

    // forjado: B (na fila, não é a vez) e C (plateia) mandam fala; o longe também
    b.room.send('dbt_say', { inst, text: 'fala fora da vez' });
    c.room.send('dbt_say', { inst, text: 'fala da plateia' });
    far.room.send('dbt_say', { text: 'fala de longe' });
    expect(await until(() => b.denied.some((d) => d.reason === 'nao_e_sua_vez') && c.denied.some((d) => d.reason === 'nao_e_sua_vez'))).toBe(true);
    // forjado: campos a mais (userId, nick) são ignorados; texto bloqueado pela moderação
    a.room.send('dbt_say', { inst, text: 'Mais árvores na avenida', nick: 'Outro', userId: B.id });
    expect(await until(() => c.lines.some((l) => l.text === 'Mais árvores na avenida'))).toBe(true);
    const line = c.lines.find((l) => l.text === 'Mais árvores na avenida');
    expect(line.nick).toBe('Orador1');
    expect(JSON.stringify(c.lines)).not.toContain(A.id);
    expect(c.lines.some((l) => /fora da vez|da plateia|de longe/.test(l.text))).toBe(false);
    expect(far.lines).toHaveLength(0);

    // rajada de reações (30): só reactionsPerMin (5, dados de teste) contam
    for (let i = 0; i < 30; i++) c.room.send('dbt_react', { inst, r: i % 2 ? 'positiva' : 'aplauso' });
    expect(await until(() => c.denied.some((d) => d.kind === 'react' && d.reason === 'limite'))).toBe(true);
    await w(700);
    const r = c.dbt.at(-1).reactions;
    expect(r.aplauso + r.positiva + r.negativa).toBe(5);
    // forjado: reação de quem está longe (não assiste) → recusada
    far.room.send('dbt_react', { inst, r: 'aplauso' });
    expect(await until(() => far.denied.some((d) => d.reason === 'nao_assiste'))).toBe(true);

    // denúncia da fala → Report DEBATE_LINE com a cópia do servidor
    c.room.send('dbt_report', { inst, id: line.id, category: 'SPAM' });
    expect(await until(() => c.reports.length)).toBe(true);
    expect(c.reports[0]).toMatchObject({ ok: true, id: line.id });
    const reps = await store.reports.list();
    expect(reps.find((x) => x.targetType === 'DEBATE_LINE')).toMatchObject({ reporterUserId: C.id, targetUserId: A.id, reportedNicknameAtTime: 'Orador1' });

    // turno de 8 s (dados) + pausa → B fala
    expect(await until(() => c.dbt.at(-1)?.speaker === 'Orador2', 14_000)).toBe(true);
    expect(c.dbt.at(-1).reactions).toEqual({ aplauso: 0, positiva: 0, negativa: 0 });
    // A agora é plateia: dbt_say dele é recusado
    a.room.send('dbt_say', { inst, text: 'de novo eu' });
    expect(await until(() => a.denied.some((d) => d.kind === 'say' && d.reason === 'nao_e_sua_vez'))).toBe(true);
    // estado a ≤ 2 Hz: poucos `dbt` para a plateia apesar da rajada
    expect(c.dbt.length).toBeLessThan(40);
  }, 40_000);
});
