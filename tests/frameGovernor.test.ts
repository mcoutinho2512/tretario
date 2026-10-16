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
  it('a 60 FPS sempre renderiza', () => {
    const g = new FrameGovernor(60, false);
    for (let i = 0; i < 10; i++) expect(g.shouldRender(i * 16.7)).toBe(true);
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
