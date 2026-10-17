/**
 * CONFRONTO (rodada 9) — CONTRATO compartilhado (cliente, servidor, missões, eventos). Um sistema só (CombatSystem no
 * servidor, server/src/combat/), dirigido por DADOS (`public/gameplay/combat.json`): soco, chute, empurrão, esquiva e
 * golpes de item são DEFINIÇÕES, nunca `if (soco)` espalhado.
 *
 * Autoridade: o cliente só PEDE "executei a ação X nesta orientação" (`cbt`); o servidor decide alvo, alcance, arco,
 * janela, estado, zona/evento (src/combat/policy.ts), stamina, cooldown e resultado. Nenhuma mensagem do cliente
 * carrega alvo, dano ou acerto.
 *
 * Estilo arcade: valores de JOGO (condição abstrata, empurrão, queda), sem gore, sem lesão, sem morte, sem termo médico.
 * Grupos/torcidas: nenhuma diferença mecânica (tests/groupNeutrality.test.ts).
 */

/** estado físico (NetPlayer.status) — estende o STATUS da rodada 5 (0/1/2 mantidos; src/net/rules.ts) */
export const PHYS = { NORMAL: 0, KNOCKED_DOWN: 1, GETTING_UP: 2, STAGGERED: 3, RAGDOLL: 4 } as const;
export type PhysState = (typeof PHYS)[keyof typeof PHYS];

/** efeitos temporários (NetPlayer.fx, bits) */
export const FX = {
  /** desorientado (spray): visão menos nítida para quem sofre, reação no personagem; nada técnico/real */
  DISORIENTED: 1 << 0,
  /** proteção de retorno (spawn/levantou/reentrou): não sofre impacto */
  PROTECTED: 1 << 1,
  /** em esquiva (janela de invulnerabilidade curta) */
  DODGING: 1 << 2,
  /** em postura de confronto (HUD de confronto/stamina visível para o próprio) */
  ENGAGED: 1 << 3,
} as const;

/** categoria de ação de confronto */
export type CombatKind = 'strike' | 'push' | 'dodge' | 'spray';

/** resultado aplicado ao ALVO por um acerto válido (valores de jogo) */
export interface CombatImpact {
  /** perda de condição (0–100) */
  condition: number;
  /** deslocamento (m) na direção do golpe */
  knockback: number;
  /** estado resultante mínimo (STAGGERED/KNOCKED_DOWN); a condição em 0 sempre derruba */
  state?: 'STAGGERED' | 'KNOCKED_DOWN';
  /** duração do cambaleio / desorientação (ms) */
  staggerMs?: number;
  disorientMs?: number;
}

/** definição de ação de confronto (dados) */
export interface CombatActionDefinition {
  /** id estável u8 (nunca reaproveitar) */
  id: number;
  key: string;
  label: string;
  kind: CombatKind;
  /** clipe (src/characters/human/proceduralClips.ts ou biblioteca) */
  animation: string;
  /** tempos (ms) a partir do pedido: preparação → janela ativa → recuperação */
  windupMs: number;
  activeMs: number;
  recoveryMs: number;
  /** alcance (m, do centro do atacante) e arco (graus, total) */
  range: number;
  arcDeg: number;
  staminaCost: number;
  cooldownMs: number;
  impact: CombatImpact;
  /** estados físicos em que pode começar (padrão: só NORMAL) */
  allowedStates?: (keyof typeof PHYS)[];
  /** tipo de item na mão exigido (src/social/props.ts PropKind); ausente = mãos livres ou qualquer */
  requiredItem?: string;
  /** só com as mãos vazias (soco/empurrão) */
  bareHanded?: boolean;
  /** combo: id da ação anterior e janela (ms) para encadear; o combo pode trocar a animação/impacto */
  comboFrom?: number;
  comboWindowMs?: number;
  /** esquiva: duração da invulnerabilidade e deslocamento */
  iFramesMs?: number;
  dashM?: number;
  /** (rodada 9, aditivo) variante de combo: id da ação BASE que o cliente pede (o servidor troca por esta) */
  comboOf?: number;
  /** (aditivo) máximo de alvos por golpe (padrão 1: o mais próximo no arco; spray atinge vários) */
  maxTargets?: number;
}

