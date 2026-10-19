import { describe, it, expect } from 'vitest';
import { PRESETS, mobileAdjust } from '../src/core/settings';

describe('presets gráficos', () => {
  it('BAIXO ≤ MÉDIO ≤ ALTO em custo', () => {
    const { low, medium, high } = PRESETS;
    expect(low.pixelRatio).toBeLessThanOrEqual(medium.pixelRatio);
    expect(medium.pixelRatio).toBeLessThanOrEqual(high.pixelRatio);
    expect(low.shadowMapSize).toBe(0);
    expect(medium.shadowMapSize).toBeLessThanOrEqual(high.shadowMapSize);
    for (let i = 0; i < 3; i++) {
      expect(low.lodDistances[i]).toBeLessThanOrEqual(medium.lodDistances[i]);
      expect(medium.lodDistances[i]).toBeLessThanOrEqual(high.lodDistances[i]);
    }
    expect(high.ambientOcclusion).toBe(true);
  });
  it('ULTRA investe em alcance (sombra, LOD, NPCs) e bordas (MSAA no HDR) sem inflar resolução de sombra ou pixel ratio', () => {
    const { high, ultra } = PRESETS;
    expect(ultra.shadowMapSize).toBe(high.shadowMapSize);
    expect(ultra.pixelRatio).toBe(high.pixelRatio);
    expect(ultra.shadowDistance).toBeGreaterThan(high.shadowDistance);
    expect(ultra.lodDistances[0]).toBeGreaterThan(high.lodDistances[0]);
    expect(ultra.pedestrians).toBeGreaterThan(high.pedestrians);
    expect(ultra.msaaSamples).toBeGreaterThan(0);
    expect(ultra.anisotropy).toBeGreaterThan(high.anisotropy);
  });
  it('ajuste mobile reduz NPCs, trânsito, sombras e distância de desenho', () => {
    const m = mobileAdjust(PRESETS.ultra);
    expect(m.pedestrians).toBeLessThanOrEqual(12);
    // (sem trânsito NPC desde a rodada 7: não há mais população de veículos por preset)
    expect(m.shadowMapSize).toBeLessThanOrEqual(1024);
    expect(m.lodDistances[2]).toBeLessThanOrEqual(1400);
    expect(m.ambientOcclusion).toBe(false);
  });
  it('distâncias de LOD crescentes e dentro do far da câmera', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.lodDistances[0]).toBeLessThan(p.lodDistances[1]);
      expect(p.lodDistances[1]).toBeLessThan(p.lodDistances[2]);
      expect(p.fogFar).toBeLessThanOrEqual(p.cameraFar);
    }
  });
});
