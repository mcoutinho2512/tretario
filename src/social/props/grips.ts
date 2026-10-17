/**
 * Pegadas e posicionamento dos itens (puro, testável — sem three.js).
 *
 * Três formas de prender um item ao personagem com esqueleto:
 *  - `bone`    preso ao osso da mão (segue punho e antebraço: balançar bandeira, megafone na boca, taco)
 *  - `upright` posição da mão, mas eixo quase vertical (guarda-chuva: não tomba com o pulso)
 *  - `two_hand` quadro calculado pelas DUAS mãos a cada quadro (cartazes, faixa, bandeira grande): funciona com
 *    qualquer pose de carregar, porque não depende da orientação de cada punho — só de onde as mãos estão
 *  - `waist`   pendurado na cintura por alça (percussão), baqueta na mão direita
 *
 * Unidades: metros. Referencial do personagem: +Z frente, +Y cima, +X esquerda (a mão direita fica em −X).
 */
import { PROPS, type PropKind } from '../props';

export type AttachMode = 'bone' | 'upright' | 'two_hand' | 'waist';
export type Hand = 'hand_r' | 'hand_l';

export interface GripSpec {
  mode: AttachMode;
  /** mão principal (bone/upright/waist: a que segura; two_hand: ignorado) */
  hand: Hand;
  /** deslocamento ao longo do eixo do item a partir do centro do punho (m; + = para o lado do polegar) */
  slide: number;
  /** two_hand: como o item fica em relação às mãos */
  twoHand?: 'edge' | 'stick' | 'pole' | 'banner';
}

/**
 * Centro do punho fechado e eixos, no referencial LOCAL do osso da mão (medidos no rig "game_engine" do MPFB,
 * iguais em todos os corpos — a escala vem do `root`). O osso aponta +Y para os dedos.
 *  - `center`: onde o cabo passa (entre as falanges proximais, deslocado para a palma)
 *  - `axis`: linha dos nós dos dedos (mínimo → indicador), projetada ⟂ ao osso: o cabo sai pelo lado do polegar
 *  - `palm`: normal da palma
 */
export const HAND_GRIP: Record<Hand, { center: [number, number, number]; axis: [number, number, number]; palm: [number, number, number] }> = {
  hand_r: { center: [-0.031, 0.09, 0.007], axis: [0.776, 0, 0.631], palm: [-0.631, 0, 0.776] },
  hand_l: { center: [0.031, 0.09, 0.007], axis: [-0.776, 0, 0.631], palm: [0.631, 0, 0.776] },
};

export const PROP_GRIPS: Record<PropKind, GripSpec> = {
  flag_small: { mode: 'bone', hand: 'hand_r', slide: 0 },
  flag_large: { mode: 'two_hand', hand: 'hand_r', slide: 0, twoHand: 'pole' },
  sign_small: { mode: 'two_hand', hand: 'hand_r', slide: 0, twoHand: 'edge' },
  sign_large: { mode: 'two_hand', hand: 'hand_r', slide: 0, twoHand: 'stick' },
  sign_double: { mode: 'two_hand', hand: 'hand_r', slide: 0, twoHand: 'stick' },
  banner: { mode: 'two_hand', hand: 'hand_r', slide: 0, twoHand: 'banner' },
  megaphone: { mode: 'bone', hand: 'hand_r', slide: 0 },
  whistle: { mode: 'bone', hand: 'hand_r', slide: 0.01 },
  umbrella: { mode: 'upright', hand: 'hand_r', slide: 0 },
  drum: { mode: 'waist', hand: 'hand_r', slide: 0 },
  bat: { mode: 'bone', hand: 'hand_r', slide: -0.02 },
  bar: { mode: 'bone', hand: 'hand_r', slide: -0.03 },
  spray: { mode: 'bone', hand: 'hand_r', slide: 0 },
};

