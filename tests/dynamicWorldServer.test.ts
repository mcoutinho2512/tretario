/**
 * Rodada 12 — MUNDO DINÂMICO na sala REAL (servidor de teste PV_TEST=1, processo separado): `qa_dyn` força eventos;
 * os sinais chegam pela mensagem `dyn`; reuniões entram na MESMA agenda ("acontecendo agora", formato 'dinamico') e
 * no MESMO `evt_pts`; foco de briga num mundo sem autônomos é "fantasma" e passa pelos níveis em ordem.
 * Ainda sem a WorldView do AGENTE C: ninguém participa (n = 0). PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client, type Room } from '@colyseus/sdk';
import type { AgendaEntry, DynamicSignalWire, EventPointWire } from '../src/events/schedule';
import { freePortBlock } from './fixtures/freePort';

const PORT = await freePortBlock(2);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'pong', 'chat_hello', 'chat', 'presence', 'race_board', 'walk', 'clash', 'evt_done', 'exit_ok', 'correct', 'denied', 'ads', 'prog', 'cbt_self'];
const skip = process.env.PV_SKIP_NET_TESTS === '1';
let srv: ChildProcess | null = null;
const rooms: Room[] = [];
const until = async (f: () => unknown, ms = 15000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await w(50); } };

describe.skipIf(skip)('mundo dinâmico — sala real', () => {
  beforeAll(async () => {
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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

  it('qa_dyn → `dyn` (sinais), agenda "acontecendo agora" e evt_pts; briga fantasma sobe TENSÃO → CONFRONTO → GENERALIZADO', async () => {
    const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, name: 'Qa', testSpawn: { x: -900, z: 437 } });
    rooms.push(room);
    const msgs: Record<string, any[]> = {};
    for (const t of QUIET) room.onMessage(t, () => {});
    for (const t of ['dyn', 'agenda', 'evt_pts', 'qa_dyn_res']) room.onMessage(t, (m: unknown) => { (msgs[t] ??= []).push(m); });
    room.onMessage('*', () => {});
    await until(() => msgs.agenda?.length);
    room.send('qa_dyn', { kind: 'CONCENTRACAO', x: -900, z: 440, ack: true });
    room.send('qa_dyn', { kind: 'BRIGA_GENERALIZADA', x: -850, z: 420, ack: true });
    room.send('qa_dyn', { kind: 'INVALIDO', ack: true });
    await until(() => (msgs.qa_dyn_res?.length ?? 0) >= 3);
    expect(msgs.qa_dyn_res.map((r) => r.ok)).toEqual([true, true, false]);
    const [cid, fid] = msgs.qa_dyn_res.map((r) => r.id);
    await until(() => (msgs.dyn?.at(-1)?.list as DynamicSignalWire[] | undefined)?.some((s) => s.id === cid));
    const sig = (msgs.dyn.at(-1).list as DynamicSignalWire[]).find((s) => s.id === cid)!;
    expect(sig).toMatchObject({ k: 'CONCENTRACAO', x: -900, z: 440, n: 0 });
    await until(() => (msgs.agenda.at(-1).list as AgendaEntry[]).some((e) => e.inst === cid && e.format === 'dinamico' && e.state === 'ACTIVE'));
    await until(() => (msgs.evt_pts?.at(-1)?.list as EventPointWire[] | undefined)?.some((p) => p.id === `dyn_${cid}` && p.crowd === 0));
    // foco fantasma: níveis na ordem (acelerado no QA), sem ninguém (n = 0 até a WorldView do AGENTE C)
    const levels: number[] = [];
    let seen = 0;
    await until(() => { for (; seen < (msgs.dyn?.length ?? 0); seen++) for (const s of msgs.dyn[seen].list as DynamicSignalWire[]) if (s.id === fid && levels.at(-1) !== s.e) levels.push(s.e); return levels.includes(3); }, 40_000);
    expect(levels.slice(0, 3)).toEqual([1, 2, 3]);
    // foco de briga: na agenda só como "Briga generalizada" (dados: presentation.agenda); nunca como ponto de concentração
    expect((msgs.agenda.at(-1).list as AgendaEntry[]).some((e) => e.inst === fid && e.name !== 'Briga generalizada')).toBe(false);
    expect((msgs.evt_pts.at(-1).list as EventPointWire[]).some((p) => p.id === `dyn_${fid}`)).toBe(false);
  }, 60_000);
});
