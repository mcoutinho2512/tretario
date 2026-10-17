/**
 * Métricas PÚBLICAS (rodada 8) — GET /api/metrics/public. Contagens SEMÂNTICAS (src/identity/types.ts PublicMetrics):
 *   playersOnline     pessoas jogando (entidades humanas; inclui quem está em graça de reconexão). NUNCA bots/NPCs
 *   spectatorsOnline  espectadores conectados
 *   environmentCrowd  multidão AMBIENTAL simulada, configurada pelos DADOS do evento (social.rallyCrowd +
 *                     estimativa de pedestres NPC × npcs.pedestrianDensity) — é um número de simulação, não de pessoas
 *   testBots          bots de carga (join `bot: true`, só em servidor de teste)
 *   totalConnections  conexões abertas (jogadores + espectadores + bots)
 * Cache de ~1,5 s: a rota pode ser martelada pela tela inicial sem custo para a sala.
 */
import type { PublicMetrics } from '../../../src/identity/types';
import type { PresenceCounts } from './PresenceTracker';

/** pedestres NPC por cliente no preset médio (src/core/settings.ts) — base da estimativa ambiental */
export const PEDESTRIAN_ESTIMATE = 56;

export interface EventCrowdData { social?: { rallyCrowd?: number }; npcs?: { pedestrianDensity?: number } }

export function environmentCrowdFor(ev: EventCrowdData | undefined): number {
  if (!ev) return 0;
  const rally = Math.max(0, Math.round(ev.social?.rallyCrowd ?? 0));
  const peds = Math.max(0, Math.round(PEDESTRIAN_ESTIMATE * (ev.npcs?.pedestrianDensity ?? 1)));
  return rally + peds;
}

/** o que cada sala viva informa */
export interface WorldMetricsSource {
  counts(now: number): PresenceCounts;
  eventId: string;
  eventName: string;
  environmentCrowd: number;
}

export function computePublicMetrics(sources: Iterable<WorldMetricsSource>, now: number, fallback = { eventId: '', eventName: '', environmentCrowd: 0 }): PublicMetrics {
  const m: PublicMetrics = { playersOnline: 0, spectatorsOnline: 0, environmentCrowd: 0, totalConnections: 0, testBots: 0, eventId: fallback.eventId, eventName: fallback.eventName, updatedAt: now };
  let first = true;
  for (const s of sources) {
    const c = s.counts(now);
    m.playersOnline += c.players;
    m.spectatorsOnline += c.spectators;
    m.testBots += c.bots;
    m.totalConnections += c.connections;
    if (first) { m.eventId = s.eventId; m.eventName = s.eventName; m.environmentCrowd = s.environmentCrowd; first = false; }
  }
  if (first) m.environmentCrowd = fallback.environmentCrowd;
  return m;
}

/** salas vivas (cada PresidenteVargasRoom se registra no onCreate e sai no onDispose) */
export const liveWorlds = new Set<WorldMetricsSource>();

let cache: { at: number; body: PublicMetrics } | null = null;
export const METRICS_CACHE_MS = 1500;

export function publicMetrics(now = Date.now(), fallback?: { eventId: string; eventName: string; environmentCrowd: number }): PublicMetrics {
  if (cache && now - cache.at < METRICS_CACHE_MS) return cache.body;
  const body = computePublicMetrics(liveWorlds, now, fallback);
  cache = { at: now, body };
  return body;
}

/** testes */
export function resetMetricsCache() { cache = null; }
