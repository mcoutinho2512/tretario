/**
 * Rodada 9 — itens de confronto no mundo (server/src/items), proteção de retorno (server/src/combat/protection.ts),
 * queda por status sem duplicar com `knock` (src/player/fallSync.ts) e a preferência "Reduzir efeitos visuais".
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroundItems, CARRIED } from '../server/src/items/GroundItems';
import { RoomItems, loadCombatProps, ITEM_SLICES, type ItemPlayer } from '../server/src/items/RoomItems';
import { ProtectionService, applyProtection, expireProtection, protectMsFromData, readProtectMs, DEFAULT_PROTECT_MS } from '../server/src/combat/protection';
import { decodeItemList, encodeItemList, ITEM_STATE, rackPlacement, type CombatPropsData } from '../src/items/protocol';
import { validateProp, type ActionActor } from '../src/social/actionRules';
import { FX } from '../src/combat/types';
import { STATUS } from '../src/net/rules';
import { FallSync, FALL_DEDUP_MS } from '../src/player/fallSync';
import { sanitizePreferences } from '../server/src/http/profile';
import { DEFAULT_HUD_PREFS, mergePrefs } from '../src/ui/hud/hudPrefs';

const axis: [number, number][] = [[0, 0], [1000, 0]];
const data = (o: Partial<CombatPropsData['supply']> = {}): CombatPropsData => ({
  version: 1,
  props: [{ propId: 11, kind: 'bat', actions: [], groundTtlMs: 30_000 }, { propId: 12, kind: 'bar', actions: [], groundTtlMs: 30_000 }, { propId: 13, kind: 'spray', actions: [], groundTtlMs: 10_000 }],
  supply: { maxGround: 3, pickRangeM: 2.2, aoiM: 50, racks: [{ id: 'a', at: { x: 10, z: 0 }, props: [11, 12, 13] }, { id: 'b', at: { x: 500, z: 0 }, props: [11, 12] }], ...o },
});
const at = (x: number, z = 0) => ({ x, z });

describe('itens de confronto no mundo (servidor)', () => {
  it('estoque vem dos apoios (dados); itens só de categoria COMBAT_PROP; nada nasce do nada', () => {
    const gi = new GroundItems({ ...data(), supply: { ...data().supply, racks: [{ id: 'x', at: { x: 0, z: 0 }, props: [11, 1, 13] }] } }, axis);
    expect([...gi.items.values()].map((i) => i.prop)).toEqual([11, 13]); // bandeira (1) ignorada
    const real = loadCombatProps();
    expect(real.supply.racks.length).toBeGreaterThan(0);
    expect(real.props.map((p) => p.kind).sort()).toEqual(['bar', 'bat', 'spray']);
  });

  it('alcance: longe é negado; perto pega e vira CARRIED (some da lista)', () => {
    const gi = new GroundItems(data(), axis);
    const bat = [...gi.items.values()].find((i) => i.prop === 11 && i.rack === 0)!;
    expect(gi.pick('s1', bat.id, at(bat.x + 3), 0)).toEqual({ ok: false, reason: 'longe' });
    const r = gi.pick('s1', bat.id, at(bat.x + 1.5), 0);
    expect(r.ok).toBe(true);
    expect(bat.state).toBe(CARRIED);
    expect(gi.carriedProp('s1')).toBe(11);
    expect(gi.near(10, 0).list.some((v) => v.id === bat.id)).toBe(false);
    // outro jogador não pega o que está na mão de alguém
    expect(gi.pick('s2', bat.id, at(bat.x), 0)).toEqual({ ok: false, reason: 'ocupado' });
    expect(gi.pick('s2', 999, at(0), 0)).toEqual({ ok: false, reason: 'inexistente' });
    expect(gi.pick('s2', 'x' as unknown as number, at(0), 0)).toEqual({ ok: false, reason: 'invalido' });
  });

  it('troca: pegar outro com um na mão larga o atual na posição do jogador', () => {
    const gi = new GroundItems(data(), axis);
    const list = [...gi.items.values()].filter((i) => i.rack === 0);
    const [bat, bar] = [list.find((i) => i.prop === 11)!, list.find((i) => i.prop === 12)!];
    gi.pick('s1', bat.id, at(10), 0);
    const r = gi.pick('s1', bar.id, at(10.2), 100);
    expect(r.ok && r.swapped?.id).toBe(bat.id);
    expect(bat.state).toBe(ITEM_STATE.GROUND);
    expect(bat.x).toBeCloseTo(10.2);
    expect(gi.carriedProp('s1')).toBe(12);
  });

  it('largar, expirar (groundTtlMs por item) e voltar à vaga do apoio', () => {
    const gi = new GroundItems(data(), axis);
    const spray = [...gi.items.values()].find((i) => i.prop === 13)!;
    const slot = { ...spray.slot };
    gi.pick('s1', spray.id, at(spray.x), 0);
    expect(gi.drop('s1', at(30, 5), 1000)).toMatchObject({ ok: true });
    expect(gi.drop('s1', at(30, 5), 1000)).toEqual({ ok: false, reason: 'sem_item' });
    expect(spray.state).toBe(ITEM_STATE.GROUND);
    expect(gi.near(30, 5).list.map((v) => v.id)).toContain(spray.id);
    expect(gi.tick(1000 + 9_999)).toBe(0);
    expect(gi.tick(1000 + 10_000)).toBe(1); // ttl do spray: 10 s
    expect(spray.state).toBe(ITEM_STATE.RACK);
    expect([spray.x, spray.z]).toEqual([slot.x, slot.z]);
  });

  it('teto de itens largados: o mais antigo volta ao apoio', () => {
    const gi = new GroundItems(data({ maxGround: 2 }), axis);
    const ids = [...gi.items.values()].filter((i) => i.rack === 0).map((i) => i.id);
    let t = 0;
    for (const id of ids) { const it = gi.items.get(id)!; gi.pick('s1', id, at(it.x), t); gi.drop('s1', at(40 + t / 1000), (t += 1000)); }
    expect(gi.groundCount).toBe(2);
    expect(gi.items.get(ids[0])!.state).toBe(ITEM_STATE.RACK);
    expect(gi.stats.capped).toBe(1);
  });

  it('saiu do mundo / caiu: o item possuído cai onde estava (idempotente)', () => {
    const gi = new GroundItems(data(), axis);
    const bar = [...gi.items.values()].find((i) => i.prop === 12)!;
    gi.pick('s1', bar.id, at(bar.x), 0);
    expect(gi.release('s1', at(77), 5)?.id).toBe(bar.id);
    expect(gi.release('s1', at(77), 6)).toBeNull();
    expect(bar.state).toBe(ITEM_STATE.GROUND);
    expect(bar.x).toBe(77);
    expect(gi.carriedCount).toBe(0);
  });

  it('assinatura da lista muda só quando um item visível muda', () => {
    const gi = new GroundItems(data(), axis);
    const a = gi.near(10, 0).sig, b = gi.near(10, 0).sig;
    expect(a).toBe(b);
    expect(gi.near(9999, 0).sig).toBe(0);
    const it = [...gi.items.values()][0];
    gi.pick('s1', it.id, at(it.x), 0);
    expect(gi.near(10, 0).sig).not.toBe(a);
  });

  it('protocolo item_list: codifica/decodifica; lixo é recusado', () => {
    const l = [{ id: 3, prop: 12, x: 10.26, z: -4.04, state: ITEM_STATE.GROUND }];
    expect(decodeItemList(encodeItemList(l))).toEqual([{ id: 3, prop: 12, x: 10.3, z: -4, state: ITEM_STATE.GROUND }]);
    expect(decodeItemList([1, 2, 3])).toBeNull();
    expect(decodeItemList('x')).toBeNull();
    const p = rackPlacement({ id: 'r', at: { t: 0.5, side: 0 }, props: [11, 12, 13] }, axis);
    expect(p.x).toBeCloseTo(500);
    expect(p.slots).toHaveLength(3);
  });

  it('mão: item de confronto só vai para a mão de quem o possui (validateProp)', () => {
    const a: ActionActor = { act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [] };
    expect(validateProp(a, 11, 0, 0)).toEqual({ ok: false, reason: 'sem_item' });
    expect(validateProp({ ...a, carried: 12 }, 11, 0, 0)).toEqual({ ok: false, reason: 'sem_item' });
    expect(validateProp({ ...a, carried: 11 }, 11, 0, 0)).toEqual({ ok: true });
    expect(validateProp(a, 1, 0, 0)).toEqual({ ok: true }); // social continua livre
    expect(validateProp({ ...a, carried: 11 }, 0, 0, 0)).toEqual({ ok: true }); // guardar
  });

  it('freeCombatProps (dados): taco/barra/spray direto da roda, sem posse; caído/veículo continuam negando', () => {
    expect(loadCombatProps().freeCombatProps).toBe(true);
    const a: ActionActor = { act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [], freeCombat: true };
    for (const id of [11, 12, 13]) expect(validateProp({ ...a, recent: [] }, id, 0, 0)).toEqual({ ok: true });
    expect(validateProp({ ...a, status: 1 }, 11, 0, 0)).toEqual({ ok: false, reason: 'caido' });
    expect(validateProp({ ...a, vehicle: 'car0' }, 11, 0, 0)).toEqual({ ok: false, reason: 'em_veiculo' });
  });
});

describe('RoomItems (ganchos da sala, sem Colyseus)', () => {
  function host() {
    const players = new Map<string, { p: ItemPlayer; x: number; z: number; slot: number }>();
    const sent: { sid: string; type: string; msg: unknown }[] = [];
    const hands = new Map<string, number>();
    const h = {
      player: (sid: string) => players.get(sid),
      each: (fn: (sid: string, slot: number, x: number, z: number) => void) => { for (const [sid, v] of players) fn(sid, v.slot, v.x, v.z); },
      send: (sid: string, type: string, msg: unknown) => sent.push({ sid, type, msg }),
      setHand: (sid: string, prop: number) => { hands.set(sid, prop); const v = players.get(sid); if (v) v.p.prop = prop; },
      raycast: () => 1,
    };
    return { players, sent, hands, h };
  }

  it('pegar põe na mão + item_self; cair (status DOWN) larga e esvazia a mão; lista só quando muda', () => {
    const { players, sent, hands, h } = host();
    const ri = new RoomItems(h, data(), axis);
    players.set('s1', { p: { prop: 0, status: STATUS.OK, vehicle: '', platform: '', heading: 0 }, x: 10, z: 0, slot: 0 });
    const bat = [...ri.items.items.values()].find((i) => i.prop === 11 && i.rack === 0)!;
    for (let n = 0; n < ITEM_SLICES; n++) ri.tick(0, 100, n);
    const lists = sent.filter((m) => m.type === 'item_list').length;
    expect(lists).toBe(1);
    for (let n = 0; n < ITEM_SLICES; n++) ri.tick(0, 100, n);
    expect(sent.filter((m) => m.type === 'item_list').length).toBe(lists); // nada mudou: nada enviado
    ri.onPick('s1', { i: bat.id }, 1000);
    expect(hands.get('s1')).toBe(11);
    expect(sent.at(-1)).toEqual({ sid: 's1', type: 'item_self', msg: { c: 11, i: bat.id } });
    expect(ri.carriedProp('s1')).toBe(11);
    // pedido rápido demais
    ri.onPick('s1', { i: bat.id }, 1050);
    expect(sent.at(-1)).toEqual({ sid: 's1', type: 'item_denied', msg: 'rapido' });
    // queda: larga onde caiu
    players.get('s1')!.p.status = STATUS.DOWN;
    ri.tick(2000, 100, 1);
    expect(hands.get('s1')).toBe(0);
    expect(bat.state).toBe(ITEM_STATE.GROUND);
    expect(ri.carriedProp('s1')).toBe(0);
    // caído não pega
    ri.onPick('s1', { i: bat.id }, 3000);
    expect(sent.at(-1)).toEqual({ sid: 's1', type: 'item_denied', msg: 'caido' });
  });

  it('em veículo não pega; saída larga no lugar', () => {
    const { players, sent, h } = host();
    const ri = new RoomItems(h, data(), axis);
    players.set('s2', { p: { prop: 0, status: STATUS.OK, vehicle: 'bike1', platform: '', heading: 0 }, x: 10, z: 0, slot: 1 });
    const it = [...ri.items.items.values()][0];
    ri.onPick('s2', { i: it.id }, 0);
    expect(sent.at(-1)?.msg).toBe('em_veiculo');
    players.get('s2')!.p.vehicle = '';
    ri.onPick('s2', { i: it.id }, 500);
    players.get('s2')!.x = 33;
    ri.leave('s2', 600);
    expect(it.state).toBe(ITEM_STATE.GROUND);
    expect(it.x).toBe(33);
  });
});

describe('proteção de retorno', () => {
  it('liga o bit PROTECTED, nunca encurta, expira e desliga', () => {
    const p = { fx: FX.DISORIENTED, protectedUntil: 0 };
    expect(applyProtection(p, 1000, 4000)).toBe(5000);
    expect(p.fx & FX.PROTECTED).toBeTruthy();
    expect(p.fx & FX.DISORIENTED).toBeTruthy(); // outros bits ficam
    expect(applyProtection(p, 2000, 1000)).toBe(5000); // não encurta
    expect(expireProtection(p, 4999)).toBe(false);
    expect(expireProtection(p, 5000)).toBe(true);
    expect(p.fx & FX.PROTECTED).toBe(0);
    expect(p.fx & FX.DISORIENTED).toBeTruthy();
  });

  it('serviço por conexão: apply/tick/clear; duração do arquivo de confronto ou 4000 ms', () => {
    const s = new ProtectionService(4000);
    const np = { fx: 0 };
    s.apply('a', np, 0);
    expect(s.isProtected('a', 3999)).toBe(true);
    expect(s.protectedUntil('a')).toBe(4000);
    expect(s.tick(3999, () => np)).toBe(0);
    expect(np.fx & FX.PROTECTED).toBeTruthy();
    expect(s.tick(4000, () => np)).toBe(1);
    expect(np.fx).toBe(0);
    expect(s.size).toBe(0);
    s.apply('b', np, 0, 9000); s.clear('b', np);
    expect(np.fx).toBe(0);
    expect(DEFAULT_PROTECT_MS).toBe(4000);
    expect(protectMsFromData()).toBeGreaterThanOrEqual(0);
  });

  it('lê tuning.protectMs de combat.json quando existe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-combat-'));
    const f = join(dir, 'combat.json');
    writeFileSync(f, JSON.stringify({ tuning: { protectMs: 2500 } }));
    expect(readProtectMs(f)).toBe(2500);
    writeFileSync(f, JSON.stringify({ tuning: { protectMs: 'x' } }));
    expect(readProtectMs(f)).toBe(DEFAULT_PROTECT_MS);
    expect(readProtectMs(join(dir, 'nao_existe.json'))).toBe(DEFAULT_PROTECT_MS);
  });
});

describe('queda por status sem duplicar com knock (FallSync)', () => {
  it('knock primeiro: a mudança de status logo depois NÃO recomeça', () => {
    const f = new FallSync();
    expect(f.onStatus(STATUS.OK, 0)).toBe('ignore');
    expect(f.onKnock(100)).toBe('start');
    expect(f.onStatus(STATUS.DOWN, 150)).toBe('ignore');
    expect(f.onStatus(STATUS.GETUP, 3000)).toBe('ignore');
    expect(f.onStatus(STATUS.OK, 4000)).toBe('ignore');
  });

  it('status primeiro (sem knock): começa; knock atrasado só refina', () => {
    const f = new FallSync();
    expect(f.onStatus(STATUS.DOWN, 0)).toBe('start');
    expect(f.onKnock(200)).toBe('refine');
    expect(f.onKnock(300)).toBe('ignore');
    expect(f.onStatus(STATUS.RAGDOLL, 400)).toBe('ignore'); // mesma queda
  });

  it('nova queda depois de levantar; knock muito antigo não bloqueia', () => {
    const f = new FallSync();
    f.onKnock(0); f.onStatus(STATUS.DOWN, 50); f.onStatus(STATUS.GETUP, 2500); f.onStatus(STATUS.OK, 3500);
    expect(f.onStatus(STATUS.DOWN, 3500 + FALL_DEDUP_MS)).toBe('start');
    f.onStatus(STATUS.OK, 9000);
    expect(f.onKnock(9100)).toBe('start');
    // cambaleio não é queda
    const g = new FallSync();
    expect(g.onStatus(STATUS.STAGGER, 0)).toBe('ignore');
  });
});

describe('"Reduzir efeitos visuais" (preferência)', () => {
  it('perfil: sanitizePreferences mantém o booleano e descarta lixo; HUD: mergePrefs idem', () => {
    expect(sanitizePreferences({ reduceEffects: true, names: 'TODOS' })).toEqual({ names: 'TODOS', reduceEffects: true });
    expect(sanitizePreferences({ reduceEffects: 'sim' })).toEqual({});
    const round = sanitizePreferences(JSON.parse(JSON.stringify(sanitizePreferences({ reduceEffects: false }))));
    expect(round).toEqual({ reduceEffects: false });
    expect(DEFAULT_HUD_PREFS.reduceEffects).toBe(false);
    expect(mergePrefs(DEFAULT_HUD_PREFS, round).reduceEffects).toBe(false);
    expect(mergePrefs(DEFAULT_HUD_PREFS, { reduceEffects: true }).reduceEffects).toBe(true);
    expect(mergePrefs(DEFAULT_HUD_PREFS, { reduceEffects: 1 }).reduceEffects).toBe(false);
  });
});
