/**
 * Edifícios de reconhecimento com fachada própria (rodada 6). Geometria simplificada sobre o contorno
 * OSM; medidas, fontes e confiança em docs/RECOGNITION_BUILDINGS.md. Todas as fotos citadas são do
 * Wikimedia Commons e foram usadas só como referência (nenhuma imagem incluída no repositório).
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { ArchBuilder, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';
import { centroidOf, cleanRing, edgeFacing, hash01, lodInstance, massWithArcade, ribbons, roofBox, windows } from './recognition';

function seeded(ab: ArchBuilder, id: number) {
  const n = Math.floor(hash01(id) * 97);
  for (let i = 0; i < n; i++) ab.rand();
  return ab;
}

/** LOD distante genérico: massa + faixas por pavimento em todas as arestas */
function farMass(far: ArchBuilder, ring: XZ[], top: number, wall: THREE.ColorRepresentation, ground: number, floorH: number, band: THREE.ColorRepresentation, winH = 1.5, mat: ArchMat = 'stone') {
  far.prism(ring, 0, top, wall, mat);
  const floors = Math.max(1, Math.floor((top - ground - 1) / floorH));
  ArchBuilder.edgeFrames(ring, 4, (m, len) => far.withFrame(m, () => ribbons(far, 0.5, len - 0.5, ground, floors, floorH, 0.9, winH, band)));
}

// -------------------------------------------------------------------------------------------------
/**
 * Edifício Presidente Kennedy — Av. Pres. Vargas, 633 (esquina com a Uruguaiana). Lâmina "streamline":
 * extremidade curva, faixas horizontais de pastilha azul em todos os pavimentos, janelas em fita com
 * caixilhos brancos, pilotis redondos. Ref.: Eduardo P, "Edifício Presidente Kennedy" (2012, CC BY-SA 3.0).
 */
export function buildPresidenteKennedy(b: BuildingRec, mats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const ring = cleanRing(b.poly.outer);
  const top = b.height;
  const near = seeded(new ArchBuilder(), b.id), far = new ArchBuilder();
  const WHITE = 0xeeece6, BLUE = 0x5f8ea6, GLASS = 0x34424a;
  const hA = massWithArcade(near, b, ring, top, { wall: WHITE, column: 0x8f908c, columnShape: 'round', columnR: 0.45, storefront: 0x3a4044 });
  const ground = Math.max(hA, 4.5);
  const floorH = 3.05;
  const floors = Math.floor((top - ground - 1.2) / floorH);
  ArchBuilder.edgeFrames(ring, 0.8, (m, len) => near.withFrame(m, () => {
    for (let k = 0; k < floors; k++) {
      const y = ground + k * floorH;
      near.box(len + 0.05, 0.95, 0.32, len / 2, y, 0.16, BLUE, 'granite'); // peitoril de pastilha azul
      near.box(len + 0.05, 0.16, 0.36, len / 2, y + 0.95, 0.18, WHITE, 'stone'); // pingadeira branca
    }
    ribbons(near, 0, len, ground, floors, floorH, 1.11, floorH - 1.22, GLASS, 0.02);
    near.detail(() => { if (len > 2.2) for (let x = 1.1; x < len - 0.4; x += 1.25) near.box(0.09, floors * floorH, 0.08, x, ground, 0.05, WHITE, 'metal'); });
    near.box(len + 0.1, 0.9, 0.4, len / 2, top - 0.9, 0.18, WHITE, 'stone'); // platibanda
  }));
  roofBox(near, ring, top, 5, 4, 3, WHITE);
  farMass(far, ring, top, WHITE, ground, floorH, 0x5f7e8e, 1.9);
  const c = centroidOf(ring);
  return lodInstance('presidente_kennedy', near, far, mats, new THREE.Vector3(c[0], top / 2, c[1]));
}

// -------------------------------------------------------------------------------------------------
/**
 * Edifício Belacap (Universidade Estácio — Av. Pres. Vargas, 642) e vizinho de mesma linguagem:
 * grelha profunda de concreto bege (brise em quadrículas) e letreiro azul horizontal no terço superior.
 * Ref.: Fulviusbsas, "AvPresVargas1" (2017, CC BY-SA 4.0). `sign` = recebe o letreiro.
 */
