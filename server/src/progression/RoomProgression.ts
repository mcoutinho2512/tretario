/**
 * Cola da rodada 9 para a sala (sem Colyseus): ProgressionService + emissores de gameplay + telemetria, ligados ao
 * barramento `room.gameplay`. A sala só repassa o ciclo de vida (entrar/cair/sair/tick/descartar) e uma linha por
 * caminho de aceite (`r9.e.*`) — ver o bloco "rodada 9 — progressão" em PresidenteVargasRoom.ts.
 */
import { fileURLToPath } from 'node:url';
import type { GameplayBus } from '../gameplay/bus';
import type { DataStore } from '../data/types';
import type { ItemEntitlements } from '../../../src/characters/unlocks';
import { ProgressionService } from './ProgressionService';
import { GameplayEmitters, type RallyRing } from './emitters';
import { GameplayTelemetry } from '../telemetry/GameplayTelemetry';
import { loadCatalog } from './catalog';
import { liveProgression } from './entitlements';

export interface RoomProgressionDeps {
  send: (sid: string, type: string, msg: unknown) => void;
  store: DataStore | null;
  /** jogadores no chão (posição aceita) — permanência nas concentrações */
  players: () => Iterable<{ sid: string; x: number; z: number }>;
  rings: () => RallyRing[];
}

/** identidade mínima (server/src/identity/resolve.ts) — persistente = conta real (não visitante/anônimo/teste) */
type Ident = { userId: string | null; test?: boolean; role?: string; bot?: boolean };
const persistentOf = (id: Ident | undefined) => !!id?.userId && !id.test;

export class RoomProgression {
  readonly service: ProgressionService;
  readonly e: GameplayEmitters;
  readonly telemetry: GameplayTelemetry;
  private off: (() => void)[] = [];

  constructor(bus: GameplayBus, private deps: RoomProgressionDeps) {
    const tfile = process.env.PV_TELEMETRY_FILE ?? (process.env.PV_TEST === '1' ? null : fileURLToPath(new URL('../../data/telemetry.jsonl', import.meta.url)));
    this.telemetry = new GameplayTelemetry({ file: tfile || null, periodS: Number(process.env.PV_TELEMETRY_S ?? 60) });
    this.service = new ProgressionService({
      catalog: loadCatalog(), store: deps.store, send: (sid, t, m) => deps.send(sid, t, m),
      flushMs: Number(process.env.PV_PROG_FLUSH_S ?? 15) * 1000, observer: this.telemetry.observer,
    });
    this.e = new GameplayEmitters(bus);
    this.off.push(bus.on(this.service.listener), bus.on(this.telemetry.listener));
    liveProgression.add(this.service);
  }

  /** onAuth: direitos da conta antes de validar o visual salvo */
  async preload(id: Ident): Promise<ItemEntitlements> {
    return persistentOf(id) && this.deps.store ? this.service.preload(id.userId!) : { items: new Set() };
  }

  /** onJoin (jogador): progresso + direitos no ator social (ações/designs bloqueados) */
  join(sid: string, id: Ident, social?: { ent?: ItemEntitlements }): ItemEntitlements {
    if (id.bot) return { items: new Set() }; // bot de carga (servidor de teste): sem progressão nem telemetria
    const ent = this.service.join(sid, { userId: id.userId, persistent: persistentOf(id) });
    if (social) social.ent = ent;
    this.telemetry.sessionStart(sid, persistentOf(id));
    return ent;
  }

  ent(sid: string): ItemEntitlements { return this.service.entitlementsOf(sid); }
  drop(sid: string) { this.service.drop(sid); }
  leave(sid: string) { this.service.leave(sid); this.e.forget(sid); this.telemetry.sessionEnd(sid); }
  track(sid: string, m: unknown) { this.service.track(sid, m); }
  seen(sid: string, m: unknown) { this.service.seen(sid, m); }

  tick(dtMs: number, now = Date.now()) {
    this.service.tick(now);
    this.e.tick(dtMs, this.deps.players, this.deps.rings, now);
    this.telemetry.maybeLog(now);
  }

  async dispose() {
    for (const f of this.off) f();
    await this.service.flushAll();
    await this.telemetry.flush();
    liveProgression.delete(this.service);
  }
}
