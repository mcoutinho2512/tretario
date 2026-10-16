/**
 * Tipos de corpo e aparência dos personagens (jogador, NPCs e futuros jogadores remotos).
 * Tudo em dados: fácil de sincronizar pela rede (apenas o `CharacterAppearance` trafega).
 */

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

/** Aparência determinística a partir de uma semente (NPCs reproduzíveis). */
export function randomAppearance(seed: number, body?: BodyType): CharacterAppearance {
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
  return {
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
}

export const DEFAULT_PLAYER_APPEARANCE: Record<BodyType, CharacterAppearance> = {
  homem: { body: 'homem', skin: 0xb98a68, hair: 0x1d1714, top: 0x2f6f8f, bottom: 0x2c3a52, shoes: 0xe8e8e2, scale: 1 },
  mulher: { body: 'mulher', skin: 0xc68b62, hair: 0x2b1c12, top: 0xd23c3c, bottom: 0x1f2430, shoes: 0xe8e8e2, scale: 1 },
  idoso: { body: 'idoso', skin: 0xe0ac85, hair: 0xd6d2cc, top: 0xe8e6e0, bottom: 0x6b5a45, shoes: 0x5a3a22, scale: 1 },
  idosa: { body: 'idosa', skin: 0xa86e4a, hair: 0xbdb8b0, top: 0x8c4a9e, bottom: 0x24395e, shoes: 0x222222, scale: 1 },
};
