/**
 * Rodada 12 (AGENTE F) — remoto que sumia com o nome ainda na tela: a 1ª amostra de quem acabou de entrar chega sem
 * `speed`; o NaN ficava preso nos filtros do rumo visível (inclinação do esqueleto NaN → malha some) e na fase da
 * multidão instanciada. Estes testes falhavam antes da correção (src/player/gaitStep.ts, crowd/animVariety.ts).
 */
import { describe, expect, it } from 'vitest';
import { createGait, finiteOr, gaitPoisoned, stepGait } from '../src/player/gaitStep';
import { advanceCyclePhase, finiteSpeed } from '../src/characters/crowd/animVariety';

const finite = (g: ReturnType<typeof createGait>) => [g.face, g.speed, g.yawRate, g.accel, g.roll, g.pitch].every(Number.isFinite);

describe('rumo visível (gaitStep) com amostra de rede incompleta', () => {
  it('velocidade ausente (undefined → NaN) na 1ª amostra não contamina o estado', () => {
    const g = createGait();
    stepGait(g, 1.2, undefined as unknown as number, true, 1 / 60); // 1ª amostra: só inicializa
    for (let i = 0; i < 30; i++) stepGait(g, 1.2, NaN, true, 1 / 60); // interpolação com a amostra sem speed
    expect(finite(g)).toBe(true);
    expect(g.speed).toBe(0);
    // e depois a velocidade real chega: o filtro segue normalmente
    for (let i = 0; i < 120; i++) stepGait(g, 1.2, 3, true, 1 / 60);
    expect(g.speed).toBeGreaterThan(2.9);
    expect(finite(g)).toBe(true);
  });

  it('o mesmo roteiro da rede no código antigo (sem saneamento) ficava NaN para sempre', () => {
    // modelo do filtro antigo de AvatarVisual.steer: g.speed += (s - g.speed) · k
    let speed = 0;
    const k = 1 - Math.exp(-12 / 60);
    speed += (NaN - speed) * k;
    for (let i = 0; i < 600; i++) speed += (3 - speed) * k;
    expect(Number.isNaN(speed)).toBe(true); // a armadilha que a correção evita
    const g = createGait();
    stepGait(g, 0, 0, true, 1 / 60);
    stepGait(g, 0, NaN, true, 1 / 60);
    for (let i = 0; i < 600; i++) stepGait(g, 0, 3, true, 1 / 60);
    expect(g.speed).toBeCloseTo(3, 3);
  });

  it('estado já contaminado (NaN/∞) se recupera no passo seguinte', () => {
    const g = createGait();
    stepGait(g, 0.5, 1, true, 1 / 60);
    g.speed = NaN; g.roll = Infinity; g.yawRate = NaN;
    expect(gaitPoisoned(g)).toBe(true);
    stepGait(g, 0.5, 1.4, true, 1 / 60);
    expect(finite(g)).toBe(true);
    for (let i = 0; i < 60; i++) stepGait(g, 0.5, 1.4, true, 1 / 60);
    expect(finite(g)).toBe(true);
    expect(Math.abs(g.roll)).toBeLessThan(0.2);
  });

  it('rumo e dt não finitos mantêm o rumo anterior / não avançam', () => {
    const g = createGait();
    stepGait(g, 1, 1, true, 1 / 60);
    stepGait(g, NaN, 1, true, 1 / 60);
    expect(g.face).toBeCloseTo(1, 6);
    stepGait(g, 2, 1, true, NaN);
    expect(finite(g)).toBe(true);
  });

  it('curva correndo ainda inclina o corpo (comportamento da rodada 9.1 preservado)', () => {
    const g = createGait();
    let h = 0;
    stepGait(g, h, 5, true, 1 / 60);
    for (let i = 0; i < 90; i++) { h += 1.5 / 60; stepGait(g, h, 5, true, 1 / 60); }
    expect(g.roll).toBeLessThan(-0.05);
    expect(g.pitch).toBeGreaterThan(0);
  });

  it('finiteOr', () => {
    expect(finiteOr(2, 0)).toBe(2);
    expect(finiteOr(undefined, 7)).toBe(7);
    expect(finiteOr(NaN, 7)).toBe(7);
    expect(finiteOr(-Infinity, 7)).toBe(7);
  });
});

describe('multidão instanciada: fase do ciclo assado', () => {
  it('velocidade NaN não prende a fase em NaN', () => {
    let phase = 0.3;
    const sp = finiteSpeed(NaN);
    expect(sp).toBe(0);
    // taxa calculada da forma do CrowdRenderer, agora com a velocidade saneada
    const rate = Math.min(2.2, Math.max(0.35, sp / 1.2)) / 1.1;
    for (let i = 0; i < 10; i++) phase = advanceCyclePhase(phase, 1 / 60, rate);
    expect(Number.isFinite(phase)).toBe(true);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
  });

  it('fase já contaminada recomeça; taxa NaN não contamina', () => {
    expect(advanceCyclePhase(NaN, 1 / 60, 1)).toBeCloseTo(1 / 60, 6);
    expect(advanceCyclePhase(0.5, 1 / 60, NaN)).toBe(0);
    expect(advanceCyclePhase(0.99, 0.02, 1)).toBeCloseTo(0.01, 6);
  });
});
