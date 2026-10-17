/**
 * Rodada 9 — CONFRONTO (server/src/combat/CombatSystem.ts) e PULO (JumpValidator) com um "host" falso (sem Colyseus):
 * soco/chute/empurrão/esquiva, combos, stamina, cooldown, alcance, orientação, zona de paz × combate, itens (taco,
 * barra e spray com props de mentira), queda → levantar → proteção, bonecos de treino, campos forjados ignorados.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CombatSystem, type CombatActorView, type CombatHost } from '../server/src/combat/CombatSystem';
import { JumpValidator } from '../server/src/combat/JumpValidator';
import { CombatTable, JUMP, JUMP_FLIGHT_MS, JUMP_PEAK, inArc, parseCombatData } from '../src/combat/data';
import { FX, PHYS } from '../src/combat/types';
import type { ZoneCombatPolicy, PeaceArea, CombatEventRules } from '../src/combat/policy';
import type { GameplayEvent } from '../src/gameplay/events';

const DATA = parseCombatData(JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')));
const TABLE = new CombatTable(DATA);
const ID = (k: string) => TABLE.id(k);
/** props de mentira: o taco é o 11 real; barra e spray (agente B) ganham ids de teste */
const PROP_KINDS: Record<number, string> = { 11: 'bat', 50: 'bar', 51: 'spray', 1: 'flag_small' };

type P = CombatActorView & { zone: string | null };
class World {
  t = 1_000_000;
  players = new Map<string, P>();
  zones: Record<string, { combatPolicy?: ZoneCombatPolicy; peaceAreas?: PeaceArea[] }> = { ARENA: { combatPolicy: 'COMBAT' }, PRACA: { combatPolicy: 'PEACE' }, DISPUTA: { combatPolicy: 'CONTESTED' } };
  sent: { sid: string; type: string; msg: any }[] = [];
  aoi: { subject: string; type: string; msg: any }[] = [];
  events: { sid: string; ev: GameplayEvent }[] = [];
  knocks: { sid: string; kind: string }[] = [];
  airborne = new Set<string>();
  canAct = new Set<string>();
  add(sid: string, o: Partial<P> = {}) {
    const p: P = { x: 0, z: 0, heading: 0, status: 0, vehicle: '', platform: '', mode: 'interacao', prop: 0, immuneUntil: 0, nid: this.players.size + 1, zone: 'ARENA', ...o };
    this.players.set(sid, p); this.canAct.add(sid);
    return p;
  }
  host(): CombatHost {
    return {
      actor: (sid) => this.players.get(sid),
      forEachNear: (x, z, r, fn) => { for (const [sid, p] of this.players) if (Math.hypot(p.x - x, p.z - z) <= r) fn(sid); },
      walls: null,
      zoneOf: (sid) => this.players.get(sid)?.zone ?? null,
      zoneDef: (id) => (id ? this.zones[id] : undefined),
      groupKey: () => null,
      propKind: (id) => PROP_KINDS[id],
      can: (sid) => this.canAct.has(sid),
      send: (sid, type, msg) => this.sent.push({ sid, type, msg }),
      sendAoi: (subject, type, msg) => this.aoi.push({ subject, type, msg }),
      sendNear: (_x, _z, _r, type, msg) => this.aoi.push({ subject: '*', type, msg }),
      setStatus: (sid, st) => { const p = this.players.get(sid); if (p) p.status = st; },
      setFx: () => {},
      place: (sid, x, z) => { const p = this.players.get(sid); if (p) { p.x = x; p.z = z; } },
      knockdown: (sid, _fx, _fz, _d, _s, _by, kind) => { const p = this.players.get(sid)!; p.status = PHYS.KNOCKED_DOWN; this.knocks.push({ sid, kind }); },
      emit: (sid, ev) => this.events.push({ sid, ev }),
      airborne: (sid) => this.airborne.has(sid),
      now: () => this.t,
    };
  }
}

