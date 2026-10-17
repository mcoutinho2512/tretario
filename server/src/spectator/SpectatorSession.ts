/**
 * Sessões de ESPECTADOR (rodada 8): mesma sala, mesmo mundo, papel 'spectator' decidido pelo servidor.
 * Sem NetPlayer, sem corpo, sem colisão, fora da contagem de jogadores. Recebe só o necessário:
 * área de interesse (StateView: jogadores/veículos próximos + multidão "crowd" + grafites) centrada na posição da
 * CÂMERA, que o cliente manda em baixa frequência (`spec_cam {x, z}`), presa aos limites do mapa e com taxa limitada.
 * Toda mensagem de jogo continua bloqueada por capacidade (PresidenteVargasRoom.gate) — o espectador não tem nenhuma.
 * Rodada 8.1: `spec_cam {x, z, alt}` — a ALTITUDE escolhe a camada (src/spectator/tiers.ts, com histerese): raio do
 * AOI de entidades por camada e, em FAR/AGGREGATE, células agregadas (`spec_cells`, CellFeed) em vez de pessoas.
 */
import type { Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { makeSlotView, type SlotView } from '../../../src/net/spatialGrid';
import { SPECTATOR, clampToBounds, rateOk, sanitizeSpecAlt, sanitizeSpecCam, type Bounds } from '../../../src/spectator/bounds';
import { SPEC_TIER_AOI, tierForAltitude, type SpecTier } from '../../../src/spectator/tiers';
import { CellFeed } from './CrowdCellAggregator';

export interface SpectatorSession {
  sid: string;
  client: Client;
  view: StateView;
  /** slot próprio (mesmo espaço de slots dos jogadores; nunca entra na grade espacial) */
  slot: number;
  /** centro da área de interesse (câmera), já preso aos limites */
  cam: { x: number; z: number };
  camAt: number;
  /** altitude da câmera acima do foco (m), presa; camada atual (histerese) */
  alt: number;
  tier: SpecTier;
  /** entrega de células agregadas (FAR/AGGREGATE) */
  feed: CellFeed;
  inView: SlotView;
  vehInView: Set<string>;
  overflow: number[];
  crowdKnown: Set<number>;
  aoiCap: number;
  /** spec_cam descartados (taxa/inválidos) — QA */
  dropped: number;
}

export type CamResult = 'ok' | 'rate' | 'invalid' | 'unknown';

export class SpectatorSessions {
  readonly map = new Map<string, SpectatorSession>();
  constructor(private bounds: Bounds, private minIntervalMs: number = SPECTATOR.serverMinIntervalMs) {}

  get size() { return this.map.size; }
  get(sid: string) { return this.map.get(sid); }
  values() { return this.map.values(); }

  add(client: Client, slot: number, start: { x: number; z: number; alt?: unknown }, aoiCap: number): SpectatorSession {
    const alt = sanitizeSpecAlt(start);
    const tier = tierForAltitude(alt, 'NEAR');
    const feed = new CellFeed();
    feed.setTier(tier);
    const s: SpectatorSession = {
      sid: client.sessionId, client, view: new StateView(), slot, cam: clampToBounds(start.x, start.z, this.bounds), camAt: -Infinity, alt, tier, feed,
      inView: makeSlotView(), vehInView: new Set(), overflow: [], crowdKnown: new Set(), aoiCap, dropped: 0,
    };
    this.map.set(s.sid, s);
    return s;
  }

  remove(sid: string): SpectatorSession | undefined {
    const s = this.map.get(sid);
    this.map.delete(sid);
    return s;
  }

  /** spec_cam do cliente: validado, preso aos limites e com taxa limitada (o excesso é ignorado, sem resposta) */
  onCam(sid: string, raw: unknown, now: number): CamResult {
    const s = this.map.get(sid);
    if (!s) return 'unknown';
    if (!rateOk(s.camAt, now, this.minIntervalMs)) { s.dropped++; return 'rate'; }
    const c = sanitizeSpecCam(raw, this.bounds);
    if (!c) { s.dropped++; return 'invalid'; }
    s.cam = c; s.camAt = now;
    s.alt = sanitizeSpecAlt(raw);
    s.tier = tierForAltitude(s.alt, s.tier);
    s.feed.setTier(s.tier);
    return 'ok';
  }

  /** raio do AOI de entidades do espectador (m) — nunca maior que o do jogador */
  static aoiRadius(s: Pick<SpectatorSession, 'tier'>, playerRadius: number): number {
    return Math.min(playerRadius, SPEC_TIER_AOI[s.tier]);
  }
}
