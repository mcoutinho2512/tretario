/**
 * Barramento de eventos de gameplay (rodada 9): síncrono, em processo, sem Colyseus. Quem acontece emite; missões,
 * conquistas e telemetria assinam. Um assinante que lança erro não derruba os outros nem o tick.
 */
import type { GameplayEnvelope, GameplayEvent } from '../../../src/gameplay/events';
import { log } from '../log';

export type GameplayListener = (e: GameplayEnvelope) => void;

export class GameplayBus {
  private ls = new Set<GameplayListener>();
  errors = 0;
  emitted = 0;
  /** rodada 12 — entidades cujos eventos não contam (personagens autônomos: missões/progressão/telemetria só de pessoas) */
  ignore: ((sid: string) => boolean) | null = null;

  on(fn: GameplayListener): () => void { this.ls.add(fn); return () => this.ls.delete(fn); }

  emit(sid: string, ev: GameplayEvent, at = Date.now()) {
    if (this.ignore?.(sid)) return;
    this.emitted++;
    const env: GameplayEnvelope = { sid, at, ev };
    for (const fn of this.ls) {
      try { fn(env); } catch (err) { this.errors++; if (this.errors < 20) log.warn('error', 'assinante de gameplay falhou', { err: err as Error }); }
    }
  }

  get size() { return this.ls.size; }
}
