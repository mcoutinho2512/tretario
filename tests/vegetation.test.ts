import { describe, expect, it } from 'vitest';
import { generateVegetation } from '../src/world/vegetationGen';
import { SPECIES_WEIGHTS, speciesAt } from '../src/world/vegetation';

const tris = (g: { index: { count: number } | null }) => (g.index?.count ?? 0) / 3;

describe('vegetação', () => {
  it('gera as variantes de forma determinística e dentro do orçamento de triângulos', async () => {
    const a = await generateVegetation();
    const b = await generateVegetation();
    expect(a.map((v) => v.name)).toContain('oiti_0');
    expect(a.map((v) => v.species)).toEqual(expect.arrayContaining(['oiti', 'amendoeira', 'cassia', 'ficus', 'munguba', 'ipe', 'palmeira']));
    for (let i = 0; i < a.length; i++) {
      const [l0, l1] = a[i].lods;
      const near = tris(l0.bark) + tris(l0.leaves), mid = tris(l1.bark) + tris(l1.leaves);
      expect(near, a[i].name).toBeLessThan(9000);
      expect(mid, a[i].name).toBeLessThan(2500);
      expect(mid).toBeLessThan(near * 0.45);
      expect(l0.leaves.attributes.position.count).toBe(b[i].lods[0].leaves.attributes.position.count);
      // a copa podada deixa passagem livre sob a árvore (pedestres/ônibus)
      const box = l0.leaves.boundingBox!;
      expect(box.max.y, a[i].name).toBeLessThanOrEqual(a[i].height + 0.01);
    }
  }, 30000);

  it('distribui espécies por posição com predominância de oiti', () => {
    expect(SPECIES_WEIGHTS.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 5);
    const count = new Map<string, number>();
    for (let x = -1000; x < 1000; x += 7.3) for (let z = -300; z < 300; z += 9.1) {
      const s = speciesAt(x, z);
      count.set(s, (count.get(s) ?? 0) + 1);
    }
    const sorted = [...count.entries()].sort((p, q) => q[1] - p[1]);
    expect(sorted[0][0]).toBe('oiti');
    expect(speciesAt(12.5, -40)).toBe(speciesAt(12.5, -40));
  });
});
