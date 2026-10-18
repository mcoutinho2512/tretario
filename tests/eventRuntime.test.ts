/**
 * Rodada 9 — EventRuntime (agenda, estados, inscrição) e runners de caminhada, corrida (bicicleta E patinete no
 * MESMO runner) e confronto de grupos, com relógio e sala FALSOS (server/src/events é sem Colyseus).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventRuntime } from '../server/src/events/EventRuntime';
import { sanitizeAgenda } from '../server/src/events/agenda';
import { RUNNERS } from '../server/src/events/runners';
import { RACE_MAX_CORRECTIONS } from '../server/src/events/RaceRunner';
import type { EventHost, ParticipantView } from '../server/src/events/runner';
import type { ScheduledEventDef } from '../src/events/schedule';
import type { GameplayEnvelope } from '../src/gameplay/events';
import { occurrence, occurrencesAround, timeState } from '../src/events/recurrence';
import { resolvePoint, routePolyline, segmentHitsCircle } from '../src/events/route';
import { combatAllowed, type CombatParty, type ZoneCombatPolicy } from '../src/combat/policy';
import { environmentCells } from '../server/src/spectator/CrowdCellAggregator';
import { CROWD_CELL } from '../src/spectator/tiers';
import { cellOfKey as cellXZ } from '../src/spectator/cellCodec';
import { MAX_SPEED } from '../src/net/protocol';
import type { EventDef } from '../src/events/types';

const axis: [number, number][] = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
const MIN = 60_000;

/** sala falsa: jogadores com posição/veículo/grupo; registra mensagens e eventos de gameplay */
function fakeRoom() {
  const ps = new Map<string, ParticipantView>();
  const sent: { sid: string; type: string; msg: any }[] = [];
  const emitted: GameplayEnvelope[] = [];
  const teleports: { sid: string; x: number; z: number }[] = [];
  const prot = new Map<string, number>();
  const zone = new Map<string, string>();
  const host: EventHost = {
    participant: (sid) => ps.get(sid) ?? null,
    players: () => ps.keys(),
    send: (sid, type, msg) => sent.push({ sid, type, msg }),
    emit: (sid, ev) => emitted.push({ sid, at: 0, ev }),
    zoneOf: (sid) => zone.get(sid) ?? null,
    teleport: (sid, x, z) => { teleports.push({ sid, x, z }); const p = ps.get(sid); if (p) { p.x = x; p.z = z; } return true; },
    protect: (sid, until) => { prot.set(sid, until); },
  };
  const add = (sid: string, o: Partial<ParticipantView> = {}) => { ps.set(sid, { sid, name: sid.toUpperCase(), x: 0, z: 0, vehicleKind: null, groupKey: null, status: 0, dropped: false, onPlatform: false, ...o }); return ps.get(sid)!; };
  const of = (type: string, sid?: string) => sent.filter((s) => s.type === type && (!sid || s.sid === sid));
  return { ps, sent, emitted, teleports, prot, zone, host, add, of };
}

const base = (o: Partial<ScheduledEventDef>): ScheduledEventDef => ({
  id: 'ev', format: 'encontro', name: 'Ev', description: '', zones: ['CENTRAL'],
  recurrence: { everyMin: 30, offsetMin: 10, registrationMin: 5, startingS: 20, durationMin: 6 },
  capacity: 3, minParticipants: 0, rewards: [], ...o,
});

function rig(defs: ScheduledEventDef[], t0: number) {
  const room = fakeRoom();
  const clock = { t: t0 };
  const rt = new EventRuntime(defs, room.host, axis, { clock: () => clock.t });
  const at = (t: number) => { clock.t = t; rt.tick(t, 100); };
  /** avança em passos de 100 ms (como a sala) */
  const run = (ms: number, each?: (t: number) => void) => { const end = clock.t + ms; while (clock.t < end) { clock.t += 100; each?.(clock.t); rt.tick(clock.t, 100); } };
  return { ...room, rt, clock, at, run };
}

