/**
 * Rodada 10 — montagem (AGENTE C): servidor REAL (subprocesso, PV_TEST=1, memória) com clientes forjados (SDK).
 *  - corrida: A e B pedem o MESMO carro ao mesmo tempo → só um entra (o outro: `ocupado`), sem dois ocupantes;
 *  - saída segura: B parado na porta do motorista → A sai em outro ponto, longe de B e fora de qualquer carroceria;
 *  - queda + reconexão DENTRO da graça: A volta no mesmo veículo (resume), mesma entidade, sem avatar/veículo duplicado;
 *  - queda FORA da graça: entidade removida, veículo livre (AVAILABLE) e depois devolvido à vaga (RESETTING → vaga);
 *    ao entrar de novo, A nasce a pé.
 * Porta na faixa 3300–3399. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { distToVehicle, packMove } from '../src/net/rules';
import { pointOnAxis } from '../src/world/zones';
import { exitCandidates } from '../src/vehicles/exitSafety';

const PORT = 3300 + (process.pid % 45) * 2;
const EP = `ws://127.0.0.1:${PORT}`;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'gf_list', 'pong', 'chat_hello', 'chat', 'chat_mutes', 'presence', 'evt', 'evt_agenda', 'agenda', 'prog', 'items', 'ads', 'walk', 'clash', 'correct', 'denied', 'spawn', 'mode_ok'];
const skip = process.env.PV_SKIP_NET_TESTS === '1';
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const spawnOf = (id: string) => manifest.vehicleSpawns.find((s: { id: string }) => s.id === id) as { id: string; kind: string; x: number; z: number; heading: number };
const axis: [number, number][] = manifest.pvAxis;
const P = (t: number, s: number) => { const p = pointOnAxis(axis, t, s); return { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }; };

let srv: ChildProcess | null = null;
const rooms: Room[] = [];
interface Bot { room: Room; msgs: Record<string, any[]>; seq: number; x: number; z: number }
async function bot(name: string, at: { x: number; z: number }): Promise<Bot> {
  const room = await new Client(EP).joinOrCreate('presidente_vargas', { ...APP, name, testSpawn: at });
  rooms.push(room);
  const b: Bot = { room, msgs: {}, seq: 0, x: at.x, z: at.z };
  for (const t of QUIET) room.onMessage(t, () => {});
  room.onMessage('*', () => {});
  for (const t of ['enter_ok', 'enter_denied', 'exit_ok', 'resume']) room.onMessage(t, (m: unknown) => { (b.msgs[t] ??= []).push(m); });
  return b;
}
const until = async (f: () => unknown, ms = 12000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await w(50); } };
const st = (b: Bot) => (b.room.state ?? {}) as any;
async function drive(b: Bot, to: { x: number; z: number }, v = 5) {
  for (;;) {
    const d = Math.hypot(to.x - b.x, to.z - b.z);
    if (d < 0.05) return;
    const s = Math.min(d, v * 0.1), h = Math.atan2(to.x - b.x, to.z - b.z);
    b.x += ((to.x - b.x) / d) * s; b.z += ((to.z - b.z) / d) * s;
    b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: h, speed: v, loco: 4, seq: ++b.seq }));
    await w(100);
  }
}

describe.skipIf(skip)('montagem no servidor real (rodada 10) — corrida, saída segura, reconexão', () => {
  beforeAll(async () => {
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_GRACE_S: '4', PV_VEH_RESET_MS: '1500' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let ready = false;
    srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; if (process.env.PV_DEBUG_TEST) process.stdout.write(String(d)); });
    srv.stderr!.on('data', () => {});
    for (let i = 0; i < 150 && !ready; i++) await w(100);
    if (!ready) throw new Error('servidor de teste não subiu');
  }, 30_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(3000)]);
    if (srv?.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
  });

  it('corrida: A e B pedem o mesmo carro no mesmo instante → só um entra; o outro recebe "ocupado"', async () => {
    const car = spawnOf('car1');
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    const A = await bot('Ana', { x: car.x + 1.5 * c, z: car.z - 1.5 * s });
    const B = await bot('Beto', { x: car.x - 1.5 * c, z: car.z + 1.5 * s });
    await w(400);
    A.room.send('enter', { id: car.id, seq: 0 });
    B.room.send('enter', { id: car.id, seq: 0 });
    await until(() => (A.msgs.enter_ok?.length ?? 0) + (A.msgs.enter_denied?.length ?? 0) + (B.msgs.enter_ok?.length ?? 0) + (B.msgs.enter_denied?.length ?? 0) >= 2);
    const oks = [A, B].filter((b) => b.msgs.enter_ok?.length);
    const den = [A, B].filter((b) => b.msgs.enter_denied?.length);
    expect(oks).toHaveLength(1);
    expect(den).toHaveLength(1);
    expect(den[0].msgs.enter_denied[0].reason).toBe('ocupado');
    await until(() => st(A).vehicles?.get(car.id)?.occupant);
    expect(st(A).vehicles.get(car.id).occupant).toBe(oks[0].room.sessionId);
    expect(st(A).vehicles.get(car.id).state).toBe(1); // OCCUPIED
    // ninguém mais "dentro" do mesmo carro
    let inside = 0;
    st(A).players.forEach((p: any) => { if (p.vehicle === car.id) inside++; });
    expect(inside).toBe(1);
    oks[0].room.send('exit', {});
    await until(() => oks[0].msgs.exit_ok?.length);
    await A.room.leave(); await B.room.leave();
  }, 30_000);

  it('saída segura: alguém parado na porta do motorista → sai em outro ponto livre, fora de qualquer carroceria', async () => {
    const car = spawnOf('car0');
    const door = exitCandidates('car', car)[0];
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    const A = await bot('Caio', { x: car.x - 1.6 * c, z: car.z + 1.6 * s });
    const B = await bot('Dani', { x: door.x, z: door.z });
    await w(600); // B entra na grade do servidor
    A.room.send('enter', { id: car.id, seq: 0 });
    await until(() => A.msgs.enter_ok?.length);
    A.room.send('exit', {});
    await until(() => A.msgs.exit_ok?.length);
    const out = A.msgs.exit_ok[0] as { x: number; z: number };
    expect(Math.hypot(out.x - door.x, out.z - door.z)).toBeGreaterThanOrEqual(0.65);
    expect(distToVehicle(out.x, out.z, { ...car, kind: 'car' })).toBeGreaterThan(0.3);
    for (const o of manifest.vehicleSpawns as { x: number; z: number; heading: number; kind: string }[]) {
      if (Math.hypot(o.x - out.x, o.z - out.z) < 8 && (o.kind === 'car' || o.kind === 'moto')) expect(distToVehicle(out.x, out.z, o)).toBeGreaterThan(0.3);
    }
    // a posição do servidor é a de saída e o carro ficou livre
    await until(() => st(A).players.get(A.room.sessionId)?.vehicle === '');
    expect(st(A).vehicles.get(car.id).occupant).toBe('');
    expect(st(A).vehicles.get(car.id).state).toBe(0);
    await A.room.leave(); await B.room.leave();
  }, 30_000);

  it('queda dentro da graça: volta no MESMO veículo, mesma entidade, sem duplicar avatar/veículo', async () => {
    const car = spawnOf('car2') ?? spawnOf('car0');
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    const A = await bot('Eva', { x: car.x + 1.6 * c, z: car.z - 1.6 * s });
    const B = await bot('Fred', { x: car.x + 5 * c, z: car.z - 5 * s });
    await w(400);
    A.room.send('enter', { id: car.id, seq: 0 });
    await until(() => A.msgs.enter_ok?.length);
    await until(() => st(B).players.get(A.room.sessionId)?.vehicle === car.id);
    const sid = A.room.sessionId;
    const vehiclesBefore = st(B).vehicles.size, playersBefore = st(B).players.size;
    const back = new Promise<boolean>((res) => { A.room.onReconnect(() => res(true)); setTimeout(() => res(false), 8000); });
    A.room.reconnection.minUptime = 0;
    (A.room as unknown as { connection: { transport: { ws: { close(): void } } } }).connection.transport.ws.close(); // queda sem consentimento
    // durante a graça: B continua vendo A no carro (congelado), e o carro ocupado por A
    await w(300);
    expect(st(B).players.get(sid)?.vehicle).toBe(car.id);
    expect(st(B).vehicles.get(car.id).occupant).toBe(sid);
    expect(await back).toBe(true);
    expect(A.room.sessionId).toBe(sid);
    await until(() => A.msgs.resume?.length);
    expect(A.msgs.resume[0].vehicle).toBe(car.id);
    await w(400);
    expect(st(B).players.size).toBe(playersBefore);
    expect(st(B).vehicles.size).toBe(vehiclesBefore);
    let occ = 0;
    st(B).vehicles.forEach((v: any) => { if (v.occupant === sid) occ++; });
    expect(occ).toBe(1);
    // continua dirigível: sai normalmente
    A.room.send('exit', {});
    await until(() => A.msgs.exit_ok?.length);
    await until(() => st(B).vehicles.get(car.id).occupant === '');
    await A.room.leave(); await B.room.leave();
  }, 40_000);

  it('queda FORA da graça: entidade some, veículo fica livre e volta para a vaga; A reentra a pé', async () => {
    const bike = spawnOf('st14_0');
    const A = await bot('Gil', { x: bike.x + 0.8, z: bike.z });
    A.room.send('enter', { id: bike.id, seq: 0 });
    await until(() => A.msgs.enter_ok?.length);
    A.x = A.msgs.enter_ok[0].x; A.z = A.msgs.enter_ok[0].z;
    // leva a bicicleta para longe da vaga (> 15 m), por caminho livre do eixo da avenida
    await drive(A, P(0.135, 10)); await drive(A, P(0.12, 10));
    const far = P(0.12, 10);
    const C = await bot('Hugo', { x: far.x + 60, z: far.z }); // observador longe (> 25 m) — não impede o retorno
    await w(500);
    expect(Math.hypot(far.x - bike.x, far.z - bike.z)).toBeGreaterThan(15);
    const sid = A.room.sessionId;
    A.room.reconnection.enabled = false;
    (A.room as unknown as { connection: { transport: { ws: { close(): void } } } }).connection.transport.ws.close();
    // graça (4 s) vence → onLeave: entidade removida, veículo livre; abandonado → RESETTING → vaga
    await until(() => !st(C).players.get(sid), 12000);
    await until(() => { const v = st(C).vehicles.get(bike.id); return v && v.occupant === '' && Math.hypot(v.x - bike.x, v.z - bike.z) < 0.2 && v.state === 0; }, 12000);
    let occ = 0;
    st(C).vehicles.forEach((v: any) => { if (v.occupant === sid) occ++; });
    expect(occ).toBe(0);
    // volta como sessão nova: a pé, em posição válida (nada de "nascer dentro" do veículo)
    const A2 = await bot('Gil', { x: far.x, z: far.z });
    await until(() => st(A2)?.players?.get(A2.room.sessionId));
    const me = st(A2).players.get(A2.room.sessionId);
    expect(me.vehicle).toBe('');
    await A2.room.leave(); await C.room.leave();
  }, 60_000);
});
