/**
 * Política de zona do servidor (server/src/combat/zonePolicy.ts) sobre os DADOS reais (zones.json, manifest).
 * Rodada 12 — decisão definitiva do dono: NÃO EXISTEM ÁREAS DE PAZ. Toda zona e fora de qualquer zona = COMBAT; sem
 * peaceAreas nem áreas derivadas (spawn, palco, anel do trio/carro de som, retornos de evento). Só a proteção
 * temporária de retorno e as regras de evento bloqueiam um impacto.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ZonePolicy } from '../server/src/combat/zonePolicy';
import { zoneAt, type ZoneDefinition } from '../src/world/zones';
import { RALLY_SHAPE } from '../src/social/rally';
import { combatAllowed, parseCombatRules, type CombatParty } from '../src/combat/policy';

const zfile = JSON.parse(readFileSync('public/world/zones.json', 'utf8')) as Record<string, unknown> & { zones: (ZoneDefinition & Record<string, unknown>)[] };
const zones = zfile.zones;
const rules = parseCombatRules(zfile);
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const axis = manifest.pvAxis as [number, number][];

describe('política de zona (dados reais) — não existem áreas de paz', () => {
  it('dados: toda zona é COMBAT, sem peaceAreas; sem derivedPeaceAreas na raiz; consentimento "none"', () => {
    for (const z of zones) { expect(z.combatPolicy).toBe('COMBAT'); expect(z.peaceAreas).toBeUndefined(); }
    expect(zfile.derivedPeaceAreas).toBeUndefined();
    expect(rules).toEqual({ combatConsent: 'none' });
    expect(parseCombatRules({})).toEqual({ combatConsent: 'both' }); // ausente = consentimento antigo (não é zona)
    // concentrações não carregam raio de paz
    for (const s of Object.values(RALLY_SHAPE)) expect('peaceR' in s).toBe(false);
  });

  it('fora de zona, zona desconhecida e o antigo "PEACE" = COMBAT', () => {
    const zp = new ZonePolicy({ zones: [...zones, { id: 'LEGADO', name: 'x', from: 0, to: 0.01, halfWidth: 1, combatPolicy: 'PEACE' as never }] });
    expect(zp.policyFor(null)).toBe('COMBAT');
    expect(zp.policyFor('NAO_EXISTE')).toBe('COMBAT');
    expect(zp.policyFor('LEGADO')).toBe('COMBAT');
    for (const z of zones) expect(zp.policyFor(z.id)).toBe('COMBAT');
    expect('peaceAt' in zp).toBe(false);
  });

  it('dados reais + combatAllowed: pacíficos se acertam no spawn, no palco, junto ao trio e fora da avenida; só a proteção de retorno bloqueia', () => {
    const zp = new ZonePolicy({ zones });
    const pol = (z: string | null) => zp.policyFor(z);
    const party = (x: number, z: number, o: Partial<CombatParty> = {}): CombatParty => ({ zone: zoneAt(zones, axis, x, z)?.id ?? null, mode: 'pacifico', groupKey: null, combatEventId: '', protectedUntil: 0, ...o });
    const [sx, sz] = manifest.spawn.p;
    const st = manifest.eventSpots.find((s: { kind: string }) => s.kind === 'stage');
    const pts: [number, number][] = [[sx, sz], [st.x + Math.sin(st.heading) * 9, st.z + Math.cos(st.heading) * 9], [-955, 400], [-1050, 450], [50000, 50000]];
    for (const [x, z] of pts) expect(combatAllowed(pol, party(x, z), party(x + 1, z), null, 0, rules.combatConsent)).toEqual({ ok: true });
    expect(combatAllowed(pol, party(sx, sz), party(sx + 1, sz, { protectedUntil: 10 }), null, 0, rules.combatConsent)).toEqual({ ok: false, reason: 'protegido' });
  });
});
