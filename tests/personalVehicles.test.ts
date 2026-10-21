/**
 * Rodada 12 — veículo pessoal (puro): ponto de surgimento (personalSpawn.ts) e política/ciclo de vida
 * (server/src/vehicles/PersonalVehicles.ts) com um host falso — taxa, 1 ativo por dono, troca, ociosidade, saída.
 */
import { describe, expect, it } from 'vitest';
import { PERSONAL_RULES, type PersonalKind } from '../src/vehicles/personal';
import { boxDist, findPersonalSpawn, type SpawnSurface, type SpawnWorld } from '../src/vehicles/personalSpawn';
import { VEHICLE_BOX } from '../src/net/rules';
import { PersonalVehicles, type PersonalActor, type PersonalHost } from '../server/src/vehicles/PersonalVehicles';
import { planEquip, planUnequip } from '../src/inventory/equipRules';
import { DEFAULT_QUICKBAR, isActive, isQuickKey, pinQuick } from '../src/inventory/quickbar';
import { buildInventory } from '../src/inventory/catalog';
import type { QuickbarLayout } from '../src/inventory/types';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/characters/bodyTypes';

/** mundo de teste: pista em |x| ≤ 6, calçada 6 < x ≤ 20, prédio além; parede em x = 20 */
const world = (surface?: (x: number, z: number) => SpawnSurface): SpawnWorld => ({
  bounds: [-200, -200, 200, 200],
  surface: surface ?? ((x) => (Math.abs(x) <= 6 ? 'road' : x <= 20 && x >= -20 ? 'walk' : 'blocked')),
  clear: (ax, _az, bx) => !((ax < 20) !== (bx < 20)),
});

describe('ponto de surgimento', () => {
  for (const k of ['scooter', 'bicycle'] as PersonalKind[]) {
    it(`${k}: na calçada, ao lado do avatar, à distância-alvo`, () => {
      const r = findPersonalSpawn(k, { x: 12, z: 0, heading: 0 }, world());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.d).toBeCloseTo(PERSONAL_RULES.spawnDist[k], 5);
      expect(boxDist(12, 0, r, VEHICLE_BOX[k])).toBeGreaterThan(0.3); // não nasce dentro do dono
    });
  }
  it('carro/moto: nunca na calçada — da calçada vai para a pista mais próxima; longe demais → sem lugar', () => {
    const car = findPersonalSpawn('car', { x: 9, z: 0, heading: 0 }, world());
    expect(car.ok).toBe(true);
    if (car.ok) {
      expect(Math.abs(car.x)).toBeLessThanOrEqual(6 - 0.9 + 1e-6); // caixa inteira na pista
      expect(car.d).toBeLessThanOrEqual(PERSONAL_RULES.spawnMaxDist.car);
    }
    expect(findPersonalSpawn('moto', { x: 18, z: 0, heading: 0 }, world()).ok).toBe(true); // pista a 12 m ≤ 14 m (moto alcança como o carro)
    expect(findPersonalSpawn('moto', { x: 24, z: 0, heading: 0 }, world()).ok).toBe(false); // pista a 18 m > 14 m
    expect(findPersonalSpawn('car', { x: 18.5, z: 0, heading: 0 }, world()).ok).toBe(true); // ≤ 14 m alcança
  });
  it('pessoa, veículo e objeto bloqueiam; parede entre o avatar e o ponto também', () => {
    const base = findPersonalSpawn('bicycle', { x: 0, z: 0, heading: 0 }, world());
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const withPerson = findPersonalSpawn('bicycle', { x: 0, z: 0, heading: 0 }, world(), { people: [{ x: base.x, z: base.z }] });
    expect(withPerson.ok && Math.hypot(withPerson.x - base.x, withPerson.z - base.z) > 0.3).toBe(true);
    if (withPerson.ok) expect(boxDist(base.x, base.z, withPerson, VEHICLE_BOX.bicycle)).toBeGreaterThan(0.32);
    const withCar = findPersonalSpawn('bicycle', { x: 0, z: 0, heading: 0 }, world(), { vehicles: [{ x: base.x, z: base.z, heading: 0, kind: 'car' }] });
    expect(withCar.ok && boxDist(withCar.x, withCar.z, { x: base.x, z: base.z, heading: 0 }, VEHICLE_BOX.car)).toBeGreaterThan(0.2);
    const withObj = findPersonalSpawn('bicycle', { x: 0, z: 0, heading: 0 }, world(), { objects: [{ x: base.x, z: base.z, r: 0.4 }] });
    expect(withObj.ok && (withObj.x !== base.x || withObj.z !== base.z)).toBe(true);
    // encostado na parede (x = 19.8): nada do outro lado
    const wall = findPersonalSpawn('scooter', { x: 19.6, z: 0, heading: Math.PI / 2 }, world());
    expect(wall.ok && wall.x < 20).toBe(true);
    // cercado por pessoas em todos os anéis → sem lugar
    const crowd: { x: number; z: number }[] = [];
    for (let x = -6; x <= 6; x += 0.5) for (let z = -6; z <= 6; z += 0.5) if (Math.hypot(x, z) > 0.5) crowd.push({ x, z });
    expect(findPersonalSpawn('scooter', { x: 0, z: 0, heading: 0 }, world(), { people: crowd }).ok).toBe(false);
  });
  it('determinístico', () => {
    const a = findPersonalSpawn('car', { x: 10, z: 3, heading: 0.7 }, world()), b = findPersonalSpawn('car', { x: 10, z: 3, heading: 0.7 }, world());
    expect(a).toEqual(b);
  });
});

