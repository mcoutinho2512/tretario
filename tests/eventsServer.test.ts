/**
 * Rodada 9 — corrida no servidor REAL com clientes forjados (SDK, mensagens cruas): agenda chega ao entrar; inscrição
 * só montado no veículo certo; o progresso vem SÓ dos movimentos aceitos (checkpoints em ordem até a chegada);
 * mensagens do cliente dizendo "passei"/"cheguei" são ignoradas; teleporte vira correções → DQ. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { packMove } from '../src/net/rules';
import { pointOnAxis } from '../src/world/zones';
import type { AgendaEntry } from '../src/events/schedule';
import { freePortBlock } from './fixtures/freePort';

const PORT = await freePortBlock(2);
const EP = `ws://127.0.0.1:${PORT}`;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'pong', 'chat_hello', 'chat', 'presence', 'evt_pts', 'race_board', 'walk', 'clash', 'evt_done', 'exit_ok', 'correct', 'denied'];
const skip = process.env.PV_SKIP_NET_TESTS === '1';
const axis: [number, number][] = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
const P = (t: number, s: number) => { const p = pointOnAxis(axis, t, s); return { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }; };
const START = P(0.135, 10), CP1 = P(0.12, 10), CP2 = P(0.1, 10);
const AGENDA = [{
  id: 'teste-bike', format: 'corrida', name: 'Teste bike', description: '', zones: ['CIDADE_NOVA'],
  recurrence: { everyMin: 60, offsetMin: 0.2, registrationMin: 0.17, startingS: 2, durationMin: 2 },
  capacity: 4, minParticipants: 1, rewards: [], npcCrowd: 10,
  race: { vehicle: 'bicycle', laps: 1, timeLimitS: 100, start: { id: 's', at: START, radius: 8 }, checkpoints: [{ id: 'c1', at: CP1, radius: 7 }, { id: 'c2', at: CP2, radius: 7 }] },
}];

let srv: ChildProcess | null = null;
const rooms: Room[] = [];
interface Bot { room: Room; msgs: Record<string, any[]>; seq: number; x: number; z: number }
async function bot(name: string, spawnAt: { x: number; z: number }): Promise<Bot> {
  const room = await new Client(EP).joinOrCreate('presidente_vargas', { ...APP, name, testSpawn: spawnAt });
  rooms.push(room);
  const b: Bot = { room, msgs: {}, seq: 0, x: spawnAt.x, z: spawnAt.z };
  for (const t of QUIET) room.onMessage(t, () => {});
  for (const t of ['agenda', 'evt_res', 'race', 'race_def', 'evt_result', 'enter_ok', 'enter_denied', 'spawn', 'correct']) room.onMessage(t, (m: unknown) => { (b.msgs[t] ??= []).push(m); });
  return b;
}
const until = async (f: () => unknown, ms = 15000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await w(50); } };
/** dirige em linha reta a v m/s, um movimento a cada 100 ms (o servidor valida cada um) */
async function drive(b: Bot, to: { x: number; z: number }, v = 6.5) {
  for (;;) {
    const d = Math.hypot(to.x - b.x, to.z - b.z);
    if (d < 0.05) return;
    const st = Math.min(d, v * 0.1);
    const h = Math.atan2(to.x - b.x, to.z - b.z);
    b.x += ((to.x - b.x) / d) * st; b.z += ((to.z - b.z) / d) * st;
    b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: h, speed: v, loco: 4, seq: ++b.seq }));
    await w(100);
  }
}

