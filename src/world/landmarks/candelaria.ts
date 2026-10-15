/**
 * LANDMARK_CANDELARIA — Igreja de Nossa Senhora da Candelária (Praça Pio X).
 *
 * Referências usadas (ver docs/MAP_VALIDATION.md):
 *  - footprint real do OSM (way 30839484): ~80 m × 36–42 m, eixo alinhado à Pres. Vargas;
 *  - planta em cruz latina, 3 naves, cúpula sobre o transepto;
 *  - fachada principal na elevação LESTE (voltada à Rua 1º de Março / baía); abside voltada à avenida;
 *  - cúpula em pedra lioz: altura externa ~62,3 m, diâmetro externo ~16,8 m; 8 estátuas no tambor;
 *  - fachada barroca com frontão triangular; molduras em granito escuro sobre paredes caiadas;
 *  - duas torres na fachada com coroamento bulboso.
 * Alturas das torres, naves e escadaria são ESTIMATIVAS proporcionais a fotos — validar.
 */
import * as THREE from 'three';
import type { LandmarkRec, XZ } from '../types';
import { ArchBuilder, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';

const WALL = 0xe4ddcd; // caiado/levemente envelhecido
const GRANITE = 0x7c766c; // cantaria
const LIOZ = 0xc9c2b2; // cúpula de lioz
const DARK = 0x2c2a28; // vãos/portas
const BRONZE = 0x3b3226;

export const CANDELARIA_PARAMS = {
  plinth: 0.9,
  facadeDepth: 12,
  facadeHalfW: 18,
  facadeCornice: 22,
  frontispieceTop: 27,
  pedimentH: 5,
  tower: { half: 4.4, body: 31, belfry: 38, bulbTop: 44, lantern: 47, cross: 50 },
  nave: { halfW: 15, centralHalfW: 7.5, centralH: 24, aisleH: 17 },
  transept: { halfW: 19.5, h: 24, s0: -15, s1: 2 },
  apse: { halfW: 13, h: 21 },
  dome: { s: -6.5, drumR: 8.4, drumBase: 24, drumTop: 35.5, domeTop: 51.5, lanternTop: 57.5, crossTop: 62.3 },
};

export function buildCandelaria(lm: LandmarkRec, archMats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const P = CANDELARIA_PARAMS;
  // eixo longo do OBB; fachada = extremidade LESTE (maior x)
  let ax = Math.cos(lm.axis), az = Math.sin(lm.axis);
  if (ax < 0) { ax = -ax; az = -az; } // +s aponta para leste (fachada)
  const L = lm.length; // ~72 m
  const half = L / 2;
  const ab = new ArchBuilder();
  // frame local: x = s (eixo, + = fachada/leste), z = lateral, y = cima
  const ang = Math.atan2(az, ax);
  ab.frame.makeRotationY(-ang).setPosition(lm.center[0], 0, lm.center[1]);

  const y0 = P.plinth;
  const sF0 = half - P.facadeDepth; // início do bloco da fachada
  const sF1 = half; // plano da fachada
  const sA0 = -half; // fundo da abside

  // ---------- adro / embasamento + escadaria leste ----------
  ab.box(L + 3, y0, P.transept.halfW * 2 + 3, 0, 0, 0, 0xb9b2a4);
  for (let i = 0; i < 5; i++) {
    const h = y0 - i * (y0 / 5);
    ab.box(0.42, h, P.facadeHalfW * 2 + 2 - i * 0.2, sF1 + 1.5 + 0.21 + i * 0.42, 0, 0, 0xb3ac9e);
  }

  // ---------- abside / capela-mor (voltada para a Pres. Vargas) ----------
  ab.box(P.transept.s0 - sA0, P.apse.h, P.apse.halfW * 2, (sA0 + P.transept.s0) / 2, y0, 0, WALL);
  // ---------- transepto ----------
  const T = P.transept;
  ab.box(T.s1 - T.s0, T.h, T.halfW * 2, (T.s0 + T.s1) / 2, y0, 0, WALL);
  // ---------- naves ----------
  const N = P.nave;
  ab.box(sF0 - T.s1, N.centralH, N.centralHalfW * 2, (T.s1 + sF0) / 2, y0, 0, WALL);
  for (const sgn of [-1, 1]) ab.box(sF0 - T.s1, N.aisleH, N.halfW - N.centralHalfW, (T.s1 + sF0) / 2, y0, sgn * (N.centralHalfW + (N.halfW - N.centralHalfW) / 2), WALL);
  // ---------- bloco da fachada ----------
  ab.box(P.facadeDepth, P.facadeCornice, P.facadeHalfW * 2, (sF0 + sF1) / 2, y0, 0, WALL);
  // frontispício central mais alto + frontão
  const fw = (P.facadeHalfW - P.tower.half * 2) ;
  ab.box(3.5, P.frontispieceTop - P.facadeCornice, fw * 2, sF1 - 1.75, y0 + P.facadeCornice, 0, WALL);
  ab.pediment(fw * 2 + 1, P.pedimentH, 1.2, sF1 - 0.5, y0 + P.frontispieceTop + 0.6, 0, Math.PI / 2, WALL);
  // moldura do frontão (granito)
  ab.box(1.6, 0.6, fw * 2 + 1.6, sF1 - 0.4, y0 + P.frontispieceTop, 0, GRANITE);
  ab.cyl(0.25, 0.25, 2.2, sF1 - 0.5, y0 + P.frontispieceTop + P.pedimentH + 0.6, 0, GRANITE, 8);
  ab.box(0.2, 1.4, 0.9, sF1 - 0.5, y0 + P.frontispieceTop + P.pedimentH + 2.2, 0, GRANITE); // cruz
  ab.box(0.2, 0.2, 0.2, sF1 - 0.5, y0 + P.frontispieceTop + P.pedimentH + 2.9, 0, GRANITE);

  // cornijas em granito ao redor dos volumes
  const cornice = (s0: number, s1: number, hw: number, y: number, t = 0.7) => ab.box(s1 - s0 + t * 2, t, hw * 2 + t * 2, (s0 + s1) / 2, y0 + y - t, 0, GRANITE);
  cornice(sA0, T.s0, P.apse.halfW, P.apse.h);
  cornice(T.s0, T.s1, T.halfW, T.h);
  cornice(T.s1, sF0, N.centralHalfW, N.centralH);
  cornice(sF0, sF1, P.facadeHalfW, P.facadeCornice, 0.9);
  // faixa intermediária (entablamento) da fachada
  ab.box(0.5, 0.6, P.facadeHalfW * 2, sF1 + 0.2, y0 + 10.5, 0, GRANITE);

  // balaustradas sobre as coberturas planas (como nas fotos)
  for (const sgn of [-1, 1]) {
    ab.balustrade(T.s1, sgn * N.halfW, sF0, sgn * N.halfW, y0 + N.aisleH, WALL);
    ab.balustrade(sA0, sgn * P.apse.halfW, T.s0, sgn * P.apse.halfW, y0 + P.apse.h, WALL);
    ab.balustrade(T.s0, sgn * T.halfW, T.s1, sgn * T.halfW, y0 + T.h, WALL);
  }
  ab.balustrade(sA0, -P.apse.halfW, sA0, P.apse.halfW, y0 + P.apse.h, WALL);

  // pilastras de granito: cantos e ritmo nas laterais
  const pil = (s: number, z: number, h: number, w = 1.1) => ab.box(w, h, w, s, y0, z, GRANITE);
  for (const sgn of [-1, 1]) {
    for (let s = T.s1 + 4; s < sF0 - 1; s += 5.5) pil(s, sgn * N.halfW, N.aisleH - 0.6, 0.9);
    for (let s = sA0 + 3; s < T.s0 - 1; s += 5.5) pil(s, sgn * P.apse.halfW, P.apse.h - 0.6, 0.9);
    pil(T.s0, sgn * T.halfW, T.h - 0.6);
    pil(T.s1, sgn * T.halfW, T.h - 0.6);
    pil(sF1, sgn * P.facadeHalfW, P.facadeCornice - 0.8, 1.4);
    pil(sF1, sgn * fw, P.facadeCornice - 0.8, 1.2);
    pil(sA0, sgn * P.apse.halfW, P.apse.h - 0.6, 1.2);
  }

  // janelas em arco nas laterais (naves, transepto, abside)
  const sideWindows = (s0: number, s1: number, z: number, y: number, w: number, h: number, step: number, sgn: number) => {
    for (let s = s0 + step / 2; s < s1 - 1; s += step) {
      ab.archFrame(w, h, 0.35, s, y, z + sgn * 0.02, sgn > 0 ? 0 : Math.PI, GRANITE, 0.18);
      ab.archOpening(w, h, s, y, z + sgn * 0.08, sgn > 0 ? 0 : Math.PI, DARK);
    }
  };
  for (const sgn of [-1, 1]) {
    sideWindows(T.s1, sF0, sgn * N.halfW, y0 + 6, 1.8, 4.2, 5.5, sgn);
    sideWindows(sA0, T.s0, sgn * P.apse.halfW, y0 + 9, 1.8, 4.5, 5.5, sgn);
    ab.archFrame(3.2, 7, 0.45, (T.s0 + T.s1) / 2, y0 + 11, sgn * T.halfW + sgn * 0.02, sgn > 0 ? 0 : Math.PI, GRANITE, 0.2);
    ab.archOpening(3.2, 7, (T.s0 + T.s1) / 2, y0 + 11, sgn * T.halfW + sgn * 0.09, sgn > 0 ? 0 : Math.PI, DARK);
    // clerestório da nave central
    sideWindows(T.s1, sF0, sgn * N.centralHalfW, y0 + N.aisleH + 1.8, 1.5, 3.2, 5.5, sgn);
  }
  // janelas da abside (fundo, voltadas para a avenida)
  for (const z of [-6, 0, 6]) {
    ab.archFrame(1.8, 4.8, 0.35, sA0 - 0.02, y0 + 9, z, -Math.PI / 2, GRANITE, 0.18);
    ab.archOpening(1.8, 4.8, sA0 - 0.08, y0 + 9, z, -Math.PI / 2, DARK);
  }

  // ---------- fachada leste: portais e janelas ----------
  const facadeX = sF1 + 0.02;
  // portal central (bronze, Teixeira Lopes) e laterais
  const portals: [number, number, number][] = [[0, 4.2, 8.2], [-7.2, 2.8, 6.2], [7.2, 2.8, 6.2]];
  for (const [z, w, h] of portals) {
    ab.archFrame(w, h, 0.6, facadeX, y0, z, Math.PI / 2, GRANITE, 0.35);
    ab.archOpening(w, h, facadeX + 0.05, y0, z, Math.PI / 2, BRONZE);
  }
  // janelas do 2º nível + óculo
  for (const z of [-7.2, 0, 7.2]) {
    ab.archFrame(2.2, 4.6, 0.4, facadeX, y0 + 12.5, z, Math.PI / 2, GRANITE, 0.3);
    ab.archOpening(2.2, 4.6, facadeX + 0.05, y0 + 12.5, z, Math.PI / 2, DARK);
  }
  {
    const ring = new THREE.TorusGeometry(1.5, 0.35, 8, 28);
    ring.rotateY(Math.PI / 2);
    ring.translate(sF1 - 1.65, y0 + 23.6, 0);
    ab.add(ring, GRANITE);
    const oc = new THREE.CircleGeometry(1.5, 24);
    oc.rotateY(Math.PI / 2);
    oc.translate(sF1 - 1.7 + 0.12, y0 + 23.6, 0);
    ab.add(oc, DARK, 'dark');
  }

  // ---------- torres ----------
  const TW = P.tower;
  for (const sgn of [-1, 1]) {
    const tz = sgn * (P.facadeHalfW - TW.half);
    const ts = sF1 - TW.half - 0.2;
    ab.box(TW.half * 2, TW.body - P.facadeCornice, TW.half * 2, ts, y0 + P.facadeCornice, tz, WALL);
    ab.box(TW.half * 2 + 1.2, 0.8, TW.half * 2 + 1.2, ts, y0 + TW.body - 0.8, tz, GRANITE);
    // campanário com aberturas em arco nas 4 faces
    const bw = TW.half * 2 - 0.6;
    ab.box(bw, TW.belfry - TW.body, bw, ts, y0 + TW.body, tz, WALL);
    for (const [dx, dz, ry] of [[bw / 2 + 0.02, 0, Math.PI / 2], [-bw / 2 - 0.02, 0, -Math.PI / 2], [0, bw / 2 + 0.02, 0], [0, -bw / 2 - 0.02, Math.PI]] as const) {
      ab.archFrame(2.2, 4.4, 0.35, ts + dx, y0 + TW.body + 1.2, tz + dz, ry, GRANITE, 0.2);
      ab.archOpening(2.2, 4.4, ts + dx * 1.004, y0 + TW.body + 1.2, tz + dz * 1.004, ry, DARK);
    }
    // pináculos nos cantos
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
      ab.cyl(0.15, 0.4, 2.6, ts + cx * (bw / 2), y0 + TW.belfry, tz + cz * (bw / 2), GRANITE, 8);
      ab.add(new THREE.SphereGeometry(0.3, 8, 6).translate(ts + cx * (bw / 2), y0 + TW.belfry + 2.8, tz + cz * (bw / 2)), GRANITE);
    }
    ab.box(bw + 0.8, 0.7, bw + 0.8, ts, y0 + TW.belfry - 0.7, tz, GRANITE);
    // cúpula bulbosa + lanterna + cruz
    const bulb: [number, number][] = [
      [3.4, 0], [3.6, 0.6], [3.3, 1.8], [2.4, 3.2], [1.3, 4.3], [0.7, 5.0], [0.55, 5.6], [0, 6.0],
    ];
    ab.lathe(bulb, ts, y0 + TW.belfry, tz, 0x9a968c, 20);
    ab.cyl(0.6, 0.7, TW.lantern - TW.bulbTop, ts, y0 + TW.bulbTop, tz, LIOZ, 10);
    ab.add(new THREE.SphereGeometry(0.75, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(ts, y0 + TW.lantern, tz), 0x9a968c);
    ab.box(0.16, TW.cross - TW.lantern - 0.6, 0.16, ts, y0 + TW.lantern + 0.6, tz, 0x4a4844, 'metal');
    ab.box(0.16, 0.16, 1.0, ts, y0 + TW.cross - 1.0, tz, 0x4a4844, 'metal');
  }

  // ---------- cúpula sobre o cruzeiro ----------
  const D = P.dome;
  // tambor
  ab.cyl(D.drumR, D.drumR + 0.3, D.drumTop - D.drumBase, D.s, y0 + D.drumBase - y0 + 0, 0, LIOZ, 32);
  // pilastras e janelas do tambor (8 lados)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const cx = D.s + Math.cos(a) * (D.drumR + 0.25), cz = Math.sin(a) * (D.drumR + 0.25);
    if (i % 2 === 0) {
      const g = new THREE.BoxGeometry(0.9, D.drumTop - D.drumBase - 1, 0.6);
      g.rotateY(-a);
      g.translate(cx, D.drumBase + (D.drumTop - D.drumBase - 1) / 2, cz);
      ab.add(g, 0xb4ad9e);
    } else {
      const ry = Math.PI / 2 - a;
      ab.archOpening(1.9, 5.2, D.s + Math.cos(a) * (D.drumR + 0.1), D.drumBase + 2.2, Math.sin(a) * (D.drumR + 0.1), ry, DARK, 0.25);
    }
  }
  // anel/cornija + balaustrada + 8 estátuas
  ab.cyl(D.drumR + 1.0, D.drumR + 1.0, 0.8, D.s, D.drumTop - 0.8, 0, 0xa9a293, 32);
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
    const r = D.drumR + 0.7;
    ab.balustrade(D.s + Math.cos(a0) * r, Math.sin(a0) * r, D.s + Math.cos(a1) * r, Math.sin(a1) * r, D.drumTop, LIOZ, 0.5);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ab.statue(D.s + Math.cos(a) * (D.drumR + 0.7), D.drumTop + 0.9, Math.sin(a) * (D.drumR + 0.7), 0xd2ccbe, 1.05);
  }
  // casca da cúpula (perfil levemente alteado) com nervuras
  const shell: [number, number][] = [];
  const H = D.domeTop - D.drumTop;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = t * Math.PI / 2;
    const r = Math.cos(a) * (D.drumR - 0.2);
    const y = Math.sin(a) * H;
    shell.push([Math.max(r, 1.6), y]);
  }
  ab.lathe([[D.drumR + 0.2, 0], ...shell], D.s, D.drumTop + 0.2, 0, LIOZ, 48);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, aa = t * Math.PI / 2;
      const r = Math.max(Math.cos(aa) * (D.drumR - 0.2), 1.6) + 0.12;
      pts.push(new THREE.Vector3(D.s + Math.cos(a) * r, D.drumTop + 0.2 + Math.sin(aa) * H, Math.sin(a) * r));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.22, 5, false);
    ab.add(tube, 0xa8a090);
  }
  // óculos (lucarnas) na cúpula
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = Math.cos(0.42) * (D.drumR - 0.2) + 0.3;
    const g = new THREE.SphereGeometry(0.65, 8, 6);
    g.translate(D.s + Math.cos(a) * r, D.drumTop + 0.2 + Math.sin(0.42) * H, Math.sin(a) * r);
    ab.add(g, DARK, 'dark');
  }
  // lanterna + bola + cruz
  ab.cyl(1.7, 1.9, D.lanternTop - D.domeTop - 1.4, D.s, D.domeTop, 0, LIOZ, 16);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ab.archOpening(0.7, 2.2, D.s + Math.cos(a) * 1.75, D.domeTop + 1.0, Math.sin(a) * 1.75, Math.PI / 2 - a, DARK, 0.1);
  }
  ab.lathe([[2.0, 0], [1.9, 0.5], [1.2, 1.2], [0.5, 1.6], [0, 1.7]], D.s, D.lanternTop - 1.4, 0, LIOZ, 16);
  ab.add(new THREE.SphereGeometry(0.55, 12, 8).translate(D.s, D.lanternTop + 1.0, 0), 0x6f8f6a, 'metal');
  ab.box(0.2, D.crossTop - D.lanternTop - 1.5, 0.2, D.s, D.lanternTop + 1.5, 0, 0x4a4844, 'metal');
  ab.box(0.2, 0.2, 1.4, D.s, D.crossTop - 1.4, 0, 0x4a4844, 'metal');

  const group = ab.build(archMats, 'LANDMARK_CANDELARIA');

  // colisores: retângulos alinhados ao eixo
  const toW = (s: number, z: number): XZ => {
    const p = new THREE.Vector3(s, 0, z).applyMatrix4(ab.frame);
    return [p.x, p.z];
  };
  const rect = (s0: number, s1: number, hw: number): XZ[] => [toW(s0, -hw), toW(s1, -hw), toW(s1, hw), toW(s0, hw)];
  const colliders: LandmarkInstance['colliders'] = [
    { poly: rect(sA0, T.s0, P.apse.halfW), height: P.apse.h + y0 },
    { poly: rect(T.s0, T.s1, T.halfW), height: D.domeTop },
    { poly: rect(T.s1, sF0, N.halfW), height: N.centralH + y0 },
    { poly: rect(sF0, sF1, P.facadeHalfW), height: TW.cross },
  ];
  return { group, colliders, update() { /* estático */ } };
}
