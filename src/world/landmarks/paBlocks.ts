/**
 * Blocos do "PA" da Presidente Vargas (Projeto de Alinhamento dos anos 1940): torres de ~22–24
 * pavimentos alinhadas, térreo em galeria de dois pés-direitos, empenas laterais cegas e fachadas de
 * reboco claro com janelas pontuais e aparelhos de ar-condicionado — o "paredão" que define a avenida
 * entre a Uruguaiana e a Candelária.
 *
 * Referências (só consulta; detalhes e confiança em docs/RECOGNITION_BUILDINGS.md):
 *  - IMS, "Avenida Presidente Vargas; ao fundo, a Igreja da Candelária" (anos 1950, domínio público):
 *    torres brancas com coroamento escalonado, galeria de pilares quadrados, cornija sobre a galeria;
 *  - Fulviusbsas 2017 (AvPresVargas1/2, CC BY-SA 4.0): sequência de fachadas dos dois lados (bege em
 *    grelha, torre de pilastras, lâmina de faixas brancas, torre marrom de pilastras, lâmina "Santander"
 *    com pilotis afunilados, lâminas brancas com ar-condicionado);
 *  - Marinha do Brasil 2024 (G20, CC BY-SA 2.0): lado norte perto da Candelária.
 *
 * Variante no id do modelo: `pa:<variante>[:esquina]` — creme | pilares | faixas | tijolo | varandas | coroa.
 * `esquina` = também há janelas nas arestas perpendiculares à avenida (prédio de esquina); sem isso
 * essas arestas são empenas cegas (padrão dos lotes do PA).
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { ArchBuilder, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';
import { centroidOf, cleanRing, hash01, lodInstance, massWithArcade, ribbons, roofBox, shrinkRing, windows } from './recognition';

export type PaVariant = 'creme' | 'pilares' | 'faixas' | 'tijolo' | 'varandas' | 'coroa';

const TONES = [0xe6dcc8, 0xece8df, 0xd9d5cb, 0xe2d4ba]; // creme, branco, cinza claro, bege
const GLASS = 0x5b6670;
const AC = 0xd9d7d0;

export const PA_PARAMS = {
  floorH: 3.05,
  bay: 2.5,
  winW: 1.35,
  winH: 1.55,
  sill: 0.95,
  crownStep: 3.1, // cada degrau do coroamento = 1 pavimento
};

export function parsePaModel(model: string): { variant: PaVariant; corner: boolean } {
  const [, v, c] = model.split(':');
  const variant = (['creme', 'pilares', 'faixas', 'tijolo', 'varandas', 'coroa'].includes(v) ? v : 'creme') as PaVariant;
  return { variant, corner: c === 'esquina' };
}

export function buildPaBlock(b: BuildingRec, mats: Record<ArchMat, THREE.Material>, axisDir: XZ): LandmarkInstance {
  const { variant, corner } = parsePaModel(b.model ?? 'pa');
  const P = PA_PARAMS;
  const ring = cleanRing(b.poly.outer);
  const top = b.height;
  const seed = hash01(b.id);
  const near = new ArchBuilder();
  const far = new ArchBuilder();
  const tone = variant === 'tijolo' ? 0x93604a : variant === 'pilares' ? 0xd8c7a4 : variant === 'coroa' ? 0xece8df : TONES[Math.floor(seed * TONES.length)];
  const trim = variant === 'tijolo' ? 0x7b4c3a : new THREE.Color(tone).multiplyScalar(0.9).getHex();
  const crownSteps = variant === 'coroa' || variant === 'tijolo' || variant === 'pilares' ? 2 : 0;
  const bodyTop = top - crownSteps * P.crownStep;

  // massa + galeria (colunas: pilotis afunilados na variante "varandas", como na foto do Santander)
  const hA = massWithArcade(near, b, ring, bodyTop, {
    wall: tone,
    column: variant === 'varandas' ? 0x9c9a94 : trim,
    columnShape: variant === 'varandas' ? 'tapered' : variant === 'coroa' ? 'square' : 'pilotis',
    columnR: 0.42,
    storefront: 0x3a4044,
  });
  const ground = hA > 0 ? hA : 4.6;
  const floors = Math.max(1, Math.floor((bodyTop - ground - 0.8) / P.floorH));

  // coroamento escalonado
  let r2 = ring;
  for (let s = 0; s < crownSteps; s++) {
    r2 = shrinkRing(r2, 1.4 + s * 0.6);
    near.prism(r2, bodyTop + s * P.crownStep, bodyTop + (s + 1) * P.crownStep, tone, 'stone');
    far.prism(r2, bodyTop + s * P.crownStep, bodyTop + (s + 1) * P.crownStep, tone, 'stone');
  }
  // casa de máquinas
  roofBox(near, r2, top, 6, 4.5, 3.2, trim);
  roofBox(far, r2, top, 6, 4.5, 3.2, trim);

  // fachadas
  const ax = axisDir;
  ArchBuilder.edgeFrames(ring, 3.5, (m, len, _i, a, c) => {
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    // aresta "frontal" (paralela à avenida) ou lateral (empena)
    const ex = (c[0] - a[0]) / len, ez = (c[1] - a[1]) / len;
    const along = Math.abs(ex * ax[0] + ez * ax[1]);
    const side = along < 0.55;
    void n;
    const blank = side && !corner;
    near.withFrame(m, () => {
      // cornija sobre a galeria / embasamento
      near.box(len, 0.55, 0.45, len / 2, ground - 0.1, 0.22, trim, 'stone');
      // platibanda
      near.box(len, 0.7, 0.3, len / 2, bodyTop - 0.7, 0.15, trim, 'stone');
      if (blank) {
        // empena: só juntas de pavimento muito leves (reboco)
        if (len > 6) for (let k = 4; k < floors; k += 4) near.box(len, 0.12, 0.05, len / 2, ground + k * P.floorH, 0.02, trim, 'stone');
        return;
      }
      if (hA === 0) {
        // térreo de lojas (sem galeria)
        near.quad(Math.max(1, len - 1.2), 3.2, len / 2, 0.3, 0.04, 0x33393c, 'glass');
      }
      const y0 = ground + 0.3;
      if (variant === 'faixas') {
        // janelas em fita entre faixas contínuas (lâmina moderna dos anos 50)
        for (let k = 0; k <= floors; k++) near.box(len + 0.2, 1.0, 0.35, len / 2, y0 + k * P.floorH - 0.45, 0.17, k % 2 ? tone : 0xf2f0ea, 'stone');
        ribbons(near, 0.5, len - 0.5, y0, floors, P.floorH, 0.6, 1.9, 0x34404a);
        near.detail(() => { for (let x = 1.4; x < len - 0.6; x += 1.4) near.box(0.08, floors * P.floorH, 0.06, x, y0, 0.05, 0xdedbd2, 'metal'); });
      } else if (variant === 'varandas') {
        // loggias recuadas (vãos largos e escuros) entre lajes salientes
        windows(near, { x0: 0.6, x1: len - 0.6, y0, floors, floorH: P.floorH, bay: 3.0, winW: 2.3, winH: 2.2, sill: 0.45, glass: 0x56636e, blinds: 0.25, blindColor: 0xb3aea3, z: 0.03 });
        for (let k = 0; k <= floors; k++) near.box(len, 0.22, 0.55, len / 2, y0 + k * P.floorH - 0.12, 0.27, 0xf0ece4, 'stone');
      } else {
        windows(near, { x0: 0.6, x1: len - 0.6, y0, floors, floorH: P.floorH, bay: P.bay, winW: P.winW, winH: P.winH, sill: P.sill, glass: GLASS, blinds: 0.3, blindColor: 0xa29d92, ac: variant === 'tijolo' ? 0.2 : 0.35, acColor: AC });
        if (variant === 'pilares' || variant === 'tijolo') {
          // pilastras contínuas a cada 2 vãos (art déco tardio)
          const nb = Math.max(1, Math.round((len - 1.2) / P.bay));
          const bay = (len - 1.2) / nb;
          for (let i = 0; i <= nb; i += 2) near.box(0.7, bodyTop - ground - 0.6, 0.4, 0.6 + i * bay, ground + 0.5, 0.2, trim, 'stone');
        }
      }
      // coroamento: janelas pequenas nos degraus
      for (let s = 0; s < crownSteps; s++) {
        const inset = 1.4 + s * 1.2;
        if (len - 2 * inset < 3) continue;
        near.withFrame(new THREE.Matrix4().makeTranslation(0, 0, -inset), () => {
          windows(near, { x0: inset + 0.5, x1: len - inset - 0.5, y0: bodyTop + s * P.crownStep, floors: 1, floorH: P.crownStep, bay: P.bay, winW: 1.1, winH: 1.3, sill: 1.0, glass: GLASS, blinds: 0.1, z: 0.4 });
        });
      }
    });
    // LOD distante: massa + faixa por pavimento (tom médio entre vidro e reboco)
    if (!blank) far.withFrame(m, () => ribbons(far, 0.6, len - 0.6, ground + 0.3, floors, P.floorH, P.sill, P.winH, variant === 'faixas' ? 0x4a5560 : 0x6a6c6c));
  });
  far.prism(ring, 0, bodyTop, tone, 'stone');

  const c = centroidOf(ring);
  return lodInstance(`pa_${b.id}`, near, far, mats, new THREE.Vector3(c[0], top * 0.5, c[1]));
}