describe('recorrência e máquina de estados', () => {
  it('horários da ocorrência e estados pelo relógio', () => {
    const rec = { everyMin: 30, offsetMin: 10, registrationMin: 5, startingS: 20, durationMin: 6 };
    const o = occurrence(rec, 2);
    expect(o.startsAt).toBe(70 * MIN);
    expect(o.countdownAt).toBe(70 * MIN - 20_000);
    expect(o.opensAt).toBe(70 * MIN - 20_000 - 5 * MIN);
    expect(o.endsAt).toBe(76 * MIN);
    expect([o.opensAt - 1, o.opensAt, o.countdownAt, o.startsAt, o.endsAt].map((t) => timeState(o, t))).toEqual(['SCHEDULED', 'REGISTRATION', 'STARTING', 'ACTIVE', 'FINISHED']);
    // agenda: a corrente e a próxima; janela absoluta corta
    const around = occurrencesAround({ recurrence: rec }, 71 * MIN);
    expect(around.map((x) => x.k)).toEqual([2, 3]);
    expect(occurrencesAround({ recurrence: rec, endAt: new Date(80 * MIN).toISOString() }, 71 * MIN).map((x) => x.k)).toEqual([2]);
  });

  it('SCHEDULED → REGISTRATION → STARTING → ACTIVE → FINISHED com inscrição; event_join; agenda ≤ 1 Hz e na mudança', () => {
    const R = rig([base({ minParticipants: 1 })], 0);
    R.add('a');
    R.at(1 * MIN);
    const inst = R.rt.instances()[0];
    expect(inst.state).toBe('SCHEDULED');
    expect(R.rt.join('a', inst.inst)).toEqual({ ok: false, r: 'fechado' });
    R.at(inst.opensAt);
    expect(inst.state).toBe('REGISTRATION');
    expect(R.rt.join('a', inst.inst)).toEqual({ ok: true });
    expect(R.emitted.map((e) => e.ev)).toEqual([{ type: 'event_join', eventId: 'ev', format: 'encontro' }]);
    expect(R.rt.join('a', inst.inst)).toEqual({ ok: false, r: 'ja_inscrito' });
    const n0 = R.of('agenda', 'a').length;
    R.at(inst.opensAt + 200); // < 1 s: não reenvia
    expect(R.of('agenda', 'a').length).toBe(n0);
    R.at(inst.opensAt + 1500);
    const last = R.of('agenda', 'a').at(-1)!.msg.list.find((e: any) => e.inst === inst.inst);
    expect(last).toMatchObject({ state: 'REGISTRATION', count: 1, joined: true, capacity: 3 });
    const n1 = R.of('agenda', 'a').length;
    R.at(inst.opensAt + 3500); // nada mudou: não reenvia
    expect(R.of('agenda', 'a').length).toBe(n1);
    R.at(inst.countdownAt); expect(inst.state).toBe('STARTING');
    R.at(inst.startsAt); expect(inst.state).toBe('ACTIVE');
    R.at(inst.endsAt); expect(inst.state).toBe('FINISHED');
    // terminou: liberado para outra inscrição; a próxima ocorrência já está na agenda
    expect(R.rt.instanceOf('a')).toBeNull();
    expect(R.rt.instances().some((i) => i.state === 'SCHEDULED')).toBe(true);
  });

  it('CANCELLED quando o mínimo não é atingido; minParticipants 0 acontece vazio', () => {
    const R = rig([base({ id: 'min2', minParticipants: 2 }), base({ id: 'zero', minParticipants: 0 })], 0);
    R.add('a');
    R.at(6 * MIN);
    const [a, b] = ['min2', 'zero'].map((id) => R.rt.instances().find((i) => i.def.id === id)!);
    expect(R.rt.join('a', a.inst).ok).toBe(true);
    R.at(a.startsAt);
    expect(a.state).toBe('CANCELLED');
    expect(b.state).toBe('ACTIVE');
    expect(R.rt.instanceOf('a')).toBeNull(); // cancelado libera a inscrição
    R.at(a.startsAt + 2000);
    const ag = R.of('agenda', 'a').at(-1)!.msg.list;
    expect(ag.find((e: any) => e.inst === a.inst).state).toBe('CANCELLED');
  });

  it('capacidade, regras de grupo (só por chave), permissão e inexistente', () => {
    const R = rig([base({ capacity: 2, groupRules: { allowed: ['g1', 'g2'] } })], 6 * MIN);
    R.add('a', { groupKey: 'g1' }); R.add('b', { groupKey: 'g2' }); R.add('c', { groupKey: 'g1' }); R.add('d', { groupKey: 'g3' }); R.add('e');
    R.at(6 * MIN);
    const i = R.rt.instances()[0].inst;
    expect(R.rt.join('d', i)).toEqual({ ok: false, r: 'grupo' });
    expect(R.rt.join('e', i)).toEqual({ ok: false, r: 'grupo' }); // sem grupo também não entra quando há lista
    expect(R.rt.join('a', i, false)).toEqual({ ok: false, r: 'sem_permissao' });
    expect(R.rt.join('a', 'nada@0')).toEqual({ ok: false, r: 'inexistente' });
    expect(R.rt.join('a', i).ok).toBe(true);
    expect(R.rt.join('b', i).ok).toBe(true);
    expect(R.rt.join('c', i)).toEqual({ ok: false, r: 'lotado' });
    expect(R.rt.leave('a', i)).toBe(true);
    expect(R.rt.join('c', i).ok).toBe(true);
  });

  it('graça de reconexão mantém a inscrição; sair de vez (gone) desiste', () => {
    const R = rig([base({ minParticipants: 1 })], 6 * MIN);
    const a = R.add('a');
    R.at(6 * MIN);
    const inst = R.rt.instances()[0];
    R.rt.join('a', inst.inst);
    a.dropped = true; // caiu: entidade congelada, em graça
    R.at(inst.startsAt);
    expect(inst.state).toBe('ACTIVE'); // continua contando para o mínimo
    expect(inst.members.has('a')).toBe(true);
    R.rt.gone('a');
    expect(inst.members.has('a')).toBe(false);
    expect(R.rt.instanceOf('a')).toBeNull();
  });

  it('todos os eventos de public/events: agenda válida, formatos com runner e zonas existentes', () => {
    const idx = JSON.parse(readFileSync('public/events/index.json', 'utf8')) as { events: string[] };
    const zones = new Set((JSON.parse(readFileSync('public/world/zones.json', 'utf8')).zones as { id: string }[]).map((z) => z.id));
    let n = 0;
    for (const id of idx.events) {
      const ev = JSON.parse(readFileSync(`public/events/${id}.json`, 'utf8')) as EventDef;
      const ag = ev.agenda ?? [];
      expect(sanitizeAgenda(ag).length, id).toBe(ag.length);
      for (const d of ag) {
        n++;
        expect(RUNNERS.get(d.format)?.(d), `${id}/${d.id}`).toBeTruthy();
        for (const z of d.zones) expect(zones.has(z), z).toBe(true);
        for (const g of d.groupRules?.allowed ?? []) expect(ev.groups?.some((x) => x.id === g), g).toBe(true);
      }
    }
    expect(n).toBeGreaterThanOrEqual(6);
  });
});

