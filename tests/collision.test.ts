import { describe, it, expect } from 'vitest';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { stepPlayer } from '../src/player/PlayerController';
import { createPlayerState } from '../src/player/PlayerState';

describe('colisão e movimento', () => {
  const world = new CollisionWorld(250, [-1000, -1000, 1000, 1000]);
  // edifício 10×10 m centrado em (20, 0)
  world.addPolygon([[15, -5], [25, -5], [25, 5], [15, 5]], 0, 30);

  it('jogador não atravessa paredes', () => {
    const s = createPlayerState('t', 0, 0.15, 0);
    for (let i = 0; i < 600; i++) stepPlayer(s, { dirX: 1, dirZ: 0, run: true, jump: false }, 1 / 60, world);
    expect(s.x).toBeLessThan(15);
    expect(s.x).toBeGreaterThan(13);
  });

  it('câmera: raycast detecta parede entre dois pontos', () => {
    const t = world.raycast(0, 1.6, 0, 40, 1.6, 0);
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.4);
    expect(world.raycast(0, 50, 0, 40, 50, 0)).toBe(1); // acima do prédio
  });

  it('gravidade mantém o jogador no chão e o pulo retorna ao solo', () => {
    const s = createPlayerState('t', -50, 0.15, 0);
    stepPlayer(s, { dirX: 0, dirZ: 0, run: false, jump: true }, 1 / 60, world);
    expect(s.vy).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) stepPlayer(s, { dirX: 0, dirZ: 0, run: false, jump: false }, 1 / 60, world);
    expect(s.grounded).toBe(true);
    expect(s.y).toBeCloseTo(world.groundHeight(-50, 0), 3);
  });

  it('velocidades de caminhada e corrida plausíveis', () => {
    const s = createPlayerState('t', -300, 0, -300);
    for (let i = 0; i < 120; i++) stepPlayer(s, { dirX: 0, dirZ: 1, run: false, jump: false }, 1 / 60, world);
    expect(s.speed).toBeGreaterThan(1.5);
    expect(s.speed).toBeLessThan(2.2);
    for (let i = 0; i < 120; i++) stepPlayer(s, { dirX: 0, dirZ: 1, run: true, jump: false }, 1 / 60, world);
    expect(s.speed).toBeGreaterThan(4.0); // corrida de rua plausível (4,4 m/s); acima disso a cadência do ciclo fica frenética
    expect(s.locomotion).toBe('run');
  });
});
