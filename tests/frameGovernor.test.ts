import { describe, expect, it } from 'vitest';
import { FrameGovernor } from '../src/core/frameGovernor';

describe('governador de quadros', () => {
  it('a 30 FPS renderiza um quadro sim, outro não numa tela de 60 Hz', () => {
    const g = new FrameGovernor(30, false);
    let n = 0;
    for (let i = 0; i < 60; i++) if (g.shouldRender(i * 16.667)) n++;
    expect(n).toBeGreaterThanOrEqual(29);
    expect(n).toBeLessThanOrEqual(31);
  });
  it('a 60 FPS sempre renderiza numa tela de 60 Hz (mesmo com variação de ±2 ms entre quadros)', () => {
    const g = new FrameGovernor(60, false);
    for (let i = 0; i < 10; i++) expect(g.shouldRender(i * 16.7 + (i % 2 ? 2 : -2))).toBe(true);
  });
  it('a 60 FPS numa tela de 120 Hz renderiza em ritmo fixo (um quadro sim, outro não)', () => {
    const g = new FrameGovernor(60, false);
    const r: number[] = [];
    for (let i = 0; i < 120; i++) if (g.shouldRender(i * 8.333)) r.push(i * 8.333);
    expect(r.length).toBe(60);
    for (let i = 1; i < r.length; i++) expect(r[i] - r[i - 1]).toBeCloseTo(16.67, 1);
  });
  it('reduz a resolução quando os quadros atrasam e volta a subir com folga', () => {
    const g = new FrameGovernor(30, true);
    for (let i = 0; i < 120; i++) g.onFrame(50, null); // 20 FPS por 6 s
    expect(g.scale).toBeLessThan(1);
    expect(g.scale).toBeGreaterThanOrEqual(0.55);
    const low = g.scale;
    for (let i = 0; i < 600; i++) g.onFrame(33.3, 8); // folga por 20 s
    expect(g.scale).toBeGreaterThan(low);
  });
  it('sem resolução dinâmica a escala não muda', () => {
    const g = new FrameGovernor(60, false);
    for (let i = 0; i < 200; i++) g.onFrame(40, 30);
    expect(g.scale).toBe(1);
  });
  it('usa o tempo de GPU quando disponível', () => {
    const g = new FrameGovernor(60, true);
    for (let i = 0; i < 120; i++) g.onFrame(16.7, 16); // GPU no limite, intervalo ainda ok
    expect(g.scale).toBeLessThan(1);
  });
});
