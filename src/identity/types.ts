/**
 * Identidade (rodada 8) — tipos COMPARTILHADOS por cliente, servidor e ferramentas. Ninguém redefine User, Session,
 * PlayerIdentity ou EventGroup em outro lugar.
 *
 * Quatro identificadores DIFERENTES (nunca usar o id do socket como identidade):
 *  - userId          conta (banco; PRIVADO — nunca vai para outros clientes)
 *  - authSessionId   sessão de LOGIN (cookie HttpOnly; o banco guarda só o hash do token)
 *  - connectionId    conexão WebSocket atual (Colyseus sessionId; muda a cada reconexão "dura")
 *  - entityId        entidade jogável no mundo (chave em state.players; estável durante a sessão de jogo e na reconexão)
 */
import type { CharacterAppearance } from '../characters/bodyTypes';

/** situação da conta no banco */
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';
/** concessões de licença de participação; NONE = nenhuma ativa */
export type AccessGrant = 'NONE' | 'DEV_GRANTED' | 'PAID' | 'STAFF';
/** estado de acesso DERIVADO (src/access/policy.ts) — nunca uma flag solta como `isPaid` */
export type AccessState = 'VISITOR' | 'REGISTERED' | 'PLAYER' | 'SUSPENDED' | 'BANNED';
/** papel da conexão no mundo */
export type WorldRole = 'player' | 'spectator';
/** presença (heartbeat/TTL; não é gravada por quadro) */
export type PresenceState = 'ONLINE' | 'PLAYING' | 'SPECTATING' | 'AWAY' | 'OFFLINE';

/** o que o servidor sabe de quem está conectado (resolvido pelo servidor — o cliente nunca declara) */
export interface PlayerIdentity {
  userId: string | null;
  authSessionId: string | null;
  nickname: string;
  state: AccessState;
  grant: AccessGrant;
  role: WorldRole;
  /** grupo do evento atual (EventMembership), se houver */
  groupKey: string | null;
}

/** perfil PÚBLICO mínimo — sem e-mail, IP, ids internos */
export interface PublicProfile {
  nickname: string;
  displayName?: string | null;
  appearance: CharacterAppearance | null;
  /** mês de entrada (AAAA-MM), não a data exata */
  since: string;
}

/** preferências do jogador (perfil; sem dado sensível) */
export interface PlayerPreferences {
  /** nomes acima dos jogadores */
  names?: 'TODOS' | 'PROXIMOS' | 'NENHUM';
  chatCollapsed?: boolean;
  quality?: string;
  /** rodada 9 — acessibilidade: reduzir efeitos visuais (desorientação só com ícone + tom leve) */
  reduceEffects?: boolean;
}

/** resposta de GET /api/me (dados do PRÓPRIO usuário) */
export interface MeResponse {
  authenticated: boolean;
  user?: { nickname: string | null; emailVerified: boolean; status: AccountStatus; createdAt: string };
  access: { state: AccessState; grant: AccessGrant };
  appearance?: CharacterAppearance | null;
  preferences?: PlayerPreferences;
  /** grupo escolhido no evento atual */
  membership?: { eventId: string; groupKey: string } | null;
}

/** rotas HTTP (mesma origem: o Vite faz proxy de /api para o servidor em desenvolvimento) */
export const API = {
  register: '/api/auth/register',
  verifyEmail: '/api/auth/verify-email',
  resendCode: '/api/auth/resend-code',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  forgot: '/api/auth/forgot',
  reset: '/api/auth/reset',
  me: '/api/me',
  nickname: '/api/me/nickname',
  nicknameAvailable: '/api/nickname/available',
  appearance: '/api/me/appearance',
  preferences: '/api/me/preferences',
  /** ticket de uso único para entrar na sala (o WebSocket nunca recebe o cookie) */
  joinTicket: '/api/session/ticket',
  event: '/api/events/current',
  membership: '/api/events/current/membership',
  profile: '/api/profile/',
  metrics: '/api/metrics/public',
} as const;

/** opções de entrada na sala relativas à identidade (o resto continua em JoinOptions) */
export interface IdentityJoinOptions {
  /** ticket de uso único (jogador autenticado); ausente = visitante */
  ticket?: string;
  /** papel pedido; o SERVIDOR decide (visitante só pode 'spectator') */
  role?: WorldRole;
}

/** métricas públicas SEMÂNTICAS (nunca chamar NPC de jogador) */
export interface PublicMetrics {
  /** pessoas com conta jogando (entidades jogáveis humanas) */
  playersOnline: number;
  /** espectadores conectados */
  spectatorsOnline: number;
  /** multidão ambiental SIMULADA (NPCs/concentração) — rótulo próprio na UI */
  environmentCrowd: number;
  /** conexões abertas (jogadores + espectadores + bots de teste) */
  totalConnections: number;
  /** bots de carga conectados (só em servidor de teste; nunca somados a "jogadores") */
  testBots: number;
  eventId: string;
  eventName: string;
  updatedAt: number;
}