let W: World, C: CombatSystem;
/** avança o relógio processando janelas ativas e o tick */
const step = (ms: number) => { for (let k = 0; k < ms; k += 20) { W.t += 20; C.update(20); } };
const hits = () => W.aoi.filter((m) => m.type === 'cbt_hit').map((m) => m.msg);
const denials = (sid: string) => W.sent.filter((m) => m.sid === sid && m.type === 'cbt_denied').map((m) => m.msg.reason);
function setup(bOpts: Partial<P> = {}) {
  W = new World();
  C = new CombatSystem(TABLE, W.host());
  W.add('A', { x: 0, z: 0, heading: 0 });
  W.add('B', { x: 0, z: 1.1, heading: Math.PI, ...bOpts });
  C.join('A'); C.join('B');
}

describe('tabela de confronto (combat.json)', () => {
  it('valida e indexa: ações base, combos, itens, boneco', () => {
    expect(['soco', 'chute', 'empurrao', 'esquiva', 'golpe_taco', 'golpe_barra', 'spray'].every((k) => ID(k) > 0)).toBe(true);
    expect(TABLE.itemAction('bat')?.key).toBe('golpe_taco');
    expect(TABLE.itemAction('bar')?.key).toBe('golpe_barra');
    expect(TABLE.itemAction('spray')?.key).toBe('spray');
    expect(TABLE.dummies.length).toBeGreaterThan(0);
    expect(() => parseCombatData({ ...DATA, actions: [...DATA.actions, { ...DATA.actions[0] }] })).toThrow(/id/);
  });
  it('combo soco → soco → chute só dentro da janela; variante não se pede direto', () => {
    const s = TABLE.byKey.get('soco')!;
    expect(TABLE.resolve(ID('soco'), { id: s.id, activeEnd: 1000 }, 1100)?.key).toBe('soco_2');
    expect(TABLE.resolve(ID('soco'), { id: s.id, activeEnd: 1000 }, 2000)?.key).toBe('soco');
    expect(TABLE.resolve(ID('chute'), { id: ID('soco_2'), activeEnd: 1000 }, 1200)?.key).toBe('chute_final');
    expect(TABLE.resolve(ID('soco_2'), null, 0)).toBeUndefined();
  });
  it('arco: à frente sim, atrás não', () => {
    expect(inArc(0, 0, 0, 0, 1, 70)).toBe(true);
    expect(inArc(0, 0, 0, 0, -1, 70)).toBe(false);
    expect(inArc(0, 0, 0, 1, 0.2, 70, 15)).toBe(false);
  });
});

