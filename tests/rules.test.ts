import { describe, it, expect } from 'vitest';
import { canPush, canEnter, vehicleImpact, knockdownOutcome, packMove, unpackMove, RULES, STATUS, type Actor } from '../src/net/rules';
import { WallGrid } from '../src/physics/walls';

const actor = (id: string, x: number, z: number, o: Partial<Actor> = {}): Actor => ({
  id, x, z, heading: Math.PI / 2, mode: 'interacao', status: STATUS.OK, vehicle: '', immuneUntil: 0, lastActionAt: -1e9, actionTimes: [], ...o,
});

describe('empurrão (validação do servidor)', () => {
  it('válido quando ambos em modo interação, perto, à frente', () => {
    expect(canPush(actor('a', 0, 0), actor('b', 1.2, 0), 10_000)).toEqual({ ok: true });
  });
  it('alvo em modo pacífico não pode ser afetado', () => {
    expect(canPush(actor('a', 0, 0), actor('b', 1.2, 0, { mode: 'pacifico' }), 10_000)).toMatchObject({ ok: false, reason: 'pacifico_alvo' });
  });
  it('atacante pacífico não empurra', () => {
    expect(canPush(actor('a', 0, 0, { mode: 'pacifico' }), actor('b', 1.2, 0), 10_000)).toMatchObject({ reason: 'pacifico_atacante' });
  });
  it('distância, ângulo, estado, veículo e imunidade', () => {
    expect(canPush(actor('a', 0, 0), actor('b', 3, 0), 10_000)).toMatchObject({ reason: 'distancia' });
    expect(canPush(actor('a', 0, 0), actor('b', -1.2, 0), 10_000)).toMatchObject({ reason: 'angulo' });
    expect(canPush(actor('a', 0, 0), actor('b', 1.2, 0, { status: STATUS.DOWN }), 10_000)).toMatchObject({ reason: 'estado' });
    expect(canPush(actor('a', 0, 0, { vehicle: 'car0' }), actor('b', 1.2, 0), 10_000)).toMatchObject({ reason: 'veiculo' });
    expect(canPush(actor('a', 0, 0), actor('b', 1.2, 0, { immuneUntil: 20_000 }), 10_000)).toMatchObject({ reason: 'imune' });
  });
  it('cooldown e anti-spam', () => {
    expect(canPush(actor('a', 0, 0, { lastActionAt: 9_500 }), actor('b', 1.2, 0), 10_000)).toMatchObject({ reason: 'cooldown' });
    const times = Array.from({ length: RULES.rateMax }, (_, i) => 1_000 + i * 1_500);
    expect(canPush(actor('a', 0, 0, { actionTimes: times, lastActionAt: 0 }), actor('b', 1.2, 0), 10_000)).toMatchObject({ reason: 'spam' });
  });
  it('não empurra através de parede; queda limitada pela parede', () => {
    const w = new WallGrid();
    w.addSegment({ ax: 0.6, az: -5, bx: 0.6, bz: 5, bottom: 0, top: 3 });
    expect(canPush(actor('a', 0, 0), actor('b', 1.2, 0), 10_000, w)).toMatchObject({ reason: 'obstaculo' });
    const w2 = new WallGrid();
    w2.addSegment({ ax: 2, az: -5, bx: 2, bz: 5, bottom: 0, top: 3 });
    const o = knockdownOutcome({ x: 0, z: 0 }, { x: 1, z: 0 }, 1.8, w2);
    expect(o.rx).toBeLessThan(2);
    expect(o.dx).toBeCloseTo(1);
  });
});

describe('veículos', () => {
  it('dois jogadores não ocupam o mesmo veículo; distância e estado verificados', () => {
    expect(canEnter({ x: 0, z: 0, status: 0, vehicle: '' }, { x: 1, z: 0, occupant: '' }).ok).toBe(true);
    expect(canEnter({ x: 0, z: 0, status: 0, vehicle: '' }, { x: 1, z: 0, occupant: 'A' })).toMatchObject({ ok: false, reason: 'ocupado' });
    expect(canEnter({ x: 0, z: 0, status: 0, vehicle: '' }, { x: 9, z: 0, occupant: '' })).toMatchObject({ reason: 'distancia' });
    expect(canEnter({ x: 0, z: 0, status: 1, vehicle: '' }, { x: 1, z: 0, occupant: '' })).toMatchObject({ reason: 'estado' });
    // carro: alcance medido até a carroceria (4,4 × 1,8 m), não ao centro
    const car = { x: 0, z: 0, occupant: '', heading: 0, kind: 'car' };
    expect(canEnter({ x: 0, z: -3.6, status: 0, vehicle: '' }, car).ok).toBe(true); // atrás do carro, 1,4 m do para-choque
    expect(canEnter({ x: 0, z: -5.0, status: 0, vehicle: '' }, car)).toMatchObject({ reason: 'distancia' });
    expect(canEnter({ x: 2.6, z: 0, status: 0, vehicle: '' }, car).ok).toBe(true); // ao lado da porta
  });
  it('impacto depende da velocidade e da caixa do carro (com amostragem do trajeto)', () => {
    const slow = vehicleImpact({ x: 0, z: 0, px: 0, pz: -0.1, heading: 0, speed: 1 }, { x: 0, z: 1 });
    expect(slow.hit).toBe(false);
    const hit = vehicleImpact({ x: 0, z: 0, px: 0, pz: -1, heading: 0, speed: 8 }, { x: 0.3, z: 2 });
    expect(hit.hit).toBe(true);
    const fast = vehicleImpact({ x: 0, z: 0, px: 0, pz: -2, heading: 0, speed: 14 }, { x: 0, z: 1 });
    expect(fast.strength).toBeGreaterThan(hit.strength);
    expect(fast.strength).toBeLessThanOrEqual(6);
    // atravessou o alvo entre duas mensagens (tunelamento) → ainda detecta
    expect(vehicleImpact({ x: 0, z: 6, px: 0, pz: -6, heading: 0, speed: 15 }, { x: 0, z: 0 }).hit).toBe(true);
    expect(vehicleImpact({ x: 0, z: 0, px: 0, pz: -1, heading: 0, speed: 8 }, { x: 3, z: 0 }).hit).toBe(false);
  });
});

describe('mensagens compactas', () => {
  it('ida e volta e rejeição de lixo', () => {
    const m = { x: 12.3456, y: 0.15, z: -7.891, heading: 1.23456, speed: 4.567, loco: 2, seq: 99 };
    const u = unpackMove(packMove(m))!;
    expect(u.x).toBeCloseTo(12.35, 2);
    expect(u.seq).toBe(99);
    expect(unpackMove([1, 2, 'x'])).toBeNull();
    expect(unpackMove({})).toBeNull();
  });
});
