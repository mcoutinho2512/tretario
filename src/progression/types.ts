/**
 * MISSÕES, PROGRESSÃO, CONQUISTAS E RECOMPENSAS (rodada 9) — CONTRATO. Tudo por DADOS:
 *   public/gameplay/missions.json      MissionDefinition[]
 *   public/gameplay/achievements.json  AchievementDefinition[]
 *   public/gameplay/levels.json        LevelCurve
 *   public/gameplay/rewards.json       catálogo de recompensas cosméticas (UnlockDefinition[])
 * O servidor avança objetivos a partir de GameplayEvent (src/gameplay/events.ts) — o cliente nunca informa progresso,
 * XP ou conclusão. Persistência no servidor (DataStore), gravada em lotes (nunca por evento).
 *
 * Neutralidade: nenhuma missão/recompensa exige grupo, lado político ou confronto com humanos para a progressão
 * básica; missões de confronto são opcionais (`optional: true`) e usam boneco de treino/eventos.
 */
import type { GameplayEventType } from '../gameplay/events';

export type MissionCategory = 'exploracao' | 'social' | 'mobilidade' | 'confronto' | 'evento';

export interface MissionObjective {
  id: string;
  label: string;
  /** tipo de GameplayEvent que conta */
  on: GameplayEventType;
  /** filtro por igualdade sobre os campos do evento (ex.: { zone: 'CENTRAL' }, { kind: 'bicycle' }) */
  where?: Record<string, string | number | boolean>;
  /** quantidade necessária (eventos) ou soma do campo `sumField` (ex.: metros) */
  count?: number;
  sumField?: string;
}

export type RewardKind = 'xp' | 'unlock' | 'title';
export interface Reward {
  kind: RewardKind;
  /** xp */
  amount?: number;
  /** unlock: chave de item (src/characters/unlocks.ts ItemKey, ex.: 'top:regata', 'shirt:200', 'action:dance_x', 'design:paz_azul') */
  item?: string;
  /** title: texto exibido no perfil */
  title?: string;
}

export interface MissionDefinition {
  id: string;
  title: string;
  description: string;
  category: MissionCategory;
  /** opcional (confronto/eventos): nunca bloqueia a progressão básica */
  optional?: boolean;
  /** missões que precisam estar concluídas antes (ordem de apresentação) */
  requires?: string[];
  /** nível mínimo para aparecer */
  minLevel?: number;
  objectives: MissionObjective[];
  rewards: Reward[];
}

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  /** como os objetivos de missão (todos precisam completar) */
  objectives: MissionObjective[];
  rewards: Reward[];
  hidden?: boolean;
  /** rodada 9: progresso só da SESSÃO (ex.: Central → Candelária na mesma visita); recomeça a cada entrada */
  session?: boolean;
}

/** XP total para chegar a cada nível (levels[0] = nível 1 = 0 XP) */
export interface LevelCurve { levels: number[]; maxLevel: number }

/** como uma peça cosmética é liberada (estende src/characters/unlocks.ts) */
export type UnlockSource = 'FREE' | 'PROGRESSION' | 'EVENT_REWARD' | 'PREMIUM_FUTURE';
export interface UnlockDefinition {
  item: string;
  label: string;
  source: UnlockSource;
  /** PROGRESSION: nível que libera (alternativa a recompensa de missão/conquista) */
  level?: number;
}

/** progresso de uma missão (servidor) */
export interface MissionProgress {
  missionId: string;
  /** objetivo → valor acumulado */
  values: Record<string, number>;
  startedAt: number;
  completedAt?: number;
}

/** progressão do jogador (servidor é a autoridade; o cliente recebe uma cópia) */
export interface PlayerProgression {
  level: number;
  xp: number;
  completedMissions: string[];
  achievements: string[];
  unlocks: string[];
  active: MissionProgress[];
  /** rodada 9 (aditivo): XP do nível atual e do próximo (null = nível máximo) — barra de XP */
  xpLevel?: number;
  xpNext?: number | null;
  /** títulos ganhos (recompensa `title`) */
  titles?: string[];
  /** missão em destaque escolhida pelo jogador (mission_track) */
  tracked?: string | null;
  /** telas de boas-vindas/dicas já vistas (contas: no servidor; visitantes: na sessão) */
  seen?: string[];
}

/* ── protocolo ─────────────────────────────────────────────────────────────────────────────────────────────────── */
/** servidor → próprio `prog`: estado completo ao entrar e a cada mudança relevante (≤ 2 Hz) */
export interface ProgressionMessage { p: PlayerProgression; persistent: boolean }
/** servidor → próprio `prog_ev`: notícia curta (objetivo/missão/conquista/nível/recompensa) */
export interface ProgressionNotice {
  kind: 'objective' | 'mission' | 'achievement' | 'level' | 'reward';
  id: string;
  label: string;
  xp?: number;
  level?: number;
  item?: string;
}
/** cliente → servidor `mission_track {id}`: escolher a missão em destaque no HUD (só preferência de UI) */
export interface MissionTrackRequest { id: string }
/** cliente → servidor `prog_seen {k}`: marcou uma tela de boas-vindas/dica como vista (só preferência de UI) */
export interface ProgressionSeenRequest { k: string }
