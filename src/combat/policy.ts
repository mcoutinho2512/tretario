/**
 * POLÍTICA DE CONFRONTO (rodada 9; rodada 12: NÃO EXISTEM ÁREAS DE PAZ) — pura, compartilhada. Responde "este golpe
 * pode ter impacto?" a partir de ZONA + EVENTO + ESTADO DO JOGADOR. O CombatSystem não conhece bairro, grupo ou
 * evento por nome: só esta função.
 *
 * Decisão definitiva do dono (rodada 12): não há zona permanente onde o confronto é proibido. Toda a avenida — e
 * também fora de qualquer zona nomeada — é COMBAT. Não há áreas de paz (nem nos dados, nem derivadas: spawn, palco,
 * anéis do trio/carro de som, retornos de evento). Zona de dados ausente ou com valor antigo ('PEACE') vale COMBAT.
 *
 *   COMBAT     impacto entre quem aceitou o confronto: os dois em modo 'interacao' (K) OU os dois inscritos num
 *              evento de confronto ativo que inclua a zona (com consentimento 'none': qualquer um)
 *   CONTESTED  (mecânica de EVENTO, nenhuma zona dos dados usa hoje) impacto só durante um evento de confronto ATIVO
 *              que inclua a zona, entre inscritos nele
 *
 * O que continua bloqueando um impacto (nada disso é zona): a PROTEÇÃO TEMPORÁRIA de retorno (5 s ao entrar,
 * reconectar ou levantar — `protectedUntil`), as regras do EVENTO (`friendlyFire`, inscrição) e o consentimento.
 * Consentimento (DADO: zones.json `combatConsent`):
 *   'both'  quem fica em modo pacífico e fora de eventos de confronto NUNCA sofre impacto (regra até 2026-10)
 *   'none'  decisão do dono (2026-10-18, "bater em todos"): qualquer jogador sofre impacto, em qualquer modo
 * Fogo amigo (mesmo grupo) vem da regra do EVENTO (`friendlyFire`), comparando chaves por igualdade —
 * nenhuma chave de grupo aparece no código.
 */
import type { CombatDenial } from './types';

export type ZoneCombatPolicy = 'CONTESTED' | 'COMBAT';
/** política efetiva de um valor de dados (ausente, desconhecido ou o antigo 'PEACE' → COMBAT) */
export const normalizeZonePolicy = (raw: unknown): ZoneCombatPolicy => (raw === 'CONTESTED' ? 'CONTESTED' : 'COMBAT');
/** consentimento exigido fora de evento em zona COMBAT ('both' = os dois em modo interação; 'none' = ninguém) */
export type CombatConsent = 'none' | 'both';

/** regras gerais de confronto (raiz de public/world/zones.json) — servidor e cliente leem o MESMO arquivo */
export interface CombatRules {
  combatConsent: CombatConsent;
}
/** ausente = regra antiga de consentimento (os dois em modo interação) */
export const DEFAULT_COMBAT_RULES: CombatRules = { combatConsent: 'both' };
export function parseCombatRules(raw: unknown): CombatRules {
  const o = (raw ?? {}) as { combatConsent?: unknown };
  return { combatConsent: o.combatConsent === 'none' ? 'none' : 'both' };
}

/** regras de confronto de um evento (EventDef/ScheduledEventDef → `combat`) */
export interface CombatEventRules {
  /** id da instância de evento ativa */
  eventId: string;
  /** zonas onde vale (ids de zones.json) */
  zones: string[];
  /** mesmo grupo sofre impacto? (padrão do evento de grupos: false) */
  friendlyFire: boolean;
}

/** o que a política precisa saber de cada lado (montado pelo servidor; nada vem do cliente) */
export interface CombatParty {
  zone: string | null;
  mode: 'pacifico' | 'interacao';
  /** chave do grupo no evento do mundo (só comparada por igualdade) */
  groupKey: string | null;
  /** evento de confronto ATIVO em que está inscrito ('' = nenhum) */
  combatEventId: string;
  /** proteção de retorno até (ms, relógio do servidor) */
  protectedUntil: number;
}

export type PolicyResult = { ok: true } | { ok: false; reason: CombatDenial };

export function combatAllowed(
  zonePolicy: (zone: string | null) => ZoneCombatPolicy,
  a: CombatParty,
  b: CombatParty,
  event: CombatEventRules | null,
  now: number,
  consent: CombatConsent = 'both',
): PolicyResult {
  const pa = zonePolicy(a.zone), pb = zonePolicy(b.zone);
  if (b.protectedUntil > now) return { ok: false, reason: 'protegido' };
  const inEvent = !!event && a.combatEventId === event.eventId && b.combatEventId === event.eventId
    && (a.zone !== null && event.zones.includes(a.zone)) && (b.zone !== null && event.zones.includes(b.zone));
  if (inEvent) {
    if (!event!.friendlyFire && a.groupKey !== null && a.groupKey === b.groupKey) return { ok: false, reason: 'politica' };
    return { ok: true };
  }
  // fora de evento: CONTESTED exige evento; COMBAT exige o consentimento dos dados
  if (pa === 'CONTESTED' || pb === 'CONTESTED') return { ok: false, reason: 'politica' };
  if (consent === 'none') return { ok: true };
  if (a.mode === 'interacao' && b.mode === 'interacao') return { ok: true };
  return { ok: false, reason: 'politica' };
}
