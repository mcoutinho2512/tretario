/**
 * Rodada 12 (agente G) — mundo dinâmico na SALA REAL (Colyseus no mesmo processo, PV_TEST=1, PV_AUTONOMOUS=150):
 * com proteção de retorno, colisão entre corpos e o CombatSystem de verdade —
 *  - humano AGRIDE: confrontador/agitado revidam (golpe de volta), cauteloso foge (AVOID_FIGHT, nenhum golpe);
 *  - discussão ESPONTÂNEA (sem `qa_dyn`, dados de frequência acelerados só aqui) vira briga com golpes trocados entre
 *    autônomos;
 *  - foco de QA (`qa_dyn` BRIGA_GENERALIZADA) com plateia: TENSÃO → CONFRONTO → GENERALIZADO por adesões graduais;
 *  - quem joga LONGE do eixo (vaga a ~270 m) recebe gente por perto.
 * PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { freePortBlock } from './fixtures/freePort';
import { Axis } from '../server/src/autonomous/axis';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = await freePortBlock(2);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const until = async (f: () => unknown, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await w(50); } return true; };
const srvMod = (m: string) => import(/* @vite-ignore */ `../server/src/${m}`);
const M = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const AX = new Axis(M.pvAxis);
const SP = { x: -560, z: 300 };

let gameServer: { close(): Promise<void> } | null = null;
let liveRooms: Set<any>;
const rooms: Room[] = [];
const join = async (name: string, at: { x: number; z: number }) => {
  const r = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, name, testSpawn: at });
  r.onMessage('*', () => {});
  rooms.push(r);
  return r;
};