export function buildBelacap(b: BuildingRec, mats: Record<ArchMat, THREE.Material>, axisPt: XZ, sign: boolean): LandmarkInstance {
  const ring = cleanRing(b.poly.outer);
  const top = b.height;
  const near = seeded(new ArchBuilder(), b.id), far = new ArchBuilder();
  const BEIGE = 0xcdbf9f, SHADE = 0xb9ab8b, GLASS = 0x2d3438;
  const hA = massWithArcade(near, b, ring, top, { wall: SHADE, column: BEIGE, columnShape: 'square', columnR: 0.45, storefront: 0x3a4044 });
  const ground = Math.max(hA, 4.5);
  const floorH = 3.2, bay = 3.2;
  const floors = Math.floor((top - ground - 1.5) / floorH);
  const front = edgeFacing(ring, axisPt, 8);
  ArchBuilder.edgeFrames(ring, 4, (m, len, i) => near.withFrame(m, () => {
    const nb = Math.max(1, Math.round(len / bay));
    const bw = len / nb;
    windows(near, { x0: 0, x1: len, y0: ground, floors, floorH, bay: bw, winW: bw - 0.5, winH: floorH - 0.6, sill: 0.3, glass: GLASS, blinds: 0.2, ac: 0.25 });
    // grelha: aletas verticais + placas horizontais salientes (0,9 m)
    for (let j = 0; j <= nb; j++) near.box(0.28, floors * floorH, 0.9, j * bw, ground, 0.45, BEIGE, 'concrete');
    for (let k = 0; k <= floors; k++) near.box(len, 0.28, 0.9, len / 2, ground + k * floorH - 0.14, 0.45, BEIGE, 'concrete');
    if (sign && i === front && len > 14) near.box(len * 0.62, 3.2, 0.3, len / 2, top - 15, 1.05, 0x1f4f9a, 'dark');
  }));
  roofBox(near, ring, top, 6, 5, 3, SHADE);
  farMass(far, ring, top, BEIGE, ground, floorH, 0x625d52, 2.4);
  if (sign) ArchBuilder.edgeFrames(ring, 14, (m, len, i) => { if (i === front) far.withFrame(m, () => far.box(len * 0.62, 3.2, 0.3, len / 2, top - 15, 0.2, 0x1f4f9a, 'dark')); });
  const c = centroidOf(ring);
  return lodInstance(`belacap_${b.id}`, near, far, mats, new THREE.Vector3(c[0], top / 2, c[1]));
}

// -------------------------------------------------------------------------------------------------
/**
 * Embratel — Av. Pres. Vargas, 1012. Lâmina de ~55 m com colunata de pé-direito duplo em colunas
 * redondas de granito escuro e fachada em faixas horizontais claras com janelas em fita; letreiro sobre
 * a cobertura (a marca mudou — painel sem texto). Refs.: Antonio Schubert (2011, CC BY-SA 2.0);
 * Eduardo P, "Avenida Presidente Vargas (2)" (2011, CC BY-SA 3.0 — galeria do nº 1012).
 */
export function buildEmbratel(b: BuildingRec, mats: Record<ArchMat, THREE.Material>, axisPt: XZ): LandmarkInstance {
  const ring = cleanRing(b.poly.outer);
  const top = b.height;
  const near = seeded(new ArchBuilder(), b.id), far = new ArchBuilder();
  const CONC = 0xcac6bc, GLASS = 0x2a3238, GRANITE = 0x5a5752;
  const hA = massWithArcade(near, b, ring, top, { wall: 0xbdb9b0, column: GRANITE, columnMat: 'granite', columnShape: 'round', columnR: 0.62, storefront: 0x3a4044 });
  const ground = Math.max(hA, 5);
  const floorH = 3.0;
  const floors = Math.floor((top - ground - 1.5) / floorH);
  const front = edgeFacing(ring, axisPt, 8);
  ArchBuilder.edgeFrames(ring, 4, (m, len, i) => near.withFrame(m, () => {
    for (let k = 0; k <= floors; k++) near.box(len + 0.4, 1.1, 0.5, len / 2, ground + k * floorH - 0.2, 0.25, CONC, 'concrete');
    ribbons(near, 0.2, len - 0.2, ground, floors, floorH, 0.9, floorH - 1.1, GLASS);
    // aletas verticais (brise) — detalhe
    near.detail(() => { for (let x = 1.5; x < len - 0.5; x += 1.5) near.box(0.1, floors * floorH, 0.45, x, ground, 0.22, 0xd8d4ca, 'concrete'); });
    if (i === front && len > 30) {
      // letreiro sobre a cobertura (painel + estrutura)
      near.box(22, 4.2, 0.4, len * 0.22, top + 1.2, -2, 0x2c2e30, 'dark');
      for (const s of [-1, 1]) near.box(0.3, 1.2, 0.3, len * 0.22 + s * 9, top, -2, 0x3a3d40, 'metal');
    }
  }));
  roofBox(near, ring, top, 8, 5, 3.2, CONC);
  farMass(far, ring, top, CONC, ground, floorH, 0x50565a, 1.9);
  const c = centroidOf(ring);
  return lodInstance('embratel', near, far, mats, new THREE.Vector3(c[0], top / 2, c[1]));
}

