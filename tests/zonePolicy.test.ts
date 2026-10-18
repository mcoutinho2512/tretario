/**
 * Rodada 9 — política de zona do servidor (server/src/combat/zonePolicy.ts) sobre os DADOS reais (zones.json,
 * manifest). Decisão do dono (2026-10-18): avenida toda COMBAT, sem áreas de paz, sem consentimento. Os caminhos das
 * áreas derivadas (spawn/palco/retorno de evento/anel MÓVEL do trio) continuam testados com `derived: true`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ZonePolicy, rallyPeaceR, type MovingRally } from '../server/src/combat/zonePolicy';
import { zoneAt, pointOnAxis, type ZoneDefinition } from '../src/world/zones';
import { RALLY_SHAPE } from '../src/social/rally';
import { combatAllowed, parseCombatRules, type CombatParty } from '../src/combat/policy';

const zfile = JSON.parse(readFileSync('public/world/zones.json', 'utf8')) as { zones: ZoneDefinition[] };
const zones = zfile.zones;
const rules = parseCombatRules(zfile);
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const axis = manifest.pvAxis as [number, number][];

/** `derived: true` = áreas de paz derivadas ligadas (regra antiga, parâmetro); os dados reais desligam */
function make(rallies: MovingRally[] = [], derived = true) {
  return new ZonePolicy({ zones, axis, spawn: manifest.spawn, spots: manifest.eventSpots, rallies: () => rallies, derived });
}