// ------------------------------------------------------------------------------------------------ caminhada
const walkDef = (o: Partial<ScheduledEventDef> = {}) => base({
  id: 'walk', format: 'caminhada', capacity: 50, npcCrowd: 100, zones: ['CENTRAL', 'CANDELARIA'],
  recurrence: { everyMin: 60, offsetMin: 0, registrationMin: 1, startingS: 10, durationMin: 10 },
  walk: { paceMs: 5, followRadius: 20, completeFraction: 0.6, route: [{ id: 'a', at: { t: 0.28 }, radius: 20 }, { id: 'b', at: { t: 0.4 }, radius: 20 }] }, ...o,
});

describe('caminhada', () => {
  it('líder anda no passo, segue o eixo; quem acompanha conclui (event_complete), quem fica longe não', () => {
    const R = rig([walkDef()], 59 * MIN);
    const near = R.add('near'), far = R.add('far'), bike = R.add('bike', { vehicleKind: 'bicycle' });
    R.at(59.5 * MIN);
    const inst = R.rt.instances().find((i) => i.state === 'REGISTRATION')!;
    for (const s of ['near', 'far', 'bike']) expect(R.rt.join(s, inst.inst).ok).toBe(true);
    R.at(inst.startsAt);
    const start = resolvePoint(axis, { t: 0.28 }), end = resolvePoint(axis, { t: 0.4 });
    const st0 = R.rt.runnerState(inst.inst) as any;
    expect(Math.hypot(st0.leader.x - start.x, st0.leader.z - start.z)).toBeLessThan(1);
    // rota segue o eixo (amostrada): mais longa que a reta, ≈ fração × comprimento do eixo
    expect(st0.total).toBeGreaterThan(Math.hypot(end.x - start.x, end.z - start.z) - 1);
    far.x = start.x + 300; far.z = start.z;
    R.run(30_000, () => { const s = R.rt.runnerState(inst.inst) as any; near.x = s.leader.x + 5; near.z = s.leader.z; bike.x = s.leader.x; bike.z = s.leader.z; });
    const s1 = R.rt.runnerState(inst.inst) as any;
    expect(s1.d).toBeCloseTo(150, -1); // 5 m/s × 30 s
    // concentração em movimento (RallyPoint 'event' com NPCs reservados)
    const pts = R.rt.rallies();
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ crowd: 100, strength: 1 });
    expect(Math.hypot(pts[0].x - s1.leader.x, pts[0].z - s1.leader.z)).toBeLessThan(0.1);
    R.run((s1.total / 5) * 1000 + 25_000, () => { const s = R.rt.runnerState(inst.inst) as any; if (!s) return; near.x = s.leader.x + 5; near.z = s.leader.z; bike.x = s.leader.x; bike.z = s.leader.z; });
    const done = R.emitted.filter((e) => e.ev.type === 'event_complete').map((e) => e.sid);
    expect(done).toEqual(['near']); // de bicicleta não é caminhada; longe não acompanhou
    expect(inst.state).toBe('FINISHED'); // chegou + dispersão
    expect(R.of('walk', 'near').at(-1)!.msg.done).toBe(true);
    expect(R.of('evt_pts').length).toBeGreaterThan(5); // ≤ 1 Hz enquanto anda
  });

  it('espectador aéreo: a densidade de ambiente das células ACOMPANHA o líder', () => {
    const R = rig([walkDef()], 59.5 * MIN);
    R.at(60 * MIN);
    const inst = R.rt.instances()[0];
    const envAt = () => environmentCells({ rallies: R.rt.rallies(), rallyCrowd: 0, peds: 0, axis, pedRange: [0, 1] });
    const peak = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const c0 = envAt();
    R.run(60_000);
    const c1 = envAt();
    const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(sum(c0)).toBe(100); expect(sum(c1)).toBe(100); // os NPCs reservados, nem mais nem menos
    expect(peak(c0)[0]).not.toBe(peak(c1)[0]); // a concentração trocou de célula
    // centro de massa das células de ambiente ≈ líder (andou ~300 m da Central)
    const s = R.rt.runnerState(inst.inst) as any;
    const com = (m: Map<number, number>) => { let x = 0, z = 0, n = 0; for (const [k, v] of m) { const [cx, cz] = cellXZ(k); x += (cx + 0.5) * CROWD_CELL.sizeM * v; z += (cz + 0.5) * CROWD_CELL.sizeM * v; n += v; } return { x: x / n, z: z / n }; };
    const m1 = com(c1), m0 = com(c0);
    expect(Math.hypot(m1.x - s.leader.x, m1.z - s.leader.z)).toBeLessThan(CROWD_CELL.sizeM);
    expect(Math.hypot(m1.x - m0.x, m1.z - m0.z)).toBeGreaterThan(250);
  });
});

