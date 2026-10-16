import { describe, it, expect } from 'vitest';
import { validateMove, sanitizeName, sanitizeColor, MAX_SPEED, type MoveMsg } from '../src/net/protocol';

const msg = (x: number, z: number, mode: MoveMsg['mode'] = 'foot'): MoveMsg => ({ x, y: 0, z, heading: 0, speed: 1, loco: 1, mode, seq: 1 });

describe('protocolo multiplayer — autoridade do servidor', () => {
  it('aceita movimento plausível a pé', () => {
    const r = validateMove({ x: 0, y: 0, z: 0, t: 0 }, msg(0.4, 0), 100);
    expect(r.ok).toBe(true);
    expect(r.x).toBeCloseTo(0.4);
  });
  it('rejeita teleporte e limita ao deslocamento máximo', () => {
    const r = validateMove({ x: 0, y: 0, z: 0, t: 0 }, msg(300, 0), 100);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_fast');
    expect(r.x).toBeLessThan(MAX_SPEED.foot);
  });
  it('bicicleta pode ir mais rápido que a pé', () => {
    // 2,5 m em 200 ms (12,5 m/s com folga de rede): acima do limite a pé, dentro do da bicicleta
    // (limites urbanos da rodada 7: bicicleta até ~25 km/h; corrida a pé 21 km/h, validada até 6,4 m/s)
    const foot = validateMove({ x: 0, y: 0, z: 0, t: 0 }, msg(2.5, 0, 'foot'), 200);
    const bike = validateMove({ x: 0, y: 0, z: 0, t: 0 }, msg(2.5, 0, 'bicycle'), 200);
    expect(foot.ok).toBe(false);
    expect(bike.ok).toBe(true);
  });
  it('rejeita posições fora do mundo e valores inválidos', () => {
    expect(validateMove({ x: 0, y: 0, z: 0, t: 0 }, msg(99999, 0), 100).reason).toBe('out_of_bounds');
    expect(validateMove({ x: 0, y: 0, z: 0, t: 0 }, { ...msg(0, 0), x: NaN }, 100).reason).toBe('invalid');
  });
  it('sanitiza nome e cores', () => {
    expect(sanitizeName('<script>alert(1)</script>Zé')).toBe('scriptalert1scriptZé');
    expect(sanitizeName('')).toBe('Visitante');
    expect(sanitizeColor(0x1000000, 5)).toBe(5);
    expect(sanitizeColor('red', 5)).toBe(5);
  });
});
