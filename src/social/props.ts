/**
 * Itens seguráveis (props) — registro ÚNICO. Geometria compartilhada por tipo; o que muda entre duas bandeiras
 * é só o DESIGN (textura/atlas, ver designs.ts) — nunca uma geometria nova por design.
 *
 * Pegada (grip):
 *  - hand_r / hand_l: uma mão (bandeira pequena, megafone, apito, guarda-chuva, taco, barra, spray)
 *  - two_hand: duas mãos (cartaz grande, placa dupla, faixa, bandeira grande, percussão)
 *  - back: nas costas (bandeira grande enrolada, por exemplo, quando não está em uso)
 *
 * Categoria (rodada 9): `SOCIAL` (padrão — qualquer um pega pela roda de ações) ou `COMBAT_PROP` (item de confronto:
 * taco, barra, spray). Item de confronto NÃO sai do nada: vem de um ponto de apoio/chão (server/src/items, mensagens
 * `item_*`) e só vai para a mão de quem o possui (actionRules.validateProp). Os golpes são DEFINIÇÕES do sistema de
 * confronto (src/combat/types.ts CombatActionDefinition, `requiredItem` = kind), resolvidos só no servidor e só onde
 * a política de zona/evento permite (src/combat/policy.ts) — valores de jogo, sem lesão.
 */
export type PropKind =
  | 'flag_small' | 'flag_large'
  | 'sign_small' | 'sign_large' | 'sign_double' | 'banner'
  | 'megaphone' | 'whistle' | 'umbrella' | 'drum' | 'bat' | 'bar' | 'spray';

/** categoria do item (rodada 9) */
export type PropCategory = 'SOCIAL' | 'COMBAT_PROP';

export type PropGrip = 'hand_r' | 'hand_l' | 'two_hand' | 'back';
/** qual família de design o item aceita (atlas de texturas) */
export type DesignSlot = 'flag' | 'sign' | 'banner';

export interface PropDefinition {
  /** u8 estável (rede). 0 = mãos vazias */
  id: number;
  kind: PropKind;
  label: string;
  grip: PropGrip;
  /** pose de carregar (camada superior do animador) quando nenhuma ação está ativa */
  carryClip: string;
  designSlot?: DesignSlot;
  /** dimensões nominais (m): para colisão visual com a mão e LOD */
  size: [number, number, number];
  /** peso na multidão de NPCs que carrega algo */
  crowdWeight: number;
  /** rodada 9 — ausente = 'SOCIAL'; 'COMBAT_PROP' só vem do chão/ponto de apoio (nunca da roda, nunca na multidão) */
  category?: PropCategory;
}

const P = (d: PropDefinition) => d;

export const PROPS: readonly PropDefinition[] = [
  P({ id: 1, kind: 'flag_small', label: 'Bandeira pequena', grip: 'hand_r', carryClip: 'carry_flag_small', designSlot: 'flag', size: [0.9, 1.4, 0.02], crowdWeight: 6 }),
  P({ id: 2, kind: 'flag_large', label: 'Bandeira grande', grip: 'two_hand', carryClip: 'carry_flag_large', designSlot: 'flag', size: [2.2, 3.2, 0.03], crowdWeight: 3 }),
  P({ id: 3, kind: 'sign_small', label: 'Cartaz', grip: 'two_hand', carryClip: 'carry_sign', designSlot: 'sign', size: [0.5, 0.95, 0.02], crowdWeight: 5 }),
  P({ id: 4, kind: 'sign_large', label: 'Cartaz grande', grip: 'two_hand', carryClip: 'carry_sign', designSlot: 'sign', size: [0.8, 1.25, 0.02], crowdWeight: 3 }),
  P({ id: 5, kind: 'sign_double', label: 'Placa dupla', grip: 'two_hand', carryClip: 'carry_sign', designSlot: 'sign', size: [0.6, 1.1, 0.06], crowdWeight: 1 }),
  P({ id: 6, kind: 'banner', label: 'Faixa', grip: 'two_hand', carryClip: 'carry_banner', designSlot: 'banner', size: [2.4, 0.7, 0.01], crowdWeight: 1 }),
  P({ id: 7, kind: 'megaphone', label: 'Megafone', grip: 'hand_r', carryClip: 'carry_megaphone', size: [0.18, 0.18, 0.35], crowdWeight: 1 }),
  P({ id: 8, kind: 'whistle', label: 'Apito', grip: 'hand_r', carryClip: 'carry_small', size: [0.05, 0.03, 0.03], crowdWeight: 1 }),
  P({ id: 9, kind: 'umbrella', label: 'Guarda-chuva', grip: 'hand_r', carryClip: 'carry_umbrella', size: [1.0, 0.9, 1.0], crowdWeight: 1 }),
  P({ id: 10, kind: 'drum', label: 'Percussão', grip: 'two_hand', carryClip: 'carry_drum', size: [0.4, 0.3, 0.4], crowdWeight: 1 }),
  // itens de confronto (rodada 9): pegos no chão/apoio, golpes definidos em dados (public/gameplay/combat.json)
  P({ id: 11, kind: 'bat', label: 'Taco', grip: 'hand_r', carryClip: 'carry_bat', size: [0.07, 0.85, 0.07], crowdWeight: 0, category: 'COMBAT_PROP' }),
  P({ id: 12, kind: 'bar', label: 'Barra de ferro', grip: 'hand_r', carryClip: 'carry_bar', size: [0.04, 0.8, 0.04], crowdWeight: 0, category: 'COMBAT_PROP' }),
  P({ id: 13, kind: 'spray', label: 'Spray de pimenta', grip: 'hand_r', carryClip: 'carry_spray', size: [0.05, 0.19, 0.05], crowdWeight: 0, category: 'COMBAT_PROP' }),
];

export const PROP_BY_ID = new Map(PROPS.map((p) => [p.id, p]));
export const PROP_BY_KIND = new Map(PROPS.map((p) => [p.kind, p]));
export const NO_PROP = 0;

/** item de confronto (categoria COMBAT_PROP) */
export const isCombatProp = (id: number) => PROP_BY_ID.get(id)?.category === 'COMBAT_PROP';
/** itens que qualquer um pega pela roda de ações (sociais) */
export const SOCIAL_PROPS: readonly PropDefinition[] = PROPS.filter((p) => p.category !== 'COMBAT_PROP');
