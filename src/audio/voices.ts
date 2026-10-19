/**
 * Rodada 10 — ORÇAMENTO DE VOZES (puro, sem WebAudio). Duas peças:
 *
 *  VoicePool       sons pontuais: N vozes fixas (cada uma = cadeia de nós REUSADA no AudioManager; só a fonte do
 *                  buffer é nova a cada disparo). Pedido com prioridade (= audibilidade × peso): vaga livre → usa;
 *                  sem vaga → rouba a voz de MENOR prioridade se o novo for mais importante; senão é descartado
 *                  (contado como "culled"). Nunca cresce.
 *  LoopScheduler   fontes contínuas LÓGICAS (motor, trio, carro de som…) em número ilimitado → no máximo M vozes
 *                  REAIS, as mais audíveis; histerese para não trocar a cada quadro; o resto fica virtual (sem nó).
 */

export interface PoolStats { played: number; stolen: number; culled: number; busy: number; size: number }

export class VoicePool {
  private endsAt: Float64Array;
  private prio: Float64Array;
  private dur: Float64Array;
  readonly stats: PoolStats;
  constructor(readonly size: number) {
    this.endsAt = new Float64Array(size);
    this.prio = new Float64Array(size);
    this.dur = new Float64Array(size);
    this.stats = { played: 0, stolen: 0, culled: 0, busy: 0, size };
  }
  /** vozes tocando em `now` */
  busy(now: number) { let n = 0; for (let i = 0; i < this.size; i++) if (this.endsAt[i] > now) n++; return n; }
  /**
   * reserva uma voz até `now + dur`; devolve { slot, steal } ou null (descartado). `steal` = a voz estava tocando
   * (o dono corta o som antigo com rampa curta antes de começar o novo).
   */
  alloc(prio: number, now: number, dur: number): { slot: number; steal: boolean } | null {
    let free = -1, low = -1, lowP = Infinity;
    for (let i = 0; i < this.size; i++) {
      if (this.endsAt[i] <= now) { free = i; break; }
      // a voz que mais perdeu importância: prioridade decai com o tempo de vida (rouba primeiro a que já está acabando)
      const p = this.prio[i] * (0.5 + 0.5 * Math.min(1, (this.endsAt[i] - now) / Math.max(1e-3, this.dur[i])));
      if (p < lowP) { lowP = p; low = i; }
    }
    let slot = free, steal = false;
    if (slot < 0) {
      if (low < 0 || lowP >= prio) { this.stats.culled++; return null; }
      slot = low; steal = true; this.stats.stolen++;
    }
    this.endsAt[slot] = now + dur;
    this.prio[slot] = prio;
    this.dur[slot] = dur;
    this.stats.played++;
    this.stats.busy = this.busy(now);
    return { slot, steal };
  }
  release(slot: number) { this.endsAt[slot] = 0; this.prio[slot] = 0; }
}

export interface LogicalLoop {
  /** identificador estável do dono (para histerese) */
  id: number;
  /** audibilidade atual (ganho × atenuação), 0 = inaudível */
  aud: number;
}

/**
 * Atribui no máximo `slots` vozes reais às fontes lógicas mais audíveis. `assign[i]` = id lógico na voz i (−1 =
 * livre). Fontes já tocando ganham bônus `keep` (histerese). Devolve as trocas para o dono aplicar.
 */
export class LoopScheduler {
  readonly assign: number[];
  stats = { logical: 0, real: 0, virtual: 0, swaps: 0 };
  private chosen = new Set<number>();
  private order: LogicalLoop[] = [];
  constructor(readonly slots: number, private keep = 1.35, private min = 0.003) { this.assign = new Array(slots).fill(-1); }

  update(loops: readonly LogicalLoop[]): { slot: number; from: number; to: number }[] {
    const cur = new Set(this.assign);
    this.order.length = 0;
    for (const l of loops) if (l.aud > this.min) this.order.push(l);
    this.order.sort((a, b) => (b.aud * (cur.has(b.id) ? this.keep : 1)) - (a.aud * (cur.has(a.id) ? this.keep : 1)));
    this.chosen.clear();
    for (let i = 0; i < Math.min(this.slots, this.order.length); i++) this.chosen.add(this.order[i].id);
    const changes: { slot: number; from: number; to: number }[] = [];
    // libera vozes cujas fontes saíram do conjunto
    for (let s = 0; s < this.slots; s++) {
      const id = this.assign[s];
      if (id >= 0 && !this.chosen.has(id)) { changes.push({ slot: s, from: id, to: -1 }); this.assign[s] = -1; }
    }
    // entra quem foi escolhido e ainda não tem voz
    const has = new Set(this.assign);
    for (const id of this.chosen) {
      if (has.has(id)) continue;
      const s = this.assign.indexOf(-1);
      if (s < 0) break;
      const prev = changes.find((c) => c.slot === s && c.to === -1);
      if (prev) prev.to = id; else changes.push({ slot: s, from: -1, to: id });
      this.assign[s] = id;
    }
    this.stats.logical = loops.length;
    this.stats.real = this.assign.filter((x) => x >= 0).length;
    this.stats.virtual = loops.length - this.stats.real;
    this.stats.swaps += changes.length;
    return changes;
  }
  slotOf(id: number) { return this.assign.indexOf(id); }
}