/** host falso: entidades, veículos e montagem em memória */
function fakeHost() {
  let now = 1_000_000;
  const actors = new Map<string, PersonalActor>();
  const veh = new Map<string, { kind: string; x: number; z: number; heading: number; owner: string; occupant: string }>();
  const calls: string[] = [];
  const h: PersonalHost & { tick(ms: number): void } = {
    now: () => now,
    tick: (ms) => { now += ms; },
    allowedKinds: () => null,
    actor: (sid) => actors.get(sid) ?? null,
    isSpectator: (sid) => sid.startsWith('spec'),
    world: world(),
    obstacles: () => ({ vehicles: [...veh.entries()].map(([id, v]) => ({ id, ...v })) }),
    addVehicle: (id, kind, x, z, heading, owner) => { veh.set(id, { kind, x, z, heading, owner, occupant: '' }); calls.push(`add:${id}`); },
    removeVehicle: (id) => { veh.delete(id); calls.push(`rm:${id}`); },
    occupant: (id) => veh.get(id)?.occupant,
    mount: (sid, id) => { const v = veh.get(id)!, a = actors.get(sid)!; v.occupant = sid; a.vehicle = id; a.x = v.x; a.z = v.z; calls.push(`mount:${sid}:${id}`); },
    dismount: (sid) => { const a = actors.get(sid)!; const v = veh.get(a.vehicle); if (v) v.occupant = ''; a.vehicle = ''; calls.push(`dismount:${sid}`); return { x: a.x + 1, z: a.z }; },
  };
  return { h, actors, veh, calls, add: (sid: string, x = 0, z = 0) => actors.set(sid, { x, z, heading: 0, status: 0, vehicle: '', platform: '' }) };
}

