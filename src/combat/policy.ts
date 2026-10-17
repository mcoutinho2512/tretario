/**
 * POLÍTICA DE CONFRONTO (rodada 9) — pura, compartilhada. Responde "este golpe pode ter impacto?" a partir de
 * ZONA + EVENTO + ESTADO DO JOGADOR. O CombatSystem não conhece bairro, grupo ou evento por nome: só esta função.
 *
 *   PEACE      nunca há impacto (palco, entrada, pontos sociais, áreas de retorno) → 'zona_paz'
 *   CONTESTED  impacto só durante um evento de confronto ATIVO que inclua a zona, entre inscritos nele
 *   COMBAT     impacto entre quem aceitou o confronto: os dois em modo 'interacao' (K) OU os dois inscritos num
 *              evento de confronto ativo que inclua a zona
 *
 * Consentimento por contexto: quem fica em modo pacífico e fora de eventos de confronto NUNCA sofre impacto, em
 * nenhuma zona. Fogo amigo (mesmo grupo) vem da regra do EVENTO (`friendlyFire`), comparando chaves por igualdade —
 * nenhuma chave de grupo aparece no código.
 */
import type { CombatDenial } from './types';

export type ZoneCombatPolicy = 'PEACE' | 'CONTESTED' | 'COMBAT';

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
  /** dentro de uma área de paz pontual (palco, retorno…) */
  inPeaceArea: boolean;
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
): PolicyResult {
  if (a.inPeaceArea || b.inPeaceArea) return { ok: false, reason: 'zona_paz' };
  const pa = zonePolicy(a.zone), pb = zonePolicy(b.zone);
  if (pa === 'PEACE' || pb === 'PEACE') return { ok: false, reason: 'zona_paz' };
  if (b.protectedUntil > now) return { ok: false, reason: 'protegido' };
  const inEvent = !!event && a.combatEventId === event.eventId && b.combatEventId === event.eventId
    && (a.zone !== null && event.zones.includes(a.zone)) && (b.zone !== null && event.zones.includes(b.zone));
  if (inEvent) {
    if (!event!.friendlyFire && a.groupKey !== null && a.groupKey === b.groupKey) return { ok: false, reason: 'politica' };
    return { ok: true };
  }
  // fora de evento: CONTESTED exige evento; COMBAT exige consentimento dos dois
  if (pa === 'CONTESTED' || pb === 'CONTESTED') return { ok: false, reason: 'politica' };
  if (a.mode === 'interacao' && b.mode === 'interacao') return { ok: true };
  return { ok: false, reason: 'politica' };
}

/** área de paz pontual (dados: zones.json `peaceAreas`, retorno de eventos, palco) */
export interface PeaceArea { id: string; x: number; z: number; r: number }
export const inPeaceArea = (areas: readonly PeaceArea[], x: number, z: number) =>
  areas.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 <= p.r * p.r);
