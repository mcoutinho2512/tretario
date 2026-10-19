/**
 * Rodada 10 — CONTRATO: torcidas (SupporterGroupDefinition), dados em `public/gameplay/supporters.json`.
 *
 * Torcida é IDENTIDADE + SOCIAL + VISUAL do PERFIL (persistente, fora de evento) — separada de grupo político e de
 * grupo de evento (`EventGroup`). Nunca dá vantagem mecânica (tests/groupNeutrality.test.ts) e nunca entra em
 * `if (id === '<time>')` no código: tudo sai destes dados. Nomes dos clubes só nominalmente; SEM escudo, fabricante,
 * patrocinador, selo ou textura oficial (docs/SUPPORTER_GROUPS.md).
 */
import type { GroupKind } from '../events/schedule';

export interface SupporterClothingSet {
  /** design de camisa (`src/social/designs.ts`, family 'football', id u16 estável) */
  shirtDesign: number;
  /** cores sugeridas (hex) para calção/bermuda e meias/tênis quando o jogador "veste as cores" */
  bottomColor?: string;
  shoeColor?: string;
  /** NPCs: variações de camisa aceitas (designs) além da principal */
  npcShirtDesigns?: number[];
}

export interface SupporterGroupDefinition {
  /** id estável (dado/banco) — o código nunca compara com um id concreto */
  id: string;
  displayName: string;
  shortName: string;
  category: Extract<GroupKind, 'SUPPORTERS'>;
  primaryColors: string[];
  secondaryColors: string[];
  clothingSet: SupporterClothingSet;
  /** designs de bandeira/faixa (`designs.ts`, targets flag/banner) */
  flagSet: number[];
  bannerSet: number[];
  /** pesos/pontos preferidos (rally points, `src/social/rally.ts`) — só onde NPCs da torcida se concentram */
  spawnPreferences?: { rally?: string[] };
  rallyPreferences?: { rally?: string[]; npcShare?: number };
  /** perfil de áudio agregado (`src/audio`) — chave de um perfil genérico (palmas/percussão própria, sem cantos) */
  audioProfile: string;
  /** cosméticos permitidos a quem escolhe a torcida (ids de designs/acessórios), sem efeito mecânico */
  allowedCosmetics: number[];
  metadata?: { referenceNotes?: string; omitted?: string[] };
}

export interface SupporterData {
  version: number;
  /** id reservado para "Nenhuma / Neutro" (escolha válida, nunca obrigatória) */
  neutralId: string;
  /** troca de torcida: fora de evento competitivo aplica já; dentro, fica PENDENTE até o fim (data-driven) */
  changePolicy: { cooldownS: number; deferDuringEventKinds: string[] };
  groups: SupporterGroupDefinition[];
}

/** estado público da torcida de um jogador (o que a sala/rede conhecem) */
export interface SupporterChoice { current: string | null; pending: string | null }
