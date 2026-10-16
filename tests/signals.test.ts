import { describe, it, expect } from 'vitest';
import { lightAt, CYCLE, CYCLE_LENGTH, SignalController } from '../src/traffic/SignalController';

describe('ciclo de semáforos', () => {
  it('as duas fases nunca ficam verdes ou amarelas ao mesmo tempo (segurança)', () => {
    for (let t = 0; t < CYCLE_LENGTH; t += 0.25) {
      const a = lightAt(t, 0), b = lightAt(t, 1);
      expect(a !== 'R' && b !== 'R').toBe(false);
    }
  });
  it('cada fase passa por verde → amarelo → vermelho', () => {
    const seq0 = new Set<string>(), seq1 = new Set<string>();
    for (let t = 0; t < CYCLE_LENGTH; t += 0.5) { seq0.add(lightAt(t, 0)); seq1.add(lightAt(t, 1)); }
    expect([...seq0].sort()).toEqual(['G', 'R', 'Y']);
    expect([...seq1].sort()).toEqual(['G', 'R', 'Y']);
  });
  it('existe vermelho geral entre as fases', () => {
    const t = CYCLE.green0 + CYCLE.yellow + 0.5;
    expect(lightAt(t, 0)).toBe('R');
    expect(lightAt(t, 1)).toBe('R');
  });
  it('defasagem por cruzamento (onda verde) altera o estado no mesmo instante', () => {
    const sc = new SignalController([{ id: 0, c: [0, 0], offset: 0 }, { id: 1, c: [0, 0], offset: 20 }]);
    sc.time = 10;
    expect(sc.state(0, 0)).toBe('G');
    expect(sc.state(1, 0)).not.toBe('G');
  });
});
