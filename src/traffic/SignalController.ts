/**
 * Ciclos de semáforo por cruzamento (2 fases: via principal / transversal), com amarelo e vermelho geral,
 * e defasagem por cruzamento (onda verde ao longo da Pres. Vargas). Determinístico a partir do tempo:
 * no multiplayer, o servidor só precisa compartilhar o relógio.
 */
import type { Junction } from '../world/types';

export type Light = 'G' | 'Y' | 'R';

export const CYCLE = { green0: 26, yellow: 3, allRed: 2, green1: 16 };
export const CYCLE_LENGTH = CYCLE.green0 + CYCLE.yellow + CYCLE.allRed + CYCLE.green1 + CYCLE.yellow + CYCLE.allRed;

export class SignalController {
  private offsets = new Map<number, number>();
  time = 0;

  constructor(junctions: Junction[]) {
    for (const j of junctions) this.offsets.set(j.id, j.offset);
  }

  /** avança o tempo (s). Com relógio global, use setTime(clock.seconds()) */
  update(dt: number) {
    this.time += dt;
  }

  setTime(seconds: number) {
    this.time = seconds;
  }

  /** estado da luz para os veículos da fase `ph` no cruzamento `j` */
  state(j: number, ph: number, t = this.time): Light {
    return lightAt(((t + (this.offsets.get(j) ?? 0)) % CYCLE_LENGTH + CYCLE_LENGTH) % CYCLE_LENGTH, ph);
  }

  /** segundos até o fim do estado atual (para pedestres decidirem atravessar) */
  remaining(j: number, ph: number): number {
    const s = this.state(j, ph);
    let dt = 0;
    while (dt < CYCLE_LENGTH && this.state(j, ph, this.time + dt) === s) dt += 0.5;
    return dt;
  }
}

/** função pura (testável): estado da fase `ph` no instante local `t` do ciclo */
export function lightAt(t: number, ph: number): Light {
  const { green0, yellow, allRed, green1 } = CYCLE;
  if (ph === 0) {
    if (t < green0) return 'G';
    if (t < green0 + yellow) return 'Y';
    return 'R';
  }
  const start = green0 + yellow + allRed;
  if (t >= start && t < start + green1) return 'G';
  if (t >= start + green1 && t < start + green1 + yellow) return 'Y';
  return 'R';
}
