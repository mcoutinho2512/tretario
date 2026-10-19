/**
 * Rodada 12 — VEÍCULO PESSOAL no servidor REAL (subprocesso, PV_TEST=1, memória) com clientes forjados (SDK):
 *  - patinete/bicicleta/moto surgem a ≤ spawnDist + folga do avatar e o dono já está montado;
 *  - carro pedido da calçada: ponto seguro na PISTA (caixa inteira), fora de pessoa/veículo/parede, ≤ spawnMaxDist;
 *  - 100 pedidos forjados → no máximo 1 ativo, recusas por `taxa`;
 *  - trocar de tipo remove o anterior (dono a bordo: exit_ok antes); só o dono usa (`enter_denied 'pessoal'`);
 *  - abandono (sem o dono a bordo) e desconexão fora da graça limpam; reconexão na graça volta montado;
 *  - B vê o veículo de A surgir (owner) e A montado; tempo pedido → `pveh_ok` (mesma máquina).
 * PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { VEHICLE_BOX, boxesOverlap, packMove, type VehicleKind } from '../src/net/rules';
import { pointOnAxis } from '../src/world/zones';
import { PERSONAL_RULES, type PersonalKind } from '../src/vehicles/personal';
import { boxDist } from '../src/vehicles/personalSpawn';
import { localToWorld } from '../src/vehicles/platform';
import { surfaceIndex } from '../server/src/vehicles/surfaceIndex';
import { freePortBlock } from './fixtures/freePort';

const PORT = await freePortBlock(2);
const EP = `ws://127.0.0.1:${PORT}`;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'gf_list', 'pong', 'chat_hello', 'chat', 'chat_mutes', 'presence', 'evt', 'evt_agenda', 'agenda', 'items', 'ads', 'walk', 'clash', 'correct', 'denied', 'spawn', 'mode_ok', 'prog_ev'];
const skip = process.env.PV_SKIP_NET_TESTS === '1';
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const axis: [number, number][] = manifest.pvAxis;
const P = (t: number, s: number) => { const p = pointOnAxis(axis, t, s); return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }; };
const surf = surfaceIndex(manifest);
const FOLGA = 0.6;

let srv: ChildProcess | null = null;
const rooms: Room[] = [];
interface Bot { room: Room; msgs: Record<string, any[]>; seq: number; at: number }
async function bot(name: string, at: { x: number; z: number }, extra: Record<string, unknown> = {}): Promise<Bot> {
  const room = await new Client(EP).joinOrCreate('presidente_vargas', { ...APP, name, testSpawn: at, ...extra });
  rooms.push(room);
  const b: Bot = { room, msgs: {}, seq: 0, at: 0 };
  for (const t of QUIET) room.onMessage(t, () => {});
  room.onMessage('*', () => {});
  for (const t of ['pveh_ok', 'pveh_denied', 'enter_ok', 'enter_denied', 'exit_ok', 'resume', 'prog']) room.onMessage(t, (m: unknown) => { (b.msgs[t] ??= []).push(m); if (t.startsWith('pveh')) b.at = performance.now(); });
  return b;
}
const until = async (f: () => unknown, ms = 12000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await w(30); } };
const st = (b: Bot) => (b.room.state ?? {}) as any;
const me = (b: Bot) => st(b).players?.get(b.room.sessionId);
/** pede e espera a resposta; devolve [resposta, ms] */
async function ask(b: Bot, kind: string): Promise<[any, number]> {
  const n0 = (b.msgs.pveh_ok?.length ?? 0) + (b.msgs.pveh_denied?.length ?? 0);
  const t0 = performance.now();
  b.room.send('pveh_req', { kind, seq: b.seq });
  await until(() => (b.msgs.pveh_ok?.length ?? 0) + (b.msgs.pveh_denied?.length ?? 0) > n0);
  const ms = b.at - t0;
  const all = [...(b.msgs.pveh_ok ?? []).map((m) => ({ ok: true, ...m })), ...(b.msgs.pveh_denied ?? []).map((m) => ({ ok: false, ...m }))];
  return [all[all.length - 1], ms];
}
const owned = (b: Bot, sid: string) => { let n = 0; st(b).vehicles?.forEach((v: any) => { if (v.owner === sid) n++; }); return n; };
const timing: Record<string, { ms: number; d: number }[]> = {};

