/**
 * Governador de quadros (puro, testável):
 *  - limita a 30 FPS quando o aparelho pede (celular: estável, menos calor e bateria) e a 60 FPS constantes nas
 *    telas de 120 Hz (ritmo regular em vez de alternar 8/17 ms);
 *  - resolução dinâmica: reduz a escala quando o intervalo entre quadros renderizados (ou o tempo de GPU,
 *    se o navegador medir) passa do orçamento; volta a subir devagar quando sobra folga.
 */
export class FrameGovernor {
  scale = 1;
  private lastRender = -Infinity;
  private emaInterval: number;
  private emaGpu: number | null = null;
  private overFor = 0;
  private underFor = 0;
  private cooldown = 0;
  readonly budgetMs: number;

  constructor(readonly targetFps: 30 | 60, readonly dynamic: boolean, readonly minScale = 0.55) {
    this.budgetMs = 1000 / targetFps;
    this.emaInterval = this.budgetMs;
  }

  /** chamado a cada requestAnimationFrame; diz se este quadro deve ser renderizado */
  shouldRender(now: number): boolean {
    // tolerância (≤ 6 ms, ~35 % do orçamento): a 30 FPS numa tela de 60 Hz renderiza um quadro sim, outro não; a 60 FPS numa tela de
    // 120 Hz também — ritmo FIXO de 16,7 ms. Renderizar em todo quadro de 120 Hz alternava 8 e 17 ms (trancos)
    // sempre que um quadro passava de 8,3 ms. Em tela de 60 Hz a 60 FPS, todo quadro passa.
    if (now - this.lastRender < this.budgetMs - Math.min(6, this.budgetMs * 0.35)) return false;
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

  get stats() { return { scale: this.scale, intervalMs: +this.emaInterval.toFixed(2), gpuMs: this.emaGpu === null ? null : +this.emaGpu.toFixed(2) }; }
}
