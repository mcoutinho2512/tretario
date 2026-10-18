/**
 * POLÍTICA DE ZONA para o confronto (rodada 9) — serviço do servidor, sem Colyseus. O CombatSystem (agente A) só
 * pergunta duas coisas, sem conhecer bairro, palco ou evento por nome:
 *
 *   policyFor(zoneId)  → 'PEACE' | 'CONTESTED' | 'COMBAT'   (zones.json `combatPolicy`; ausente/fora de zona = PEACE)
 *   peaceAt(x, z)      → dentro de alguma ÁREA DE PAZ pontual?
 *
 * Áreas de paz (src/combat/policy.ts PeaceArea), três origens:
 *  - FIXAS: `peaceAreas` de cada zona (dados) + derivadas do mundo — spawn (manifest.spawn) e palco
 *    (eventSpots kind 'stage', RALLY_SHAPE.stage.peaceR à frente do palco);
 *  - de EVENTO: pontos de retorno (`clash.respawn` da agenda) e outras que um runner registrar (setEventAreas);
 *  - MÓVEIS: anéis das concentrações dos veículos de evento (trio, carro de som — RALLY_SHAPE[kind].peaceR), lidos a
 *    cada consulta de um provedor (a sala passa as posições dos veículos de evento: a mesma lista que monta a
 *    concentração das células do espectador aéreo).
 * `derived: false` (DADO: zones.json `derivedPeaceAreas`) desliga spawn, palco, anéis móveis e retornos de evento —
 * os caminhos continuam aqui; só as `peaceAreas` dos dados valem. Puro o bastante para teste: tudo entra pelo construtor.
 */
import { inPeaceArea, type PeaceArea, type ZoneCombatPolicy } from '../../../src/combat/policy';
import { pointOnAxis, type ZoneDefinition } from '../../../src/world/zones';
import { RALLY_SHAPE } from '../../../src/social/rally';
import type { WorldPoint } from '../../../src/events/schedule';

type XZ = [number, number];

/** veículo de evento que carrega uma concentração (trio, carro de som) */
export interface MovingRally { id: string; kind: string; x: number; z: number }

/** raio da área de paz no ponto de retorno de evento (m) */
export const RESPAWN_PEACE_R = 16;
/** raio da área de paz no spawn (m) */
export const SPAWN_PEACE_R = 40;

export interface ZonePolicyInit {
  zones: readonly ZoneDefinition[];
  axis: XZ[];
  /** manifest.spawn (p = [x, z]) */
  spawn?: { p: [number, number] };
  /** manifest.eventSpots (palco) */
  spots?: readonly { id: string; kind: string; x: number; z: number; heading: number }[];
  /** veículos de evento agora (chamado a cada consulta; poucos itens) */
  rallies?: () => Iterable<MovingRally>;
  /** áreas de paz derivadas (spawn, palco, trio/carro de som, retornos de evento) ligadas? padrão: sim */
  derived?: boolean;
}

export class ZonePolicy {
  private byId = new Map<string, ZoneDefinition>();
  /** áreas fixas (zonas + spawn + palco) */
  readonly fixed: PeaceArea[] = [];
  private eventAreas = new Map<string, PeaceArea[]>();
  private rallies: () => Iterable<MovingRally>;
  private axis: XZ[];
  readonly derived: boolean;

  constructor(o: ZonePolicyInit) {
    this.axis = o.axis;
    this.derived = o.derived !== false;
    for (const z of o.zones) {
      this.byId.set(z.id, z);
      for (const a of z.peaceAreas ?? []) this.fixed.push({ ...a });
    }
    if (!this.derived) { this.rallies = () => []; return; }
    if (o.spawn) this.fixed.push({ id: 'spawn', x: o.spawn.p[0], z: o.spawn.p[1], r: SPAWN_PEACE_R });
    for (const s of o.spots ?? []) {
      if (s.kind !== 'stage') continue;
      const S = RALLY_SHAPE.stage;
      this.fixed.push({ id: `palco:${s.id}`, x: s.x + Math.sin(s.heading) * S.front, z: s.z + Math.cos(s.heading) * S.front, r: S.peaceR });
    }
    this.rallies = o.rallies ?? (() => []);
  }

  /** política da zona (id de zones.json); fora de qualquer zona ou zona sem política → PEACE */
  policyFor(zoneId: string | null | undefined): ZoneCombatPolicy {
    return (zoneId ? this.byId.get(zoneId)?.combatPolicy : undefined) ?? 'PEACE';
  }

  /** (x, z) está dentro de alguma área de paz pontual (fixa, de evento ou anel móvel de trio/carro de som)? */
  peaceAt(x: number, z: number): boolean {
    if (inPeaceArea(this.fixed, x, z)) return true;
    for (const list of this.eventAreas.values()) if (inPeaceArea(list, x, z)) return true;
    for (const v of this.rallies()) {
      const r = rallyPeaceR(v.kind);
      if (r > 0 && (x - v.x) ** 2 + (z - v.z) ** 2 <= r * r) return true;
    }
    return false;
  }

  /** áreas de um evento (pontos de retorno do confronto etc.); `[]` ou clearEventAreas remove */
  setEventAreas(key: string, areas: readonly PeaceArea[]) {
    if (areas.length && this.derived) this.eventAreas.set(key, areas.map((a) => ({ ...a })));
    else this.eventAreas.delete(key);
  }
  clearEventAreas(key: string) { this.eventAreas.delete(key); }

  /** pontos de retorno de evento (WorldPoint: x/z ou fração do eixo) → áreas de paz */
  respawnAreas(key: string, pts: readonly WorldPoint[], r = RESPAWN_PEACE_R): PeaceArea[] {
    return pts.map((p, i) => {
      const q = 't' in p ? pointOnAxis(this.axis, p.t, p.side ?? 0) : p;
      return { id: `${key}:retorno${i}`, x: q.x, z: q.z, r };
    });
  }

  /** todas as áreas agora (QA, minimapa de depuração) */
  areas(): PeaceArea[] {
    const out = [...this.fixed];
    for (const l of this.eventAreas.values()) out.push(...l);
    for (const v of this.rallies()) { const r = rallyPeaceR(v.kind); if (r > 0) out.push({ id: `rally:${v.id}`, x: v.x, z: v.z, r }); }
    return out;
  }
}

/** raio de paz do anel de concentração de um veículo de evento (0 = nenhum) */
export function rallyPeaceR(kind: string): number {
  return kind === 'trio' ? RALLY_SHAPE.trio.peaceR : kind === 'soundcar' ? RALLY_SHAPE.soundcar.peaceR : 0;
}
