/**
 * Pele coberta pela roupa: some só onde a roupa está realmente por cima (ou atravessada), nunca perto das bordas
 * da roupa nem onde ela não cobre — "roupa rasgada" sem abrir buracos.
 */
import { describe, it, expect } from 'vitest';
import { hideCoveredSkin, type ClothInput } from '../src/characters/human/hideCovered';

/** grade plana em z (normal +z), de x0..x1 / y0..y1 com n×n quadrados */
function plane(x0: number, x1: number, y0: number, y1: number, z: number, n: number) {
  const pos: number[] = [], normal: number[] = [], index: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    pos.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n, z);
    normal.push(0, 0, 1);
  }
  const at = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) index.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return { pos, normal, index };
}
/** centro de cada triângulo que SOBROU */
const kept = (pos: number[], index: number[]) => {
  const out: [number, number][] = [];
  for (let t = 0; t < index.length; t += 3) {
    const c = [0, 1].map((k) => (pos[index[t] * 3 + k] + pos[index[t + 1] * 3 + k] + pos[index[t + 2] * 3 + k]) / 3);
    out.push([c[0], c[1]]);
  }
  return out;
};

describe('pele coberta pela roupa', () => {
  const skin = plane(-0.5, 0.5, -0.5, 0.5, 0, 50); // 2 cm por quadrado
  it('esconde a pele sob a roupa e mantém a de fora e a junto das bordas', () => {
    const shirt: ClothInput = plane(-0.2, 0.2, -0.2, 0.2, 0.01, 20); // 1 cm por fora
    const r = hideCoveredSkin(skin.pos, skin.normal, skin.index, [shirt]);
    expect(r.hidden).toBeGreaterThan(0);
    const k = kept(skin.pos, r.index);
    // nada sobra no miolo coberto (longe das bordas da roupa)
    expect(k.some(([x, y]) => Math.abs(x) < 0.12 && Math.abs(y) < 0.12)).toBe(false);
    // tudo fora da roupa continua, e a faixa junto à borda (margem) também
    expect(k.some(([x, y]) => Math.abs(x) > 0.3 || Math.abs(y) > 0.3)).toBe(true);
    expect(k.some(([x, y]) => Math.abs(x) > 0.18 && Math.abs(x) < 0.21 && Math.abs(y) < 0.1)).toBe(true);
  });
  it('pele que ATRAVESSA o tecido (roupa por trás) também some', () => {
    const shirt: ClothInput = plane(-0.2, 0.2, -0.2, 0.2, -0.015, 20);
    expect(hideCoveredSkin(skin.pos, skin.normal, skin.index, [shirt]).hidden).toBeGreaterThan(0);
  });
  it('roupa longe demais (folgada além do alcance) não esconde nada', () => {
    const shirt: ClothInput = plane(-0.2, 0.2, -0.2, 0.2, 0.08, 20);
    expect(hideCoveredSkin(skin.pos, skin.normal, skin.index, [shirt]).hidden).toBe(0);
  });
  it('roupa ao lado (abertura de gola/decote) não esconde a pele exposta', () => {
    // faixa de roupa só à direita (x > 0.1): a pele em x < 0.05 fica
    const shirt: ClothInput = plane(0.1, 0.4, -0.2, 0.2, 0.01, 15);
    const r = hideCoveredSkin(skin.pos, skin.normal, skin.index, [shirt]);
    expect(r.hidden).toBeGreaterThan(0); // sob a faixa, some
    const exposed = (idx: number[]) => kept(skin.pos, idx).filter(([x, y]) => x < 0.05 && Math.abs(y) < 0.2).length;
    expect(exposed(r.index)).toBe(exposed(skin.index)); // na abertura, nada some
  });
  it('sem roupa, nada muda', () => {
    expect(hideCoveredSkin(skin.pos, skin.normal, skin.index, []).index).toEqual(skin.index);
  });
});
