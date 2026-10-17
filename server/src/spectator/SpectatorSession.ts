/**
 * Sessões de ESPECTADOR (rodada 8): mesma sala, mesmo mundo, papel 'spectator' decidido pelo servidor.
 * Sem NetPlayer, sem corpo, sem colisão, fora da contagem de jogadores. Recebe só o necessário:
 * área de interesse (StateView: jogadores/veículos próximos + multidão "crowd" + grafites) centrada na posição da
 * CÂMERA, que o cliente manda em baixa frequência (`spec_cam {x, z}`), presa aos limites do mapa e com taxa limitada.
 * Toda mensagem de jogo continua bloqueada por capacidade (PresidenteVargasRoom.gate) — o espectador não tem nenhuma.
 */
import type { Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { makeSlotView, type SlotView } from '../../../src/net/spatialGrid';
import { SPECTATOR, clampToBounds, rateOk, sanitizeSpecCam, type Bounds } from '../../../src/spectator/bounds';

export interface SpectatorSession {
  sid: string;
  client: Client;
  view: StateView;
  /** slot próprio (mesmo espaço de slots dos jogadores; nunca entra na grade espacial) */
  slot: number;
  /** centro da área de interesse (câmera), já preso aos limites */
  cam: { x: number; z: number };
  camAt: number;
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

  add(client: Client, slot: number, start: { x: number; z: number }, aoiCap: number): SpectatorSession {
    const s: SpectatorSession = {
      sid: client.sessionId, client, view: new StateView(), slot, cam: clampToBounds(start.x, start.z, this.bounds), camAt: -Infinity,
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
    return 'ok';
  }
}