describe('golpes (servidor decide)', () => {
  beforeEach(() => setup());

  it('soco acerta: condição cai, cambaleia, empurra um pouco; cbt_act e cbt_hit à AOI', () => {
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 1 }).ok).toBe(true);
    expect(W.aoi.find((m) => m.type === 'cbt_act')?.msg).toMatchObject({ by: 1, a: ID('soco') });
    step(300);
    expect(hits()).toHaveLength(1);
    expect(hits()[0]).toMatchObject({ r: 'hit', tgt: 2, st: PHYS.STAGGERED });
    expect(C.fighter('B')!.condition).toBe(100 - 12);
    expect(W.players.get('B')!.z).toBeGreaterThan(1.1);
    expect(W.events.some((e) => e.sid === 'A' && e.ev.type === 'combat_action')).toBe(true);
    step(500);
    expect(W.players.get('B')!.status).toBe(PHYS.NORMAL); // cambaleio termina no servidor
  });

  it('chute: mais alcance e mais condição; stamina gasta e regenera', () => {
    W.players.get('B')!.z = 1.6;
    expect(C.request('A', { a: ID('chute'), h: 0, seq: 1 }).ok).toBe(true);
    expect(C.fighter('A')!.stamina).toBe(100 - 16);
    step(400);
    expect(hits()[0]).toMatchObject({ r: 'hit' });
    expect(C.fighter('B')!.condition).toBe(80);
    step(3000);
    expect(C.fighter('A')!.stamina).toBe(100);
  });

  it('empurrão derruba pelo caminho de queda existente (knock); levanta; proteção bloqueia', () => {
    expect(C.request('A', { a: ID('empurrao'), h: 0, seq: 1 }).ok).toBe(true);
    step(400);
    expect(W.knocks).toEqual([{ sid: 'B', kind: 'push' }]);
    // a sala levanta B (tick existente) e dá a proteção de retorno
    const b = W.players.get('B')!;
    b.status = PHYS.NORMAL; b.immuneUntil = W.t + DATA.tuning.protectMs;
    step(1200);
    W.aoi.length = 0;
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 2 }).ok).toBe(true);
    step(300);
    expect(W.sent.find((m) => m.type === 'cbt_hit' && m.sid === 'A')?.msg).toMatchObject({ r: 'blocked' });
    expect(C.fighter('B')!.condition).toBe(100);
    expect(C.fighter('B')!.fx & FX.PROTECTED).toBe(FX.PROTECTED);
  });

  it('condição 0 sempre derruba (golpes seguidos)', () => {
    C.fighter('B'); // 100
    let n = 0;
    while (W.knocks.length === 0 && n++ < 20) {
      W.players.get('B')!.status = PHYS.NORMAL; W.players.get('B')!.z = 1.1;
      C.request('A', { a: ID('soco'), h: 0, seq: n }); step(1300);
    }
    expect(W.knocks.length).toBe(1);
    expect(n).toBeLessThan(12);
  });

  it('esquiva: invulnerável na janela → "dodged" e evento combat_dodge; desloca o jogador', () => {
    expect(C.request('B', { a: ID('esquiva'), h: Math.PI / 2, seq: 1 }).ok).toBe(true);
    expect(W.players.get('B')!.x).toBeCloseTo(2.2, 1);
    W.players.get('B')!.x = 0; // volta à frente de A (dentro da janela de invulnerabilidade)
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 1 }).ok).toBe(true);
    step(250);
    expect(hits()[0]).toMatchObject({ r: 'dodged' });
    expect(W.events.some((e) => e.sid === 'B' && e.ev.type === 'combat_dodge')).toBe(true);
    expect(C.fighter('B')!.condition).toBe(100);
  });

  it('combo soco → soco → chute final derruba', () => {
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 1 }).ok).toBe(true);
    step(240);
    W.players.get('B')!.z = 1.1;
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 2 })).toMatchObject({ ok: true, action: { key: 'soco_2' } });
    step(220);
    W.players.get('B')!.z = 1.2; W.players.get('B')!.status = PHYS.NORMAL;
    expect(C.request('A', { a: ID('chute'), h: 0, seq: 3 })).toMatchObject({ ok: true, action: { key: 'chute_final' } });
    step(400);
    expect(W.knocks.map((k) => k.sid)).toEqual(['B']);
  });

  it('stamina insuficiente e cooldown negam', () => {
    for (let i = 0; i < 4; i++) { C.request('A', { a: ID('esquiva'), h: 0, seq: i }); W.t += 1000; }
    // 4 esquivas × 20 em 4 s com regeneração: força o fim da stamina
    C.fighter('A');
    const F = C.fighter('A')!;
    expect(F.stamina).toBeLessThan(100);
    setup();
    expect(C.request('A', { a: ID('chute'), h: 0, seq: 1 }).ok).toBe(true);
    W.t += 300;
    expect(C.request('A', { a: ID('chute'), h: 0, seq: 2 })).toEqual({ ok: false, reason: 'cooldown' });
    setup();
    for (let i = 0; i < 8; i++) { C.request('A', { a: ID('esquiva'), h: 0, seq: i }); W.t += 950; }
    expect(denials('A')).toContain('stamina');
  });

  it('alcance e orientação: longe ou atrás não acerta', () => {
    W.players.get('B')!.z = 3;
    C.request('A', { a: ID('soco'), h: 0, seq: 1 });
    step(400);
    expect(hits()).toHaveLength(0);
    W.players.get('B')!.z = -1.0;
    W.t += 1000;
    C.request('A', { a: ID('soco'), h: 0, seq: 2 });
    step(400);
    expect(hits()).toHaveLength(0);
    W.t += 1000;
    C.request('A', { a: ID('soco'), h: Math.PI, seq: 3 }); // virou para B
    step(400);
    expect(hits()).toHaveLength(1);
  });

  it('pacífico nunca sofre impacto, mesmo em zona de combate', () => {
    W.players.get('B')!.mode = 'pacifico';
    C.request('A', { a: ID('soco'), h: 0, seq: 1 });
    step(300);
    expect(C.fighter('B')!.condition).toBe(100);
    expect(W.sent.find((m) => m.type === 'cbt_hit')?.msg.r).toBe('blocked');
  });

  it('zona de paz: atacante é negado com zona_paz; alvo em área de paz também', () => {
    W.players.get('A')!.zone = 'PRACA';
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 1 })).toEqual({ ok: false, reason: 'zona_paz' });
    expect(denials('A')).toEqual(['zona_paz']);
    W.players.get('A')!.zone = 'ARENA';
    W.zones.ARENA.peaceAreas = [{ id: 'palco', x: 0, z: 1.2, r: 0.5 }];
    W.t += 1000;
    C.request('A', { a: ID('soco'), h: 0, seq: 2 });
    step(300);
    expect(C.fighter('B')!.condition).toBe(100);
    expect(denials('A')).toEqual(['zona_paz', 'zona_paz']);
  });

  it('CONTESTED só com evento ativo dos dois (provedor injetado combatEventFor)', () => {
    W.players.get('A')!.zone = 'DISPUTA'; W.players.get('B')!.zone = 'DISPUTA';
    C.request('A', { a: ID('soco'), h: 0, seq: 1 }); step(300);
    expect(C.fighter('B')!.condition).toBe(100);
    const ev: CombatEventRules = { eventId: 'e1', zones: ['DISPUTA'], friendlyFire: false };
    C.combatEventFor = () => ev;
    W.t += 1000;
    C.request('A', { a: ID('soco'), h: 0, seq: 2 }); step(300);
    expect(C.fighter('B')!.condition).toBe(88);
  });

  it('itens: taco (prop 11), barra e spray com props de mentira; sem item → sem_item', () => {
    expect(C.request('A', { a: ID('golpe_taco'), h: 0, seq: 1 })).toEqual({ ok: false, reason: 'sem_item' });
    W.players.get('A')!.prop = 1; // bandeira não é taco
    expect(C.request('A', { a: ID('golpe_taco'), h: 0, seq: 2 })).toEqual({ ok: false, reason: 'sem_item' });
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 3 })).toEqual({ ok: false, reason: 'sem_item' }); // soco é de mãos livres
    W.players.get('A')!.prop = 11;
    expect(C.request('A', { a: ID('golpe_taco'), h: 0, seq: 4 }).ok).toBe(true);
    step(500);
    expect(C.fighter('B')!.condition).toBe(100 - 26);
    W.players.get('B')!.status = PHYS.NORMAL; W.players.get('B')!.z = 1.2;
    W.players.get('A')!.prop = 50;
    W.t += 2000;
    expect(C.request('A', { a: ID('golpe_barra'), h: 0, seq: 5 }).ok).toBe(true);
    step(500);
    expect(C.fighter('B')!.condition).toBe(100 - 26 - 32);
    W.players.get('B')!.status = PHYS.NORMAL; W.players.get('B')!.z = 2.0;
    W.add('C', { x: 0.4, z: 2.4 }); C.join('C');
    W.players.get('A')!.prop = 51;
    W.t += 2000;
    expect(C.request('A', { a: ID('spray'), h: 0, seq: 6 }).ok).toBe(true);
    step(800);
    // spray: vários alvos, sem perda de condição, desorientados (fx)
    expect(C.fighter('B')!.fx & FX.DISORIENTED).toBe(FX.DISORIENTED);
    expect(C.fighter('C')!.fx & FX.DISORIENTED).toBe(FX.DISORIENTED);
    step(3000);
    expect(C.fighter('C')!.fx & FX.DISORIENTED).toBe(0);
  });

  it('campos forjados (alvo, dano, posição) são ignorados; ação inválida/variante direta negada', () => {
    W.add('X', { x: 50, z: 50 }); C.join('X');
    expect(C.request('A', { a: ID('soco'), h: 0, seq: 1, target: 'X', tgt: 3, damage: 999, x: 50, z: 49 } as unknown).ok).toBe(true);
    step(300);
    expect(C.fighter('X')!.condition).toBe(100);
    expect(C.fighter('B')!.condition).toBe(88);
    W.t += 1000;
    expect(C.request('A', { a: 999, h: 0 })).toEqual({ ok: false, reason: 'acao_invalida' });
    expect(C.request('A', { a: ID('soco_2'), h: 0 })).toEqual({ ok: false, reason: 'acao_invalida' });
    expect(C.request('A', { a: ID('soco') })).toEqual({ ok: false, reason: 'acao_invalida' });
  });

  it('taxa: 30 pedidos/s → no máximo maxRequestsPerS processados, o resto "spam" (1 aviso/s)', () => {
    let ok = 0;
    for (let i = 0; i < 30; i++) { if (C.request('A', { a: ID('esquiva'), h: 0, seq: i }).ok) ok++; W.t += 33; }
    expect(ok).toBeLessThanOrEqual(2);
    expect(C.stats.denied.spam).toBeGreaterThan(20);
    expect(denials('A').filter((r) => r === 'spam').length).toBeLessThanOrEqual(2);
  });

  it('estado/veículo/no ar/capacidade negam', () => {
    W.players.get('A')!.vehicle = 'car0';
    expect(C.request('A', { a: ID('soco'), h: 0 })).toEqual({ ok: false, reason: 'em_veiculo' });
    W.players.get('A')!.vehicle = ''; W.airborne.add('A');
    expect(C.request('A', { a: ID('soco'), h: 0 })).toEqual({ ok: false, reason: 'estado' });
    W.airborne.clear(); W.players.get('A')!.status = PHYS.KNOCKED_DOWN;
    expect(C.request('A', { a: ID('soco'), h: 0 })).toEqual({ ok: false, reason: 'estado' });
    W.players.get('A')!.status = 0; W.canAct.delete('A');
    expect(C.request('A', { a: ID('soco'), h: 0 })).toEqual({ ok: false, reason: 'cap' });
    expect(W.sent.at(-1)).toMatchObject({ type: 'denied', msg: { cap: 'combat.act' } });
  });

  it('cbt_self só para o dono, só quando muda e no máximo 5 Hz', () => {
    C.request('A', { a: ID('chute'), h: 0, seq: 1 });
    const t0 = W.t;
    step(4000);
    const selfs = W.sent.filter((m) => m.type === 'cbt_self' && m.sid === 'A');
    expect(selfs.length).toBeGreaterThan(2);
    expect(selfs.length).toBeLessThanOrEqual(Math.ceil((W.t - t0) / 200) + 2);
    const n = selfs.length;
    step(2000); // tudo cheio: nada muda, nada é enviado
    expect(W.sent.filter((m) => m.type === 'cbt_self' && m.sid === 'A').length).toBe(n);
  });
});