describe('política e ciclo de vida (PersonalVehicles)', () => {
  it('pedido válido: cria com dono e monta; 100 pedidos → 1 aceito, o resto `taxa`', () => {
    const f = fakeHost(); f.add('a');
    const pv = new PersonalVehicles(f.h);
    const r = pv.request('a', { kind: 'scooter' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.mounted).toBe(true); expect(f.veh.get(r.id)!.owner).toBe('a'); expect(f.actors.get('a')!.vehicle).toBe(r.id); }
    let ok = 0, taxa = 0;
    for (let i = 0; i < 100; i++) { f.h.tick(20); const x = pv.request('a', { kind: (['bicycle', 'moto', 'car', 'scooter'] as const)[i % 4] }); if (x.ok) ok++; else if (x.reason === 'taxa') taxa++; }
    expect(ok).toBe(0); // 2 s de spam: nem a janela de 2,5 s passou, e a rajada (4/10 s) já estourou
    expect(taxa).toBe(100);
    expect(f.veh.size).toBe(1);
  });
  it('rajada: mesmo espaçado ≥ 2,5 s, no máximo 4 pedidos em 10 s', () => {
    const f = fakeHost(); f.add('a');
    const pv = new PersonalVehicles(f.h);
    const res: string[] = [];
    for (let i = 0; i < 6; i++) { const r = pv.request('a', { kind: i % 2 ? 'bicycle' : 'scooter' }); res.push(r.ok ? 'ok' : r.reason); f.h.tick(1300); }
    expect(res.filter((x) => x === 'ok').length).toBeLessThanOrEqual(3);
    expect(f.veh.size).toBe(1);
  });
  it('troca de tipo: desmonta (a bordo) e remove o anterior; 1 ativo por dono', () => {
    const f = fakeHost(); f.add('a');
    const pv = new PersonalVehicles(f.h);
    const r1 = pv.request('a', { kind: 'bicycle' });
    f.h.tick(3000);
    const r2 = pv.request('a', { kind: 'moto' });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r2.replaced).toBe(r1.id);
    expect(f.calls.indexOf('dismount:a')).toBeLessThan(f.calls.indexOf(`rm:${r1.id}`));
    expect([...f.veh.keys()]).toEqual([r2.id]);
    expect(pv.activeOf('a')?.kind).toBe('moto');
  });
  it('estado: caído, em cima do trio, em veículo do mundo, espectador, tipo/evento', () => {
    const f = fakeHost(); f.add('a'); f.add('b'); f.add('c');
    f.actors.get('a')!.status = 1; f.actors.get('b')!.platform = 'trio0'; f.actors.get('c')!.vehicle = 'car3';
    const pv = new PersonalVehicles(f.h);
    expect(pv.request('a', { kind: 'scooter' })).toMatchObject({ ok: false, reason: 'caido' });
    expect(pv.request('b', { kind: 'scooter' })).toMatchObject({ ok: false, reason: 'estado' });
    expect(pv.request('c', { kind: 'scooter' })).toMatchObject({ ok: false, reason: 'estado' });
    expect(pv.request('spec1', { kind: 'scooter' })).toMatchObject({ ok: false, reason: 'espectador' });
    f.add('d');
    expect(pv.request('d', { kind: 'trio' })).toMatchObject({ ok: false, reason: 'tipo' });
    const g = fakeHost(); g.add('e');
    const pv2 = new PersonalVehicles({ ...g.h, allowedKinds: () => new Set(['bicycle']) });
    expect(pv2.request('e', { kind: 'car' })).toMatchObject({ ok: false, reason: 'evento' });
    expect(f.veh.size).toBe(0);
  });
  it('ociosidade: sem o dono a bordo por despawnIdleMs some; com o dono a bordo fica; dono saiu → some', () => {
    const f = fakeHost(); f.add('a'); f.add('b', -12, 0);
    const pv = new PersonalVehicles(f.h);
    const r = pv.request('a', { kind: 'scooter' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    f.h.tick(PERSONAL_RULES.despawnIdleMs + 1000); pv.tick();
    expect(f.veh.has(r.id)).toBe(true); // a bordo
    f.h.dismount('a'); pv.onExit('a', r.id);
    f.h.tick(PERSONAL_RULES.despawnIdleMs - 1000); pv.tick();
    expect(f.veh.has(r.id)).toBe(true);
    f.h.tick(2000); pv.tick();
    expect(f.veh.has(r.id)).toBe(false);
    // dono sai de vez
    const r2 = pv.request('b', { kind: 'bicycle' });
    expect(r2.ok).toBe(true);
    pv.release('b');
    expect(f.veh.size).toBe(0);
  });
  it('função reutilizável (autônomos): spawnPersonalVehicle sem taxa, mesmas validações', () => {
    const f = fakeHost(); f.add('npc1', 0, 0);
    const pv = new PersonalVehicles(f.h);
    for (let i = 0; i < 5; i++) expect(pv.spawnPersonalVehicle('npc1', i % 2 ? 'bicycle' : 'scooter').ok).toBe(true);
    expect(f.veh.size).toBe(1);
    expect(pv.spawnPersonalVehicle('npc1', 'car', { x: 0, z: 0, heading: 0 }, { mount: false })).toMatchObject({ ok: true, mounted: false });
  });
});

describe('inventário e acesso rápido (veículos pessoais)', () => {
  it('veh:<tipo> é item de gameplay: planeja pedir/descer; cabe no acesso rápido; acende montado', () => {
    const st = { app: DEFAULT_PLAYER_APPEARANCE.homem, prop: 0, design: 0 };
    expect(planEquip('veh:moto', st)).toEqual({ kind: 'vehicle', vehicle: 'moto' });
    expect(planEquip('veh:trio', st)).toMatchObject({ kind: 'none' });
    expect(planUnequip('veh:moto', st)).toEqual({ kind: 'vehicle', vehicle: null });
    expect(isQuickKey('veh:scooter')).toBe(true);
    expect(isQuickKey('veh:soundcar')).toBe(false);
    expect(isActive('veh:car', 0, 0, 'car')).toBe(true);
    expect(isActive('veh:car', 0, 0, 'moto')).toBe(false);
    const inv = buildInventory({ app: DEFAULT_PLAYER_APPEARANCE.homem, prop: 0, design: 0, ent: new Set(), carried: 0, freeCombat: false, titles: [], title: null, supporters: null, supporter: null, vehicle: 'bicycle' });
    const veh = inv.filter((i) => i.category === 'VEICULOS');
    expect(veh.map((i) => i.key)).toEqual(['veh:scooter', 'veh:bicycle', 'veh:moto', 'veh:car']);
    expect(veh.find((i) => i.key === 'veh:bicycle')!.state).toBe('equipped');
    expect(pinQuick([...DEFAULT_QUICKBAR] as QuickbarLayout, veh[0], 3)).toMatchObject({ ok: true, index: 3 });
  });
});