// ------------------------------------------------------------------------------------------------ corrida
const raceDef = (vehicle: 'bicycle' | 'scooter', o: Partial<ScheduledEventDef> = {}): ScheduledEventDef => base({
  id: `race-${vehicle}`, format: 'corrida', capacity: 8, minParticipants: 1, npcCrowd: 20, zones: ['CIDADE_NOVA'],
  recurrence: { everyMin: 30, offsetMin: 10, registrationMin: 2, startingS: 10, durationMin: 10 },
  race: { vehicle, laps: 2, timeLimitS: 300, start: { id: 's', at: { x: 0, z: 0 }, radius: 5 }, checkpoints: [{ id: 'c1', at: { x: 100, z: 0 }, radius: 5 }, { id: 'c2', at: { x: 100, z: 100 }, radius: 5 }, { id: 'c3', at: { x: 0, z: 100 }, radius: 5 }] }, ...o,
});
/** dirige em linha reta até (x,z) a `v` m/s, com movimentos a 10 Hz (como o servidor aceitaria) */
function driver(R: ReturnType<typeof rig>, sid: string, mode: () => string) {
  const p = R.ps.get(sid)!;
  return (x: number, z: number, v: number) => {
    while (Math.hypot(x - p.x, z - p.z) > 0.01) {
      const d = Math.hypot(x - p.x, z - p.z), st = Math.min(d, v * 0.1);
      p.x += ((x - p.x) / d) * st; p.z += ((z - p.z) / d) * st;
      R.clock.t += 100;
      R.rt.onMove(sid, p.x, p.z, mode(), true, '', R.clock.t);
      R.rt.tick(R.clock.t, 100);
    }
  };
}

