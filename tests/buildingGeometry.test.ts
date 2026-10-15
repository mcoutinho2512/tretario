import { describe, it, expect } from 'vitest';
import { buildBuildingsGeometry } from '../src/world/builders/buildings';
import { FacadeStyle, type BuildingRec, type XZ } from '../src/world/types';

function rec(outer: XZ[]): BuildingRec {
  return { id: 1, poly: { outer }, height: 10, minHeight: 0, levels: 3, heightSource: 'osm:height', cls: 'C', style: FacadeStyle.ClassicPunched, tint: 0.5, seed: 0.5 };
}

describe('geometria de edifícios', () => {
  for (const [name, ring] of [
    ['anti-horário', [[0, 0], [10, 0], [10, 10], [0, 10]]],
    ['horário', [[0, 0], [0, 10], [10, 10], [10, 0]]],
  ] as [string, XZ[]][]) {
    it(`paredes com normais e winding para FORA (${name})`, () => {
      const g = buildBuildingsGeometry([rec(ring)], { roofDetails: false })!;
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), idx = g.getIndex()!;
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
        const e1 = [pos.getX(b) - ax, pos.getY(b) - ay, pos.getZ(b) - az];
        const e2 = [pos.getX(c) - ax, pos.getY(c) - ay, pos.getZ(c) - az];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        // winding (face frontal) concorda com a normal do vértice
        expect(n[0] * nor.getX(a) + n[1] * nor.getY(a) + n[2] * nor.getZ(a)).toBeGreaterThan(0);
        // paredes: normal aponta para longe do centro (5,5)
        if (Math.abs(nor.getY(a)) < 0.5) {
          const cx = (ax + pos.getX(b) + pos.getX(c)) / 3 - 5, cz = (az + pos.getZ(b) + pos.getZ(c)) / 3 - 5;
          expect(cx * nor.getX(a) + cz * nor.getZ(a)).toBeGreaterThan(0);
        } else {
          expect(nor.getY(a)).toBeGreaterThan(0); // cobertura para cima
        }
      }
    });
  }
});
