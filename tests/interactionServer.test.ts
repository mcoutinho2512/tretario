/**
 * Rodada 10 — "clicou/tocou → interagiu": o cliente só PEDE; o SERVIDOR REAL decide (subprocesso, PV_TEST=1, banco em
 * memória) com clientes do SDK mandando mensagens CRUAS (cliente forjado):
 *   perto → entra · longe → nega · ocupado → nega · A e B pedem o MESMO carro no mesmo instante → só um vence ·
 *   vehicleId inventado / não-texto → nega (sem ecoar o payload) · distância/posição/ocupante inventados pelo cliente →
 *   irrelevantes · "assumir" o veículo por mensagens forjadas (move com campos extras, exit alheio) → nada muda ·
 *   pegar item longe / inexistente / já pego → nega · denúncia de pessoa (user_report): perto ok, repetida, longe,
 *   própria, nid inventado, resposta sem ids.
 * Portas 3200–3299 (faixa do QA da rodada 10). PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { pointOnAxis } from '../src/world/zones';
import { decodeItemList, type ItemView } from '../src/items/protocol';
import { freePortBlock } from './fixtures/freePort';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = await freePortBlock(2);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const MANIFEST = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as { pvAxis: [number, number][]; vehicleSpawns: { id: string; kind: string; x: number; z: number; heading: number }[] };
const RACKS = (JSON.parse(readFileSync('public/gameplay/combat_props.json', 'utf8')) as { supply: { racks: { at: { t: number; side?: number } }[] } }).supply.racks;
const CARS = MANIFEST.vehicleSpawns.filter((v) => v.kind === 'car');
const TRACK = ['enter_ok', 'enter_denied', 'exit_ok', 'item_self', 'item_denied', 'user_report_res', 'spawn', 'denied'];

interface Peer { room: Room; sid: string; msgs: { type: string; m: any }[]; items: ItemView[][] }
let srv: ChildProcess | null = null;
const rooms: Room[] = [];

async function join(name: string, at: { x: number; z: number }): Promise<Peer> {
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, name, testSpawn: at });
  rooms.push(room);
  const p: Peer = { room, sid: room.sessionId, msgs: [], items: [] };
  for (const t of TRACK) room.onMessage(t, (m) => p.msgs.push({ type: t, m }));
  room.onMessage('item_list', (m) => { const l = decodeItemList(m); if (l) p.items.push(l); });
  room.onMessage('*', () => {});
  for (let i = 0; i < 50 && !p.msgs.some((x) => x.type === 'spawn'); i++) await w(40);
  await w(250); // estado inicial (players/vehicles na área de interesse)
  return p;
}
const of = (p: Peer, type: string) => p.msgs.filter((x) => x.type === type).map((x) => x.m);
const until = async (fn: () => unknown, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await w(30); } return false; };
type Veh = { occupant: string; state: number; x: number; z: number };
const vehicle = (p: Peer, id: string) => (p.room.state as { vehicles: Map<string, Veh> }).vehicles.get(id);
const playerOf = (p: Peer, sid: string) => (p.room.state as { players: Map<string, { vehicle: string; nid: number }> }).players.get(sid);
/** lateral do carro (heading 0 = +z; lateral = ±x girado) a `d` m do centro */
const side = (c: { x: number; z: number; heading: number }, d: number) => ({ x: c.x + Math.cos(c.heading) * d, z: c.z - Math.sin(c.heading) * d });