describe('política de zona (dados reais)', () => {
  it('decisão do dono: toda zona é COMBAT, sem peaceAreas; consentimento "none" e áreas derivadas desligadas', () => {
    for (const z of zones) { expect(z.combatPolicy).toBe('COMBAT'); expect(z.peaceAreas ?? []).toEqual([]); }
    expect(rules).toEqual({ combatConsent: 'none', derivedPeaceAreas: false });
    // ausente = regra antiga
    expect(parseCombatRules({})).toEqual({ combatConsent: 'both', derivedPeaceAreas: true });
  });

  it('com os dados reais nada é paz: spawn, palco, anel do trio e retorno de evento', () => {
    const zp = make([{ id: 'trio0', kind: 'trio', x: -950, z: 400 }], rules.derivedPeaceAreas);
    const [sx, sz] = manifest.spawn.p;
    expect(zp.policyFor(zoneAt(zones, axis, sx, sz)?.id)).toBe('COMBAT');
    expect(zp.peaceAt(sx, sz)).toBe(false);
    const st = manifest.eventSpots.find((s: { kind: string }) => s.kind === 'stage');
    expect(zp.peaceAt(st.x + Math.sin(st.heading) * RALLY_SHAPE.stage.front, st.z + Math.cos(st.heading) * RALLY_SHAPE.stage.front)).toBe(false);
    expect(zp.peaceAt(-945, 400)).toBe(false);
    zp.setEventAreas('evento:clash', zp.respawnAreas('clash', [{ x: -1000, z: 430 }]));
    expect(zp.peaceAt(-1000, 430)).toBe(false);
    expect(zp.areas()).toEqual([]);
  });

  it('regra antiga (derived: true): spawn é área de paz', () => {
    const zp = make();
    const [sx, sz] = manifest.spawn.p;
    expect(zp.peaceAt(sx, sz)).toBe(true);
    expect(zp.peaceAt(sx + 25, sz)).toBe(true);
  });

  it('fora de zona / zona desconhecida = PEACE', () => {
    const zp = make();
    expect(zp.policyFor(null)).toBe('PEACE');
    expect(zp.policyFor('NAO_EXISTE')).toBe('PEACE');
    for (const z of zones) expect(zp.policyFor(z.id)).toBe('COMBAT');
  });

  it('palco (eventSpots stage) é área de paz à frente do palco', () => {
    const zp = make();
    const st = manifest.eventSpots.find((s: { kind: string }) => s.kind === 'stage');
    const fx = st.x + Math.sin(st.heading) * RALLY_SHAPE.stage.front, fz = st.z + Math.cos(st.heading) * RALLY_SHAPE.stage.front;
    expect(zp.peaceAt(fx, fz)).toBe(true);
    expect(zp.peaceAt(fx + RALLY_SHAPE.stage.peaceR + 5, fz)).toBe(false);
  });

  it('anel do trio é área de paz MÓVEL: acompanha o veículo', () => {
    const trio: MovingRally = { id: 'trio0', kind: 'trio', x: -950, z: 400 }; // dentro da Cidade Nova (COMBAT)
    const zp = make([trio]);
    expect(zp.policyFor(zoneAt(zones, axis, -950, 400)?.id)).toBe('COMBAT');
    expect(zp.peaceAt(-950 + 10, 400)).toBe(true);
    expect(zp.peaceAt(-950 + rallyPeaceR('trio') + 3, 400)).toBe(false);
    trio.x = -900; trio.z = 380; // o trio andou: o anel vai junto
    expect(zp.peaceAt(-950 + 10, 400)).toBe(false);
    expect(zp.peaceAt(-905, 382)).toBe(true);
    expect(zp.areas().some((a) => a.id === 'rally:trio0')).toBe(true);
    // carro de som também; caminhão (decoração) não
    expect(rallyPeaceR('soundcar')).toBeGreaterThan(0);
    expect(rallyPeaceR('car')).toBe(0);
  });

  it('pontos de retorno de evento viram áreas de paz (e saem quando o evento acaba)', () => {
    const zp = make();
    const p = pointOnAxis(axis, 0.1, 0);
    expect(zp.peaceAt(p.x, p.z)).toBe(false);
    zp.setEventAreas('evento:clash', zp.respawnAreas('clash', [{ t: 0.1 }, { x: -1000, z: 430 }]));
    expect(zp.peaceAt(p.x, p.z)).toBe(true);
    expect(zp.peaceAt(-1000, 430)).toBe(true);
    zp.clearEventAreas('evento:clash');
    expect(zp.peaceAt(p.x, p.z)).toBe(false);
  });

  it('dados reais + combatAllowed: pacíficos se acertam em qualquer zona; só a proteção bloqueia', () => {
    const zp = make([{ id: 'trio0', kind: 'trio', x: -950, z: 400 }], rules.derivedPeaceAreas);
    const pol = (z: string | null) => zp.policyFor(z);
    const party = (x: number, z: number, o: Partial<CombatParty> = {}): CombatParty => ({ zone: zoneAt(zones, axis, x, z)?.id ?? null, inPeaceArea: zp.peaceAt(x, z), mode: 'pacifico', groupKey: null, combatEventId: '', protectedUntil: 0, ...o });
    const [sx, sz] = manifest.spawn.p;
    for (const [x, z] of [[sx, sz], [-955, 400], [-1050, 450]]) expect(combatAllowed(pol, party(x, z), party(x + 1, z), null, 0, rules.combatConsent)).toEqual({ ok: true });
    expect(combatAllowed(pol, party(sx, sz), party(sx + 1, sz, { protectedUntil: 10 }), null, 0, rules.combatConsent)).toEqual({ ok: false, reason: 'protegido' });
  });

  it('regra antiga (derived: true): área de paz bloqueia mesmo em COMBAT com consentimento', () => {
    const zp = make([{ id: 'trio0', kind: 'trio', x: -950, z: 400 }]);
    const party = (x: number, z: number): CombatParty => ({ zone: zoneAt(zones, axis, x, z)?.id ?? null, inPeaceArea: zp.peaceAt(x, z), mode: 'interacao', groupKey: null, combatEventId: '', protectedUntil: 0 });
    const pol = (z: string | null) => zp.policyFor(z);
    expect(combatAllowed(pol, party(-1050, 450), party(-1051, 450), null, 0)).toEqual({ ok: true });
    expect(combatAllowed(pol, party(-955, 400), party(-951, 400), null, 0)).toEqual({ ok: false, reason: 'zona_paz' });
  });
});
