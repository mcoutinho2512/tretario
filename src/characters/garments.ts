/**
 * Peças de roupa e cabelo VARIANTES por corpo (sem novos esqueletos): cada corpo tem a roupa base dentro do próprio
 * GLB e peças alternativas em GLBs avulsos (`<corpo>-<camada>-<estilo>.glb` + `_lod1`), ajustadas àquele corpo no
 * mesmo esqueleto e baixadas só quando alguém as veste de perto (LOD0/LOD1). Nos LODs de malha única (LOD2/LOD3) e
 * na multidão instanciada as variantes são APROXIMADAS no shader (regata = braço com cor de pele, bermuda = canela
 * com cor de pele, chinelo, cabeça raspada, manga longa) — ver human/garmentShader.ts.
 *
 * Puro (sem three.js): usado pelo cliente, pelo servidor (validação) e pelos testes.
 * DEVE casar com tools/character/variants/<corpo>.json ("styles" + "variants") — tests/garments.test.ts confere.
 * Ordem das listas = índice empacotado na rede/multidão: só ACRESCENTE no fim.
 */
import type { BodyType } from './bodyTypes';

export const TOP_STYLES = ['camiseta', 'regata', 'polo', 'camisa'] as const;
export const BOTTOM_STYLES = ['jeans', 'social', 'bermuda'] as const;
export const SHOE_STYLES = ['tenis', 'sapato', 'chinelo'] as const;
export const HAIR_STYLES = ['curto', 'curto2', 'raspado', 'afro', 'rabo', 'chanel', 'longo'] as const;
export type TopStyle = (typeof TOP_STYLES)[number];
export type BottomStyle = (typeof BOTTOM_STYLES)[number];
export type ShoeStyle = (typeof SHOE_STYLES)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];

export const STYLE_LABELS: Record<TopStyle | BottomStyle | ShoeStyle | HairStyle, string> = {
  camiseta: 'Camiseta', regata: 'Regata', polo: 'Polo', camisa: 'Camisa / blusa',
  jeans: 'Jeans', social: 'Calça social', bermuda: 'Bermuda / short',
  tenis: 'Tênis', sapato: 'Sapato', chinelo: 'Chinelo',
  curto: 'Curto', curto2: 'Curto (topete)', raspado: 'Raspado', afro: 'Crespo', rabo: 'Rabo de cavalo', chanel: 'Chanel', longo: 'Longo',
};

/** camadas com variantes (nomes das malhas no GLB) */
export type GarmentSlot = 'SHIRT' | 'PANTS' | 'SHOES' | 'HAIR';
export const GARMENT_SLOTS: GarmentSlot[] = ['SHIRT', 'PANTS', 'SHOES', 'HAIR'];

export interface SlotGarments {
  /** estilo da peça que já vem no GLB do corpo */
  base: string;
  /** estilos com GLB próprio */
  pieces: string[];
  /** estilos SEM malha (cabelo raspado/calvo) */
  bare?: string[];
}

/** o que cada corpo pode vestir (espelha os configs do Blender) */
export const BODY_GARMENTS: Record<BodyType, Record<GarmentSlot, SlotGarments>> = {
  homem: {
    SHIRT: { base: 'camiseta', pieces: ['regata', 'polo', 'camisa'] },
    PANTS: { base: 'jeans', pieces: ['bermuda', 'social'] },
    SHOES: { base: 'tenis', pieces: ['chinelo', 'sapato'] },
    HAIR: { base: 'curto', pieces: ['afro', 'curto2'], bare: ['raspado'] },
  },
  mulher: {
    SHIRT: { base: 'camiseta', pieces: ['regata', 'camisa'] },
    PANTS: { base: 'jeans', pieces: ['bermuda', 'social'] },
    SHOES: { base: 'tenis', pieces: ['chinelo', 'sapato'] },
    HAIR: { base: 'rabo', pieces: ['afro', 'chanel', 'longo'] },
  },
  idoso: {
    SHIRT: { base: 'polo', pieces: ['camiseta', 'camisa'] },
    PANTS: { base: 'social', pieces: ['bermuda', 'jeans'] },
    SHOES: { base: 'sapato', pieces: ['tenis', 'chinelo'] },
    HAIR: { base: 'curto', pieces: [], bare: ['raspado'] },
  },
  idosa: {
    SHIRT: { base: 'camiseta', pieces: ['camisa', 'regata'] },
    PANTS: { base: 'social', pieces: ['jeans', 'bermuda'] },
    SHOES: { base: 'sapato', pieces: ['tenis', 'chinelo'] },
    HAIR: { base: 'chanel', pieces: ['curto'] },
  },
};