// -------------------------------------------------------------------------------------------------
/**
 * Av. Pres. Vargas, 1111 — torre de escritórios em pele de vidro azulado com aletas verticais brancas
 * (vizinha da Biblioteca Parque). Ref.: Thomaz Silva/Agência Brasil, "Biblioteca Parque Estadual 01"
 * (2015, CC BY 3.0 BR — torre ao fundo, à esquerda).
 */
export function buildVidroPV1111(b: BuildingRec, mats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const ring = cleanRing(b.poly.outer);
  const top = b.height;
  const near = seeded(new ArchBuilder(), b.id), far = new ArchBuilder();
  const GLASS = 0x46708c, FIN = 0xe6e8e8;
  const hA = massWithArcade(near, b, ring, top, { wall: GLASS, wallMat: 'glass', column: FIN, columnShape: 'round', columnR: 0.45, storefront: 0x2e3b44 });
  const ground = Math.max(hA, 5);
  const floorH = 3.4;
  const floors = Math.floor((top - ground) / floorH);
  ArchBuilder.edgeFrames(ring, 1.2, (m, len) => near.withFrame(m, () => {
    for (let k = 0; k <= floors; k++) near.box(len, 0.25, 0.08, len / 2, ground + k * floorH, 0.04, 0x8fa9b8, 'metal');
    if (len > 4) for (let x = 0.2; x <= len; x += 3.0) near.box(0.3, top - ground, 0.6, Math.min(x, len - 0.2), ground, 0.3, FIN, 'stone');
    near.box(len, 1.2, 0.3, len / 2, top - 1.2, 0.15, FIN, 'stone');
  }));
  far.prism(ring, 0, top, GLASS, 'glass');
  ArchBuilder.edgeFrames(ring, 4, (m, len) => far.withFrame(m, () => far.box(len, 1.2, 0.3, len / 2, top - 1.2, 0.15, FIN, 'stone')));
  const c = centroidOf(ring);
  return lodInstance('pv1111', near, far, mats, new THREE.Vector3(c[0], top / 2, c[1]));
}

// -------------------------------------------------------------------------------------------------
/**
 * Biblioteca Parque Estadual — Av. Pres. Vargas, 1261 (prédio de 1980, Glauco Campello; retrofit
 * reinaugurado em 2014). Fachada para a avenida: pilares-parede brancos afunilados (mais largos no
 * topo), dois níveis de vidro escuro separados por faixa cinza, beiral branco em balanço e pórtico de
 * entrada vermelho. Refs.: Thomaz Silva/Agência Brasil (2015, CC BY 3.0 BR); Andrevruas 2011 (CC BY 3.0).
 */
export const BIBLIOTECA_PARAMS = { height: 15, pierEvery: 12.5, lowerTop: 5.4, bandTop: 6.9, upperTop: 11.8 };

export function buildBibliotecaParque(b: BuildingRec, mats: Record<ArchMat, THREE.Material>, axisPt: XZ): LandmarkInstance {
  const P = BIBLIOTECA_PARAMS;
  const ring = cleanRing(b.poly.outer);
  const H = b.height;
  const near = new ArchBuilder(), far = new ArchBuilder();
  const WHITE = 0xeeedea, GREY = 0x9c9e9d, GLASS = 0x263032, RED = 0x8c2a26;
  near.prism(ring, 0, H, 0xdedcd6, 'concrete');
  far.prism(ring, 0, H, 0xdedcd6, 'concrete');
  const front = edgeFacing(ring, axisPt, 10);
  // pilar afunilado (trapézio extrudado): 1,0 m na base → 2,5 m no topo, 1,4 m de saliência
  const pier = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(1.25, H - 0.6); s.lineTo(-1.25, H - 0.6); s.lineTo(-0.5, 0);
    return new THREE.ExtrudeGeometry(s, { depth: 1.4, bevelEnabled: false });
  })();
  ArchBuilder.edgeFrames(ring, 6, (m, len, i) => {
    const main = i === front;
    near.withFrame(m, () => {
      if (main) {
        near.quad(len - 1, P.lowerTop - 0.3, len / 2, 0.3, 0.05, GLASS, 'glass');
        near.box(len, P.bandTop - P.lowerTop, 0.45, len / 2, P.lowerTop, 0.22, GREY, 'concrete');
        near.quad(len - 1, P.upperTop - P.bandTop, len / 2, P.bandTop, 0.05, GLASS, 'glass');
        near.box(len + 1, H - P.upperTop, 1.9, len / 2, P.upperTop, 0.95, WHITE, 'concrete'); // beiral em balanço
        const n = Math.max(2, Math.round(len / P.pierEvery));
        for (let k = 0; k <= n; k++) near.add(pier.clone().translate(0.7 + (k * (len - 1.4)) / n, 0, 0), WHITE, 'concrete');
        // pórtico vermelho da entrada (um terço do comprimento)
        const ex = len * 0.38;
        near.box(1.1, 3.9, 1.1, ex - 2.6, 0, 3.0, RED, 'dark');
        near.box(6.4, 0.9, 3.6, ex, 3.3, 1.8, RED, 'dark');
        // caixilhos (detalhe)
        near.detail(() => { for (let x = 2.5; x < len - 1; x += 2.5) near.box(0.08, P.upperTop - 0.3, 0.08, x, 0.3, 0.1, 0x3a3d40, 'metal'); });
      } else {
        near.box(len, 0.8, 0.3, len / 2, H - 0.8, 0.15, WHITE, 'concrete');
        if (len > 10) windows(near, { x0: 1, x1: len - 1, y0: 0.6, floors: 2, floorH: 5.5, bay: 5, winW: 3.2, winH: 2.4, sill: 1.2, glass: GLASS, blinds: 0 });
      }
    });
    if (main) far.withFrame(m, () => {
      far.quad(len - 1, P.upperTop - 0.3, len / 2, 0.3, 0.05, GLASS, 'glass');
      far.box(len + 1, H - P.upperTop, 1.9, len / 2, P.upperTop, 0.95, WHITE, 'concrete');
    });
  });
  const c = centroidOf(ring);
  return lodInstance('biblioteca_parque', near, far, mats, new THREE.Vector3(c[0], 8, c[1]), { detail: 150, far: 380 });
}