describe('corrida (bicicleta e patinete: o MESMO runner)', () => {
  for (const vehicle of ['bicycle', 'scooter'] as const) {
    it(`${vehicle}: veículo certo para inscrever, checkpoints em ordem, pular não conta, voltas, posição e tempo`, () => {
      const R = rig([raceDef(vehicle)], 7 * MIN);
      const a = R.add('a', { vehicleKind: vehicle }), b = R.add('b', { vehicleKind: vehicle });
      R.add('c', { vehicleKind: null }); R.add('w', { vehicleKind: vehicle === 'bicycle' ? 'scooter' : 'bicycle' });
      R.at(8.5 * MIN);
      const inst = R.rt.instances()[0];
      expect(inst.state).toBe('REGISTRATION');
      expect(R.rt.join('c', inst.inst)).toEqual({ ok: false, r: 'veiculo' }); // a pé
      expect(R.rt.join('w', inst.inst)).toEqual({ ok: false, r: 'veiculo' }); // veículo errado
      expect(R.rt.join('a', inst.inst).ok).toBe(true);
      expect(R.rt.join('b', inst.inst).ok).toBe(true);
      expect(R.of('race_def', 'a')[0].msg).toMatchObject({ vehicle, laps: 2, cps: [{ x: 100, z: 0, r: 5 }, { x: 100, z: 100, r: 5 }, { x: 0, z: 100, r: 5 }] });
      a.x = -3; b.x = -3; b.z = 3;
      R.at(inst.startsAt - 5000);
      expect(inst.state).toBe('STARTING');
      expect(R.of('race', 'a').at(-1)!.msg.t).toBeLessThan(0); // contagem
      R.at(inst.startsAt);
      expect(inst.state).toBe('ACTIVE');
      const v = MAX_SPEED[vehicle] * 0.95;
      const da = driver(R, 'a', () => (R.ps.get('a')!.vehicleKind ?? 'foot'));
      const db = driver(R, 'b', () => (R.ps.get('b')!.vehicleKind ?? 'foot'));
      // b pula o c1 (vai direto ao c2): não conta
      db(50, 60, v); db(100, 100, v);
      expect((R.rt.runnerState(inst.inst) as any).racers.find((r: any) => r.sid === 'b').step).toBe(0);
      // a faz as 2 voltas certinho e cruza a largada
      for (let lap = 0; lap < 2; lap++) { da(100, 0, v); da(100, 100, v); da(0, 100, v); da(0, 3, v); }
      da(0, -2, v);
      const ra = (R.rt.runnerState(inst.inst) as any).racers.find((r: any) => r.sid === 'a');
      expect(ra).toMatchObject({ step: 7, rank: 1, status: 'ok' });
      const fin = R.emitted.find((e) => e.ev.type === 'race_finish')!;
      expect(fin.sid).toBe('a');
      expect(fin.ev).toMatchObject({ type: 'race_finish', raceId: inst.inst, vehicle, rank: 1 });
      // tempo pelo relógio do servidor ≈ distância / velocidade (2 voltas ≈ 802 m; o relógio também andou nos ~142 m do b)
      const tm = (fin.ev as any).timeMs;
      expect(tm).toBeGreaterThan((800 / MAX_SPEED[vehicle]) * 1000);
      expect(tm).toBeLessThan(((802 + 142) / v) * 1000 + 2000);
      expect(R.emitted.filter((e) => e.ev.type === 'event_complete').map((e) => e.sid)).toEqual(['a']);
      expect(R.of('race', 'a').at(-1)!.msg).toMatchObject({ finished: true, rank: 1, cp: 7, lap: 2 });
      // b desmonta: andar a pé pelos checkpoints não avança
      R.ps.get('b')!.vehicleKind = null;
      db(100, 0, 6); db(100, 100, 6);
      expect((R.rt.runnerState(inst.inst) as any).racers.find((r: any) => r.sid === 'b').step).toBe(0);
      // tempo-limite: b vira DNF e a corrida termina com resultado
      R.run(300_000);
      expect(inst.state).toBe('FINISHED');
      const res = R.of('evt_result', 'a').at(-1)!.msg;
      expect(res.rows.map((r: any) => [r.name, r.rank, r.status])).toEqual([['A', 1, 'ok'], ['B', 2, 'dnf']]);
      expect(R.emitted.filter((e) => e.ev.type === 'race_finish')).toHaveLength(1);
    });
  }

  it('teleporte entre movimentos aceitos → DQ; muitas correções too_fast → DQ; nenhuma mensagem do cliente conta', () => {
    const R = rig([raceDef('bicycle')], 8.5 * MIN);
    R.add('t', { vehicleKind: 'bicycle' }); R.add('k', { vehicleKind: 'bicycle' });
    R.at(8.5 * MIN);
    const inst = R.rt.instances()[0];
    R.rt.join('t', inst.inst); R.rt.join('k', inst.inst);
    R.at(inst.startsAt);
    R.clock.t += 100;
    R.rt.onMove('t', 2, 0, 'bicycle', true, '', R.clock.t);
    R.clock.t += 100;
    R.rt.onMove('t', 99, 0, 'bicycle', true, '', R.clock.t); // 97 m em 0,1 s
    const st = (R.rt.runnerState(inst.inst) as any).racers;
    expect(st.find((r: any) => r.sid === 't')).toMatchObject({ status: 'dq', reason: 'teleporte', step: 0 });
    for (let i = 0; i <= RACE_MAX_CORRECTIONS; i++) { R.clock.t += 100; R.rt.onMove('k', 0.5 * i, 0, 'bicycle', false, 'too_fast', R.clock.t); }
    expect((R.rt.runnerState(inst.inst) as any).racers.find((r: any) => r.sid === 'k')).toMatchObject({ status: 'dq', reason: 'correcoes' });
    // runtime não expõe nenhum caminho de "cliente diz que passou": só onMove (posição aceita) e mensagens de formato
    R.rt.message('k', 'race_cp', { inst: inst.inst, cp: 3 });
    expect((R.rt.runnerState(inst.inst) as any).racers.find((r: any) => r.sid === 'k').step).toBe(0);
    expect(R.emitted.some((e) => e.ev.type === 'race_finish')).toBe(false);
    // todos fora de prova: termina já
    R.run(600);
    expect(inst.state).toBe('FINISHED');
    expect(R.of('evt_result', 't').at(-1)!.msg.rows.every((r: any) => r.status === 'dq')).toBe(true);
  });

  it('segmento × raio: atravessar um checkpoint entre dois movimentos conta, passar ao lado não', () => {
    expect(segmentHitsCircle({ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 0, z: 3 }, 4)).toBe(true);
    expect(segmentHitsCircle({ x: -5, z: 0 }, { x: 5, z: 0 }, { x: 0, z: 6 }, 4)).toBe(false);
    expect(segmentHitsCircle({ x: -5, z: 0 }, { x: -4, z: 0 }, { x: 0, z: 0 }, 2)).toBe(false);
  });

  it('rotas das corridas dos dados: pistas da Cidade Nova, longe da concentração (fora do trecho de pedestres)', () => {
    const ev = JSON.parse(readFileSync('public/events/manifestacao.json', 'utf8')) as EventDef;
    const zones = JSON.parse(readFileSync('public/world/zones.json', 'utf8')).zones as { id: string; from: number; to: number }[];
    const cn = zones.find((z) => z.id === 'CIDADE_NOVA')!;
    const races = ev.agenda!.filter((d) => d.race);
    expect(races.map((d) => d.race!.vehicle).sort()).toEqual(['bicycle', 'scooter']);
    for (const d of races) for (const c of [d.race!.start, ...d.race!.checkpoints]) {
      const t = (c.at as { t: number }).t;
      expect(t).toBeGreaterThanOrEqual(cn.from); expect(t).toBeLessThanOrEqual(cn.to);
    }
    // caminhada: rota amostrada no eixo da Central à Candelária
    const walk = ev.agenda!.find((d) => d.walk)!;
    const poly = routePolyline(axis, walk.walk!.route.map((c) => c.at));
    expect(poly.length).toBeGreaterThan(100);
  });
});

