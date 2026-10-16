import { describe, it, expect } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { stepRideable, RIDEABLE_DEFS, type RideableState } from '../src/vehicles/Rideable';
import { InteractionController } from '../src/interaction/InteractionMode';

describe('veículos utilizáveis', () => {
  const world = new CollisionWorld(250, [-1000, -1000, 1000, 1000]);
  world.addPolygon([[30, -5], [40, -5], [40, 5], [30, 5]], 0, 30);
  const mk = (kind: 'bicycle' | 'scooter'): RideableState => ({ id: 't', kind, x: 0, y: 0.15, z: 0, heading: Math.PI / 2, speed: 0, occupant: 'p' });

  it('bicicleta acelera até a velocidade máxima e não atravessa prédios', () => {
    const v = mk('bicycle');
    for (let i = 0; i < 600; i++) stepRideable(v, RIDEABLE_DEFS.bicycle, { throttle: 1, steer: 0, boost: false }, 1 / 60, world);
    expect(v.x).toBeLessThan(30);
    expect(v.x).toBeGreaterThan(25);
  });
  it('velocidades plausíveis: bicicleta > patinete > caminhada', () => {
    expect(RIDEABLE_DEFS.bicycle.maxSpeed).toBeGreaterThan(RIDEABLE_DEFS.scooter.maxSpeed);
    expect(RIDEABLE_DEFS.scooter.maxSpeed).toBeGreaterThan(1.8);
  });
  it('esterçar muda o rumo apenas em movimento', () => {
    const v = mk('scooter');
    stepRideable(v, RIDEABLE_DEFS.scooter, { throttle: 0, steer: 1, boost: false }, 1, world);
    expect(v.heading).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('modos de interação', () => {
  it('evento pacífico bloqueia o modo interação e pedidos de ação', () => {
    const ic = new InteractionController();
    ic.setPolicy('pacifico');
    expect(ic.toggle().ok).toBe(false);
    expect(ic.request('empurrar', 0, 0, 0, 0)).toBeNull();
  });
  it('evento opcional permite alternar; ações viram pedidos (com cooldown) para o servidor', () => {
    const ic = new InteractionController();
    ic.setPolicy('opcional');
    expect(ic.toggle().ok).toBe(true);
    expect(ic.mode).toBe('interacao');
    expect(ic.request('empurrar', 0, 0, 0, 0)).not.toBeNull();
    expect(ic.request('empurrar', 0, 0, 0, 0)).toBeNull(); // cooldown
    expect(ic.outbox.length).toBe(1);
  });
});
