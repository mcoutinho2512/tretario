/**
 * Centro Cultural Banco do Brasil (Rua Primeiro de Março, 66 — edifício eclético de 1906,
 * projeto de Francisco Joaquim Bethencourt da Silva; sede do Banco do Brasil até os anos 1980).
 *
 * Referências (medidas e confiança em docs/LANDMARKS.md):
 *  - footprint OSM (way 30775640): quadrilátero ~71 × 44 m; fachada principal a OESTE (Rua 1º de Março),
 *    fachada sul voltada para a Praça Pio X / chafariz da Candelária, leste para a R. Visconde de Itaboraí;
 *  - fotos Wikimedia Commons (Marcus Guimarães 2007 CC BY, Mwaldeck 2017 domínio público) e a maquete
 *    exposta no próprio CCBB (Al Lemos 2007, domínio público):
 *    embasamento de 2 níveis em cantaria cinza (térreo alto + mezanino com óculos), "piano nobile" de
 *    2 pavimentos com janelas altas e balcões, 5º pavimento, cornija branca, ático com janelas pequenas;
 *    pavilhões de canto levemente salientes; entrada central em granito escuro com 3 arcos e 2 óculos;
 *    claraboia da rotunda no centro da cobertura.
 *  - altura ~31 m (estimativa por contagem de pavimentos; OSM sem altura).
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { ArchBuilder, updateDetailLod, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';

export const CCBB_PARAMS = {
  height: 31,
  baseTop: 9.6, // térreo + mezanino em cantaria
  nobileTop: 19.4, // janelas altas de 2 pavimentos
  fifthTop: 24.4,
  atticTop: 29.8,
  bay: 4.3,
  pavilion: 9.5, // largura dos pavilhões de canto (salientes 0,6 m)
  entranceW: 24, // frontispício central em granito escuro (fachada oeste)
};

const STONE = 0x948b7f; // cantaria cinza do embasamento
const WALL = 0xdcc4a2; // reboco bege-rosado
const WHITE = 0xf0ebe0; // cornijas e molduras
const DARK_GRANITE = 0x2f2c2a;
const GLASS = 0x2a3036;

export function buildCCBB(b: BuildingRec, archMats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const P = CCBB_PARAMS;
  const ring = b.poly.outer;
  const group = new THREE.Group();
  group.name = 'LANDMARK_CCBB';
  const ab = new ArchBuilder();
  const H = P.height;

  // massa (cobertura com leve platibanda)
  ab.prism(ring, 0, P.baseTop, STONE, 'granite');
  ab.prism(ring, P.baseTop, P.atticTop, WALL, 'stone');
  ab.prism(ring, P.atticTop, H - 0.6, 0xc9b392, 'stone');

  // fachada principal = aresta cuja normal externa aponta mais para oeste (Rua 1º de Março)
  let mainIdx = -1, best = -Infinity;
  ArchBuilder.edgeFrames(ring, 10, (m, _len, i) => {
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    if (-n.x > best) { best = -n.x; mainIdx = i; }
  });

  ArchBuilder.edgeFrames(ring, 10, (m, len, i) => ab.withFrame(m, () => {
    const main = i === mainIdx;
    // pavilhões de canto salientes
    const pv = Math.min(P.pavilion, len / 4);
    for (const x of [pv / 2, len - pv / 2]) {
      ab.box(pv, P.atticTop - 0.2, 0.6, x, 0, 0.3, WALL, 'stone');
      ab.box(pv, P.baseTop, 0.75, x, 0, 0.37, STONE, 'granite');
      for (let y = 0.9; y < P.baseTop - 0.5; y += 0.9) ab.box(pv + 0.04, 0.12, 0.79, x, y, 0.37, 0x7f776c, 'granite'); // juntas da rusticação
    }
    const segs: [number, number][] = [[0, pv], [pv, len - pv], [len - pv, len]];
    for (const [x0, x1] of segs) {
      const z = x0 === 0 || x1 === len ? 0.6 : 0;
      ab.withFrame(new THREE.Matrix4().makeTranslation(0, 0, z), () => {
        const isEntrance = main && x0 === pv;
        // embasamento: térreo alto + mezanino (óculos)
        if (!isEntrance) {
          ab.facadeGrid({ x0, x1, y0: 0.5, floors: 1, floorH: 6.0, bay: P.bay, winW: 1.9, winH: 4.1, sill: 0.6, frameD: 0.45, pierW: 0.5, wall: STONE, wallMat: 'granite', glass: 0x262b2f, mullions: true });
          const nb = Math.max(1, Math.round((x1 - x0) / P.bay));
          for (let k = 0; k < nb; k++) {
            const x = x0 + ((k + 0.5) * (x1 - x0)) / nb;
            const ring2 = new THREE.TorusGeometry(0.75, 0.16, 8, 20).translate(x, 7.9, 0.5);
            ab.add(ring2, WHITE, 'stone');
            ab.add(new THREE.CircleGeometry(0.72, 20).translate(x, 7.9, 0.42), GLASS, 'glass');
          }
          ab.box(x1 - x0, 0.6, 0.9, (x0 + x1) / 2, P.baseTop - 0.6, 0.45, WHITE, 'stone');
        }
        // piano nobile: janelas altas com molduras e balcões
        ab.facadeGrid({ x0, x1, y0: P.baseTop, floors: 1, floorH: P.nobileTop - P.baseTop, bay: P.bay, winW: 1.9, winH: 6.6, sill: 1.2, frameD: 0.35, pierW: 0.7, pierD: 0.06, wall: WALL, wallMat: 'stone', glass: GLASS, mullions: true });
        const nb = Math.max(1, Math.round((x1 - x0) / P.bay));
        for (let k = 0; k < nb; k++) {
          const x = x0 + ((k + 0.5) * (x1 - x0)) / nb;
          ab.box(2.5, 0.3, 0.3, x, P.baseTop + 1.2 + 6.6, 0.5, WHITE, 'stone'); // verga
          for (const s of [-1, 1]) ab.box(0.22, 6.6, 0.12, x + s * 1.06, P.baseTop + 1.2, 0.42, WHITE, 'stone'); // moldura
          ab.box(2.6, 0.18, 0.9, x, P.baseTop + 1.1, 0.75, WHITE, 'stone'); // balcão
          ab.detail(() => ab.balustrade(x - 1.2, 1.05, x + 1.2, 1.05, P.baseTop + 1.25, WHITE, 0.3));
        }
        ab.box(x1 - x0, 0.9, 1.0, (x0 + x1) / 2, P.nobileTop - 0.2, 0.5, WHITE, 'stone'); // cornija intermediária
        // 5º pavimento
        ab.facadeGrid({ x0, x1, y0: P.nobileTop + 0.7, floors: 1, floorH: P.fifthTop - P.nobileTop - 0.7, bay: P.bay, winW: 1.6, winH: 2.4, sill: 1.0, frameD: 0.3, pierW: 0.7, wall: WALL, wallMat: 'stone', glass: GLASS, mullions: true });
        ab.box(x1 - x0, 0.8, 1.3, (x0 + x1) / 2, P.fifthTop, 0.6, WHITE, 'stone'); // cornija principal (branca)
        // ático recuado com janelas pequenas
        ab.withFrame(new THREE.Matrix4().makeTranslation(0, 0, -0.5), () => {
          ab.facadeGrid({ x0, x1, y0: P.fifthTop + 0.8, floors: 1, floorH: P.atticTop - P.fifthTop - 0.8, bay: P.bay, winW: 1.1, winH: 1.6, sill: 1.5, frameD: 0.25, pierW: 0.6, wall: 0xd2b996, wallMat: 'stone', glass: GLASS });
        });
        ab.box(x1 - x0, 0.6, 0.9, (x0 + x1) / 2, P.atticTop, 0.2, WHITE, 'stone');
        if (isEntrance) {
          // frontispício em granito escuro: 3 arcos + 2 óculos (maquete do CCBB)
          const w = Math.min(P.entranceW, x1 - x0);
          const cx = (x0 + x1) / 2;
          ab.box(w, P.baseTop, 0.8, cx, 0, 0.4, DARK_GRANITE, 'granite');
          for (const k of [-1, 0, 1]) {
            ab.archFrame(3.6, 6.8, 0.45, cx + k * 5.0, 0.3, 0.82, 0, 0x3d3935, 0.25, 'granite');
            ab.archOpening(3.6, 6.8, cx + k * 5.0, 0.3, 0.8, 0, 0x4a3a26, 0.06, 'metal');
          }
          for (const s of [-1, 1]) {
            ab.add(new THREE.TorusGeometry(0.9, 0.2, 8, 20).translate(cx + s * 9.5, 5.5, 0.85), 0x3d3935, 'granite');
            ab.add(new THREE.CircleGeometry(0.88, 20).translate(cx + s * 9.5, 5.5, 0.82), 0xd9cfae, 'dark');
          }
          ab.box(w + 0.6, 0.7, 1.2, cx, P.baseTop - 0.4, 0.6, 0x3d3935, 'granite');
          // degraus
          for (let i = 0; i < 3; i++) ab.box(w - 4, 0.17, 0.4, cx, 0.17 * (2 - i), 1.0 + i * 0.4, 0x8d8a84, 'granite');
        }
      });
    }
    // cornija de coroamento + platibanda
    ab.box(len + 1.2, 0.5, 1.2, len / 2, H - 1.2, 0.3, WHITE, 'stone');
    ab.box(len + 0.4, 0.7, 0.5, len / 2, H - 0.7, 0.05, 0xc9b392, 'stone');
  }));

  // claraboia da rotunda (centro da cobertura)
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  cx /= ring.length; cz /= ring.length;
  ab.cyl(5.2, 5.6, 1.4, cx, H - 0.6, cz, 0xc9b392, 8, 'stone');
  ab.lathe([[5.0, 0], [4.6, 1.2], [3.2, 2.4], [1.2, 3.0], [0, 3.1]], cx, H + 0.8, cz, 0x55626a, 8, 'glass');
  ab.detail(() => {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const pts = [[5.0, 0], [4.6, 1.2], [3.2, 2.4], [1.2, 3.0]].map(([r, y]) => new THREE.Vector3(cx + Math.cos(a) * (r + 0.05), H + 0.8 + y, cz + Math.sin(a) * (r + 0.05)));
      ab.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.08, 4, false), 0x3a3d40, 'metal');
    }
  });

  group.add(ab.build(archMats, 'ccbb_arch'));
  const c = new THREE.Vector3(cx, 15, cz);
  const arch = group.getObjectByName('ccbb_arch')!;
  return { group, colliders: [] as { poly: XZ[]; height: number }[], update(_t: Date, cam: THREE.Vector3) { if (cam) updateDetailLod(arch, c, cam, 380); } };
}
