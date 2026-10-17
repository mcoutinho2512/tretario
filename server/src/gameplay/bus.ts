/**
 * Barramento de eventos de gameplay (rodada 9): síncrono, em processo, sem Colyseus. Quem acontece emite; missões,
 * conquistas e telemetria assinam. Um assinante que lança erro não derruba os outros nem o tick.
 */
import type { GameplayEnvelope, GameplayEvent } from '../../../src/gameplay/events';

export type GameplayListener = (e: GameplayEnvelope) => void;

export class GameplayBus {
  private ls = new Set<GameplayListener>();
  errors = 0;
  emitted = 0;

  on(fn: GameplayListener): () => void { this.ls.add(fn); return () => this.ls.delete(fn); }

  emit(sid: string, ev: GameplayEvent, at = Date.now()) {
    this.emitted++;
    const env: GameplayEnvelope = { sid, at, ev };
    for (const fn of this.ls) {
      try { fn(env); } catch (err) { this.errors++; if (this.errors < 20) console.warn('[gameplay] assinante falhou:', (err as Error).message); }
    }
  }

  get size() { return this.ls.size; }
}
