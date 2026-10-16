/**
 * Ações sociais / emotes — registro ÚNICO (cliente, servidor, NPCs, roda de ações, rede).
 *
 * Uma ação é DADO, não código: para criar uma nova, acrescente uma `ActionDefinition` aqui e um clipe com o
 * nome em `clip` (biblioteca `anims.glb` ou clipe procedural em `src/characters/human/proceduralClips.ts`).
 * O animador toca qualquer ação pelo mesmo caminho (camada de ação com crossfade sobre a locomoção).
 *
 * Rede: só o `id` (u8) + instante de início (relógio do servidor) + variação vão pela rede — nunca ossos.
 * Ids são ESTÁVEIS: nunca reaproveite um id removido.
 */
import type { PropKind } from './props';

export type ActionCategory = 'gestos' | 'manifestacao' | 'danca' | 'itens';
export const ACTION_CATEGORIES: { key: ActionCategory; label: string }[] = [
  { key: 'gestos', label: 'GESTOS' },
  { key: 'manifestacao', label: 'MANIFESTAÇÃO' },
  { key: 'danca', label: 'DANÇA' },
  { key: 'itens', label: 'ITENS' },
];

export interface ActionDefinition {
  /** u8 estável (rede). 0 = nenhuma */
  id: number;
  key: string;
  /** rótulo na roda de ações */
  label: string;
  category: ActionCategory;
  /** nome do clipe tocado pelo animador */
  clip: string;
  /** loop: continua até cancelar · once: toca `duration` s e volta */
  mode: 'loop' | 'once';
  /** duração (s) das ações `once` (o servidor encerra o estado depois disso) */
  duration?: number;
  /**
   * full: corpo inteiro (pernas inclusas; movimento cancela) ·
   * upper: só tronco/braços/cabeça — as pernas seguem a locomoção (dá para andar fazendo)
   */
  layer: 'full' | 'upper';
  /** mover-se NÃO cancela (andar com bandeira/cartaz, megafone andando, aplaudir andando) */
  allowMove: boolean;
  /** precisa de um item na mão deste tipo (o servidor valida); a ação usa o item que o jogador segura */
  needs?: PropKind[];
  /** peso padrão na multidão de NPCs (0 = NPCs não usam) */
  crowdWeight?: number;
  /** a multidão instanciada (VAT, distante) tem versão simplificada assada? → nome do clipe assado */
  crowdClip?: string;
}

const A = (d: ActionDefinition) => d;

