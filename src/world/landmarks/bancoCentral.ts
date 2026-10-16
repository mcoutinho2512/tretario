/**
 * Banco Central do Brasil — Av. Presidente Vargas, 730 (1984). O prédio mais alto da avenida
 * (~130 m, 25–26 pavimentos): núcleo de concreto branco em cruz e quatro "caixas" de vidro escuro
 * empilhadas, separadas por pavimentos vazados onde aparecem as colunas brancas; as caixas dos quadrantes
 * opostos são defasadas (os vazios não ficam na mesma altura). Térreo em pilotis com saguão recuado.
 *
 * Referências (detalhes/confiança em docs/RECOGNITION_BUILDINGS.md):
 *  - Fulviusbsas, "AvPresVargas1" (2017, Wikimedia Commons, CC BY-SA 4.0) — vista da fachada sul/oeste;
 *  - Andrevruas 2011 (CC BY 3.0) — torre escura dominando o meio da avenida vista do Campo de Santana;
 *  - altura: SKYDB / Structurae (129,67 m, 25 pav., 1984); Diário do Rio (130 m, 26 pav.).
 *  - contorno: OSM way 270244540 (sem altura no OSM).
 */
import * as THREE from 'three';
import type { BuildingRec } from '../types';
import { ArchBuilder, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';
import { centroidOf, cleanRing, lodInstance } from './recognition';

export const BANCO_CENTRAL_PARAMS = {
  height: 129.7,
  pilotis: 9.0,
  floorH: 4.0,
  core: 4.6, // largura das faixas do núcleo em cruz
  /** caixas por quadrante: [pavimento inicial, nº de pavimentos]; vazio de 1 pavimento entre caixas */
  stacksA: [[0, 8], [9, 9], [19, 8]] as [number, number][],
  stacksB: [[0, 12], [13, 8], [22, 5]] as [number, number][],
};

const WHITE = 0xe9e7e1;
const GLASS = 0x1c2226;
const SPANDREL = 0x2b3136;

export function buildBancoCentral(b: BuildingRec, mats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const P = BANCO_CENTRAL_PARAMS;
  const ring = cleanRing(b.poly.outer);
  // quadro orientado pela aresta mais longa (u ao longo, v perpendicular), centrado no centroide
  let best = 0, ang = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l > best) { best = l; ang = Math.atan2(c[1] - a[1], c[0] - a[0]); }
  }
  const cen = centroidOf(ring);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let maxU = 0, maxV = 0;
  for (const p of ring) {
    const dx = p[0] - cen[0], dz = p[1] - cen[1];
    maxU = Math.max(maxU, Math.abs(dx * ux + dz * uz));
    maxV = Math.max(maxV, Math.abs(-dx * uz + dz * ux));
  }
  // meia-largura útil (um pouco dentro do contorno, que é um quadrilátero irregular)
  const hu = Math.min(maxU - 2.5, 21), hv = Math.min(maxV - 2.5, 17);
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux));
  frame.setPosition(cen[0], 0, cen[1]);

  const near = new ArchBuilder();
  const far = new ArchBuilder();
  const H = P.height;
  const k = P.core / 2;
  const nFloors = 27;
  const towerTop = P.pilotis + nFloors * P.floorH; // 117 m
  for (const ab of [near, far]) ab.withFrame(frame, () => {
    // núcleo em cruz (concreto branco) até o coroamento
    ab.box(2 * hu - 3, H - 3.5, P.core, 0, 0, 0, WHITE, 'concrete');
    ab.box(P.core, H - 3.5, 2 * hv - 3, 0, 0, 0, WHITE, 'concrete');
    ab.box(2 * k + 6, 3.5, 2 * k + 6, 0, H - 3.5, 0, WHITE, 'concrete'); // casa de máquinas / coroamento
    // saguão envidraçado recuado sob os pilotis
    ab.box(2 * hu - 10, P.pilotis - 0.5, 2 * hv - 10, 0, 0, 0, 0x2a3034, 'glass');
  });

  // quadrantes de vidro (defasados) + colunas brancas nos vazios
  const quads: [number, number, [number, number][]][] = [[1, 1, P.stacksA], [-1, -1, P.stacksA], [1, -1, P.stacksB], [-1, 1, P.stacksB]];
  near.withFrame(frame, () => {
    for (const [su, sv, stacks] of quads) {
      const w = hu - k, d = hv - k;
      const cx = su * (k + w / 2), cz = sv * (k + d / 2);
      for (const [f0, nf] of stacks) {
        const y0 = P.pilotis + f0 * P.floorH, h = nf * P.floorH;
        near.box(w, h, d, cx, y0, cz, GLASS, 'glass');
        // faixas de piso (peitoris escuros) nas duas faces externas
        for (let f = 0; f <= nf; f++) {
          const y = y0 + f * P.floorH - 0.35;
          near.box(w + 0.08, 0.7, 0.08, cx, y, sv * (k + d) + sv * 0.04, SPANDREL, 'metal');
          near.box(0.08, 0.7, d + 0.08, su * (k + w) + su * 0.04, y, cz, SPANDREL, 'metal');
        }
        // montantes verticais (detalhe)
        near.detail(() => {
          for (let x = -w / 2 + 1.5; x < w / 2; x += 1.5) near.box(0.1, h, 0.12, cx + x, y0, sv * (k + d) + sv * 0.06, SPANDREL, 'metal');
          for (let z = -d / 2 + 1.5; z < d / 2; z += 1.5) near.box(0.12, h, 0.1, su * (k + w) + su * 0.06, y0, cz + z, SPANDREL, 'metal');
        });
      }
      // colunas brancas: sob a primeira caixa (pilotis) e em cada vazio entre caixas
      const gaps: [number, number][] = [[0, P.pilotis]];
      for (let i = 0; i < stacks.length - 1; i++) {
        const e = P.pilotis + (stacks[i][0] + stacks[i][1]) * P.floorH;
        gaps.push([e, P.pilotis + stacks[i + 1][0] * P.floorH]);
      }
      const last = stacks[stacks.length - 1];
      const lastTop = P.pilotis + (last[0] + last[1]) * P.floorH;
      if (lastTop < towerTop) gaps.push([lastTop, towerTop]);
      for (const [g0, g1] of gaps) {
        // laje recuada (vazio)
        if (g0 > 0) near.box(w - 1.6, g1 - g0, d - 1.6, cx, g0, cz, 0xb9b7b0, 'concrete');
        for (const fu of [0.18, 0.82]) for (const fv of [0.18, 0.82]) {
          const px = su * (k + w * fu), pz = sv * (k + d * fv);
          if (fu === 0.18 && fv === 0.18) continue; // canto junto ao núcleo
          near.cyl(0.55, 0.55, g1 - g0, px, g0, pz, WHITE, 12, 'concrete');
        }
      }
    }
  });

  // LOD distante: uma caixa escura por quadrante (sem vazios) sobre o núcleo
  far.withFrame(frame, () => {
    for (const [su, sv] of quads) {
      const w = hu - k, d = hv - k;
      far.box(w, towerTop - P.pilotis, d, su * (k + w / 2), P.pilotis, sv * (k + d / 2), GLASS, 'glass');
    }
  });

  return lodInstance('banco_central', near, far, mats, new THREE.Vector3(cen[0], 60, cen[1]), { detail: 220, far: 700 });
}