describe('boneco de treino', () => {
  it('reage (cambaleia, cai, volta) e emite dummy_knockdown; não é jogador', () => {
    W = new World();
    C = new CombatSystem(TABLE, W.host());
    const d = TABLE.dummies[0];
    // atacante pacífico, sem zona (fora das zonas de dados): a área de treino do boneco vale COMBAT
    W.add('A', { x: d.x, z: d.z - 1.1, heading: 0, mode: 'pacifico', zone: null });
    C.join('A');
    let falls = 0;
    for (let i = 0; i < 14 && !falls; i++) {
      expect(C.request('A', { a: ID('soco'), h: 0, seq: i }).ok).toBe(true);
      step(700);
      falls = W.events.filter((e) => e.ev.type === 'dummy_knockdown').length;
    }
    expect(falls).toBe(1);
    expect(C.dummy(d.id)!.st).toBe(PHYS.KNOCKED_DOWN);
    expect(hits().some((h) => h.dummy === 1 && h.st === PHYS.STAGGERED)).toBe(true);
    step(d.resetMs + 1000);
    expect(C.dummy(d.id)).toEqual({ st: PHYS.NORMAL, cond: d.conditionMax });
    expect(W.aoi.some((m) => m.type === 'cbt_dummy')).toBe(true);
  });
  it('fora da área (zona de paz) o atacante é negado', () => {
    W = new World();
    C = new CombatSystem(TABLE, W.host());
    W.add('A', { x: 0, z: 0, zone: 'PRACA' }); C.join('A');
    expect(C.request('A', { a: ID('soco'), h: 0 })).toEqual({ ok: false, reason: 'zona_paz' });
  });
});

