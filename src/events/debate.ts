/**
 * PALCO DE DEBATE em TEXTO (rodada 9) — regras e formatos PUROS, os mesmos no cliente e no servidor
 * (server/src/debate/DebateRunner.ts · docs/DEBATES.md). Contrato base: src/events/schedule.ts (DebateSpec,
 * DebateStateMessage `dbt`, DebateReaction); aqui só EXTENSÕES aditivas.
 *
 * Reações da plateia são AGREGADAS por turno e exibidas como "reações da plateia" — nunca como votação, enquete ou
 * resultado ("quem ganhou"). Nada aqui conhece tema, pessoa ou grupo: temas são textos neutros dos dados.
 */
import type { DebateReaction, DebateStateMessage } from './schedule';

export const DEBATE_REACTIONS: readonly DebateReaction[] = ['aplauso', 'positiva', 'negativa'];
export const REACTION_LABEL: Record<DebateReaction, { one: string; many: string; button: string }> = {
  aplauso: { one: 'aplauso', many: 'aplausos', button: 'APLAUSO' },
  positiva: { one: 'positiva', many: 'positivas', button: 'POSITIVA' },
  negativa: { one: 'negativa', many: 'negativas', button: 'NEGATIVA' },
};
/** gesto do PRÓPRIO personagem ao reagir (ações existentes, src/social/actions.ts); null = sem gesto */
export const REACTION_ACTION: Record<DebateReaction, string | null> = { aplauso: 'clap', positiva: 'thumbs_up', negativa: 'talk' };

export const DEBATE_RULES = {
  /** quem está a ≤ r do palco recebe o estado e as falas (AOI do palco; nunca global) */
  aoiRadius: 70,
  /** entrar na fila: a ≤ r do palco */
  queueRadius: 55,
  queueMax: 24,
  /** quem abriu o painel pela agenda (de longe) — teto de assistentes explícitos */
  watchMax: 300,
  /** estado `dbt`: ≤ 2 Hz + na mudança */
  stateHz: 2,
  /** assistir: lote de segundos para `debate_watch` */
  watchBatchS: 30,
  /** cópia das falas para denúncia (como o chat) */
  keepMs: 15 * 60_000,
  keepMax: 600,
  /** falas mostradas no painel / guardadas por debate para quem chega */
  linesShown: 8,
  /** pausa entre turnos (ms) */
  gapMs: 2500,
} as const;

/** servidor → assistentes: estado completo (contrato `dbt` + extensões aditivas) */
export interface DebateStateWire extends DebateStateMessage {
  /** há debate em andamento (fora dele: próximo início em `nextAt`) */
  active: boolean;
  nextAt: number;
  /** lugares no palco: apelido ou null (lugar 0 = quem fala) */
  seats: (string | null)[];
  turn: number;
  turns: number;
  turnSeconds: number;
  /** nid do orador (marcar o personagem; 0 = sem) */
  nid: number;
}
/** servidor → só a conexão: posição pessoal na fila (não vai no estado comum, que é codificado uma vez) */
export interface DebateMe { inst: string; pos: number; speaking: boolean; canSpeak: boolean; canReact: boolean; why?: string }
/** servidor → assistentes: fala (texto já moderado) */
export interface DebateLine { id: string; inst: string; nick: string; nid: number; text: string; t: number; turn: number }
export type DebateDenial = 'sem_permissao' | 'inativo' | 'longe' | 'lotado' | 'nao_e_sua_vez' | 'limite' | 'nao_assiste' | 'invalido'
  | 'vazio' | 'longo' | 'bloqueado' | 'spam' | 'flood' | 'repetida' | 'cooldown' | 'caracteres';
export const DEBATE_DENIAL_TEXT: Partial<Record<DebateDenial, string>> = {
  sem_permissao: 'Sua conta não pode participar do debate agora',
  inativo: 'Nenhum debate em andamento',
  longe: 'Chegue perto do palco para entrar na fila',
  lotado: 'A fila do debate está cheia',
  nao_e_sua_vez: 'Aguarde a sua vez de falar',
  limite: 'Calma: limite de reações por minuto',
  nao_assiste: 'Abra o painel do debate para reagir',
  bloqueado: 'Mensagem bloqueada pela moderação',
  spam: 'Mensagem bloqueada (spam)',
  flood: 'Devagar: muitas mensagens seguidas',
  repetida: 'Mensagem repetida',
  cooldown: 'Aguarde um pouco para falar de novo',
  caracteres: 'Caracteres inválidos',
  longo: 'Mensagem longa demais',
};

/**
 * lugares do palco (sem física nova): marcas no chão logo à FRENTE do palco (o palco olha para +z local, caixa de
 * 7 × 10 m), em arco; o lugar 0 (quem fala) no centro. Mesma função no cliente (marcas) e no servidor.
 */
export function debateSeats(spot: { x: number; z: number; heading: number }, n: number): { x: number; z: number }[] {
  const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    // 0 no centro; 1, 2… alternando esquerda/direita
    const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    const lat = k * 1.9, fwd = 4.6 - Math.abs(k) * 0.35;
    out.push({ x: spot.x + fx * fwd + fz * lat, z: spot.z + fz * fwd - fx * lat });
  }
  return out;
}

/** "reações da plateia: 3 aplausos · 1 positiva · 0 negativas" — contagem, nunca placar/resultado */
export function reactionSummary(r: Record<DebateReaction, number>): string {
  return `reações da plateia: ${DEBATE_REACTIONS.map((k) => `${r[k]} ${r[k] === 1 ? REACTION_LABEL[k].one : REACTION_LABEL[k].many}`).join(' · ')}`;
}

/** relógio mm:ss (contagens regressivas do debate e da agenda); negativo → 00:00 */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(Math.min(99, m)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** semente determinística da reação dos NPCs (mesma para todos os clientes que veem a mesma contagem) */
export function crowdReactionSeed(inst: string, turn: number, total: number): number {
  let h = 2166136261 >>> 0;
  for (const c of `${inst}|${turn}|${total}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