/**
 * Posição aproximada do item na multidão INSTANCIADA (sem esqueleto): ponto de pegada no referencial do agente
 * e altura extra quando a ação é de erguer. `null` = pequeno demais para aparecer de longe (apito).
 */
export interface FarPlacement {
  /** ponto de pegada (m) no referencial do agente */
  at: [number, number, number];
  /** quanto sobe com ação de erguer (m) */
  raise: number;
  /** inclinação para a frente do eixo (rad) */
  tilt: number;
}

export const FAR_PLACEMENT: Record<PropKind, FarPlacement | null> = {
  flag_small: { at: [-0.24, 1.0, 0.14], raise: 0.6, tilt: 0.18 },
  flag_large: { at: [0, 1.12, 0.22], raise: 0.45, tilt: 0.08 },
  sign_small: { at: [0, 1.0, 0.3], raise: 0.75, tilt: 0 },
  sign_large: { at: [0, 1.08, 0.26], raise: 0.6, tilt: 0 },
  sign_double: { at: [0, 1.08, 0.26], raise: 0.6, tilt: 0 },
  banner: { at: [0, 1.02, 0.28], raise: 0.45, tilt: 0 },
  megaphone: { at: [-0.26, 1.0, 0.16], raise: 0.55, tilt: 0 },
  whistle: null,
  umbrella: { at: [-0.22, 1.1, 0.12], raise: 0, tilt: 0.12 },
  drum: { at: [0.06, 0.86, 0.26], raise: 0, tilt: 0 },
  bat: { at: [-0.27, 0.92, 0.06], raise: 0.4, tilt: 0.5 },
  bar: { at: [-0.27, 0.92, 0.06], raise: 0.4, tilt: 0.45 },
  // lata pequena: não aparece de longe (como o apito)
  spray: null,
};

/** ações (chave em actions.ts) que ERGUEM o item na multidão instanciada; as de balançar também oscilam */
export const RAISE_ACTIONS = new Set(['sign_raise', 'flag_raise', 'arm_up', 'arms_up', 'cheer', 'fist_up', 'banner_hold', 'megaphone', 'jump_cheer']);
export const WAVE_ACTIONS = new Set(['sign_wave', 'flag_wave', 'wave']);

/**
 * LOD do tecido (bandeira/faixa): 0 = malha subdividida + ondulação completa (perto, com esqueleto);
 * 1 = poucos segmentos + shader barato (esqueleto distante); 2 = instanciado (multidão sem esqueleto).
 */
export type ClothLod = 0 | 1 | 2;
export function clothLodFor(skinned: boolean, detail: boolean): ClothLod {
  return !skinned ? 2 : detail ? 0 : 1;
}

/** segmentos (x, y) da malha do tecido por tipo e LOD — o tamanho do tecido define a densidade */
export function clothSegments(kind: 'flag_small' | 'flag_large' | 'banner' | 'big', lod: ClothLod): [number, number] {
  const near: Record<typeof kind, [number, number]> = { flag_small: [20, 12], flag_large: [40, 26], banner: [36, 8], big: [48, 32] };
  const far: Record<typeof kind, [number, number]> = { flag_small: [5, 2], flag_large: [8, 4], banner: [8, 2], big: [12, 6] };
  return lod === 0 ? near[kind] : far[kind];
}

/** todos os itens do registro têm pegada (e o modo two_hand diz como) — usado pelos testes */
export function gripTableComplete(): string[] {
  const missing: string[] = [];
  for (const p of PROPS) {
    const g = PROP_GRIPS[p.kind];
    if (!g) { missing.push(p.kind); continue; }
    if (g.mode === 'two_hand' && !g.twoHand) missing.push(`${p.kind}:twoHand`);
    if (!(p.kind in FAR_PLACEMENT)) missing.push(`${p.kind}:far`);
  }
  return missing;
}

/** U espelhado dentro da célula do atlas (verso do tecido: o texto fica legível dos dois lados) */
export function mirrorU(u: number, u0: number, du: number): number {
  return u0 + du - (u - u0);
}
