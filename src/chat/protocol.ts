/**
 * Chat (rodada 8) — protocolo e regras PURAS compartilhadas. O servidor decide destinatários (o cliente nunca escolhe
 * quem recebe), aplica limites e moderação de texto (src/moderation/text.ts).
 */
export type ChatChannel = 'geral' | 'proximidade' | 'grupo';
export const CHAT_CHANNELS: ChatChannel[] = ['geral', 'proximidade', 'grupo'];

export const CHAT_RULES = {
  maxChars: 200,
  /** raio do canal PROXIMIDADE (m) — consulta na grade espacial */
  proximityRadius: 30,
  /** mensagens por janela (anti-flood) */
  burstMax: 5,
  burstWindowMs: 8_000,
  /** mesma mensagem repetida dentro da janela */
  repeatWindowMs: 30_000,
  /** cooldown adaptativo: dobra a cada infração seguida, até o teto */
  cooldownBaseMs: 2_000,
  cooldownMaxMs: 120_000,
  /** histórico entregue a quem entra (só GERAL) */
  historyGeneral: 30,
} as const;

/** cliente → servidor */
export interface ChatSend { ch: ChatChannel; text: string }

/** servidor → cliente (sem ids internos de conta: só o apelido e o id curto da entidade no mundo, se houver) */
export interface ChatMessage {
  /** id da mensagem (para ocultar/denunciar) */
  id: string;
  ch: ChatChannel;
  nick: string;
  /** id curto da entidade (nid) do autor no mundo, para mutar/denunciar; 0 se não estiver no mundo */
  nid: number;
  /** grupo do autor (chave do EventGroup) — só no canal GRUPO */
  group?: string;
  text: string;
  t: number;
}

export type ChatRejection = 'sem_permissao' | 'vazio' | 'longo' | 'bloqueado' | 'spam' | 'flood' | 'repetida' | 'cooldown' | 'sem_grupo' | 'caracteres';

/** categorias de denúncia (iguais ao enum ReportCategory do banco) */
export const REPORT_CATEGORIES = ['SPAM', 'ASSEDIO', 'ODIO', 'AMEACA', 'CONTEUDO_SEXUAL', 'IMPERSONACAO', 'OUTRO'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const REPORT_LABELS: Record<ReportCategory, string> = {
  SPAM: 'Spam', ASSEDIO: 'Assédio', ODIO: 'Ódio', AMEACA: 'Ameaça', CONTEUDO_SEXUAL: 'Conteúdo sexual', IMPERSONACAO: 'Imitação de outra pessoa', OUTRO: 'Outro',
};

/** cliente → servidor: denúncia de mensagem (o servidor guarda a cópia da mensagem como evidência) */
export interface ChatReport { id: string; category: ReportCategory; details?: string }

/** estado anti-flood por autor (o servidor mantém um por conta/conexão) */
export interface FloodState { recent: number[]; lastText: string; lastTextAt: number; strikes: number; blockedUntil: number }
export const newFloodState = (): FloodState => ({ recent: [], lastText: '', lastTextAt: 0, strikes: 0, blockedUntil: 0 });

/** anti-flood/spam puro: decide e atualiza o estado */
export function floodCheck(s: FloodState, text: string, now: number): { ok: true } | { ok: false; reason: 'flood' | 'repetida' | 'cooldown'; retryMs: number } {
  if (now < s.blockedUntil) return { ok: false, reason: 'cooldown', retryMs: s.blockedUntil - now };
  while (s.recent.length && now - s.recent[0] > CHAT_RULES.burstWindowMs) s.recent.shift();
  const penalize = (reason: 'flood' | 'repetida') => {
    s.strikes++;
    const ms = Math.min(CHAT_RULES.cooldownMaxMs, CHAT_RULES.cooldownBaseMs * 2 ** (s.strikes - 1));
    s.blockedUntil = now + ms;
    return { ok: false as const, reason, retryMs: ms };
  };
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm === s.lastText && now - s.lastTextAt < CHAT_RULES.repeatWindowMs) return penalize('repetida');
  if (s.recent.length >= CHAT_RULES.burstMax) return penalize('flood');
  s.recent.push(now);
  s.lastText = norm; s.lastTextAt = now;
  // bom comportamento por um tempo zera as infrações
  if (s.strikes && now - (s.blockedUntil || 0) > CHAT_RULES.cooldownMaxMs) s.strikes = 0;
  return { ok: true };
}

/* ── Mute por IDENTIDADE (rodada 8.1) ───────────────────────────────────────────────────────────────────────────────
 * O alvo é sempre resolvido NO SERVIDOR para um userId (a partir de uma mensagem recebida ou de uma entidade no mundo);
 * o cliente nunca envia userId. A lista devolvida usa `ref` OPACO (HMAC do par dono/alvo com o segredo do servidor),
 * estável para o mesmo par e inútil fora dele. O apelido é só uma cópia para exibir (pode estar desatualizado).
 * Mute ≠ ban: só filtra o que ESTE usuário recebe (GERAL, PROXIMIDADE e GRUPO), no servidor. */

/** cliente → servidor (`chat_mute`): exatamente um alvo — `msg` (id de mensagem recebida), `nid` (entidade no mundo) ou `ref` (item da lista) */
export interface ChatMuteRequest { msg?: string; nid?: number; ref?: string; on: boolean }
/** item da lista de mutados (servidor → cliente) */
export interface ChatMuteEntry { ref: string; nick: string; since: number }
/** servidor → cliente (`chat_mutes`): lista completa após cada mudança e ao entrar */
export interface ChatMuteList { list: ChatMuteEntry[] }
export type ChatMuteRejection = 'sem_conta' | 'alvo_invalido' | 'proprio' | 'limite';
/** teto de mutes por conta */
export const CHAT_MUTE_MAX = 500;
