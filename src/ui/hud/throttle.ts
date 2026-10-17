/**
 * Ajudantes do HUD para NÃO fazer trabalho de DOM por quadro (rodada 8):
 *  - RateGate: deixa passar no máximo `hz` vezes por segundo
 *  - TextSlot / ClassSlot: só tocam no DOM quando o valor muda
 *  - AutoHide: decide quando o HUD esmaece (jogador andando / parado sem mexer no HUD) e quando volta
 * Puros (o DOM entra só como alvo de escrita); testados em tests/hud.test.ts.
 */

export class RateGate {
  private next = -Infinity;
  constructor(public hz: number) {}
  /** true se já pode rodar em `nowMs` (e agenda a próxima) */
  due(nowMs: number): boolean {
    if (nowMs < this.next) return false;
    const step = 1000 / this.hz;
    // sem acumular atraso: se perdeu várias janelas (aba em segundo plano), recomeça do agora
    this.next = nowMs - this.next > step * 2 ? nowMs + step : this.next + step;
    return true;
  }
  /** força a próxima chamada a passar */
  poke() { this.next = -Infinity; }
}

/** texto que só é escrito quando muda (textContent força layout/estilo do nó) */
export class TextSlot {
  private v: string | null = null;
  writes = 0;
  constructor(readonly el: { textContent: string | null }) {}
  set(text: string): boolean {
    if (text === this.v) return false;
    this.v = text;
    this.el.textContent = text;
    this.writes++;
    return true;
  }
  get value() { return this.v ?? ''; }
}

/** classe que só é trocada quando muda */
export function setClass(el: { classList: { contains(c: string): boolean; toggle(c: string, on: boolean): unknown } }, cls: string, on: boolean): boolean {
  if (el.classList.contains(cls) === on) return false;
  el.classList.toggle(cls, on);
  return true;
}

export interface AutoHideOptions {
  /** ms sem interação até esmaecer (parado) */
  idleMs?: number;
  /** ms andando contínuo até esmaecer */
  movingMs?: number;
}

/**
 * Estado de auto-ocultar: `poke()` em toda interação com o HUD (mouse solto sobre ele, toque, tecla de HUD, aviso
 * novo); `update(now, moving)` diz se está esmaecido. Andando, esmaece mais rápido (o cenário é o protagonista).
 */
export class AutoHide {
  enabled = true;
  private lastPoke = 0;
  private movingSince = -1;
  faded = false;
  readonly idleMs: number;
  readonly movingMs: number;
  constructor(opts: AutoHideOptions = {}) {
    this.idleMs = opts.idleMs ?? 9000;
    this.movingMs = opts.movingMs ?? 2500;
  }
  poke(nowMs: number) { this.lastPoke = nowMs; this.movingSince = -1; }
  /** devolve true se o estado mudou */
  update(nowMs: number, moving: boolean): boolean {
    if (moving) { if (this.movingSince < 0) this.movingSince = Math.max(nowMs, this.lastPoke); } else this.movingSince = -1;
    const idle = nowMs - this.lastPoke > this.idleMs;
    const movedLong = this.movingSince >= 0 && nowMs - this.movingSince > this.movingMs;
    const f = this.enabled && (idle || movedLong);
    if (f === this.faded) return false;
    this.faded = f;
    return true;
  }
}