describe.skipIf(skip)('corrida no servidor real — clientes forjados', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'pv-agenda-'));
    const file = pjoin(dir, 'agenda.json');
    writeFileSync(file, JSON.stringify(AGENDA));
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '', PV_AGENDA_FILE: file, PV_AGENDA_EPOCH: 'now' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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

  it('agenda ao entrar; inscrição exige bicicleta; checkpoints pelos movimentos; reivindicação do cliente ignorada; teleporte → DQ', async () => {
    const A = await bot('Ana', { x: -920, z: 437 });
    const B = await bot('Beto', { x: -919, z: 433 });
    const C = await bot('Caio', { x: -922, z: 431 });
    await until(() => A.msgs.agenda?.length && C.msgs.agenda?.length);
    const entry = () => (A.msgs.agenda.at(-1).list as AgendaEntry[]).find((e) => e.id === 'teste-bike');
    await until(() => entry()?.state === 'REGISTRATION');
    const inst = entry()!.inst;
    expect(entry()).toMatchObject({ format: 'corrida', count: 0, capacity: 4 });
    // a pé: negado
    C.room.send('evt_join', { inst });
    await until(() => C.msgs.evt_res?.length);
    expect(C.msgs.evt_res[0]).toMatchObject({ inst, ok: false, r: 'veiculo' });
    // monta (estado do servidor) e inscreve
    A.room.send('enter', { id: 'st14_0', seq: A.seq });
    B.room.send('enter', { id: 'st14_1', seq: B.seq });
    await until(() => A.msgs.enter_ok?.length && B.msgs.enter_ok?.length);
    A.x = A.msgs.enter_ok[0].x; A.z = A.msgs.enter_ok[0].z; B.x = B.msgs.enter_ok[0].x; B.z = B.msgs.enter_ok[0].z;
    A.room.send('evt_join', { inst }); B.room.send('evt_join', { inst });
    await until(() => A.msgs.evt_res?.length && B.msgs.evt_res?.length);
    expect(A.msgs.evt_res[0]).toMatchObject({ inst, ok: true });
    expect(B.msgs.evt_res[0]).toMatchObject({ inst, ok: true });
    expect(A.msgs.race_def?.[0]).toMatchObject({ inst, vehicle: 'bicycle', laps: 1, cps: [{ x: CP1.x, z: CP1.z, r: 7 }, { x: CP2.x, z: CP2.z, r: 7 }] });
    await until(() => (A.msgs.agenda.at(-1).list as AgendaEntry[]).find((e) => e.inst === inst)?.joined === true);
    expect(entry()!.count).toBe(2);
    // B (cliente modificado) "avisa" que passou checkpoints e chegou, pelos tipos que existem (campos extras são lixo:
    // evt_join só inscreve, evt_watch só acompanha, dbt_* vai ao runner do formato — a corrida não tem)
    for (const t of ['evt_join', 'evt_watch', 'dbt_say']) B.room.send(t, { inst, cp: 3, lap: 1, finished: true, t: 1000, text: 'cheguei' });
    // tipos inventados ('race_cp', 'evt_finish'): o Colyseus derruba a conexão (C, que não está inscrito)
    C.room.send('race_cp', { inst, cp: 3 });
    // vai para a largada e espera a contagem
    await drive(A, START);
    await until(() => A.msgs.race?.some((m: any) => m.t >= 0), 20000);
    const t0 = Date.now();
    expect(B.msgs.evt_res[1]).toMatchObject({ inst, ok: false, r: 'ja_inscrito' });
    expect(B.msgs.race.at(-1)).toMatchObject({ cp: 0 });
    expect(B.msgs.race.some((m: any) => m.finished || m.cp > 0)).toBe(false);
    // B tenta teleportar para o checkpoint 2: só correções (too_fast) → DQ por correções
    for (let i = 0; i < 9; i++) { B.room.send('move', packMove({ x: CP2.x, y: 0, z: CP2.z, heading: 0, speed: 7, loco: 4, seq: ++B.seq })); await w(60); }
    await until(() => B.msgs.race?.some((m: any) => m.status === 'dq'));
    expect(B.msgs.race.find((m: any) => m.status === 'dq')).toMatchObject({ status: 'dq', reason: 'correcoes', cp: 0 });
    // A corre de verdade: c1 → c2 → chegada (largada)
    await drive(A, CP1); await drive(A, CP2); await drive(A, START);
    await until(() => A.msgs.race?.some((m: any) => m.finished));
    const fin = A.msgs.race.find((m: any) => m.finished);
    expect(fin).toMatchObject({ inst, cp: 3, lap: 1, rank: 1, finished: true });
    // tempo do servidor ≈ o que levamos dirigindo (± 2 s)
    expect(Math.abs(fin.t - (Date.now() - t0))).toBeLessThan(2500);
    await until(() => A.msgs.evt_result?.length, 8000);
    const res = A.msgs.evt_result[0];
    expect(res.rows.map((r: any) => [r.name, r.rank, r.status])).toEqual([['Ana', 1, 'ok'], ['Beto', 2, 'dq']]);
    expect(B.msgs.race.some((m: any) => m.finished)).toBe(false);
    await until(() => (A.msgs.agenda.at(-1).list as AgendaEntry[]).find((e) => e.inst === inst)?.state === 'FINISHED', 4000);
  }, 90_000);
});
