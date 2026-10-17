/**
 * Rodada 9 — política de zona do servidor (server/src/combat/zonePolicy.ts) sobre os DADOS reais (zones.json,
 * manifest): spawn e boa parte do eixo são PAZ, áreas de paz fixas (spawn/palco/telões), de evento (retorno) e o
 * anel MÓVEL do trio (acompanha o veículo).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ZonePolicy, rallyPeaceR, type MovingRally } from '../server/src/combat/zonePolicy';
import { zoneAt, pointOnAxis, type ZoneDefinition } from '../src/world/zones';
import { RALLY_SHAPE } from '../src/social/rally';
import { combatAllowed, type CombatParty } from '../src/combat/policy';

const zones = (JSON.parse(readFileSync('public/world/zones.json', 'utf8')) as { zones: ZoneDefinition[] }).zones;
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const axis = manifest.pvAxis as [number, number][];

function make(rallies: MovingRally[] = []) {
  return new ZonePolicy({ zones, axis, spawn: manifest.spawn, spots: manifest.eventSpots, rallies: () => rallies });
}

describe('política de zona (dados reais)', () => {
  it('toda zona tem política; spawn numa zona de PAZ e numa área de paz', () => {
    const zp = make();
    for (const z of zones) expect(['PEACE', 'CONTESTED', 'COMBAT']).toContain(z.combatPolicy);
    const [sx, sz] = manifest.spawn.p;
    const z = zoneAt(zones, axis, sx, sz);
    expect(zp.policyFor(z?.id)).toBe('PEACE');
    expect(zp.peaceAt(sx, sz)).toBe(true);
    expect(zp.peaceAt(sx + 25, sz)).toBe(true);
  });

  it('fora de zona / zona desconhecida = PEACE; há COMBAT e CONTESTED nos dados', () => {
    const zp = make();
    expect(zp.policyFor(null)).toBe('PEACE');
    expect(zp.policyFor('NAO_EXISTE')).toBe('PEACE');
    expect(zp.policyFor('CIDADE_NOVA')).toBe('COMBAT');
    expect(zp.policyFor('CAMPO_DE_SANTANA')).toBe('CONTESTED');
    expect(zp.policyFor('CENTRO')).toBe('PEACE');
  });

  it('quem é pacífico tem espaço de sobra: ≥ 50% do eixo é PAZ', () => {
    let peace = 0;
    for (const z of zones) if ((z.combatPolicy ?? 'PEACE') === 'PEACE') peace += z.to - z.from;
    expect(peace).toBeGreaterThanOrEqual(0.5);
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

  it('integra com combatAllowed: área de paz bloqueia mesmo em COMBAT com consentimento', () => {
    const zp = make([{ id: 'trio0', kind: 'trio', x: -950, z: 400 }]);
    const party = (x: number, z: number): CombatParty => ({ zone: zoneAt(zones, axis, x, z)?.id ?? null, inPeaceArea: zp.peaceAt(x, z), mode: 'interacao', groupKey: null, combatEventId: '', protectedUntil: 0 });
    const pol = (z: string | null) => zp.policyFor(z);
    expect(combatAllowed(pol, party(-1050, 450), party(-1051, 450), null, 0)).toEqual({ ok: true });
    expect(combatAllowed(pol, party(-955, 400), party(-951, 400), null, 0)).toEqual({ ok: false, reason: 'zona_paz' });
  });
});