// ------------------------------------------------------------------------------------------------ confronto
const clashDef = (friendlyFire: boolean): ScheduledEventDef => base({
  id: 'clash', format: 'confronto_grupos', capacity: 10, minParticipants: 2, zones: ['CAMPO_DE_SANTANA'], combatPolicy: 'CONTESTED',
  recurrence: { everyMin: 30, offsetMin: 10, registrationMin: 2, startingS: 5, durationMin: 2 },
  groupRules: { allowed: ['g1', 'g2'], friendlyFire },
  clash: { zones: ['CAMPO_DE_SANTANA'], respawn: [{ x: -50, z: 0 }, { x: 50, z: 0 }], protectMs: 4000, holdArea: { id: 'h', at: { x: 0, z: 0 }, radius: 10 }, pointsPerKnockdown: 3, pointsPerHoldSecond: 1 },
});
const party = (o: Partial<CombatParty>): CombatParty => ({ zone: 'CAMPO_DE_SANTANA', inPeaceArea: false, mode: 'pacifico', groupKey: null, combatEventId: '', protectedUntil: 0, ...o });

describe('confronto de grupos', () => {
  for (const ff of [false, true]) {
    it(`friendlyFire ${ff} (dos dados) chega ao combatAllowed via combatEventFor; pontos por área e derrubadas`, () => {
      const R = rig([clashDef(ff)], 8.5 * MIN);
      const a1 = R.add('a1', { groupKey: 'g1' }), a2 = R.add('a2', { groupKey: 'g1' }), b1 = R.add('b1', { groupKey: 'g2' });
      R.add('x', { groupKey: 'g3' });
      for (const s of ['a1', 'a2', 'b1', 'x']) R.zone.set(s, 'CAMPO_DE_SANTANA');
      R.at(8.5 * MIN);
      const inst = R.rt.instances()[0];
      expect(R.rt.join('x', inst.inst)).toEqual({ ok: false, r: 'grupo' });
      for (const s of ['a1', 'a2', 'b1']) expect(R.rt.join(s, inst.inst).ok).toBe(true);
      expect(R.rt.combatEventFor('a1')).toBeNull(); // ainda não ativo
      expect(R.rt.zonePolicy('CAMPO_DE_SANTANA')).toBeNull();
      R.at(inst.startsAt);
      const ev = R.rt.combatEventFor('a1')!;
      expect(ev).toEqual({ eventId: inst.inst, zones: ['CAMPO_DE_SANTANA'], friendlyFire: ff });
      expect(R.rt.combatEventFor('x')).toBeNull(); // não inscrito
      expect(R.rt.zonePolicy('CAMPO_DE_SANTANA')).toBe('CONTESTED');
      const pol = (z: string | null): ZoneCombatPolicy => R.rt.zonePolicy(z) ?? 'PEACE';
      const P = (sid: string) => party({ groupKey: R.ps.get(sid)!.groupKey, combatEventId: R.rt.combatEventFor(sid)?.eventId ?? '' });
      expect(combatAllowed(pol, P('a1'), P('b1'), ev, R.clock.t)).toEqual({ ok: true });
      expect(combatAllowed(pol, P('a1'), P('a2'), ev, R.clock.t).ok).toBe(ff);
      expect(combatAllowed(pol, P('a1'), party({ groupKey: 'g3' }), ev, R.clock.t).ok).toBe(false); // não inscrito: nunca
      // área: só g1 dentro → g1 pontua; os dois → disputada
      a1.x = 0; a2.x = 2; b1.x = 40;
      R.run(3000);
      const s1 = (R.rt.runnerState(inst.inst) as any).score;
      expect(s1.g1).toBeGreaterThanOrEqual(2); expect(s1.g2).toBe(0);
      b1.x = 1;
      R.run(3000);
      expect((R.rt.runnerState(inst.inst) as any).score.g1).toBeCloseTo(s1.g1, 0);
      // derrubadas: rival pontua; mesmo grupo nunca pontua (mesmo com fogo amigo)
      const before = (R.rt.runnerState(inst.inst) as any).score.g1;
      R.rt.onKnockdown('a1', 'b1');
      R.rt.onKnockdown('a1', 'a2');
      R.rt.onKnockdown('x', 'b1'); // não inscrito: ignorado
      const s2 = (R.rt.runnerState(inst.inst) as any);
      expect(s2.score.g1 - before).toBe(3);
      expect(s2.knockdowns).toEqual({ a1: 1 });
      // retorno: ao levantar, volta ao ponto do grupo protegido
      b1.status = 1; R.run(300);
      expect(R.teleports.some((t) => t.sid === 'b1')).toBe(false);
      b1.status = 0; R.run(200);
      expect(R.teleports.find((t) => t.sid === 'b1')).toMatchObject({ x: 50, z: 0 });
      expect(R.rt.protectedUntil('b1')).toBeGreaterThan(R.clock.t);
      expect(combatAllowed(pol, P('a1'), { ...P('b1'), protectedUntil: R.rt.protectedUntil('b1') }, ev, R.clock.t)).toEqual({ ok: false, reason: 'protegido' });
      R.run(4500);
      expect(R.rt.protectedUntil('b1')).toBe(0);
      expect(R.prot.get('b1')).toBe(0); // a sala desliga o bit
      // fim: participação (presença na zona) → event_complete para os inscritos; nunca por golpe
      R.run(2 * MIN);
      expect(inst.state).toBe('FINISHED');
      expect(R.rt.combatEventFor('a1')).toBeNull();
      expect(R.emitted.filter((e) => e.ev.type === 'event_complete').map((e) => e.sid).sort()).toEqual(['a1', 'a2', 'b1']);
      const res = R.of('evt_result', 'a1').at(-1)!.msg;
      expect(res.rows[0]).toMatchObject({ group: 'g1', rank: 1 });
      expect(R.emitted.every((e) => !JSON.stringify(e.ev).includes('xp'))).toBe(true);
    });
  }
});

