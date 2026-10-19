/**
 * Rodada 10 — InteractionSystem (puro): escolha do alvo contextual, clique/toque pela projeção na tela, toque × arrasto,
 * provedores (rótulos/alcance/estado iguais às regras de antes) e a denúncia de pessoa no ChatService.
 * Sala real com clientes forjados: tests/interactionServer.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CONTEXT_MIN_PRIORITY, TOUCH_MIN_PX, chooseContext, highlightText, inReach, pickScreen, promptText, type ScreenHit } from '../src/interaction/select';
import { TAP_MAX_MS, TAP_SLOP_PX, TapTracker } from '../src/input/tapGesture';
import { IX_PRIORITY, ItemProvider, PersonProvider, VehicleProvider, vehiclePrompt } from '../src/interaction/providers';
import { RIDEABLE_DEFS, useDistance, type RideableInstance, type RideableKind } from '../src/vehicles/Rideable';
import type { Interactable } from '../src/interaction/types';
import { CHAT_SERVER, ChatService, type ChatIdentity } from '../server/src/chat/ChatService';
import { MemoryDataStore } from '../server/src/data/memory';

const cand = (o: Partial<Interactable> & { key: string }): Interactable => ({
  interactionType: 'enter_vehicle', interactionLabel: 'Entrar', targetLabel: 'Carro', maxDistance: 2.4, priority: 50, allowedStates: ['foot'],
  serverAction: 'enter', availability: 'available', x: 0, y: 1, z: 0, pickRadius: 1, activate: () => {}, ...o,
});

describe('alvo contextual (E / USAR / realce)', () => {
  it('só no alcance, no estado certo e disponível; maior prioridade vence', () => {
    const car = cand({ key: 'car', x: 2, priority: IX_PRIORITY.vehicle });
    const item = cand({ key: 'item', interactionType: 'pickup', x: 1, priority: IX_PRIORITY.pickup, maxDistance: 2 });
    const far = cand({ key: 'far', x: 10, priority: 99 });
    expect(chooseContext([item, car, far], 0, 0, 'foot')?.key).toBe('car');
    expect(chooseContext([item, car, far], 0, 0, 'vehicle')).toBeNull(); // estado errado
    car.availability = 'busy';
    expect(chooseContext([item, car], 0, 0, 'foot')?.key).toBe('item'); // ocupado não é alvo da tecla
    expect(chooseContext([item, car], 0, 0, 'foot', 0, 0, 'pickup')?.key).toBe('item');
  });
  it('pessoas (prioridade ≤ limite) nunca viram alvo contextual — só clique/toque', () => {
    const person = cand({ key: 'p', interactionType: 'person', priority: IX_PRIORITY.person, x: 0.5, maxDistance: 8 });
    expect(IX_PRIORITY.person).toBeLessThanOrEqual(CONTEXT_MIN_PRIORITY);
    expect(chooseContext([person], 0, 0, 'foot')).toBeNull();
  });
  it('empate de prioridade: o mais perto; com distâncias parecidas, o que está na mira', () => {
    const a = cand({ key: 'a', x: 1.0 }), b = cand({ key: 'b', x: -1.1 });
    expect(chooseContext([a, b], 0, 0, 'foot')?.key).toBe('a');
    expect(chooseContext([a, b], 0, 0, 'foot', -1, 0)?.key).toBe('b'); // câmera olhando para −x
  });
  it('distância medida pelo provedor (lateral da carroceria) vale mais que o centro', () => {
    const car = cand({ key: 'car', x: 3.2, distance: 1.9 });
    expect(inReach(car, 0, 0)).toBe(true);
    expect(inReach({ ...car, distance: undefined }, 0, 0)).toBe(false);
  });
  it('textos curtos: realce "CARRO · Entrar", ocupado, longe; prompt', () => {
    const c = cand({ key: 'c', prompt: 'E — ENTRAR NO CARRO' });
    expect(highlightText(c, true)).toBe('CARRO · Entrar');
    expect(highlightText(c, false)).toBe('CARRO · chegue mais perto');
    expect(highlightText({ ...c, availability: 'busy' }, true)).toBe('CARRO · Em uso');
    expect(promptText(c)).toBe('E — ENTRAR NO CARRO');
  });
});

describe('clique/toque pela projeção na tela', () => {
  const at = (sx: number, sy: number, rPx = 10): ScreenHit => ({ sx, sy, rPx });
  it('alvo mínimo de 44 px no toque mesmo para objeto pequeno/longe', () => {
    const it = cand({ key: 'i' });
    const proj = () => at(100, 100, 4);
    expect(pickScreen([it], 'foot', 100 + TOUCH_MIN_PX / 2 - 1, 100, TOUCH_MIN_PX, proj)?.key).toBe('i');
    expect(pickScreen([it], 'foot', 100 + TOUCH_MIN_PX / 2 + 2, 100, TOUCH_MIN_PX, proj)).toBeNull();
  });
  it('o mais perto do dedo vence; quase empate → maior prioridade; atrás da câmera e estado errado não contam', () => {
    const car = cand({ key: 'car', priority: 50 }), item = cand({ key: 'item', priority: 40, interactionType: 'pickup' });
    const pos: Record<string, ScreenHit | null> = { car: at(200, 200, 60), item: at(205, 200, 30) };
    expect(pickScreen([car, item], 'foot', 205, 200, 44, (c) => pos[c.key])?.key).toBe('item');
    pos.item = null;
    expect(pickScreen([car, item], 'foot', 205, 200, 44, (c) => pos[c.key])?.key).toBe('car');
    expect(pickScreen([car], 'vehicle', 200, 200, 44, (c) => pos[c.key])).toBeNull();
    const a = cand({ key: 'a', priority: 10, interactionType: 'person' }), b = cand({ key: 'b', priority: 50 });
    expect(pickScreen([a, b], 'foot', 100, 100, 44, (c) => (c.key === 'a' ? at(100, 100, 40) : at(102, 100, 40)))?.key).toBe('b');
  });
});

describe('toque × arrasto (TapTracker)', () => {
  it('parado e rápido = toque; passou do limiar = arrasto (e nunca mais toque)', () => {
    const t = new TapTracker();
    t.begin(1, 100, 100, 0);
    expect(t.move(1, 104, 103)).toBe(false); // dentro do limiar: câmera não gira
    expect(t.end(1, 104, 103, 120)).toBe('tap');
    t.begin(2, 100, 100, 0);
    expect(t.move(2, 100 + TAP_SLOP_PX + 1, 100)).toBe(true);
    expect(t.move(2, 101, 100)).toBe(true); // voltou para perto: continua arrasto
    expect(t.end(2, 101, 100, 100)).toBe('drag');
  });
  it('segurar parado não é toque; dois dedos (pinça) cancelam; touchcancel esquece', () => {
    const t = new TapTracker();
    t.begin(1, 0, 0, 0);
    expect(t.end(1, 0, 0, TAP_MAX_MS + 1)).toBeNull();
    t.begin(2, 0, 0, 0); t.begin(3, 50, 50, 0); t.cancelAll();
    expect(t.end(2, 0, 0, 50)).toBeNull();
    expect(t.end(3, 50, 50, 50)).toBeNull();
    t.begin(4, 0, 0, 0); t.forget(4);
    expect(t.end(4, 0, 0, 10)).toBeNull();
    expect(t.origin(9)).toBeNull();
  });
});

const veh = (id: string, kind: RideableKind, x: number, z: number, occupant = '', netState = 0): RideableInstance =>
  ({ state: { id, kind, x, y: 0, z, heading: 0, speed: 0, occupant }, def: RIDEABLE_DEFS[kind], model: null as never, netState, design: 0 }) as RideableInstance;

describe('provedores', () => {
  const calls: string[] = [];
  const mk = (items: RideableInstance[], o: { riding?: RideableInstance | null; platform?: string | null; pending?: boolean } = {}) => new VehicleProvider({
    items: () => items, riding: () => o.riding ?? null, platform: () => o.platform ?? null, pending: () => !!o.pending,
    enter: (it) => calls.push(`enter:${it.state.id}`), board: (it) => calls.push(`board:${it.state.id}`), exit: () => calls.push('exit'),
  });
  it('veículos: verbo por tipo (dados), mesma distância do RideableSystem.nearest, ocupado = busy', () => {
    const items = [veh('c', 'car', 2, 0), veh('m', 'moto', 0, 2), veh('b', 'bicycle', -1.5, 0), veh('s', 'scooter', 0, -1.5), veh('o', 'car', 6, 0, 'outro'), veh('longe', 'car', 400, 0)];
    const out: Interactable[] = [];
    mk(items).collect(0, 0, 'foot', out);
    const by = (k: string) => out.find((c) => c.key === `veh:${k}`)!;
    expect(out.find((c) => c.key === 'veh:longe')).toBeUndefined();
    expect([by('c').interactionLabel, by('m').interactionLabel, by('b').interactionLabel, by('s').interactionLabel]).toEqual(['Entrar', 'Montar', 'Montar', 'Usar']);
    expect(by('c').prompt).toBe('E — ENTRAR NO CARRO');
    expect(by('b').prompt).toBe('E — MONTAR NA BICICLETA');
    expect(by('s').prompt).toBe('E — USAR O PATINETE');
    expect(vehiclePrompt('moto', 'Moto', 'a')).toBe('E — MONTAR NA MOTO');
    expect(by('c').distance).toBeCloseTo(useDistance(items[0], 0, 0), 6);
    expect(by('o').availability).toBe('busy');
    by('c').activate();
    expect(calls.at(-1)).toBe('enter:c');
    // aguardando o servidor: todos esperam
    const out2: Interactable[] = [];
    mk(items, { pending: true }).collect(0, 0, 'foot', out2);
    expect(out2.every((c) => c.availability !== 'available')).toBe(true);
  });
  it('trio: escada (Subir) vence o volante; em cima/em veículo só existe SAIR/DESCER', () => {
    const trio = veh('t', 'trio', 0, 0);
    const out: Interactable[] = [];
    mk([trio]).collect(0, -7.2, 'foot', out); // pé da escada (TRIO.ladderFoot)
    const ctx = chooseContext(out, 0, -7.2, 'foot');
    expect(ctx?.interactionType).toBe('board_platform');
    expect(ctx?.prompt).toBe('E — SUBIR NO TRIO');
    ctx!.activate();
    expect(calls.at(-1)).toBe('board:t');
    const o2: Interactable[] = [];
    mk([trio], { platform: 't' }).collect(0, 0, 'platform', o2);
    expect(o2.map((c) => [c.interactionType, c.interactionLabel])).toEqual([['exit_vehicle', 'Descer']]);
    const car = veh('c', 'car', 0, 0, 'eu');
    const o3: Interactable[] = [];
    mk([car], { riding: car }).collect(0, 0, 'vehicle', o3);
    expect(o3.map((c) => c.prompt)).toEqual(['E — SAIR']);
    expect(chooseContext(o3, 0, 0, 'vehicle')?.priority).toBe(IX_PRIORITY.exit);
  });
  it('itens: "Pegar" no alcance do cliente (abaixo do servidor); pessoas: em veículo não', () => {
    const picked: number[] = [];
    const ip = new ItemProvider({ forEach: (fn) => { fn(7, 11, 1.5, 0, 0); fn(8, 12, 100, 0, 1); }, label: () => 'Taco', ground: () => 0, pick: (id) => picked.push(id), pending: () => false });
    const out: Interactable[] = [];
    ip.collect(0, 0, 'foot', out);
    expect(out.map((c) => c.key)).toEqual(['item:7']);
    expect(chooseContext(out, 0, 0, 'foot', 0, 0, 'pickup')?.interactionLabel).toBe('Pegar');
    out[0].activate();
    expect(picked).toEqual([7]);
    const o2: Interactable[] = [];
    ip.collect(0, 0, 'vehicle', o2);
    expect(o2).toEqual([]);
    const opened: string[] = [];
    const pp = new PersonProvider({ forEach: (fn) => { fn('a', 3, 'Ana', 1, 0, 0, false); fn('b', 4, 'Bia', 1, 0, 1, true); }, open: (id) => opened.push(id) });
    const o3: Interactable[] = [];
    pp.collect(0, 0, 'foot', o3);
    expect(o3.map((c) => c.targetLabel)).toEqual(['Ana']);
    o3[0].activate();
    expect(opened).toEqual(['a']);
  });
  it('sem alocar por quadro: o mesmo objeto volta a cada coleta', () => {
    const p = mk([veh('c', 'car', 1, 0)]);
    const a: Interactable[] = [], b: Interactable[] = [];
    p.collect(0, 0, 'foot', a); p.collect(0, 0, 'foot', b);
    expect(a[0]).toBe(b[0]);
  });
});

describe('denúncia de PESSOA (painel) — ChatService.reportUser', () => {
  class Conn { msgs: { type: string; msg: any }[] = []; send(type: string, msg: any) { this.msgs.push({ type, msg }); } last(t: string) { return [...this.msgs].reverse().find((m) => m.type === t)?.msg; } }
  const player = (nickname: string, userId: string | null): ChatIdentity => ({ userId, nickname, state: 'PLAYER', role: 'player', groupKey: null });
  function setup(store: MemoryDataStore | null) {
    const pos = new Map<string, { x: number; z: number }>(), sids: string[] = [], idents = new Map<string, ChatIdentity>();
    const svc = new ChatService({
      nidOf: (sid) => sids.indexOf(sid) + 1, posOf: (sid) => pos.get(sid), near: () => {}, broadcast: () => {},
      identityOfNid: (nid) => { const sid = sids[nid - 1]; const id = sid ? idents.get(sid) : undefined; return id ? { sid, userId: id.userId, nickname: id.nickname } : undefined; },
    }, { store, eventId: 'teste', log: () => {}, secret: 's' });
    const join = (sid: string, id: ChatIdentity, at: [number, number]) => { const c = new Conn(); sids.push(sid); idents.set(sid, id); pos.set(sid, { x: at[0], z: at[1] }); svc.join(sid, id, c); return c; };
    return { svc, join, pos, nid: (sid: string) => sids.indexOf(sid) + 1 };
  }
  it('valida alvo/distância/repetição/limite e grava USER sem ids na resposta', async () => {
    const store = new MemoryDataStore();
    const { svc, join, nid, pos } = setup(store);
    const a = join('A', player('Ana', 'u-ana'), [0, 0]);
    join('B', player('Beto', 'u-beto'), [3, 0]);
    join('C', player('Caio', null), [500, 0]);
    expect(await svc.reportUser('A', { nid: nid('A') })).toEqual({ ok: false, r: 'propria' });
    expect(await svc.reportUser('A', { nid: 999 })).toEqual({ ok: false, r: 'inexistente' });
    expect(await svc.reportUser('A', { nid: 'x', userId: 'u-beto' })).toEqual({ ok: false, r: 'inexistente' }); // userId do cliente: ignorado
    expect(await svc.reportUser('A', { nid: nid('C') })).toEqual({ ok: false, r: 'longe' });
    const ok = await svc.reportUser('A', { nid: nid('B'), category: 'ASSEDIO', userId: 'u-ana', targetUserId: 'forjado' });
    expect(ok).toEqual({ ok: true });
    expect(a.last('user_report_res')).toEqual({ ok: true }); // sem id de conta, sem id de denúncia
    expect(JSON.stringify(a.msgs)).not.toMatch(/u-beto|u-ana/);
    const reps = await store.reports.list();
    expect(reps).toHaveLength(1);
    expect(reps[0]).toMatchObject({ targetType: 'USER', targetUserId: 'u-beto', reporterUserId: 'u-ana', category: 'ASSEDIO', reportedNicknameAtTime: 'Beto' });
    expect((reps[0].evidence as { kind: string; distanceM: number }).kind).toBe('user');
    expect(await svc.reportUser('A', { nid: nid('B') })).toEqual({ ok: false, r: 'repetida' });
    // teto compartilhado com o chat: 6 por 10 min
    for (let i = 0; i < CHAT_SERVER.reportMax + 2; i++) { const s = `X${i}`; join(s, player(`P${i}`, `u-${i}`), [1, 1]); pos.set(s, { x: 1, z: 1 }); }
    const rs: string[] = [];
    for (let i = 0; i < CHAT_SERVER.reportMax + 1; i++) rs.push((await svc.reportUser('A', { nid: nid(`X${i}`) })).r ?? 'ok');
    expect(rs.filter((r) => r === 'ok').length).toBe(CHAT_SERVER.reportMax - 1);
    expect(rs.at(-1)).toBe('limite');
  });
  it('visitante sem permissão de denúncia: sem_permissao', async () => {
    const { svc, join, nid } = setup(null);
    join('A', { userId: null, nickname: 'Esp', state: 'VISITOR', role: 'spectator', groupKey: null }, [0, 0]);
    join('B', player('Beto', 'u-b'), [1, 0]);
    expect(await svc.reportUser('A', { nid: nid('B') })).toEqual({ ok: false, r: 'sem_permissao' });
  });
});