/** campos da aparência por camada */
export const SLOT_FIELD = { SHIRT: 'topStyle', PANTS: 'bottomStyle', SHOES: 'shoeStyle', HAIR: 'hairStyle' } as const;
export type StyleFields = { topStyle?: TopStyle; bottomStyle?: BottomStyle; shoeStyle?: ShoeStyle; hairStyle?: HairStyle };

/** estilos que este corpo veste nesta camada (base primeiro) */
export function stylesFor(body: BodyType, slot: GarmentSlot): string[] {
  const g = BODY_GARMENTS[body]?.[slot];
  return g ? [g.base, ...g.pieces, ...(g.bare ?? [])] : [];
}

/** estilo efetivo: o pedido, se o corpo o tiver; senão o da roupa base (aparências antigas/estranhas continuam válidas) */
export function resolveStyle(body: BodyType, slot: GarmentSlot, style: string | undefined): string {
  const g = BODY_GARMENTS[body]?.[slot];
  if (!g) return '';
  return style && (style === g.base || g.pieces.includes(style) || g.bare?.includes(style)) ? style : g.base;
}

/** os quatro estilos efetivos de uma aparência */
export function resolvedStyles(a: { body: BodyType } & StyleFields): Record<GarmentSlot, string> {
  return {
    SHIRT: resolveStyle(a.body, 'SHIRT', a.topStyle),
    PANTS: resolveStyle(a.body, 'PANTS', a.bottomStyle),
    SHOES: resolveStyle(a.body, 'SHOES', a.shoeStyle),
    HAIR: resolveStyle(a.body, 'HAIR', a.hairStyle),
  };
}

export type PieceKind = 'base' | 'piece' | 'bare';
export function pieceKind(body: BodyType, slot: GarmentSlot, style: string): PieceKind {
  const g = BODY_GARMENTS[body][slot];
  return style === g.base ? 'base' : g.bare?.includes(style) ? 'bare' : 'piece';
}

/** arquivo da peça avulsa (só LOD0/LOD1; nos LODs de malha única as variantes são aproximadas no shader) */
export function pieceFile(body: BodyType, slot: GarmentSlot, style: string, lod: 0 | 1): string {
  return `${body}-${slot.toLowerCase()}-${style}${lod === 1 ? '_lod1' : ''}.glb`;
}

/**
 * Aparência empacotada num inteiro (multidão instanciada): índices nas listas globais.
 * bits 0–2 camisa · 3–4 calça · 5–6 calçado · 7 sem cabelo
 */
export function packLook(a: { body: BodyType } & StyleFields): number {
  const s = resolvedStyles(a);
  const ti = Math.max(0, TOP_STYLES.indexOf(s.SHIRT as TopStyle));
  const bi = Math.max(0, BOTTOM_STYLES.indexOf(s.PANTS as BottomStyle));
  const si = Math.max(0, SHOE_STYLES.indexOf(s.SHOES as ShoeStyle));
  const bare = pieceKind(a.body, 'HAIR', s.HAIR) === 'bare' ? 1 : 0;
  return ti | (bi << 3) | (si << 5) | (bare << 7);
}
export function unpackLook(v: number) {
  return { top: TOP_STYLES[v & 7] ?? 'camiseta', bottom: BOTTOM_STYLES[(v >> 3) & 3] ?? 'jeans', shoes: SHOE_STYLES[(v >> 5) & 3] ?? 'tenis', bare: ((v >> 7) & 1) === 1 };
}