describe.skipIf(skip)('rodada 12 (G) — escalada, revide e população na sala real', () => {
  beforeAll(async () => {
    process.env.PV_TEST = '1';
    process.env.PV_STORE = 'memory';
    process.env.PV_GRAFFITI_STORE = 'memory';
    process.env.PV_AUTONOMOUS = '150';
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

  it('revide/fuga pela personalidade, discussão espontânea → briga com golpes trocados, generalizada gradual, gente longe do eixo', async () => {
    const human = await join('Pessoa', SP);
    const acts: { by: number; at: number }[] = [], hits: { by: number; tgt: number; r: string }[] = [];
    const room = [...liveRooms].find((r) => r.roomId === human.roomId);
    // golpes como o SERVIDOR os anuncia (CombatSystem → sala), sem depender da AOI/rede do cliente de teste
    const orig = room.autoCombat.bind(room);
    room.autoCombat = (type: string, msg: any) => { if (type === 'cbt_act') acts.push({ by: msg.by, at: Date.now() }); else if (type === 'cbt_hit') hits.push(msg); orig(type, msg); };
    const auto = room.auto, dyn = room.dyn, rt = room.rt as Map<string, any>;
    expect(await until(() => auto.list().filter((a: any) => a.materialized).length > 40, 15_000)).toBe(true);
    await w(6000); // proteção de retorno (5 s) de quem acabou de aparecer
    const place = (id: string, x: number, z: number) => { const p = room.state.players.get(id), r = rt.get(id); p.x = x; p.z = z; r.last = { ...r.last, x, z, t: Date.now() }; r.actor.x = x; r.actor.z = z; auto.place(id, x, z); };
    const me = () => room.state.players.get(human.sessionId);
    // livres e FORA da proteção de retorno (quem acabou de aparecer/levantar não sofre impacto por 5 s — regra da sala)
    const busy = (id: string) => ['ARGUE', 'FIGHT', 'WATCH', 'FLEE'].includes(dyn.roleOf(id)?.role ?? ''); // reunião não conta: apanhar tira da reunião
    const free = (pers: string[]) => auto.list().filter((a: any) => a.materialized && pers.includes(a.personality) && !a.fight && !a.vehicle && !busy(a.id) && (rt.get(a.id)?.actor.immuneUntil ?? 0) < Date.now() - 500);

    // ---------- 1) humano agride: revide (confrontador/agitado) × fuga (cauteloso)
    const provoke = async (id: string) => {
      await until(() => me().status === 0, 8000); // quem foi empurrado antes precisa levantar para bater
      const nid = room.state.players.get(id).nid;
      let t0 = 0;
      for (let tries = 0; tries < 3; tries++) {
        const p = me();
        place(id, p.x + 0.9, p.z);
        await w(300);
        t0 = Date.now();
        human.send('cbt', { a: 1, h: Math.PI / 2 });
        if (await until(() => hits.some((h) => h.tgt === nid && h.r === 'hit'), 1500)) break; // o soco pegou
        await w(1200);
      }
      let fled = false;
      await until(() => { if (auto.debug(id).goal === 'AVOID_FIGHT') fled = true; return acts.some((a) => a.by === nid && a.at > t0 + 50); }, 9000);
      return { back: acts.some((a) => a.by === nid && a.at > t0 + 50), fled };
    };
    // intervalo por humano zerado SÓ aqui: cada provocação passa pela reação do diretor (pesos da personalidade)
    dyn.cfg.conflict.provocation.cooldownPerHumanS = 0;
    await until(() => free(['CONFRONTADOR', 'AGITADO']).length >= 2, 40_000); // a população vai chegando (LOD/chegadas)
    const hot = [...free(['CONFRONTADOR']), ...free(['AGITADO'])].slice(0, 5);
    expect(hot.length).toBeGreaterThanOrEqual(2);
    let back = 0, k = 0;
    for (const a of hot) { const r = await provoke(a.id); if (r.back) back++; human.send('test_tp', { x: SP.x + 25 * ++k, z: SP.z }); await w(2000); }
    // revide ~97 % (confrontador) / ~85 % (agitado) pelos pesos: a maioria revida (folga para o sorteio)
    expect(back).toBeGreaterThanOrEqual(Math.max(1, Math.ceil(hot.length * 0.5)));
    const shy = free(['CAUTELOSO'])[0];
    if (shy) {
      human.send('test_tp', { x: SP.x - 40, z: SP.z }); await w(1500);
      const r = await provoke(shy.id);
      expect(r.back).toBe(false); // cauteloso não revida
      expect(r.fled).toBe(true); // foge (AVOID_FIGHT)
    }

    // ---------- 2) discussão ESPONTÂNEA (sondas do diretor, sem qa_dyn) → briga com golpes trocados entre autônomos
    human.send('test_tp', { x: SP.x, z: SP.z + 20 }); await w(1500);
    const C = dyn.cfg.conflict, B = dyn.cfg.budget.conflict;
    Object.assign(C, { seedChance: 1 }); Object.assign(C.tension, { escalateChance: 1, calmChance: 0 });
    Object.assign(B, { globalCooldownS: 0, regionCooldownS: 0, fightCooldownS: 0, minSpacingM: 0 });
    Object.assign(dyn.cfg.director, { probeNearHumanShare: 1, probeHumanOffsetM: 8 });
    const crowd = free(['AGITADO', 'CONFRONTADOR', 'TORCEDOR', 'SOCIAL']).slice(0, 8);
    crowd.forEach((a: any, i: number) => place(a.id, me().x + 3 + (i % 4) * 1.4, me().z + 3 + Math.floor(i / 4) * 1.4));
    const srvHits = hits;
    const nids = () => new Set(auto.list().map((a: any) => a.nid));
    const hist0 = dyn.history.length;
    // nasceu SOZINHA neste trecho (início sem detalhe: nem provocada nem forçada) e subiu para CONFRONTO
    const spontaneous = () => { const fresh = dyn.history.slice(hist0); const st = fresh.filter((h: any) => h.ev === 'start' && h.kind === 'DISCUSSAO' && !h.detail).map((h: any) => h.id); return fresh.find((h: any) => h.ev === 'level' && h.level === 'CONFRONTO' && st.includes(h.id)); };
    expect(await until(() => spontaneous(), 30_000)).toBe(true);
    const between = () => { const ns = nids(); return srvHits.filter((h) => h.r === 'hit' && ns.has(h.by) && ns.has(h.tgt)); };
    await until(() => new Set(between().map((h) => h.by)).size >= 2, 30_000);
    expect(new Set(between().map((h) => h.by)).size).toBeGreaterThanOrEqual(2); // golpes TROCADOS (os dois lados bateram)
    Object.assign(C, { seedChance: 0 }); // chega de focos novos

    // ---------- 3) foco de QA com plateia: TENSÃO → CONFRONTO → GENERALIZADO, adesões graduais
    human.send('test_tp', { x: SP.x + 60, z: SP.z - 10 }); await w(1500);
    const ring = free(['AGITADO', 'CONFRONTADOR', 'TORCEDOR', 'SOCIAL', 'CURIOSO', 'OBSERVADOR', 'MANIFESTANTE']).slice(0, 22);
    ring.forEach((a: any, i: number) => { const ang = (i / ring.length) * Math.PI * 2; place(a.id, me().x + 6 + Math.cos(ang) * (2 + (i % 3)), me().z + Math.sin(ang) * (2 + (i % 3))); });
    await w(800);
    human.send('qa_dyn', { kind: 'BRIGA_GENERALIZADA', x: me().x + 6, z: me().z, ack: true });
    let gid = '';
    await until(() => { gid = dyn.history.filter((h: any) => h.ev === 'start' && h.kind === 'DISCUSSAO').at(-1)?.id ?? ''; return gid && dyn.history.some((h: any) => h.id === gid && h.level === 'GENERALIZADO'); }, 50_000);
    const lv = dyn.history.filter((h: any) => h.id === gid && (h.ev === 'start' || h.ev === 'level')).map((h: any) => h.level);
    expect(lv.slice(0, 3)).toEqual(['TENSAO', 'CONFRONTO', 'GENERALIZADO']);
    const steps: number[] = [];
    for (let i = 0; i < 20; i++) { const d = dyn.debug(gid); if (d) steps.push(d.roles.FIGHT ?? 0); await w(400); }
    for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBeLessThanOrEqual(C.general.maxJoinPerEval * 2);

    // ---------- 4) quem joga LONGE do eixo (vaga a ~270 m): gente chega por perto
    let far = { x: 0, z: 0 }, best = Infinity;
    for (const v of M.vehicleSpawns) { const d = Math.abs(AX.project(v.x, v.z).d - 270); if (d < best) { best = d; far = { x: v.x + 2, z: v.z + 2 }; } }
    expect(AX.project(far.x, far.z).d).toBeGreaterThan(200);
    const far1 = await join('Longe', far);
    const fp = () => room.state.players.get(far1.sessionId);
    const nearFar = () => auto.list().filter((a: any) => a.materialized && Math.hypot(a.x - fp().x, a.z - fp().z) < 110).length;
    expect(await until(() => nearFar() >= 5, 30_000)).toBe(true);
  }, 240_000);
});
