import { describe, it, expect } from 'vitest';
import { PRESETS } from '../src/core/settings';

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
  it('distâncias de LOD crescentes e dentro do far da câmera', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.lodDistances[0]).toBeLessThan(p.lodDistances[1]);
      expect(p.lodDistances[1]).toBeLessThan(p.lodDistances[2]);
      expect(p.fogFar).toBeLessThanOrEqual(p.cameraFar);
    }
  });
});