describe('pulo (JumpValidator)', () => {
  const ctx = { status: 0, vehicle: '', platform: '' };
  it('pulo válido, no ar negado, cooldown depois do pouso', () => {
    const J = new JumpValidator();
    J.join('A', 0);
    let t = 10_000;
    J.clampY('A', 0, 0, t);
    expect(J.request('A', 1, t, ctx)).toEqual({ ok: true });
    expect(J.request('A', 2, t + 100, ctx)).toEqual({ ok: false, reason: 'no_ar' });
    // no ar: até o pico + folga
    expect(J.clampY('A', 0.5, 3, t + 150)).toBe(0.5);
    expect(J.clampY('A', 5, 3, t + 250)).toBeCloseTo(JUMP_PEAK + JUMP.slackM, 5);
    // pousa
    t += JUMP_FLIGHT_MS + 20;
    expect(J.clampY('A', 0, 0, t)).toBe(0);
    expect(J.airborne('A', t)).toBe(false);
    expect(J.request('A', 3, t + 200, ctx)).toEqual({ ok: false, reason: 'cooldown' });
    expect(J.request('A', 4, t + JUMP.cooldownMs + 10, ctx)).toEqual({ ok: true });
  });
  it('sem pulo ninguém sobe além do degrau; teto absoluto; descer é livre', () => {
    const J = new JumpValidator();
    J.join('A', 0);
    const t = 5000;
    expect(J.clampY('A', 0, 0, t)).toBe(0);
    expect(J.clampY('A', 0.15, 1, t + 66)).toBe(0.15); // meio-fio
    expect(J.clampY('A', 3, 1, t + 132)).toBeCloseTo(0.35, 5);
    let y = 0.35;
    for (let i = 0; i < 30; i++) y = J.clampY('A', y + 0.2, 1, t + 200 + i * 66);
    expect(y).toBeLessThanOrEqual(1.05 + 1e-9);
    expect(J.clampY('A', 0, 1, t + 3000)).toBe(0);
  });
  it('estado/veículo/trio negam; janela no ar expira sozinha', () => {
    const J = new JumpValidator();
    J.join('A', 0);
    expect(J.request('A', 1, 0, { ...ctx, status: 1 })).toEqual({ ok: false, reason: 'estado' });
    expect(J.request('A', 1, 0, { ...ctx, vehicle: 'car0' })).toEqual({ ok: false, reason: 'veiculo' });
    expect(J.request('A', 1, 0, { ...ctx, platform: 'trio0' })).toEqual({ ok: false, reason: 'veiculo' });
    expect(J.request('A', 1, 1000, ctx).ok).toBe(true);
    expect(J.airborne('A', 1000 + JUMP_FLIGHT_MS + JUMP.lateMs + 1)).toBe(false);
  });
});