// -------------------------------------------------------------------------------------------------
/**
 * Edifício Paulo de Frontin ("Balança Mas Não Cai", 1945–1948) — esquina da Pres. Vargas com a Rua de
 * Santana. Lâmina residencial de 22 pavimentos (dois blocos no OSM) perpendicular à avenida, malha
 * densa de janelas pequenas, faixa vertical vermelha na ponta voltada para a avenida, corpo creme/salmão
 * e bloco sul cinza-esverdeado; painel publicitário na cobertura. Refs.: OSM (way 326571730:
 * name/loc_name, building:levels=22); Валерий Дед, panoramio (CC BY 3.0); dfmarx 2007 (CC BY-SA 2.0).
 * `part` = 0 (bloco norte, junto à avenida) | 1 (bloco sul).
 */
export function buildPauloDeFrontin(b: BuildingRec, mats: Record<ArchMat, THREE.Material>, axisPt: XZ, part: 0 | 1): LandmarkInstance {
  const ring = cleanRing(b.poly.outer);
  const top = b.height;
  const near = seeded(new ArchBuilder(), b.id), far = new ArchBuilder();
  const BODY = part === 0 ? 0xe2cdb2 : 0xa7ae9e, RED = 0x9c4536, GLASS = 0x515a60;
  const hA = massWithArcade(near, b, ring, top, { wall: BODY, column: 0x9a948a, columnShape: 'square', columnR: 0.4, storefront: 0x3a4044 });
  const ground = Math.max(hA, 4.2);
  const floorH = 3.0;
  const floors = Math.min(21, Math.floor((top - ground - 1) / floorH));
  const front = edgeFacing(ring, axisPt, 8);
  ArchBuilder.edgeFrames(ring, 4, (m, len, i) => near.withFrame(m, () => {
    const isFront = part === 0 && i === front;
    if (isFront) near.box(len + 0.1, top - ground, 0.12, len / 2, ground, 0.06, RED, 'stone'); // ponta vermelha
    windows(near, { x0: 0.8, x1: len - 0.8, y0: ground + 0.2, floors, floorH, bay: 2.2, winW: 1.15, winH: 1.3, sill: 0.95, glass: GLASS, blinds: 0.3, blindColor: 0x9d968a, ac: 0.18, z: isFront ? 0.15 : 0.03 });
    near.box(len, 0.8, 0.3, len / 2, top - 0.8, 0.15, part === 0 ? 0xd6c09f : 0x969d8d, 'stone');
  }));
  // painel publicitário na cobertura (bloco norte), voltado para oeste/Cidade Nova
  if (part === 0) {
    const c = centroidOf(ring);
    near.box(16, 6, 0.4, c[0], top + 1.5, c[1], 0xd9d7cf, 'dark', Math.PI / 2 - 0.33);
    near.box(1.2, 1.5, 10, c[0], top, c[1], 0x3a3d40, 'metal', -0.33); // estrutura do painel
    far.box(16, 6, 0.4, c[0], top + 1.5, c[1], 0xd9d7cf, 'dark', Math.PI / 2 - 0.33);
  }
  roofBox(near, ring, top, 5, 4, 2.6, BODY);
  farMass(far, ring, top, BODY, ground, floorH, part === 0 ? 0x857a6c : 0x6b7068, 1.3);
  const c = centroidOf(ring);
  return lodInstance(`paulo_frontin_${part}`, near, far, mats, new THREE.Vector3(c[0], top / 2, c[1]));
}
