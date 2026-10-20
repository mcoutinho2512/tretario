/**
 * Rodada 12 — PERSONAGENS AUTÔNOMOS na sala REAL (Colyseus no mesmo processo, PV_TEST=1, PV_AUTONOMOUS=60):
 * tipo de entidade (humano 0 · autônomo 1 · bot de carga 2) chegando ao cliente; métricas públicas e /metrics contam
 * só pessoas; denunciar/silenciar autônomo recusado ('autonomo'); apelido de autônomo reservado no cadastro; ações de
 * autônomo fora do barramento de missões; veículo pelo MESMO caminho (onEnter → mountVehicle, occupant/vehicle);
 * confronto pelo CombatSystem (aceitos, nunca 'spam'); diretor de eventos ligado à WorldView real.
 * PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import { freePortBlock } from './fixtures/freePort';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = await freePortBlock(2);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_add', 'gf_del', 'gf_state', 'gf_res', 'pong', 'chat_hello', 'chat', 'presence', 'race_board', 'walk', 'clash', 'evt_done', 'exit_ok', 'correct', 'denied', 'ads', 'prog', 'cbt_self', 'agenda', 'evt_pts', 'dyn', 'spawn', 'items', 'knock', 'cbt_hit', 'prog_ev', 'mode_ok'];
const until = async (f: () => unknown, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await w(50); } return true; };
const srvMod = (m: string) => import(/* @vite-ignore */ `../server/src/${m}`);

let gameServer: { close(): Promise<void> } | null = null;
let liveRooms: Set<any>;
const rooms: Room[] = [];
const SP = { x: -560, z: 300 };

