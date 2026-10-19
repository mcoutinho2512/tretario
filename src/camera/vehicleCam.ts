/**
 * Rodada 11 — câmera ao dirigir (docs/VEHICLE_MOUNTING.md · docs/DESKTOP_CONTROLS.md). PURO (tests/desktopInput.test.ts).
 *
 * A câmera acompanha o rumo do veículo suavemente (carro um pouco mais rápido; moto, bicicleta e patinete iguais).
 * Botão direito arrastando = olhar em volta: enquanto segura, NADA puxa a câmera; ao soltar, espera RETURN_DELAY_MS e
 * volta para trás do veículo com suavização — mesmo parado (quem olhou em volta quer a câmera de volta).
 * Sem olhar em volta, parado (|v| ≤ 1 m/s) a câmera fica onde está (como antes).
 */
export const RETURN_DELAY_MS = 1000;

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class VehicleCamFollow {
  /** voltando para trás do veículo depois de olhar em volta */
  returning = false;
  private sawLook = false;

  /**
   * novo yaw da câmera. `looking` = arrasto de câmera em curso; `lastLookEnd` = fim do último arrasto (ms, mesmo
   * relógio de `now`); `rate` = 1/s (carro 2,2; demais 1,5).
   */
  step(camYaw: number, heading: number, speed: number, dt: number, now: number, looking: boolean, lastLookEnd: number, rate: number): number {
    if (looking) { this.sawLook = true; this.returning = false; return camYaw; }
    if (this.sawLook && now - lastLookEnd < RETURN_DELAY_MS) return camYaw;
    if (this.sawLook) { this.sawLook = false; this.returning = true; }
    const d = wrap(heading - camYaw);
    if (this.returning && Math.abs(d) < 0.02) this.returning = false;
    if (!this.returning && Math.abs(speed) <= 1) return camYaw;
    // volta depois do olhar: um pouco mais firme que o seguir normal, sempre suave
    const k = Math.min(1, dt * (this.returning ? Math.max(rate, 2.4) : rate));
    return camYaw + d * k;
  }

  reset() { this.returning = false; this.sawLook = false; }
}
