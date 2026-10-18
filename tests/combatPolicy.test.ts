import { describe, expect, it } from 'vitest';
import { combatAllowed, inPeaceArea, type CombatParty, type ZoneCombatPolicy } from '../src/combat/policy';

const zones: Record<string, ZoneCombatPolicy> = { PAZ: 'PEACE', DISPUTA: 'CONTESTED', ARENA: 'COMBAT' };
const pol = (z: string | null): ZoneCombatPolicy => (z && zones[z]) || 'PEACE';
const party = (o: Partial<CombatParty> = {}): CombatParty => ({ zone: 'ARENA', inPeaceArea: false, mode: 'pacifico', groupKey: null, combatEventId: '', protectedUntil: 0, ...o });
const NOW = 1_000_000;

describe('consentimento "none" (decisão do dono 2026-10-18: bater em todos, sem K)', () => {
  const none = (a: CombatParty, b: CombatParty, ev: Parameters<typeof combatAllowed>[3] = null, now = NOW) => combatAllowed(pol, a, b, ev, now, 'none');
  it('COMBAT: impacto em qualquer modo (pacífico ataca e sofre)', () => {
    expect(none(party(), party())).toEqual({ ok: true });
    expect(none(party({ mode: 'interacao' }), party())).toEqual({ ok: true });
    expect(none(party(), party({ mode: 'interacao' }))).toEqual({ ok: true });
  });
  it('proteção de retorno continua bloqueando', () => {
    expect(none(party(), party({ protectedUntil: NOW + 1 }))).toEqual({ ok: false, reason: 'protegido' });
    expect(none(party(), party({ protectedUntil: NOW }))).toEqual({ ok: true });
  });
  it('fogo amigo do evento continua valendo; PEACE/área de paz/CONTESTED (se existirem nos dados) também', () => {
    const ev = { eventId: 'e1', zones: ['ARENA'], friendlyFire: false };
    expect(none(party({ combatEventId: 'e1', groupKey: 'x' }), party({ combatEventId: 'e1', groupKey: 'x' }), ev)).toEqual({ ok: false, reason: 'politica' });
    expect(none(party({ combatEventId: 'e1', groupKey: 'x' }), party({ combatEventId: 'e1', groupKey: 'y' }), ev)).toEqual({ ok: true });
    expect(none(party(), party({ zone: 'PAZ' }))).toEqual({ ok: false, reason: 'zona_paz' });
    expect(none(party(), party({ inPeaceArea: true }))).toEqual({ ok: false, reason: 'zona_paz' });
    expect(none(party({ zone: 'DISPUTA' }), party({ zone: 'DISPUTA' })).ok).toBe(false);
  });
});

describe('política de confronto (zona + evento + estado) — consentimento "both" (regra antiga, padrão do parâmetro)', () => {
  it('PEACE nunca permite, mesmo com consentimento e evento', () => {
    const ev = { eventId: 'e1', zones: ['PAZ'], friendlyFire: true };
    const a = party({ zone: 'PAZ', mode: 'interacao', combatEventId: 'e1' }), b = party({ zone: 'PAZ', mode: 'interacao', combatEventId: 'e1' });
    expect(combatAllowed(pol, a, b, ev, NOW)).toEqual({ ok: false, reason: 'zona_paz' });
  });
  it('área de paz pontual dentro de zona de combate bloqueia', () => {
    expect(combatAllowed(pol, party({ mode: 'interacao' }), party({ mode: 'interacao', inPeaceArea: true }), null, NOW)).toEqual({ ok: false, reason: 'zona_paz' });
    expect(inPeaceArea([{ id: 'palco', x: 0, z: 0, r: 10 }], 3, 4)).toBe(true);
    expect(inPeaceArea([{ id: 'palco', x: 0, z: 0, r: 10 }], 30, 4)).toBe(false);
  });
  it('COMBAT exige consentimento dos dois (modo interação); pacífico nunca sofre impacto', () => {
    expect(combatAllowed(pol, party({ mode: 'interacao' }), party({ mode: 'interacao' }), null, NOW)).toEqual({ ok: true });
    expect(combatAllowed(pol, party({ mode: 'interacao' }), party({ mode: 'pacifico' }), null, NOW).ok).toBe(false);
  });
  it('CONTESTED só dentro de evento de confronto ativo entre inscritos', () => {
    const ev = { eventId: 'e1', zones: ['DISPUTA'], friendlyFire: false };
    const a = party({ zone: 'DISPUTA', mode: 'interacao' }), b = party({ zone: 'DISPUTA', mode: 'interacao' });
    expect(combatAllowed(pol, a, b, null, NOW).ok).toBe(false);
    expect(combatAllowed(pol, { ...a, combatEventId: 'e1' }, { ...b, combatEventId: 'e1' }, ev, NOW)).toEqual({ ok: true });
    expect(combatAllowed(pol, { ...a, combatEventId: 'e1' }, b, ev, NOW).ok).toBe(false);
  });
  it('fogo amigo vem da regra do evento (comparação por igualdade de chave)', () => {
    const a = party({ zone: 'DISPUTA', combatEventId: 'e1', groupKey: 'x' });
    const b = party({ zone: 'DISPUTA', combatEventId: 'e1', groupKey: 'y' });
    const c = party({ zone: 'DISPUTA', combatEventId: 'e1', groupKey: 'x' });
    const off = { eventId: 'e1', zones: ['DISPUTA'], friendlyFire: false };
    expect(combatAllowed(pol, a, b, off, NOW)).toEqual({ ok: true });
    expect(combatAllowed(pol, a, c, off, NOW)).toEqual({ ok: false, reason: 'politica' });
    expect(combatAllowed(pol, a, c, { ...off, friendlyFire: true }, NOW)).toEqual({ ok: true });
  });
  it('proteção de retorno bloqueia impacto no protegido', () => {
    expect(combatAllowed(pol, party({ mode: 'interacao' }), party({ mode: 'interacao', protectedUntil: NOW + 1 }), null, NOW)).toEqual({ ok: false, reason: 'protegido' });
  });
});
