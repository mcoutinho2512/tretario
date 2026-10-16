/**
 * Estado social de UM personagem (jogador local, remoto ou NPC) — a mesma estrutura alimenta o esqueleto
 * (`HumanCharacter.setSocial`), os itens na mão (`PropAttachment`) e a multidão instanciada (`CrowdAgent`).
 */
export interface SocialState {
  /** ação (ACTIONS id; 0 = nenhuma) */
  act: number;
  /** segundos desde o início da ação (relógio comum: todos os clientes tocam a mesma fase) */
  phase: number;
  /** variação 0..7 (desfasamento/espelho; NPCs: semente) */
  variation: number;
  /** item segurado (PROPS id; 0 = mãos vazias) */
  prop: number;
  /** design do item (DESIGNS id; 0 = padrão) */
  design: number;
}

export const EMPTY_SOCIAL: Readonly<SocialState> = Object.freeze({ act: 0, phase: 0, variation: 0, prop: 0, design: 0 });