/** item de confronto: o MESMO registro de props (src/social/props.ts), categoria COMBAT_PROP */
export interface CombatPropDefinition {
  /** id do prop em props.ts */
  propId: number;
  kind: string;
  /** ações que o item habilita (ids de CombatActionDefinition) */
  actions: number[];
  /** some do chão depois de largado (ms) — política de limpeza/reset */
  groundTtlMs: number;
}

/** stamina e condição (valores de jogo) */
export interface CombatTuning {
  staminaMax: number;
  staminaRegenPerS: number;
  /** atraso da regeneração depois de gastar (ms) */
  staminaRegenDelayMs: number;
  conditionMax: number;
  conditionRegenPerS: number;
  conditionRegenDelayMs: number;
  /** derrubado: tempo no chão e levantar (ms) — teto de segurança no servidor */
  downMs: number;
  getupMs: number;
  /** proteção de retorno depois de levantar/reentrar (ms) */
  protectMs: number;
  /** tolerâncias do servidor (latência): folga de alcance (m) e de arco (graus) */
  rangeSlackM: number;
  arcSlackDeg: number;
  /** pedidos por segundo aceitos (acima: descartados + 'spam') */
  maxRequestsPerS: number;
  /** buffer de entrada no cliente (ms) */
  inputBufferMs: number;
}

export interface CombatData {
  version: 1;
  tuning: CombatTuning;
  actions: CombatActionDefinition[];
  props: CombatPropDefinition[];
  /** (aditivo) bonecos de treino: alvo do servidor (não é jogador) — cada um com uma área de treino COMBAT */
  dummies?: CombatDummyDefinition[];
}

/** boneco de treino (estilizado, não é pessoa): reage (cambaleia/cai/volta) e nunca conta como jogador */
export interface CombatDummyDefinition {
  /** id u8 estável */
  id: number;
  key: string;
  x: number; z: number; heading: number;
  /** raio (m) da área de treino em volta: política COMBAT lá dentro (áreas de paz continuam valendo) */
  areaR: number;
  conditionMax: number;
  /** caído → volta de pé (ms) */
  resetMs: number;
}

/** servidor → perto `cbt_dummy`: estado do boneco [id, x, z, heading, st (PHYS), condição 0–100] */
export type CombatDummyWire = [number, number, number, number, number, number];

/* ── protocolo ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** cliente → servidor `cbt`: pedido de ação (só intenção + orientação + seq do movimento) */
export interface CombatRequest { a: number; h: number; seq: number }
/** servidor → AOI `cbt_act`: alguém começou uma ação (todos animam igual; t = relógio comum) */
export interface CombatActEvent { by: number; a: number; h: number; t: number }
/** servidor → AOI `cbt_hit`: resultado decidido pelo servidor */
export interface CombatHitEvent {
  by: number; tgt: number; a: number;
  /** 'hit' acertou · 'dodged' esquivou · 'blocked' política (zona/evento/proteção) */
  r: 'hit' | 'dodged' | 'blocked';
  /** direção do impacto e novo estado físico do alvo */
  dx: number; dz: number; st: PhysState;
  /** (aditivo) deslocamento aplicado ao alvo (m) — o próprio alvo aplica na predição */
  kb?: number;
  /** (aditivo) o alvo é um boneco de treino (tgt = id do boneco) */
  dummy?: 1;
}
/** servidor → só o próprio `cbt_self`: stamina/condição (mudou, ≤ 5 Hz) */
export interface CombatSelf { st: number; cd: number; fx: number }
export type CombatDenial = 'zona_paz' | 'politica' | 'estado' | 'stamina' | 'cooldown' | 'spam' | 'sem_item' | 'em_veiculo' | 'acao_invalida' | 'protegido';
/** servidor → próprio `cbt_denied` */
export interface CombatDenied { a: number; reason: CombatDenial }

/** cliente → servidor `jump {seq}`; servidor valida (no chão, cooldown, estado, veículo) e responde só se negar */
export interface JumpRequest { seq: number }
export type JumpDenial = 'no_ar' | 'cooldown' | 'estado' | 'veiculo';
/** servidor → próprio `jump_denied` */
export interface JumpDenied { seq: number; reason: JumpDenial }
