/**
 * Tipos de corpo e aparência dos personagens (jogador, NPCs e futuros jogadores remotos).
 * Tudo em dados: fácil de sincronizar pela rede (apenas o `CharacterAppearance` trafega).
 */
import { DESIGNS } from '../social/designs';
import type { BottomStyle, HairStyle, ShoeStyle, TopStyle } from './garments';

export type BodyType = 'homem' | 'mulher' | 'idoso' | 'idosa';

export interface BodyParams {
  label: string;
  height: number; // altura total (m)
  shoulder: number; // meia-largura dos ombros
  hip: number; // meia-largura do quadril
  chest: number; // raio do tórax
  belly: number; // volume abdominal (0–1)
  posture: number; // curvatura (0 ereto … 1 curvado)
  speedFactor: number; // fator de velocidade de caminhada
  strideFactor: number;
  hair: 'curto' | 'longo' | 'coque' | 'calvo';
  lowerWear: 'calca' | 'saia' | 'bermuda';
}

export const BODY_TYPES: Record<BodyType, BodyParams> = {
  homem: { label: 'Homem', height: 1.76, shoulder: 0.205, hip: 0.098, chest: 0.17, belly: 0.25, posture: 0, speedFactor: 1, strideFactor: 1, hair: 'curto', lowerWear: 'calca' },
  mulher: { label: 'Mulher', height: 1.64, shoulder: 0.178, hip: 0.112, chest: 0.155, belly: 0.15, posture: 0, speedFactor: 0.97, strideFactor: 0.94, hair: 'longo', lowerWear: 'calca' },
  idoso: { label: 'Idoso', height: 1.69, shoulder: 0.195, hip: 0.1, chest: 0.168, belly: 0.55, posture: 0.55, speedFactor: 0.72, strideFactor: 0.78, hair: 'calvo', lowerWear: 'calca' },
  idosa: { label: 'Idosa', height: 1.57, shoulder: 0.172, hip: 0.115, chest: 0.158, belly: 0.45, posture: 0.45, speedFactor: 0.68, strideFactor: 0.75, hair: 'coque', lowerWear: 'saia' },
};

export interface CharacterAppearance {
  body: BodyType;
  skin: number; // cor (hex)
  hair: number;
  top: number; // camisa/blusa
  bottom: number; // calça/saia/bermuda
  shoes: number;
  /** variação de altura (multiplicador ~0.94–1.06) */
  scale: number;
  /** acessório (variante de geometria compartilhada) e sua cor */
  accessory?: Accessory;
  acc?: number;
  // ---- variantes de peça (garments.ts; ausente = roupa base do corpo — aparências antigas continuam válidas)
  topStyle?: TopStyle;
  bottomStyle?: BottomStyle;
  shoeStyle?: ShoeStyle;
  hairStyle?: HairStyle;
  /** camisa com design (social/designs.ts, alvo 'shirt' — cores de futebol); 0/ausente = lisa na cor `top` */
  shirtDesign?: number;
}

export type Accessory = 'nenhum' | 'bone' | 'mochila' | 'bolsa' | 'oculos' | 'chapeu';
export const ACCESSORIES: Accessory[] = ['nenhum', 'bone', 'mochila', 'bolsa', 'oculos', 'chapeu'];

// paleta de tons de pele (diversidade brasileira)
export const SKIN_TONES = [0xf1c8a5, 0xe0ac85, 0xc68b62, 0xa86e4a, 0x8a5636, 0x6b3f26, 0x4f2d1b];
export const HAIR_YOUNG = [0x1c1410, 0x2b1c12, 0x3d2a1a, 0x5a3a1e, 0x8a6a3a, 0x141414];
export const HAIR_OLD = [0xd6d2cc, 0xbdb8b0, 0x9a958e, 0xe8e6e0];
export const TOPS = [0x2f6f8f, 0xe8e6e0, 0xd23c3c, 0x2e7d4f, 0xf2c230, 0x1e2a44, 0x8c4a9e, 0xf08a3c, 0x6fa8c8, 0xf4f1ea, 0x333333, 0xc9b38a];
export const BOTTOMS = [0x2c3a52, 0x1f2430, 0x6b5a45, 0x3d3d3d, 0x8a8f96, 0x24395e, 0xc8bfa8];
export const SHOES = [0xe8e8e2, 0x222222, 0x5a3a22, 0x3a4a6a, 0xb0b0b0];

