/**
 * LANDMARK_CANDELARIA — Igreja de Nossa Senhora da Candelária (Praça Pio X).
 *
 * Referências (medidas, fontes e confiança em docs/LANDMARKS.md):
 *  - footprint real do OSM (way 30839484): ~72 × 37 m, braços do transepto salientes ~3 m;
 *    fachada principal na extremidade LESTE (entrada principal no OSM; voltada à Rua 1º de Março);
 *    fundos (capela-mor) voltados para a Pres. Vargas;
 *  - cúpula em lioz: altura externa 62,3 m, diâmetro externo 16,8 m; 8 estátuas no tambor;
 *  - fotos Wikimedia Commons (Halley Pacheco de Oliveira 2012, Rodrigojordy 2012, Andrevruas 2011):
 *    fachada em duas ordens de pilastras pareadas de cantaria cinza-acastanhada sobre panos caiados;
 *    7 tramos (torre, óculo, janela, central, janela, óculo, torre); portal central em arco (portas de
 *    bronze), portas laterais com frontões curvos; frontão triangular com brasão e pináculos;
 *    torres com relógio, sineira em arco, balaustrada com obeliscos, coruchéu bulboso branco com
 *    nervuras, lanterna, esfera e cata-vento.
 * Alturas das torres/ordens: ESTIMATIVAS por proporção nas fotos frontais (largura da fachada = OSM).
 */