describe.skipIf(skip)('veículo pessoal no servidor real (rodada 12)', () => {
  beforeAll(async () => {
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_GRACE_S: '4', PV_PVEH_IDLE_MS: '1500' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let ready = false;
    srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; if (process.env.PV_DEBUG_TEST) process.stdout.write(String(d)); });
    srv.stderr!.on('data', (d) => { if (process.env.PV_DEBUG_TEST) process.stderr.write(String(d)); });
    for (let i = 0; i < 150 && !ready; i++) await w(100);
    if (!ready) throw new Error('servidor de teste não subiu');
  }, 30_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(3000)]);
    if (srv?.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
    // eslint-disable-next-line no-console
    console.log('[pveh] pedido → pveh_ok (ms) e distância (m):', JSON.stringify(Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, { ms: +(v.reduce((a, b) => a + b.ms, 0) / v.length).toFixed(1), d: +(v.reduce((a, b) => a + b.d, 0) / v.length).toFixed(2), n: v.length }]))));
  });

  for (const [kind, at] of [['scooter', P(0.3, -38)], ['bicycle', P(0.3, -4)], ['moto', P(0.32, 0)]] as [PersonalKind, { x: number; z: number }][]) {
    it(`${kind}: aparece junto ao avatar (≤ ${PERSONAL_RULES.spawnDist[kind]} m + ${FOLGA}) e o dono já está montado; B vê surgir e A montado`, async () => {
      const A = await bot(`A_${kind}`, at);
      const B = await bot(`B_${kind}`, { x: at.x + 6, z: at.z + 6 });
      await w(400);
      const [r, ms] = await ask(A, kind);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.kind).toBe(kind);
      expect(r.mounted).toBe(true);
      const d = Math.hypot(r.x - at.x, r.z - at.z);
      (timing[kind] ??= []).push({ ms, d });
      expect(d).toBeLessThanOrEqual(PERSONAL_RULES.spawnDist[kind] + FOLGA);
      await until(() => me(A)?.vehicle === r.id);
      const v = st(A).vehicles.get(r.id);
      expect(v.owner).toBe(A.room.sessionId);
      expect(v.occupant).toBe(A.room.sessionId);
      expect(v.kind).toBe(kind);
      // B: o veículo surge (com dono) e A aparece montado nele
      await until(() => st(B).vehicles?.get(r.id) && st(B).players?.get(A.room.sessionId)?.vehicle === r.id, 4000);
      expect(st(B).vehicles.get(r.id).owner).toBe(A.room.sessionId);
      // só o dono usa: B tenta entrar → 'pessoal' (ou 'ocupado', se ainda ocupado)
      A.room.send('exit', {});
      await until(() => A.msgs.exit_ok?.length);
      await until(() => st(B).vehicles.get(r.id)?.occupant === '');
      B.room.send('enter', { id: r.id, seq: 0 });
      await until(() => B.msgs.enter_denied?.length || B.msgs.enter_ok?.length);
      expect(B.msgs.enter_ok).toBeUndefined();
      expect(['pessoal', 'distancia']).toContain(B.msgs.enter_denied[0].reason);
      await A.room.leave(); await B.room.leave();
    }, 30_000);
  }

  it('carro pedido da CALÇADA: ponto seguro na pista (caixa inteira), fora de pessoa/veículo/parede, perto', async () => {
    const at = P(0.2, 36); // calçada larga ao lado da pista (sem gradil até a pista)
    expect(surf.surface(at.x, at.z)).toBe('walk');
    const O = await bot('Obs', P(0.2, 31)); // alguém parado na beira da pista
    const A = await bot('Motorista', at);
    await w(500);
    const [r, ms] = await ask(A, 'car');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const d = Math.hypot(r.x - at.x, r.z - at.z);
    (timing.car ??= []).push({ ms, d });
    expect(d).toBeLessThanOrEqual(PERSONAL_RULES.spawnMaxDist.car);
    const box = VEHICLE_BOX.car;
    const c = { x: r.x, z: r.z, heading: r.heading };
    for (const [lx, lz] of [[0, 0], [box.width / 2, box.len / 2], [-box.width / 2, box.len / 2], [box.width / 2, -box.len / 2], [-box.width / 2, -box.len / 2]]) {
      const p = localToWorld(c, lx, lz);
      expect(surf.surface(p.x, p.z), `canto ${lx},${lz}`).toBe('road');
    }
    const o = st(A).players.get(O.room.sessionId);
    expect(boxDist(o.x, o.z, c, box)).toBeGreaterThan(0.3);
    expect(boxDist(at.x, at.z, c, box)).toBeGreaterThan(0.3);
    st(A).vehicles.forEach((v: any, id: string) => { if (id !== r.id && Math.hypot(v.x - r.x, v.z - r.z) < 12) expect(boxesOverlap({ ...c, kind: 'car' }, { x: v.x, z: v.z, heading: v.heading, kind: v.kind as VehicleKind })).toBe(false); });
    // montado já (porta perto) ou parado ali para entrar com E
    await until(() => st(A).vehicles?.get(r.id));
    if (r.mounted) await until(() => me(A)?.vehicle === r.id);
    else { A.room.send('enter', { id: r.id, seq: 0 }); await until(() => A.msgs.enter_ok?.length || A.msgs.enter_denied?.length); }
    await A.room.leave(); await O.room.leave();
  }, 30_000);

  it('spam: 100 pedidos forjados → no máximo 1 veículo ativo, o resto recusado por taxa', async () => {
    const at = P(0.34, -4);
    const A = await bot('Spam', at);
    const W = await bot('Olho', { x: at.x + 5, z: at.z });
    await w(400);
    let maxOwned = 0;
    const kinds = ['scooter', 'bicycle', 'moto', 'car', 'xx', 42];
    for (let i = 0; i < 100; i++) {
      A.room.send('pveh_req', { kind: kinds[i % kinds.length], seq: i });
      if (i % 4 === 3) { await w(100); maxOwned = Math.max(maxOwned, owned(W, A.room.sessionId)); } // ~40/s (abaixo do limite do Colyseus)
    }
    await until(() => (A.msgs.pveh_ok?.length ?? 0) + (A.msgs.pveh_denied?.length ?? 0) >= 100, 15000);
    await w(300);
    maxOwned = Math.max(maxOwned, owned(W, A.room.sessionId));
    const oks = A.msgs.pveh_ok?.length ?? 0;
    const taxa = (A.msgs.pveh_denied ?? []).filter((m) => m.reason === 'taxa').length;
    expect(oks).toBeLessThanOrEqual(2); // 1 por janela de 2,5 s (o envio dura ~2,5 s)
    expect(taxa).toBeGreaterThanOrEqual(95);
    expect(maxOwned).toBeLessThanOrEqual(1);
    expect(owned(W, A.room.sessionId)).toBeLessThanOrEqual(1);
    await A.room.leave(); await W.room.leave();
  }, 40_000);

  it('trocar de tipo remove o anterior (a bordo: desce antes); abandono some depois do prazo; B vê sumir', async () => {
    const at = P(0.36, -4);
    const A = await bot('Troca', at);
    const B = await bot('Vê', { x: at.x + 6, z: at.z });
    await w(400);
    const [r1] = await ask(A, 'bicycle');
    expect(r1.ok).toBe(true);
    await until(() => me(A)?.vehicle === r1.id && st(B).vehicles?.get(r1.id));
    await w(PERSONAL_RULES.minIntervalMs + 100);
    const [r2] = await ask(A, 'moto');
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
    expect(r2.replaced).toBe(r1.id);
    expect(A.msgs.exit_ok?.length).toBe(1); // desmontou com segurança antes
    await until(() => !st(B).vehicles.get(r1.id) && st(B).vehicles.get(r2.id), 4000);
    expect(owned(B, A.room.sessionId)).toBe(1);
    if (r2.mounted) await until(() => me(A)?.vehicle === r2.id);
    // abandono: desce e se afasta → some depois de PV_PVEH_IDLE_MS (1,5 s) + tick de 1 Hz
    A.room.send('exit', {});
    await until(() => me(A)?.vehicle === '');
    await until(() => !st(B).vehicles.get(r2.id), 6000);
    expect(owned(B, A.room.sessionId)).toBe(0);
    await A.room.leave(); await B.room.leave();
  }, 40_000);

  it('reconexão dentro da graça: volta montado no mesmo pessoal; queda fora da graça: o pessoal some', async () => {
    const at = P(0.38, -4);
    const A = await bot('Rede', at);
    const B = await bot('Testemunha', { x: at.x + 6, z: at.z });
    await w(400);
    const [r] = await ask(A, 'scooter');
    expect(r.ok).toBe(true);
    await until(() => st(B).players?.get(A.room.sessionId)?.vehicle === r.id);
    const sid = A.room.sessionId;
    const back = new Promise<boolean>((res) => { A.room.onReconnect(() => res(true)); setTimeout(() => res(false), 8000); });
    A.room.reconnection.minUptime = 0;
    (A.room as unknown as { connection: { transport: { ws: { close(): void } } } }).connection.transport.ws.close();
    await w(300);
    expect(st(B).vehicles.get(r.id)?.occupant).toBe(sid);
    expect(await back).toBe(true);
    await until(() => A.msgs.resume?.length);
    expect(A.msgs.resume[0].vehicle).toBe(r.id);
    expect(owned(B, sid)).toBe(1);
    // agora fora da graça (4 s): entidade e pessoal somem
    A.room.reconnection.enabled = false;
    (A.room as unknown as { connection: { transport: { ws: { close(): void } } } }).connection.transport.ws.close();
    await until(() => !st(B).players.get(sid), 12000);
    await until(() => !st(B).vehicles.get(r.id), 4000);
    expect(owned(B, sid)).toBe(0);
    await B.room.leave();
  }, 40_000);

  it('missão: o pessoal conta `vehicle_enter` (mobilidade.patinete)', async () => {
    const a0 = P(0.44, -4), a1 = P(0.47, -4);
    const A = await bot('Missão', a0);
    await w(400);
    // 40 m a pé (dentro da regra) concluem BOAS-VINDAS → MOBILIDADE fica ativa
    const h = Math.atan2(a1.x - a0.x, a1.z - a0.z);
    let x = a0.x, z = a0.z;
    for (let d = 0; d < 42; d += 1.1) { x += Math.sin(h) * 1.1; z += Math.cos(h) * 1.1; A.room.send('move', packMove({ x, y: 0, z, heading: h, speed: 5, loco: 1, seq: ++A.seq })); await w(100); }
    await until(() => (A.msgs.prog ?? []).some((m) => (m.p?.active ?? []).some((x: any) => x.missionId === 'mobilidade')), 6000);
    A.seq++;
    const [r] = await ask(A, 'scooter');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await until(() => (A.msgs.prog ?? []).some((m) => (m.p?.active ?? []).some((x: any) => x.missionId === 'mobilidade' && (x.values?.patinete ?? 0) >= 1)), 6000);
    await A.room.leave();
  }, 20_000);

  it('recusas: tipo inválido → "tipo"; caído/espectador não pede', async () => {
    const A = await bot('Recusa', P(0.42, -4));
    await w(300);
    const [r] = await ask(A, 'helicoptero');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('tipo');
    const S = await new Client(EP).joinOrCreate('presidente_vargas', { role: 'spectator', specCam: { x: -540, z: 255 } });
    rooms.push(S);
    S.onMessage('*', () => {});
    const got = new Promise<any>((res) => { S.onMessage('pveh_denied', res); setTimeout(() => res(null), 3000); });
    S.send('pveh_req', { kind: 'scooter' });
    expect((await got)?.reason).toBe('espectador');
    await A.room.leave(); await S.leave();
  }, 20_000);
});