type Weights<T> = [T, number][];
/** peças plausíveis por corpo (pesos): idosos quase nunca de regata; calçado depende da calça (abaixo) */
const TOP_W: Record<BodyType, Weights<TopStyle>> = {
  homem: [['camiseta', 45], ['regata', 16], ['polo', 16], ['camisa', 14]],
  mulher: [['camiseta', 50], ['regata', 26], ['camisa', 24]],
  idoso: [['polo', 45], ['camiseta', 30], ['camisa', 25]],
  idosa: [['camiseta', 50], ['camisa', 42], ['regata', 8]],
};
const BOTTOM_W: Record<BodyType, Weights<BottomStyle>> = {
  homem: [['jeans', 44], ['bermuda', 36], ['social', 20]],
  mulher: [['jeans', 45], ['bermuda', 30], ['social', 25]],
  idoso: [['social', 55], ['bermuda', 25], ['jeans', 20]],
  idosa: [['social', 60], ['jeans', 30], ['bermuda', 10]],
};
/** calçado pela calça: bermuda com tênis/chinelo, calça social com sapato */
const SHOE_W: Record<BottomStyle, Weights<ShoeStyle>> = {
  jeans: [['tenis', 70], ['sapato', 24], ['chinelo', 6]],
  social: [['sapato', 72], ['tenis', 28]],
  bermuda: [['tenis', 52], ['chinelo', 44], ['sapato', 4]],
};
const HAIR_W: Record<BodyType, Weights<HairStyle>> = {
  homem: [['curto', 38], ['curto2', 26], ['raspado', 20], ['afro', 16]],
  mulher: [['rabo', 30], ['chanel', 24], ['longo', 26], ['afro', 20]],
  idoso: [['curto', 62], ['raspado', 38]],
  idosa: [['chanel', 60], ['curto', 40]],
};

export interface AppearanceOptions {
  /** fração com camisa de futebol (cores/padrões, sem escudos): ~6 % no dia a dia, 15–25 % num ato/evento */
  football?: number;
}

/** Aparência determinística a partir de uma semente (NPCs reproduzíveis). */
export function randomAppearance(seed: number, body?: BodyType, opts: AppearanceOptions = {}): CharacterAppearance {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const types: BodyType[] = ['homem', 'homem', 'mulher', 'mulher', 'idoso', 'idosa'];
  const b = body ?? pick(types);
  const old = b === 'idoso' || b === 'idosa';
  const accPool: Accessory[] = old ? ['nenhum', 'chapeu', 'oculos', 'bolsa', 'nenhum'] : ['nenhum', 'bone', 'mochila', 'bolsa', 'oculos', 'nenhum', 'mochila'];
  const weighted = <T,>(w: [T, number][]): T => {
    let r = rnd() * w.reduce((t, [, n]) => t + n, 0);
    for (const [v, n] of w) if ((r -= n) < 0) return v;
    return w[0][0];
  };
  const app: CharacterAppearance = {
    accessory: pick(accPool),
    acc: pick([0x1f1f1f, 0x2b4a7a, 0x8a2a2a, 0xd8d0c0, 0x3d6b3d, 0x6b4a2a, 0xe0b030]),
    body: b,
    skin: pick(SKIN_TONES),
    hair: old ? pick(HAIR_OLD) : pick(HAIR_YOUNG),
    top: pick(TOPS),
    bottom: pick(BOTTOMS),
    shoes: pick(SHOES),
    scale: 0.94 + rnd() * 0.12,
  };
  // peças (sorteios depois das cores: as cores de uma semente continuam as mesmas de antes)
  app.topStyle = weighted(TOP_W[b]);
  app.bottomStyle = weighted(BOTTOM_W[b]);
  app.shoeStyle = weighted(SHOE_W[app.bottomStyle]);
  app.hairStyle = weighted(HAIR_W[b]);
  // camisa de futebol: modelo camiseta, cor de base = fundo do design (a multidão distante sem padrão fica parecida)
  if (rnd() < (opts.football ?? 0.06) * (old ? 0.5 : 1)) {
    const d = weighted(footballWeights());
    app.shirtDesign = d;
    app.topStyle = 'camiseta';
    const bg = DESIGNS.find((x) => x.id === d)?.palette.bg;
    if (bg) app.top = parseInt(bg.slice(1), 16);
  }
  return app;
}

let footballW: [number, number][] | null = null;
/** camisas de futebol pelo peso na multidão (designs.ts `crowdWeight`) */
function footballWeights(): [number, number][] {
  return (footballW ??= DESIGNS.filter((d) => d.family === 'football' && d.targets.includes('shirt') && (d.crowdWeight ?? 0) > 0)
    .map((d) => [d.id, d.crowdWeight!]));
}

export const DEFAULT_PLAYER_APPEARANCE: Record<BodyType, CharacterAppearance> = {
  homem: { body: 'homem', skin: 0xb98a68, hair: 0x1d1714, top: 0x2f6f8f, bottom: 0x2c3a52, shoes: 0xe8e8e2, scale: 1 },
  mulher: { body: 'mulher', skin: 0xc68b62, hair: 0x2b1c12, top: 0xd23c3c, bottom: 0x1f2430, shoes: 0xe8e8e2, scale: 1 },
  idoso: { body: 'idoso', skin: 0xe0ac85, hair: 0xd6d2cc, top: 0xe8e6e0, bottom: 0x6b5a45, shoes: 0x5a3a22, scale: 1 },
  idosa: { body: 'idosa', skin: 0xa86e4a, hair: 0xbdb8b0, top: 0x8c4a9e, bottom: 0x24395e, shoes: 0x222222, scale: 1 },
};