export const ACTIONS: readonly ActionDefinition[] = [
  // ---------------------------------------------------------------- gestos (sociais)
  A({ id: 1, key: 'wave', label: 'Acenar', category: 'gestos', clip: 'emote_wave', mode: 'once', duration: 2.4, layer: 'upper', allowMove: true, crowdWeight: 3, crowdClip: 'emote_wave' }),
  A({ id: 2, key: 'clap', label: 'Bater palmas', category: 'gestos', clip: 'emote_clap', mode: 'loop', layer: 'upper', allowMove: true, crowdWeight: 5, crowdClip: 'emote_clap' }),
  A({ id: 3, key: 'point', label: 'Apontar', category: 'gestos', clip: 'emote_point', mode: 'once', duration: 2.0, layer: 'upper', allowMove: true, crowdWeight: 1 }),
  A({ id: 4, key: 'cheer', label: 'Comemorar', category: 'gestos', clip: 'emote_cheer', mode: 'once', duration: 2.6, layer: 'upper', allowMove: true, crowdWeight: 3, crowdClip: 'emote_arms_up' }),
  A({ id: 5, key: 'arm_up', label: 'Levantar um braço', category: 'gestos', clip: 'emote_arm_up', mode: 'loop', layer: 'upper', allowMove: true, crowdWeight: 2, crowdClip: 'emote_arms_up' }),
  A({ id: 6, key: 'arms_up', label: 'Levantar os dois braços', category: 'gestos', clip: 'emote_arms_up', mode: 'loop', layer: 'upper', allowMove: true, crowdWeight: 3, crowdClip: 'emote_arms_up' }),
  A({ id: 7, key: 'thumbs_up', label: 'Sinal positivo', category: 'gestos', clip: 'emote_thumbs_up', mode: 'once', duration: 1.8, layer: 'upper', allowMove: true, crowdWeight: 1 }),
  A({ id: 8, key: 'talk', label: 'Gesticular (conversa)', category: 'gestos', clip: 'emote_talk', mode: 'loop', layer: 'upper', allowMove: false, crowdWeight: 6 }),
  A({ id: 9, key: 'photo', label: 'Pose para foto', category: 'gestos', clip: 'emote_photo', mode: 'loop', layer: 'full', allowMove: false, crowdWeight: 1 }),
  A({ id: 10, key: 'sit', label: 'Sentar no chão', category: 'gestos', clip: 'emote_sit_ground', mode: 'loop', layer: 'full', allowMove: false, crowdWeight: 1 }),
  A({ id: 11, key: 'jump_cheer', label: 'Pular comemorando', category: 'gestos', clip: 'emote_jump_cheer', mode: 'once', duration: 2.2, layer: 'full', allowMove: false, crowdWeight: 1 }),
  A({ id: 12, key: 'phone', label: 'Filmar com o celular', category: 'gestos', clip: 'emote_phone', mode: 'loop', layer: 'upper', allowMove: true, crowdWeight: 2 }),
  // ---------------------------------------------------------------- manifestação
  A({ id: 20, key: 'sign_raise', label: 'Levantar cartaz', category: 'manifestacao', clip: 'prop_sign_raise', mode: 'loop', layer: 'upper', allowMove: true, needs: ['sign_small', 'sign_large', 'sign_double'], crowdWeight: 4, crowdClip: 'emote_arms_up' }),
  A({ id: 21, key: 'sign_wave', label: 'Balançar cartaz', category: 'manifestacao', clip: 'prop_sign_wave', mode: 'loop', layer: 'upper', allowMove: true, needs: ['sign_small', 'sign_large', 'sign_double'], crowdWeight: 3, crowdClip: 'emote_arms_up' }),
  A({ id: 22, key: 'flag_raise', label: 'Levantar bandeira', category: 'manifestacao', clip: 'prop_flag_raise', mode: 'loop', layer: 'upper', allowMove: true, needs: ['flag_small', 'flag_large'], crowdWeight: 4, crowdClip: 'emote_arm_up' }),
  A({ id: 23, key: 'flag_wave', label: 'Balançar bandeira', category: 'manifestacao', clip: 'prop_flag_wave', mode: 'loop', layer: 'upper', allowMove: true, needs: ['flag_small', 'flag_large'], crowdWeight: 4, crowdClip: 'emote_arm_up' }),
  A({ id: 24, key: 'megaphone', label: 'Usar megafone', category: 'manifestacao', clip: 'prop_megaphone', mode: 'loop', layer: 'upper', allowMove: true, needs: ['megaphone'], crowdWeight: 1 }),
  A({ id: 25, key: 'rhythm_clap', label: 'Palmas ritmadas', category: 'manifestacao', clip: 'emote_rhythm_clap', mode: 'loop', layer: 'upper', allowMove: true, crowdWeight: 4, crowdClip: 'emote_clap' }),
  A({ id: 26, key: 'banner_hold', label: 'Erguer faixa', category: 'manifestacao', clip: 'prop_banner_hold', mode: 'loop', layer: 'upper', allowMove: true, needs: ['banner'], crowdWeight: 1 }),
  A({ id: 27, key: 'fist_up', label: 'Punho erguido', category: 'manifestacao', clip: 'emote_fist_up', mode: 'loop', layer: 'upper', allowMove: true, crowdWeight: 2, crowdClip: 'emote_arm_up' }),
  A({ id: 28, key: 'drum', label: 'Tocar percussão', category: 'manifestacao', clip: 'prop_drum', mode: 'loop', layer: 'upper', allowMove: true, needs: ['drum'], crowdWeight: 1 }),
  A({ id: 29, key: 'whistle', label: 'Apitar', category: 'manifestacao', clip: 'prop_whistle', mode: 'once', duration: 1.6, layer: 'upper', allowMove: true, needs: ['whistle'], crowdWeight: 1 }),
  // ---------------------------------------------------------------- dança (movimentos genéricos, sem coreografia de terceiros)
  A({ id: 40, key: 'dance_simple', label: 'Dança simples', category: 'danca', clip: 'dance_simple', mode: 'loop', layer: 'full', allowMove: false, crowdWeight: 3, crowdClip: 'dance_simple' }),
  A({ id: 41, key: 'dance_lively', label: 'Dança animada', category: 'danca', clip: 'dance_lively', mode: 'loop', layer: 'full', allowMove: false, crowdWeight: 2, crowdClip: 'dance_lively' }),
  A({ id: 42, key: 'dance_arms', label: 'Dança com braços', category: 'danca', clip: 'dance_arms', mode: 'loop', layer: 'full', allowMove: false, crowdWeight: 2, crowdClip: 'dance_arms' }),
  A({ id: 43, key: 'dance_party', label: 'Dança de festa', category: 'danca', clip: 'dance_party', mode: 'loop', layer: 'full', allowMove: false, crowdWeight: 2, crowdClip: 'dance_party' }),
  A({ id: 44, key: 'dance_classic', label: 'Dança (biblioteca)', category: 'danca', clip: 'dance', mode: 'loop', layer: 'full', allowMove: false, crowdWeight: 1, crowdClip: 'dance' }),
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
export const ACTION_BY_KEY = new Map(ACTIONS.map((a) => [a.key, a]));
export const NO_ACTION = 0;

/** a ação pode continuar com o jogador se movendo? (ação desconhecida → não) */
export function actionAllowsMove(id: number): boolean {
  return id === NO_ACTION || !!ACTION_BY_ID.get(id)?.allowMove;
}

/** a ação terminou? (`once` depois da duração; `loop` só por cancelamento) */
export function actionExpired(id: number, startedAt: number, now: number): boolean {
  const d = ACTION_BY_ID.get(id);
  if (!d) return true;
  return d.mode === 'once' && now - startedAt > (d.duration ?? 2) * 1000;
}