import * as THREE from 'three';
import type { LandmarkRec } from '../types';
import { ArchBuilder, updateDetailLod, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';
import { CANDELARIA_PARAMS, candelariaColliders, candelariaFrame } from './colliders';
export { CANDELARIA_PARAMS } from './colliders';

const WALL = 0xebe5d8; // panos caiados
const CANT = 0x8e8376; // cantaria (granito cinza-acastanhado)
const CANT_DARK = 0x766c61;
const LIOZ = 0xc4beb2; // cúpula em lioz
const BULB = 0xe4e1da; // coruchéus
const DARK = 0x24221f;
const BRONZE = 0x4a3b28;
const GLASS = 0x3a4045;

export function buildCandelaria(lm: LandmarkRec, archMats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const P = CANDELARIA_PARAMS;
  const { ang } = candelariaFrame(lm);
  const L = lm.length;
  const half = L / 2;
  const ab = new ArchBuilder();
  // frame local: x = s (eixo, + = fachada/leste), z = lateral, y = cima
  ab.frame.makeRotationY(-ang).setPosition(lm.center[0], 0, lm.center[1]);

  const y0 = P.plinth;
  const sF0 = half - P.facadeDepth; // início do bloco da fachada
  const sF1 = half; // plano da fachada
  const sA0 = -half; // fundos
  const T = P.transept, N = P.nave, A = P.apse, TW = P.tower, D = P.dome;
  const FW = P.facadeHalfW;

  // ---------- adro / embasamento + escadaria leste ----------
  ab.box(L + 3, y0, T.halfW * 2 + 3, 0, 0, 0, 0xb3ada1, 'granite');
  for (let i = 0; i < 5; i++) {
    const h = y0 - i * (y0 / 5);
    ab.box(0.42, h, FW * 2 + 2 - i * 0.2, sF1 + 1.5 + 0.21 + i * 0.42, 0, 0, 0xaaa395, 'granite');
  }

  // ---------- massas ----------
  const vol = (s0: number, s1: number, hw: number, h: number, c = WALL) => ab.box(s1 - s0, h, hw * 2, (s0 + s1) / 2, y0, 0, c, 'stone');
  vol(sA0, T.s0, A.halfW, A.h); // sacristias laterais (fundos)
  vol(sA0 + 1, T.s0, A.choirHalfW, A.choirH); // capela-mor
  vol(T.s0, T.s1, T.halfW, T.h); // transepto
  vol(T.s1, sF0, N.halfW, N.aisleH); // naves laterais
  vol(T.s1, sF0, N.centralHalfW, N.centralH); // nave central
  vol(sF0, sF1, FW, P.facadeCornice); // bloco da fachada
  // telhados de duas águas (nave central, capela-mor, transepto) em telha cinza
  const roof = (s0: number, s1: number, hw: number, y: number, h: number) => {
    const shape = new THREE.Shape([new THREE.Vector2(-hw, 0), new THREE.Vector2(hw, 0), new THREE.Vector2(0, h)]);
    const len = s1 - s0;
    const ex = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    ex.translate(0, 0, -len / 2);
    ex.rotateY(Math.PI / 2);
    ex.translate((s0 + s1) / 2, y0 + y, 0);
    ab.add(ex, 0x6f6c68, 'granite', 0.02);
  };
  roof(T.s1, sF0, N.centralHalfW, N.centralH, 3.2);
  roof(sA0 + 1, T.s0, A.choirHalfW, A.choirH, 2.8);
  // transepto: telhado ao longo de z
  {
    const shape = new THREE.Shape([new THREE.Vector2(-(T.s1 - T.s0) / 2, 0), new THREE.Vector2((T.s1 - T.s0) / 2, 0), new THREE.Vector2(0, 3.2)]);
    const ex = new THREE.ExtrudeGeometry(shape, { depth: T.halfW * 2, bevelEnabled: false });
    ex.translate((T.s0 + T.s1) / 2, y0 + T.h, -T.halfW);
    ab.add(ex, 0x6f6c68, 'granite', 0.02);
  }

  // cornijas de cantaria ao redor das massas
  const cornice = (s0: number, s1: number, hw: number, y: number, t = 0.7) => ab.box(s1 - s0 + t * 2, t, hw * 2 + t * 2, (s0 + s1) / 2, y0 + y - t, 0, CANT, 'granite');
  cornice(sA0, T.s0, A.halfW, A.h);
  cornice(sA0 + 1, T.s0, A.choirHalfW, A.choirH);
  cornice(T.s0, T.s1, T.halfW, T.h);
  cornice(T.s1, sF0, N.halfW, N.aisleH);
  cornice(T.s1, sF0, N.centralHalfW, N.centralH);
  // embasamento de cantaria em todo o perímetro
  ab.box(L - 0.2, 1.4, A.halfW * 2 + 0.4, 0, y0, 0, CANT, 'granite');
  ab.box(T.s1 - T.s0 + 0.4, 1.4, T.halfW * 2 + 0.4, (T.s0 + T.s1) / 2, y0, 0, CANT, 'granite');

  // balaustradas sobre as coberturas planas
  for (const sgn of [-1, 1]) {
    ab.balustrade(T.s1, sgn * N.halfW, sF0, sgn * N.halfW, y0 + N.aisleH, WALL, 0.45, 'stone');
    ab.balustrade(sA0, sgn * A.halfW, T.s0, sgn * A.halfW, y0 + A.h, WALL, 0.45, 'stone');
  }
  ab.balustrade(sA0, -A.halfW, sA0, A.halfW, y0 + A.h, WALL, 0.45, 'stone');

  // pilastras de cantaria: ritmo nas laterais e cantos
  const pil = (s: number, z: number, h: number, w = 1.1, yb = 0) => ab.box(w, h, w, s, y0 + yb, z, CANT, 'granite');
  for (const sgn of [-1, 1]) {
    for (let s = T.s1 + 2.5; s < sF0 - 1; s += 5) pil(s, sgn * N.halfW, N.aisleH - 0.6, 0.9);
    for (let s = sA0 + 2.5; s < T.s0 - 1; s += 5) pil(s, sgn * A.halfW, A.h - 0.6, 0.9);
    for (const s of [T.s0, T.s1]) pil(s, sgn * T.halfW, T.h - 0.6, 1.3);
    pil(sA0, sgn * A.halfW, A.h - 0.6, 1.3);
    for (let s = T.s1 + 2.5; s < sF0 - 1; s += 5) pil(s, sgn * N.centralHalfW, N.centralH - N.aisleH - 0.6, 0.7, N.aisleH);
  }

  // janelas em arco nas laterais (naves, transepto, fundos)
  const sideWindows = (s0: number, s1: number, z: number, y: number, w: number, h: number, step: number, sgn: number) => {
    for (let s = s0 + step / 2; s < s1 - 1; s += step) {
      ab.archFrame(w, h, 0.35, s, y, z + sgn * 0.02, sgn > 0 ? 0 : Math.PI, CANT, 0.18, 'granite');
      ab.archOpening(w, h, s, y, z + sgn * 0.06, sgn > 0 ? 0 : Math.PI, GLASS, 0.06, 'glass');
    }
  };
  for (const sgn of [-1, 1]) {
    sideWindows(T.s1, sF0, sgn * N.halfW, y0 + 6, 1.8, 4.4, 5, sgn);
    sideWindows(sA0, T.s0, sgn * A.halfW, y0 + 6, 1.8, 4.4, 5, sgn);
    ab.archFrame(3.4, 7.2, 0.5, (T.s0 + T.s1) / 2, y0 + 10, sgn * T.halfW + sgn * 0.02, sgn > 0 ? 0 : Math.PI, CANT, 0.22, 'granite');
    ab.archOpening(3.4, 7.2, (T.s0 + T.s1) / 2, y0 + 10, sgn * T.halfW + sgn * 0.08, sgn > 0 ? 0 : Math.PI, GLASS, 0.06, 'glass');
    sideWindows(T.s1, sF0, sgn * N.centralHalfW, y0 + N.aisleH + 1.6, 1.5, 3.4, 5, sgn);
  }
  for (const z of [-5, 0, 5]) {
    ab.archFrame(1.9, 5, 0.35, sA0 - 0.02, y0 + 8, z, -Math.PI / 2, CANT, 0.18, 'granite');
    ab.archOpening(1.9, 5, sA0 - 0.06, y0 + 8, z, -Math.PI / 2, GLASS, 0.06, 'glass');
  }

  // ---------- fachada leste (frame da fachada: x ao longo = −z, z para fora = +s) ----------
  const facadeM = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).setPosition(sF1, y0, 0);
  // tramos: [x0, x1] ao longo da fachada
  const edges = [-FW, -9.2, -6.0, -2.6, 2.6, 6.0, 9.2, FW];
  const O1 = 10.4; // topo da 1ª ordem (entablamento 10.4–11.4)
  const O2 = P.facadeCornice - 1.2; // topo da 2ª ordem
  ab.withFrame(facadeM, () => {
    // pilastras pareadas (duas ordens) + entablamentos
    const pilaster = (x: number, ya: number, yb: number, w = 0.8, d = 0.55) => {
      ab.box(w, yb - ya, d, x, ya, d / 2, CANT, 'granite');
      ab.box(w + 0.3, 0.45, d + 0.15, x, yb - 0.45, (d + 0.15) / 2, CANT_DARK, 'granite'); // capitel
      ab.box(w + 0.25, 0.5, d + 0.12, x, ya, (d + 0.12) / 2, CANT_DARK, 'granite'); // base
    };
    for (const x of edges) {
      const corner = Math.abs(x) > FW - 0.1;
      const xs = corner ? [x - Math.sign(x) * 0.7] : Math.abs(x) === 6 ? [x] : [x - 0.55, x + 0.55];
      for (const xx of xs) {
        pilaster(xx, 1.2, O1, corner ? 1.4 : 0.8);
        pilaster(xx, O1 + 1.0, O2, corner ? 1.4 : 0.8);
      }
    }
    ab.box(FW * 2 + 0.6, 1.0, 0.8, 0, O1, 0.4, CANT, 'granite'); // entablamento 1
    ab.box(FW * 2 + 0.8, 0.35, 1.0, 0, O1 + 0.65, 0.5, CANT_DARK, 'granite');
    ab.box(FW * 2 + 1.0, 1.2, 1.1, 0, O2, 0.55, CANT, 'granite'); // cornija principal
    ab.box(FW * 2 + 1.4, 0.4, 1.4, 0, O2 + 1.2, 0.7, CANT_DARK, 'granite');
    ab.box(FW * 2, 1.2, 0.3, 0, 0, 0.15, CANT, 'granite'); // soco

    // aberturas
    const frameArch = (x: number, y: number, w: number, h: number, fill: number, mat: ArchMat, t = 0.45) => {
      ab.archFrame(w, h, t, x, y, 0.02, 0, CANT, 0.32, 'granite');
      ab.archOpening(w, h, x, y, 0.03, 0, fill, 0.06, mat);
    };
    const rectOpen = (x: number, y: number, w: number, h: number, fill: number, mat: ArchMat) => {
      ab.box(w + 0.9, h + 0.45, 0.3, x, y - 0.05, 0.15, CANT, 'granite');
      ab.box(w, h, 0.34, x, y, 0.17, fill, mat);
    };
    const segPed = (x: number, y: number, w: number) => ab.segmentalPediment(w, w * 0.22, 0.35, 0.5, x, y, 0.35, 0, CANT_DARK, 'granite');
    // 1ª ordem
    frameArch(0, 1.2, 4.0, 7.8, BRONZE, 'metal', 0.6); // portal central (portas de bronze)
    ab.box(1.8, 1.2, 0.5, 0, 9.0, 0.3, CANT_DARK, 'granite'); // cartela sobre o portal
    for (const sgn of [-1, 1]) {
      rectOpen(sgn * 4.3, 1.2, 2.1, 4.8, BRONZE, 'metal'); // portas laterais
      segPed(sgn * 4.3, 6.6, 3.2);
      rectOpen(sgn * 7.6, 3.2, 1.3, 2.2, GLASS, 'glass'); // nichos/janelas pequenas
      ab.box(1.9, 1.6, 0.25, sgn * 7.6, 6.4, 0.12, CANT, 'granite'); // painel
      frameArch(sgn * 13.6, 1.2, 2.6, 6.2, BRONZE, 'metal', 0.5); // portas das torres
      ab.add(new THREE.TorusGeometry(0.6, 0.14, 8, 20).translate(sgn * 13.6, 8.6, 0.3), CANT, 'granite');
      ab.add(new THREE.CircleGeometry(0.58, 20).translate(sgn * 13.6, 8.6, 0.2), GLASS, 'glass');
    }
    // 2ª ordem
    frameArch(0, 12.6, 2.6, 5.4, GLASS, 'glass');
    segPed(0, 18.6, 3.8);
    for (const sgn of [-1, 1]) {
      frameArch(sgn * 4.3, 12.8, 2.0, 4.6, GLASS, 'glass', 0.4);
      segPed(sgn * 4.3, 17.9, 3.0);
      ab.add(new THREE.TorusGeometry(0.85, 0.22, 8, 24).translate(sgn * 7.6, 15.2, 0.25), CANT, 'granite'); // óculos
      ab.add(new THREE.CircleGeometry(0.82, 24).translate(sgn * 7.6, 15.2, 0.12), GLASS, 'glass');
      frameArch(sgn * 13.6, 12.8, 2.2, 4.6, GLASS, 'glass', 0.4);
      segPed(sgn * 13.6, 17.9, 3.2);
    }
    // painéis emoldurados (detalhe)
    ab.detail(() => {
      for (const x of [-7.6, -4.3, 0, 4.3, 7.6, -13.6, 13.6]) {
        const w = Math.abs(x) === 7.6 ? 1.8 : 2.4;
        for (const y of [O1 - 2.2]) if (Math.abs(x) !== 0 && Math.abs(x) !== 4.3) ab.box(w, 1.2, 0.12, x, y, 0.06, CANT, 'granite');
        ab.box(w, 1.3, 0.12, x, O2 - 1.6, 0.06, CANT, 'granite');
      }
    });

    // frontispício + frontão com brasão, cruz e pináculos
    const fw = 9.2;
    ab.box(fw * 2, P.frontispieceTop - P.facadeCornice, 1.6, 0, P.facadeCornice, -0.6, WALL, 'stone');
    for (const s of [-1, 1]) ab.box(0.9, P.frontispieceTop - P.facadeCornice, 0.5, s * (fw - 0.5), P.facadeCornice, 0.4, CANT, 'granite');
    ab.box(fw * 2 + 0.6, 0.6, 1.4, 0, P.frontispieceTop, -0.1, CANT, 'granite');
    ab.pediment(fw * 2 + 0.4, P.pedimentH, 1.2, 0, P.frontispieceTop + 0.6, -0.2, 0, WALL, 'stone');
    // moldura do frontão (duas águas)
    const slope = Math.atan2(P.pedimentH, fw);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(Math.hypot(fw, P.pedimentH) + 0.6, 0.55, 1.5);
      g.rotateZ(-s * slope);
      g.translate(s * fw / 2, P.frontispieceTop + 0.6 + P.pedimentH / 2 + 0.2, -0.1);
      ab.add(g, CANT, 'granite');
    }
    ab.box(2.4, 2.2, 0.4, 0, P.frontispieceTop + 1.2, 0.5, CANT_DARK, 'granite'); // brasão
    ab.add(new THREE.SphereGeometry(0.6, 10, 8).scale(1, 1.2, 0.4).translate(0, P.frontispieceTop + 2.3, 0.75), CANT_DARK, 'granite');
    const apex = P.frontispieceTop + 0.6 + P.pedimentH;
    ab.box(0.9, 1.4, 0.9, 0, apex, -0.2, CANT, 'granite');
    ab.box(0.22, 3.2, 0.22, 0, apex + 1.4, -0.2, 0x3e4a44, 'metal'); // cruz
    ab.box(1.6, 0.22, 0.22, 0, apex + 3.4, -0.2, 0x3e4a44, 'metal');
    for (const x of [-8.2, -6.6, 6.6, 8.2]) ab.finial(x, P.frontispieceTop + 0.6, 0.2, 3.4, CANT, 'granite');
  });

  // ---------- torres ----------
  for (const sgn of [-1, 1]) {
    const tz = sgn * (FW - TW.half);
    const ts = sF1 - TW.half;
    const w = TW.half * 2;
    const bodyH = TW.body - P.facadeCornice;
    const yb = y0 + P.facadeCornice;
    ab.box(w, bodyH, w, ts, yb, tz, WALL, 'stone');
    // pilastras de canto + cornijas
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) ab.box(1.0, bodyH, 1.0, ts + cx * (w / 2 - 0.3), yb, tz + cz * (w / 2 - 0.3), CANT, 'granite');
    ab.box(w + 1.4, 0.9, w + 1.4, ts, y0 + TW.body - 0.9, tz, CANT, 'granite');
    ab.box(w + 1.8, 0.35, w + 1.8, ts, y0 + TW.body - 0.2, tz, CANT_DARK, 'granite');
    // relógio (frente e laterais) e sineira em arco nas 4 faces
    const faces: [number, number, number][] = [[w / 2 + 0.02, 0, Math.PI / 2], [-w / 2 - 0.02, 0, -Math.PI / 2], [0, w / 2 + 0.02, 0], [0, -w / 2 - 0.02, Math.PI]];
    for (const [dx, dz, ry] of faces) {
      ab.archFrame(2.0, 4.0, 0.4, ts + dx, yb + 4.2, tz + dz, ry, CANT, 0.22, 'granite');
      ab.archOpening(2.0, 4.0, ts + dx * 1.004, yb + 4.2, tz + dz * 1.004, ry, DARK, 0.1, 'dark');
      const n = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      ab.add(new THREE.TorusGeometry(1.15, 0.2, 8, 28).rotateY(ry).translate(ts + dx + n.x * 0.1, yb + 2.0, tz + dz + n.z * 0.1), CANT, 'granite');
      ab.add(new THREE.CircleGeometry(1.12, 28).rotateY(ry).translate(ts + dx + n.x * 0.05, yb + 2.0, tz + dz + n.z * 0.05), 0xf2f0ea, 'stone');
      ab.detail(() => {
        // ponteiros fixos e sino
        ab.add(new THREE.BoxGeometry(0.08, 0.9, 0.04).translate(0, 0.35, 0).rotateZ(0.9).rotateY(ry).translate(ts + dx + n.x * 0.12, yb + 2.0, tz + dz + n.z * 0.12), 0x1e1e1e, 'metal');
        ab.add(new THREE.BoxGeometry(0.1, 0.6, 0.04).translate(0, 0.25, 0).rotateZ(-2.2).rotateY(ry).translate(ts + dx + n.x * 0.12, yb + 2.0, tz + dz + n.z * 0.12), 0x1e1e1e, 'metal');
      });
    }
    ab.detail(() => ab.lathe([[0.05, 0], [0.7, 0.1], [0.65, 0.5], [0.45, 1.1], [0.15, 1.3], [0, 1.35]], ts, yb + 5.0, tz, 0x5a4a30, 12, 'metal'));
    // estágio superior: balaustrada + obeliscos nos cantos + sineira menor
    const bw = w - 2.0;
    const y1 = y0 + TW.body;
    for (const cx of [-1, 1]) {
      ab.balustrade(ts + cx * (w / 2 + 0.3), tz - w / 2 - 0.3, ts + cx * (w / 2 + 0.3), tz + w / 2 + 0.3, y1, CANT, 0.4, 'granite');
      ab.balustrade(ts - w / 2 - 0.3, tz + cx * (w / 2 + 0.3), ts + w / 2 + 0.3, tz + cx * (w / 2 + 0.3), y1, CANT, 0.4, 'granite');
    }
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) ab.finial(ts + cx * (w / 2 + 0.1), y1, tz + cz * (w / 2 + 0.1), 3.6, CANT, 'granite');
    ab.box(bw, TW.belfry - TW.body, bw, ts, y1, tz, WALL, 'stone');
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) ab.box(0.7, TW.belfry - TW.body, 0.7, ts + cx * (bw / 2 - 0.2), y1, tz + cz * (bw / 2 - 0.2), CANT, 'granite');
    for (const [dx, dz, ry] of [[bw / 2 + 0.02, 0, Math.PI / 2], [-bw / 2 - 0.02, 0, -Math.PI / 2], [0, bw / 2 + 0.02, 0], [0, -bw / 2 - 0.02, Math.PI]] as const) {
      ab.archFrame(1.4, 3.2, 0.3, ts + dx, y1 + 1.1, tz + dz, ry, CANT, 0.18, 'granite');
      ab.archOpening(1.4, 3.2, ts + dx * 1.004, y1 + 1.1, tz + dz * 1.004, ry, DARK, 0.08, 'dark');
    }
    ab.box(bw + 1.0, 0.6, bw + 1.0, ts, y0 + TW.belfry - 0.6, tz, CANT, 'granite');
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) ab.finial(ts + cx * (bw / 2 + 0.2), y0 + TW.belfry, tz + cz * (bw / 2 + 0.2), 2.4, CANT, 'granite');
    // coruchéu bulboso (branco, nervuras escuras) + lanterna + esfera + cata-vento
    const bulb: [number, number][] = [[2.6, 0], [2.75, 0.5], [2.55, 1.6], [1.9, 2.9], [1.1, 4.0], [0.6, 4.8], [0.5, 5.6], [0, 5.65]];
    const by = y0 + TW.belfry;
    ab.lathe(bulb, ts, by, tz, BULB, 24, 'stone');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pts = bulb.slice(0, 7).map(([r, y]) => new THREE.Vector3(ts + Math.cos(a) * (r + 0.06), by + y, tz + Math.sin(a) * (r + 0.06)));
      ab.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.09, 4, false), 0x8a8d8f, 'metal');
    }
    ab.cyl(0.5, 0.6, TW.lantern - TW.bulbTop, ts, y0 + TW.bulbTop, tz, BULB, 10, 'stone');
    ab.add(new THREE.SphereGeometry(0.42, 12, 10).translate(ts, y0 + TW.lantern + 0.4, tz), 0x8f7a3c, 'metal');
    ab.box(0.12, TW.cross - TW.lantern - 0.8, 0.12, ts, y0 + TW.lantern + 0.8, tz, 0x3e4a44, 'metal');
    ab.box(0.12, 0.12, 1.1, ts, y0 + TW.cross - 1.2, tz, 0x3e4a44, 'metal');
    ab.box(1.0, 0.35, 0.04, ts + 0.5, y0 + TW.cross - 2.0, tz, 0x3e4a44, 'metal'); // cata-vento
  }

  // ---------- cúpula sobre o cruzeiro ----------
  const ds = D.s;
  ab.cyl(D.drumR + 1.2, D.drumR + 1.2, D.drumBase - (y0 + T.h) + 0.5, ds, y0 + T.h - 0.5, 0, LIOZ, 32, 'stone'); // base do tambor
  ab.cyl(D.drumR, D.drumR + 0.3, D.drumTop - D.drumBase, ds, D.drumBase, 0, LIOZ, 32, 'stone');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const cx = ds + Math.cos(a) * (D.drumR + 0.25), cz = Math.sin(a) * (D.drumR + 0.25);
    if (i % 2 === 0) {
      const g = new THREE.BoxGeometry(0.9, D.drumTop - D.drumBase - 1, 0.6);
      g.rotateY(-a);
      g.translate(cx, D.drumBase + (D.drumTop - D.drumBase - 1) / 2, cz);
      ab.add(g, 0xaea79a, 'stone');
    } else {
      const ry = Math.PI / 2 - a;
      ab.archOpening(1.9, 5.2, ds + Math.cos(a) * (D.drumR + 0.1), D.drumBase + 2.2, Math.sin(a) * (D.drumR + 0.1), ry, GLASS, 0.25, 'glass');
    }
  }
  ab.cyl(D.drumR + 1.0, D.drumR + 1.0, 0.8, ds, D.drumTop - 0.8, 0, 0xa9a293, 32, 'stone');
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
    const r = D.drumR + 0.7;
    ab.balustrade(ds + Math.cos(a0) * r, Math.sin(a0) * r, ds + Math.cos(a1) * r, Math.sin(a1) * r, D.drumTop, LIOZ, 0.5, 'stone');
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ab.statue(ds + Math.cos(a) * (D.drumR + 0.7), D.drumTop + 0.9, Math.sin(a) * (D.drumR + 0.7), 0xd2ccbe, 1.05);
  }
  // casca (perfil levemente alteado) com nervuras
  const shell: [number, number][] = [];
  const Hd = D.domeTop - D.drumTop;
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI / 2;
    shell.push([Math.max(Math.cos(a) * (D.drumR - 0.2), 1.6), Math.sin(a) * Hd]);
  }
  ab.lathe([[D.drumR + 0.2, 0], ...shell], ds, D.drumTop + 0.2, 0, LIOZ, 48, 'stone');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, aa = t * Math.PI / 2;
      const r = Math.max(Math.cos(aa) * (D.drumR - 0.2), 1.6) + 0.12;
      pts.push(new THREE.Vector3(ds + Math.cos(a) * r, D.drumTop + 0.2 + Math.sin(aa) * Hd, Math.sin(a) * r));
    }
    ab.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.24, 5, false), 0x9f988b, 'stone');
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = Math.cos(0.42) * (D.drumR - 0.2) + 0.3;
    ab.add(new THREE.SphereGeometry(0.65, 8, 6).translate(ds + Math.cos(a) * r, D.drumTop + 0.2 + Math.sin(0.42) * Hd, Math.sin(a) * r), DARK, 'dark');
  }
  // lanterna + bola + cruz
  ab.cyl(1.7, 1.9, D.lanternTop - D.domeTop - 1.4, ds, D.domeTop, 0, LIOZ, 16, 'stone');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ab.archOpening(0.7, 2.2, ds + Math.cos(a) * 1.75, D.domeTop + 1.0, Math.sin(a) * 1.75, Math.PI / 2 - a, DARK, 0.1);
  }
  ab.lathe([[2.0, 0], [1.9, 0.5], [1.2, 1.2], [0.5, 1.6], [0, 1.7]], ds, D.lanternTop - 1.4, 0, LIOZ, 16, 'stone');
  ab.add(new THREE.SphereGeometry(0.55, 12, 8).translate(ds, D.lanternTop + 1.0, 0), 0x6f8f6a, 'metal');
  ab.box(0.2, D.crossTop - D.lanternTop - 1.5, 0.2, ds, D.lanternTop + 1.5, 0, 0x4a4844, 'metal');
  ab.box(0.2, 0.2, 1.4, ds, D.crossTop - 1.4, 0, 0x4a4844, 'metal');

  const group = ab.build(archMats, 'LANDMARK_CANDELARIA');
  const c = new THREE.Vector3(lm.center[0], 25, lm.center[1]);
  return { group, colliders: candelariaColliders(lm), update(_t: Date, cam: THREE.Vector3) { if (cam) updateDetailLod(group, c, cam); } };
}