describe.skipIf(skip)('personagens autônomos — sala real', () => {
  beforeAll(async () => {
    process.env.PV_TEST = '1';
    process.env.PV_STORE = 'memory';
    process.env.PV_GRAFFITI_STORE = 'memory';
    process.env.PV_AUTONOMOUS = '60';
    const { MemoryDataStore } = await import('../server/src/data/memory');
    const { TicketService } = await import('../server/src/identity/tickets');
    const { setServices } = await import('../server/src/services');
    setServices({ store: new MemoryDataStore(), tickets: new TicketService() });
    liveRooms = (await srvMod('PresidenteVargasRoom.ts')).liveRooms;
    const { listenGameServer } = await srvMod('testServer.ts') as { listenGameServer(port: number): Promise<{ close(): Promise<void> }> };
    gameServer = await listenGameServer(PORT);
  }, 60_000);
  afterAll(async () => {
    delete process.env.PV_AUTONOMOUS;
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(2000)]);
    await Promise.race([gameServer?.close(), w(3000)]);
  });

  it('kind por entidade, métricas só de pessoas, denúncia/silenciar recusados, apelido reservado, missões sem autônomos', async () => {
    const human = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, name: 'Pessoa', testSpawn: SP });
    rooms.push(human);
    const got: Record<string, any[]> = {};
    for (const q of QUIET) human.onMessage(q, () => {});
    for (const t of ['user_report_res', 'chat_mute_denied']) human.onMessage(t, (m: unknown) => { (got[t] ??= []).push(m); });
    human.onMessage('*', () => {});
    const bot = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, name: 'Carga', bot: true, testSpawn: { x: SP.x + 4, z: SP.z } });
    rooms.push(bot);
    bot.onMessage('*', () => {});
    const room = [...liveRooms].find((r) => r.roomId === human.roomId);
    expect(room?.auto).toBeTruthy();
    // autônomos aparecem perto da pessoa e chegam ao cliente pelo MESMO estado (kind 1)
    const kinds = () => { const k: Record<number, number> = {}; (human.state as any).players.forEach((p: any) => { k[p.kind] = (k[p.kind] ?? 0) + 1; }); return k; };
    expect(await until(() => (kinds()[1] ?? 0) >= 5, 10_000)).toBe(true);
    const srvKinds: Record<number, number> = {};
    room.state.players.forEach((p: any, id: string) => { srvKinds[p.kind] = (srvKinds[p.kind] ?? 0) + 1; if (p.kind === 1) expect(id.startsWith('ac:')).toBe(true); });
    expect(srvKinds[0]).toBe(1); expect(srvKinds[2]).toBe(1); expect(srvKinds[1]).toBeGreaterThan(5);
    expect(room.state.players.get(human.sessionId).kind).toBe(0);
    expect(room.state.players.get(bot.sessionId).kind).toBe(2);
    // métricas públicas: só a pessoa; bot como testBots; autônomos em lugar nenhum
    const pm = await srvMod('presence/publicMetrics.ts');
    pm.resetMetricsCache();
    const pub = pm.publicMetrics(Date.now());
    expect(pub.playersOnline).toBe(1);
    expect(pub.testBots).toBe(1);
    // /metrics: `players` = conexões de jogo (pessoa + bot); autônomos à parte
    const { metrics } = await srvMod('metrics.ts');
    metrics.sample('teste-auto'); await w(1200);
    const m = metrics.sample('teste-auto');
    expect(m.players).toBe(2);
    expect(m.autonomousActive).toBeGreaterThan(5);
    expect(m.autonomousPopulation).toBe(60);
    expect(typeof m.aiMs).toBe('number');
    // denunciar / silenciar um autônomo: recusa limpa
    let anid = 0; room.state.players.forEach((p: any) => { if (p.kind === 1 && !anid) anid = p.nid; });
    human.send('user_report', { nid: anid, category: 'OUTRO' });
    human.send('chat_mute', { nid: anid, on: true });
    expect(await until(() => got.user_report_res?.length && got.chat_mute_denied?.length)).toBe(true);
    expect(got.user_report_res[0]).toEqual({ ok: false, r: 'autonomo' });
    expect(got.chat_mute_denied[0]).toEqual({ reason: 'autonomo' });
    // apelido de autônomo vivo: reservado no cadastro/troca de apelido
    const { autonomousNicknameTaken, nicknameKey } = await srvMod('autonomous/names.ts');
    const anyName = room.auto.list()[0].name as string;
    expect(autonomousNicknameTaken(nicknameKey(anyName))).toBe(true);
    const { AuthService } = await srvMod('auth/service.ts').catch(() => ({ AuthService: null }));
    if (AuthService?.prototype?.checkNickname) {
      const fake = { store: { profiles: { byNicknameKey: async () => null } } };
      expect(await AuthService.prototype.checkNickname.call(fake, anyName)).toEqual({ ok: false, error: 'apelido_em_uso' });
    }
    // barramento de missões/progressão ignora autônomos
    const before = room.gameplay.emitted;
    room.gameplay.emit('ac:1', { type: 'chat' });
    expect(room.gameplay.emitted).toBe(before);
    // diretor de eventos ligado à WorldView real (near enxerga os autônomos)
    const out: unknown[] = [];
    expect(room.auto.near(SP.x, SP.z, 120, out)).toBeGreaterThan(5);
    expect(room.dyn.view).toBe(room.auto);
  }, 40_000);

  it('autônomo usa veículo do mundo pelo mesmo caminho e briga pelas regras do CombatSystem', async () => {
    const room = [...liveRooms][0];
    const auto = room.auto;
    const rt = room.rt as Map<string, any>;
    // um autônomo materializado vai a uma bicicleta livre perto
    let vid = '', vx = 0, vz = 0;
    room.state.vehicles.forEach((v: any, id: string) => { if (!vid && v.kind === 'bicycle' && !v.occupant && Math.hypot(v.x - SP.x, v.z - SP.z) < 400) { vid = id; vx = v.x; vz = v.z; } });
    expect(vid).not.toBe('');
    // leva a pessoa (e com ela a "área viva") para perto da bicicleta
    const human = rooms[0];
    human.send('test_tp', { x: vx + 3, z: vz + 3 });
    await w(1200);
    const ids: string[] = auto.list().filter((a: any) => a.materialized).map((a: any) => a.id);
    expect(ids.length).toBeGreaterThan(3);
    const rider = ids[0];
    const place = (id: string, x: number, z: number) => { const p = room.state.players.get(id), r = rt.get(id); p.x = x; p.z = z; r.last = { ...r.last, x, z, t: Date.now() }; r.actor.x = x; r.actor.z = z; auto.place(id, x, z); };
    place(rider, vx + 1.2, vz);
    auto.force(rider, 'USE_VEHICLE');
    expect(await until(() => room.state.vehicles.get(vid).occupant === rider || [...room.state.vehicles.values()].some((v: any) => v.occupant === rider), 10_000)).toBe(true);
    const p = room.state.players.get(rider);
    expect(p.vehicle).not.toBe('');
    expect(room.state.vehicles.get(p.vehicle).occupant).toBe(rider);
    // dois autônomos brigam: pedidos aceitos pelo CombatSystem, nunca negados por excesso (ritmo humano)
    const [a, b] = ids.slice(1, 3);
    place(a, vx + 6, vz + 6); place(b, vx + 6.8, vz + 6);
    const st0 = { ...room.combat.stats, denied: { ...room.combat.stats.denied } };
    auto.force(a, 'JOIN_FIGHT', { target: b });
    auto.force(b, 'JOIN_FIGHT', { target: a });
    // até 12 s (com a suíte inteira rodando em paralelo, 6 s fixos às vezes davam só 2 golpes aceitos)
    await until(() => room.combat.stats.accepted - st0.accepted > 2, 12_000);
    const st = room.combat.stats;
    if (process.env.PV_DEBUG_TEST) console.log('DBG', JSON.stringify({ acc: st.accepted - st0.accepted, den: st.denied, d0: st0.denied, a: auto.debug(a), b: auto.debug(b) }));
    expect(st.accepted - st0.accepted).toBeGreaterThan(2);
    expect((st.denied.spam ?? 0) - (st0.denied.spam ?? 0)).toBe(0);
  }, 40_000);
});
