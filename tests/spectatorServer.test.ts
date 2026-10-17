/**
 * Servidor REAL (subprocesso, PV_TEST=1, banco em memória) + clientes do SDK do Colyseus mandando mensagens CRUAS:
 * um espectador "modificado" tenta mover, dirigir, subir no trio, empurrar, agir, segurar item e pichar — o servidor
 * nega tudo (`denied`) e o estado do mundo não muda. Também: espectador não vira entidade nem conta como jogador,
 * spec_cam fora do mapa é preso, e a métrica pública separa jogador / espectador / bot.
 * PV_SKIP_NET_TESTS=1 pula (máquina sem as dependências do servidor).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client, type Room } from '@colyseus/sdk';

const PORT = 27100 + (process.pid % 400) * 2;
const EP = `ws://127.0.0.1:${PORT}`;
const API = `http://127.0.0.1:${PORT + 1}`;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'spawn', 'correct', 'chat_hello', 'chat', 'chat_mutes'];
const skip = process.env.PV_SKIP_NET_TESTS === '1';

let srv: ChildProcess | null = null;
const rooms: Room[] = [];
async function join(o: Record<string, unknown>): Promise<Room> {
  const r = await new Client(EP).joinOrCreate('presidente_vargas', { ...APP, ...o });
  for (const t of QUIET) r.onMessage(t, () => {});
  rooms.push(r);
  return r;
}

describe.skipIf(skip)('espectador no servidor real — cliente forjado', () => {
  beforeAll(async () => {
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let ready = false;
    srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; });
    srv.stderr!.on('data', () => {});
    for (let i = 0; i < 150 && !ready; i++) await w(100);
    if (!ready) throw new Error('servidor de teste não subiu');
  }, 30_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(1500)]); // sala já fechada (substituída) não responde
    if (srv?.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
  });

  it('nega toda mensagem de jogo do espectador e não cria entidade', async () => {
    const A = await join({ name: 'A', testSpawn: { x: -540, z: 255 } });
    const S = await join({ role: 'spectator', specCam: { x: -540, z: 255 } });
    const denied: string[] = [];
    S.onMessage('denied', (d: { cap: string }) => denied.push(d.cap));
    await w(700);
    const st = S.state as { players: Map<string, { x: number; z: number; act: number; prop: number; vehicle: string; platform: string }>; vehicles: Map<string, { occupant: string }> };
    // o espectador VÊ o jogador A pela área de interesse da câmera, mas não é entidade
    expect(st.players.has(A.sessionId)).toBe(true);
    expect(st.players.has(S.sessionId)).toBe(false);
    const a0 = { ...st.players.get(A.sessionId)! };
    const forged: [string, unknown][] = [
      ['move', [-500, 0, 240, 0, 5, 1, 1]], ['pmove', [0, 0, 0, 0, 1, 1]], ['mode', 'interacao'],
      ['enter', { id: 'som0', seq: 1 }], ['exit', {}], ['board', { id: 'trio0' }], ['unboard', {}],
      ['push', A.sessionId], ['act', { a: 40 }], ['prop', { p: 1, d: 0 }], ['gf_new', { s: 'x', c: 'AAAA' }],
    ];
    for (const [t, m] of forged) S.send(t, m);
    await w(700);
    expect(denied.sort()).toEqual(['action.perform', 'graffiti.create', 'item.hold', 'push', 'vehicle.use', 'vehicle.use', 'vehicle.use', 'vehicle.use', 'world.play', 'world.play', 'world.play'].sort());
    const a1 = st.players.get(A.sessionId)!;
    expect({ x: a1.x, z: a1.z, act: a1.act, prop: a1.prop, vehicle: a1.vehicle, platform: a1.platform }).toEqual({ x: a0.x, z: a0.z, act: a0.act, prop: a0.prop, vehicle: a0.vehicle, platform: a0.platform });
    expect(st.players.has(S.sessionId)).toBe(false);
    for (const v of st.vehicles.values()) expect(v.occupant).not.toBe(S.sessionId);
  });

  it('spec_cam move a área de interesse (fora do mapa é preso) e a métrica pública é semântica', async () => {
    const far = await join({ name: 'Longe', testSpawn: { x: 700, z: -200 } });
    await join({ name: 'bot0', bot: true, testSpawn: { x: 650, z: -180 } });
    const S = await join({ role: 'spectator', specCam: { x: -540, z: 255 } });
    await w(700);
    const st = S.state as { players: Map<string, unknown> };
    expect(st.players.has(far.sessionId)).toBe(false); // longe da câmera
    S.send('spec_cam', { x: 690, z: -205 });
    await w(900);
    expect(st.players.has(far.sessionId)).toBe(true); // a câmera foi até lá
    S.send('spec_cam', { x: 1e9, z: -1e9 }); // forjado: preso aos limites, não quebra nada
    await w(400);
    const m = await (await fetch(`${API}/api/metrics/public`)).json();
    // jogadores humanos: A (teste anterior) + Longe; bots à parte; 2 espectadores
    expect(m).toMatchObject({ playersOnline: 2, testBots: 1, spectatorsOnline: 2, totalConnections: 5, eventId: 'manifestacao' });
    expect(m.environmentCrowd).toBeGreaterThan(0);
  });

  it('queda → reconecta na MESMA entidade (resume) e login duplicado: a sessão nova assume', async () => {
    const R = await join({ name: 'R', testUser: 'qa_r', testSpawn: { x: -545, z: 250 } });
    R.reconnection.minUptime = 0;
    const O = await join({ role: 'spectator', specCam: { x: -545, z: 250 } });
    const st = O.state as { players: Map<string, { link: number; name: string }> };
    await w(500);
    let resumed: { x: number } | null = null;
    R.onMessage('resume', (m: { x: number }) => { resumed = m; });
    const sid = R.sessionId;
    (R.connection.transport as unknown as { ws: { close: () => void } }).ws.close(); // queda sem LEAVE consentido
    await w(150);
    expect(st.players.get(sid)?.link).toBe(1); // em graça, marcada, uma só
    for (let i = 0; i < 40 && !resumed; i++) await w(100);
    expect(resumed).not.toBeNull();
    expect(R.sessionId).toBe(sid);
    await w(300);
    expect(st.players.get(sid)?.link).toBe(0);
    expect([...st.players.values()].filter((p) => p.name === 'R')).toHaveLength(1);
    // mesma conta entra de novo (outra aba): a antiga é substituída, nunca duas entidades
    let replaced = false, leftCode = 0;
    R.onMessage('session_replaced', () => { replaced = true; });
    R.onLeave((c: number) => { leftCode = c; });
    const R2 = await join({ name: 'R', testUser: 'qa_r', testSpawn: { x: -500, z: 250 } });
    await w(600);
    expect(replaced).toBe(true);
    expect(leftCode).toBe(4020);
    expect(st.players.has(sid)).toBe(false);
    expect(st.players.has(R2.sessionId)).toBe(true);
    expect([...st.players.values()].filter((p) => p.name === 'R')).toHaveLength(1);
  });
});