describe.skipIf(skip)('interação — servidor real decide (cliente forjado)', () => {
  beforeAll(async () => {
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_EVENT: 'cotidiano', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let ready = false;
    srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; });
    srv.stderr!.on('data', () => {});
    for (let i = 0; i < 200 && !ready; i++) await w(100);
    if (!ready) throw new Error('servidor de teste não subiu');
  }, 40_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(1500)]);
    if (srv?.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
  });

  it('perto entra; longe e id inventado são negados; o payload não é ecoado', async () => {
    const car = CARS[0];
    const F = await join('Longe', side(car, 7));
    F.room.send('enter', { id: car.id, seq: 1, dist: 0, distance: 0, x: car.x, z: car.z, near: true }); // distância "inventada"
    expect(await until(() => of(F, 'enter_denied').length)).toBe(true);
    expect(of(F, 'enter_denied')[0]).toEqual({ id: car.id, reason: 'distancia' });
    F.room.send('enter', { id: 'carro_que_nao_existe', seq: 2 });
    F.room.send('enter', { id: { $gt: '' }, seq: 3 });
    F.room.send('enter', 'x'.repeat(200)); // texto longo: não é id (e não volta na resposta)
    expect(await until(() => of(F, 'enter_denied').length >= 4)).toBe(true);
    expect(of(F, 'enter_denied').slice(1).map((d) => [d.id, d.reason])).toEqual([['carro_que_nao_existe', 'inexistente'], ['', 'inexistente'], ['', 'inexistente']]);
    expect(vehicle(F, car.id)?.occupant ?? '').toBe('');
    const N = await join('Perto', side(car, 1.6));
    N.room.send('enter', { id: car.id, seq: 1 });
    expect(await until(() => of(N, 'enter_ok').length)).toBe(true);
    expect(await until(() => vehicle(N, car.id)?.occupant === N.sid)).toBe(true);
    expect(playerOf(N, N.sid)?.vehicle).toBe(car.id);
    // outro perto do carro ocupado: negado
    const O = await join('Outro', side(car, -1.6));
    O.room.send('enter', { id: car.id, seq: 1 });
    expect(await until(() => of(O, 'enter_denied').length)).toBe(true);
    expect(of(O, 'enter_denied')[0].reason).toBe('ocupado');
    // "assumir" o carro alheio: exit de quem não está nele, move com campos extras/ocupante forjado, enter com occupant
    O.room.send('exit', { seq: 5, id: car.id });
    O.room.send('move', [car.x, 0.15, car.z, 0, 1, 1, 9, 'car', N.sid]);
    O.room.send('enter', { id: car.id, seq: 6, occupant: O.sid, force: true, vehicle: car.id });
    await w(500);
    expect(vehicle(O, car.id)?.occupant).toBe(N.sid);
    expect(playerOf(O, O.sid)?.vehicle).toBe('');
    expect(of(O, 'exit_ok')).toEqual([]);
    // sair: livre de novo
    N.room.send('exit', { seq: 2 });
    expect(await until(() => of(N, 'exit_ok').length)).toBe(true);
    expect(await until(() => vehicle(N, car.id)?.occupant === '')).toBe(true);
  }, 30_000);

  it('A e B pedem o MESMO carro no mesmo instante: só um vence', async () => {
    const car = CARS[1];
    const A = await join('Ana', side(car, 1.6)), B = await join('Bia', side(car, -1.6));
    A.room.send('enter', { id: car.id, seq: 1 });
    B.room.send('enter', { id: car.id, seq: 1 });
    expect(await until(() => of(A, 'enter_ok').length + of(A, 'enter_denied').length + of(B, 'enter_ok').length + of(B, 'enter_denied').length >= 2)).toBe(true);
    const oks = of(A, 'enter_ok').length + of(B, 'enter_ok').length;
    const den = [...of(A, 'enter_denied'), ...of(B, 'enter_denied')];
    expect(oks).toBe(1);
    expect(den.map((d) => d.reason)).toEqual(['ocupado']);
    const winner = of(A, 'enter_ok').length ? A : B;
    expect(await until(() => vehicle(A, car.id)?.occupant === winner.sid && vehicle(B, car.id)?.occupant === winner.sid)).toBe(true);
    // quem perdeu tenta de novo várias vezes seguidas: continua negado, nada muda
    const loser = winner === A ? B : A;
    for (let i = 0; i < 5; i++) loser.room.send('enter', { id: car.id, seq: 10 + i });
    await w(400);
    expect(vehicle(loser, car.id)?.occupant).toBe(winner.sid);
    expect(playerOf(loser, loser.sid)?.vehicle).toBe('');
  }, 30_000);

  it('pegar item: longe, inexistente e já pego são negados; perto pega (e vai para a mão)', async () => {
    const rack = RACKS[0], pt = pointOnAxis(MANIFEST.pvAxis, rack.at.t, rack.at.side ?? 0);
    const A = await join('Pega', { x: pt.x + 1, z: pt.z });
    expect(await until(() => A.items.some((l) => l.length > 0))).toBe(true);
    const it0 = A.items.flat()[0];
    const F = await join('Distante', { x: pt.x + 12, z: pt.z });
    F.room.send('item_pick', { i: it0.id, x: it0.x, z: it0.z, d: 0 }); // posição/distância do cliente: ignoradas
    await w(450); // o servidor limita a taxa de pedidos de item ('rapido')
    F.room.send('item_pick', { i: 987654 });
    await w(450);
    F.room.send('item_pick', { i: 'abc' });
    expect(await until(() => of(F, 'item_denied').length >= 3)).toBe(true);
    expect(of(F, 'item_denied')).toEqual(['longe', 'inexistente', 'invalido']);
    A.room.send('item_pick', { i: it0.id });
    expect(await until(() => of(A, 'item_self').some((m) => m.i === it0.id && m.c === it0.prop))).toBe(true);
    // a mão (prop do jogador no estado) recebe o item: HUD e corpo leem a mesma fonte
    expect(await until(() => (A.room.state as { players: Map<string, { prop: number }> }).players.get(A.sid)?.prop === it0.prop)).toBe(true);
    // B chega perto e tenta pegar o mesmo: já está com A
    const B = await join('Tarde', { x: pt.x + 1.2, z: pt.z + 0.4 });
    B.room.send('item_pick', { i: it0.id });
    expect(await until(() => of(B, 'item_denied').length)).toBe(true);
    expect(of(B, 'item_denied')[0]).toBe('ocupado');
  }, 30_000);

  it('denunciar pessoa (painel): perto ok, repetida, longe, própria, nid inventado — resposta sem ids', async () => {
    const base = { x: CARS[2].x + 4, z: CARS[2].z + 4 };
    const A = await join('Denuncia', base), B = await join('Alvo', { x: base.x + 2, z: base.z }), C = await join('Distante2', { x: base.x + 200, z: base.z });
    await w(400);
    const nidB = playerOf(A, B.sid)?.nid ?? 0;
    expect(nidB).toBeGreaterThan(0);
    const nidA = playerOf(A, A.sid)?.nid ?? 0;
    A.room.send('user_report', { nid: nidB, category: 'ASSEDIO', userId: 'forjado', sessionId: B.sid });
    // a 1ª só responde depois de gravar (assíncrono); a repetida é recusada na hora — espera a 1ª para a ordem valer
    expect(await until(() => of(A, 'user_report_res').length >= 1)).toBe(true);
    A.room.send('user_report', { nid: nidB, category: 'SPAM' });
    A.room.send('user_report', { nid: nidA });
    A.room.send('user_report', { nid: 65000 });
    A.room.send('user_report', { nid: 'B' });
    expect(await until(() => of(A, 'user_report_res').length >= 5)).toBe(true);
    expect(of(A, 'user_report_res')).toEqual([{ ok: true }, { ok: false, r: 'repetida' }, { ok: false, r: 'propria' }, { ok: false, r: 'inexistente' }, { ok: false, r: 'inexistente' }]);
    // longe: C está fora da área de A — o nid dele (visto no próprio estado) não serve a 200 m
    const nidC = playerOf(C, C.sid)?.nid ?? 0;
    A.room.send('user_report', { nid: nidC });
    expect(await until(() => of(A, 'user_report_res').length >= 6)).toBe(true);
    expect(of(A, 'user_report_res')[5]).toEqual({ ok: false, r: 'longe' });
    expect(JSON.stringify(of(A, 'user_report_res'))).not.toContain(B.sid);
    expect(of(B, 'user_report_res')).toEqual([]); // o denunciado não é avisado
  }, 30_000);
});
