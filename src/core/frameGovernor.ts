/**
 * Governador de quadros (puro, testável):
 *  - LIMITE de FPS: 30 (celular: estável, menos calor e bateria), 60 (constantes também nas telas de 120 Hz: ritmo
 *    regular em vez de alternar 8/17 ms) ou 0 = SEM LIMITE (rodada 11): renderiza em todo requestAnimationFrame, isto
 *    é, na taxa do monitor (120/144 Hz) — sem laço ocupado; quem dita o ritmo continua sendo o rAF/vsync.
 *    Troca ao vivo com `setLimit` (painel de ajustes), sem recarregar.
 *  - resolução dinâmica: reduz a escala quando o intervalo entre quadros renderizados (ou o tempo de GPU,
 *    se o navegador medir) passa do orçamento; volta a subir devagar quando sobra folga. Sem limite, o orçamento
 *    é o de 60 FPS (só reduz se cair abaixo de 60).
 */
export type FpsLimit = 30 | 60 | 0;

export class FrameGovernor {
  scale = 1;
  private lastRender = -Infinity;
  private emaInterval: number;
  private emaGpu: number | null = null;
  private overFor = 0;
  private underFor = 0;
  private cooldown = 0;
  private _limit: FpsLimit;

  /** `uncapped` (só bancada, sem vsync): renderiza em todo requestAnimationFrame para medir a vazão real */
  constructor(limit: FpsLimit, readonly dynamic: boolean, readonly minScale = 0.55, readonly uncapped = false) {
    this._limit = limit;
    this.emaInterval = this.budgetMs;
  }

  /** limite atual (0 = sem limite) */
  get limit(): FpsLimit { return this.uncapped ? 0 : this._limit; }
  /** FPS que a resolução dinâmica tenta sustentar */
  get targetFps(): 30 | 60 { return this._limit === 30 ? 30 : 60; }
  get budgetMs(): number { return 1000 / this.targetFps; }

  /** troca o limite ao vivo (painel de ajustes) */
  setLimit(limit: FpsLimit) {
    if (limit === this._limit) return;
    this._limit = limit;
    this.emaInterval = this.budgetMs;
    this.overFor = this.underFor = 0;
    this.cooldown = 1;
  }

  /** chamado a cada requestAnimationFrame; diz se este quadro deve ser renderizado */
  shouldRender(now: number): boolean {
    if (this.uncapped || this._limit === 0) { this.lastRender = now; return true; }
    // tolerância (≤ 6 ms, ~35 % do orçamento): a 30 FPS numa tela de 60 Hz renderiza um quadro sim, outro não; a 60 FPS numa tela de
    // 120 Hz também — ritmo FIXO de 16,7 ms. Renderizar em todo quadro de 120 Hz alternava 8 e 17 ms (trancos)
    // sempre que um quadro passava de 8,3 ms. Em tela de 60 Hz a 60 FPS, todo quadro passa.
    const b = this.budgetMs;
    if (now - this.lastRender < b - Math.min(6, b * 0.35)) return false;
    this.lastRender = now;
    return true;
  }

  /**
   * registra um quadro renderizado: intervalo desde o anterior (ms) e tempo de GPU (ms, se disponível).
   * Retorna a nova escala se mudou, senão null.
   */
  onFrame(intervalMs: number, gpuMs: number | null, dtS = intervalMs / 1000): number | null {
    if (!this.dynamic || !Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > 1000) return null;
    this.emaInterval += (intervalMs - this.emaInterval) * 0.1;
    if (gpuMs !== null && Number.isFinite(gpuMs)) this.emaGpu = this.emaGpu === null ? gpuMs : this.emaGpu + (gpuMs - this.emaGpu) * 0.1;
    this.cooldown = Math.max(0, this.cooldown - dtS);
    const b = this.budgetMs;
    const over = this.emaInterval > b * 1.12 || (this.emaGpu !== null && this.emaGpu > b * 0.9);
    const under = this.emaInterval < b * 1.04 && (this.emaGpu === null || this.emaGpu < b * 0.55);
    this.overFor = over ? this.overFor + dtS : 0;
    this.underFor = under ? this.underFor + dtS : 0;
    if (this.cooldown > 0) return null;
    if (this.overFor > 0.8 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, +(this.scale - 0.08).toFixed(3));
      this.cooldown = 1.5; this.overFor = 0;
      return this.scale;
    }
    if (this.underFor > 4 && this.scale < 1) {
      this.scale = Math.min(1, +(this.scale + 0.05).toFixed(3));
      this.cooldown = 2; this.underFor = 0;
      return this.scale;
    }
    return null;
  }

  get stats() { return { scale: this.scale, limit: this.limit, intervalMs: +this.emaInterval.toFixed(2), gpuMs: this.emaGpu === null ? null : +this.emaGpu.toFixed(2) }; }
}