// ------------------------------------------------------------------------------------------------ rodada 9.1: identidade
describe('inscrição é da identidade (chave de participante), não da conexão', () => {
  /** sala com contas: sessão → `u:<conta>` (como a sala real: authorKeyOf) */
  const withKeys = (R: ReturnType<typeof rig>, keys: Record<string, string>) => { R.host.participantKey = (sid) => keys[sid] ?? `s:${sid}`; };
  const racer = (R: ReturnType<typeof rig>, inst: string, sid: string) => (R.rt.runnerState(inst) as any).racers.find((r: any) => r.sid === sid);

  it('queda em graça e volta (mesmo sessionId): continua inscrito com o mesmo progresso de checkpoint', () => {
    const R = rig([raceDef('bicycle')], 8.5 * MIN);
    withKeys(R, { a: 'u:ana' });
    const a = R.add('a', { vehicleKind: 'bicycle' });
    R.at(8.5 * MIN);
    const inst = R.rt.instances()[0];
    expect(R.rt.join('a', inst.inst).ok).toBe(true);
    a.x = -3; R.at(inst.startsAt);
    const da = driver(R, 'a', () => 'bicycle');
    da(100, 0, 6); da(100, 100, 6);
    expect(racer(R, inst.inst, 'a').step).toBe(2);
    a.dropped = true; R.run(5000); // em graça: entidade congelada, nada de onLeave
    a.dropped = false; R.rt.reconnected('a');
    expect(R.rt.instanceOf('a')).toBe(inst);
    expect(racer(R, inst.inst, 'a')).toMatchObject({ step: 2, status: 'ok' });
    expect(R.of('race_def', 'a').length).toBeGreaterThanOrEqual(2); // estado do formato de novo na volta
    da(0, 100, 6);
    expect(racer(R, inst.inst, 'a').step).toBe(3);
  });

  it('login duplicado (sessão nova da MESMA conta): inscrição e progresso passam para a nova; contagem não muda; sem duplicar', () => {
    const R = rig([raceDef('bicycle')], 8.5 * MIN);
    withKeys(R, { a1: 'u:ana', a2: 'u:ana', b: 'u:beto' });
    const a1 = R.add('a1', { vehicleKind: 'bicycle' }); R.add('b', { vehicleKind: 'bicycle' });
    R.at(8.5 * MIN);
    const inst = R.rt.instances()[0];
    R.rt.join('a1', inst.inst); R.rt.join('b', inst.inst);
    a1.x = -3; R.at(inst.startsAt);
    driver(R, 'a1', () => 'bicycle')(100, 0, 6);
    expect(racer(R, inst.inst, 'a1').step).toBe(1);
    // a sala: onJoin da nova → attach ANTES do takeOver; depois a antiga sai (onLeave → gone)
    R.add('a2', { vehicleKind: 'bicycle', x: a1.x, z: a1.z });
    R.rt.attach('a2');
    R.ps.delete('a1'); R.rt.gone('a1');
    expect(R.rt.instanceOf('a1')).toBeNull();
    expect(R.rt.instanceOf('a2')).toBe(inst);
    expect([...inst.members].sort()).toEqual(['a2', 'b']);
    expect(racer(R, inst.inst, 'a2')).toMatchObject({ step: 1, status: 'ok' });
    expect(racer(R, inst.inst, 'a1')).toBeUndefined();
    expect(R.rt.join('a2', inst.inst)).toEqual({ ok: false, r: 'ja_inscrito' }); // a conta já está inscrita
    R.run(1500);
    const ag = R.of('agenda', 'a2').at(-1)!.msg.list.find((e: any) => e.inst === inst.inst);
    expect(ag).toMatchObject({ joined: true, count: 2 });
    expect(R.of('race_def', 'a2').length).toBeGreaterThanOrEqual(1);
    // continua de onde estava: o próximo checkpoint é o c2
    driver(R, 'a2', () => 'bicycle')(100, 100, 6);
    expect(racer(R, inst.inst, 'a2').step).toBe(2);
    expect(R.rt.sizes()).toMatchObject({ members: 2, sessions: 2, keys: 2 });
  });

  it('sair depois da graça (gone da sessão atual) desiste: DNF; o resumo fica só pela janela recente', () => {
    const R = rig([raceDef('bicycle')], 8.5 * MIN);
    withKeys(R, { a: 'u:ana', b: 'u:beto' });
    const a = R.add('a', { vehicleKind: 'bicycle' }); R.add('b', { vehicleKind: 'bicycle' });
    R.at(8.5 * MIN);
    const inst = R.rt.instances()[0];
    R.rt.join('a', inst.inst); R.rt.join('b', inst.inst);
    a.x = -3; R.at(inst.startsAt);
    driver(R, 'a', () => 'bicycle')(100, 0, 6);
    R.rt.gone('b'); // graça vencida
    expect(R.rt.instanceOf('b')).toBeNull();
    expect(racer(R, inst.inst, 'b')).toMatchObject({ status: 'dnf', reason: 'saiu' });
    R.run(300_000);
    expect(inst.state).toBe('FINISHED');
    // retenção: runner, inscritos e chaves soltos; só o resumo (linhas/contagens)
    expect(R.rt.runnerState(inst.inst)).toBeNull();
    expect(inst.members.size).toBe(0);
    expect(R.rt.sizes()).toMatchObject({ members: 0, sessions: 0, keys: 0 });
    const res = R.rt.results(inst.inst)!;
    expect(res.rows.map((r) => [r.name, r.status])).toEqual([['A', 'dnf'], ['B', 'dnf']]);
    expect(res).toMatchObject({ completed: 0, count: 1 });
    R.run(1500);
    expect(R.of('agenda', 'a').at(-1)!.msg.list.find((e: any) => e.inst === inst.inst)).toMatchObject({ state: 'FINISHED', count: 1 });
    R.run(10 * MIN + 2000); // janela recente (10 min) vencida: some
    expect(R.rt.results(inst.inst)).toBeNull();
    expect(R.rt.get(inst.inst)).toBeUndefined();
  });

  it('confronto: lado (grupo), presença e derrubadas seguem o participante na troca de sessão', () => {
    const R = rig([clashDef(false)], 8.5 * MIN);
    withKeys(R, { a1: 'u:ana', a2: 'u:ana', b: 'u:beto' });
    R.add('a1', { groupKey: 'g1' }); R.add('b', { groupKey: 'g2' });
    for (const s of ['a1', 'a2', 'b']) R.zone.set(s, 'CAMPO_DE_SANTANA');
    R.at(8.5 * MIN);
    const inst = R.rt.instances()[0];
    R.rt.join('a1', inst.inst); R.rt.join('b', inst.inst);
    R.at(inst.startsAt);
    R.rt.onKnockdown('a1', 'b');
    R.add('a2', { groupKey: 'g1' });
    R.rt.attach('a2'); R.ps.delete('a1'); R.rt.gone('a1');
    R.rt.onKnockdown('a2', 'b');
    const s = R.rt.runnerState(inst.inst) as any;
    expect(s.knockdowns).toEqual({ a2: 2 });
    expect(s.score.g1).toBe(6);
    expect(R.rt.combatEventFor('a2')?.eventId).toBe(inst.inst);
    expect(R.rt.combatEventFor('a1')).toBeNull();
  });

  it('anônimo (sem conta): chave da sessão — outra conexão não herda nada', () => {
    const R = rig([raceDef('bicycle')], 8.5 * MIN);
    R.add('x', { vehicleKind: 'bicycle' }); R.add('y', { vehicleKind: 'bicycle' });
    R.at(8.5 * MIN);
    const inst = R.rt.instances()[0];
    R.rt.join('x', inst.inst);
    R.rt.attach('y');
    expect(R.rt.instanceOf('x')).toBe(inst);
    expect(R.rt.instanceOf('y')).toBeNull();
  });
});
