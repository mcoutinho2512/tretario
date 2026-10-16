/**
 * Relógio do mundo. Singleplayer: relógio do sistema. Multiplayer: sincronizado com o servidor
 * (estimativa de offset por ping, estilo NTP, filtrando pelo menor RTT).
 * Semáforos, ciclos e eventos são função DESTE relógio → todos os clientes veem o mesmo estado.
 */
export class WorldClock {
  private offset = 0;
  private bestRtt = Infinity;
  samples = 0;

  now(): number {
    return Date.now() + this.offset;
  }

  seconds(): number {
    return this.now() / 1000;
  }

  /** registra uma amostra de sincronização: t0 = envio local, ts = hora do servidor, t1 = recebimento local */
  addSample(t0: number, ts: number, t1: number) {
    const rtt = t1 - t0;
    if (rtt < 0) return;
    this.samples++;
    // a amostra com menor RTT é a mais confiável; aceita também amostras próximas (deriva)
    if (rtt <= this.bestRtt * 1.25 || this.samples < 3) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      const est = ts + rtt / 2 - t1;
      this.offset = this.samples < 3 ? est : this.offset * 0.7 + est * 0.3;
    }
  }

  get rtt() { return this.bestRtt; }
  get offsetMs() { return this.offset; }
}

export const worldClock = new WorldClock();
