/**
 * POLÍTICA DE ZONA para o confronto (rodada 9; rodada 12: NÃO EXISTEM ÁREAS DE PAZ) — serviço do servidor, sem
 * Colyseus. O CombatSystem só pergunta:
 *
 *   policyFor(zoneId)  → 'COMBAT' | 'CONTESTED'   (zones.json `combatPolicy`; ausente, desconhecido, o antigo 'PEACE'
 *                                                 ou FORA de qualquer zona = COMBAT)
 *
 * Decisão definitiva do dono (rodada 12): não há zona permanente onde o confronto é proibido. Saíram as áreas de paz
 * dos dados (`peaceAreas`, `derivedPeaceAreas`) e as derivadas do mundo (spawn, palco, anéis do trio/carro de som,
 * retornos de evento). O que bloqueia um impacto agora não é lugar: a PROTEÇÃO TEMPORÁRIA de retorno (5 s ao entrar,
 * reconectar, levantar — server/src/combat/protection.ts) e as regras do EVENTO (src/combat/policy.ts).
 */
import { normalizeZonePolicy, type ZoneCombatPolicy } from '../../../src/combat/policy';
import type { ZoneDefinition } from '../../../src/world/zones';

export interface ZonePolicyInit {
  zones: readonly ZoneDefinition[];
}

export class ZonePolicy {
  private byId = new Map<string, ZoneCombatPolicy>();

  constructor(o: ZonePolicyInit) {
    for (const z of o.zones) this.byId.set(z.id, normalizeZonePolicy(z.combatPolicy));
  }

  /** política da zona (id de zones.json); fora de qualquer zona ou zona sem política → COMBAT */
  policyFor(zoneId: string | null | undefined): ZoneCombatPolicy {
    return (zoneId ? this.byId.get(zoneId) : undefined) ?? 'COMBAT';
  }
}
