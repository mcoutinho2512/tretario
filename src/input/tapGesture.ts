/**
 * Rodada 10 — TOQUE × ARRASTO (puro; tests/interaction.test.ts). Um dedo que anda menos que TAP_SLOP_PX e solta em
 * até TAP_MAX_MS é um TOQUE (interage com o objeto); passou do limiar, vira ARRASTO (câmera) e nunca mais é toque.
 * Enquanto não passou do limiar o olhar NÃO gira (um toque não mexe a câmera). Dois dedos (pinça) cancelam o toque.
 */
export const TAP_SLOP_PX = 10;
export const TAP_MAX_MS = 350;
const STALE_MS = 5000;

interface Track { x0: number; y0: number; t0: number; drag: boolean; cancelled: boolean; solo: boolean }

export class TapTracker {
  private t = new Map<number, Track>();

  /**
   * dedo novo. Outro dedo de OLHAR ainda ativo nesta camada = gesto de dois dedos (pinça): nenhum dos dois vira
   * toque. `solo` = dedo do joystick: não conta para a pinça (andar com o polegar esquerdo e tocar num objeto com o
   * direito funciona) e não é cancelado por ela. Dedos sem `touchend` há mais de STALE_MS (evento perdido) são
   * esquecidos — não travam os toques seguintes.
   */
  begin(id: number, x: number, y: number, now: number, solo = false) {
    for (const [k, v] of this.t) if (now - v.t0 > STALE_MS) this.t.delete(k);
    let multi = false;
    if (!solo) for (const v of this.t.values()) if (!v.solo) multi = true;
    this.t.set(id, { x0: x, y0: y, t0: now, drag: false, cancelled: false, solo });
    if (multi) this.cancelAll();
  }

  /** devolve true quando este dedo já é ARRASTO (o chamador aplica o olhar) */
  move(id: number, x: number, y: number): boolean {
    const k = this.t.get(id);
    if (!k) return true;
    if (!k.drag && Math.hypot(x - k.x0, y - k.y0) > TAP_SLOP_PX) k.drag = true;
    return k.drag;
  }

  /** origem do dedo (o 1º delta do arrasto parte daqui: sem perder o movimento do limiar) */
  origin(id: number): { x: number; y: number } | null { const k = this.t.get(id); return k ? { x: k.x0, y: k.y0 } : null; }

  isDrag(id: number): boolean { return this.t.get(id)?.drag ?? false; }

  /** soltou: 'tap' | 'drag' | null (desconhecido / cancelado) */
  end(id: number, x: number, y: number, now: number): 'tap' | 'drag' | null {
    const k = this.t.get(id);
    this.t.delete(id);
    if (!k || k.cancelled) return null;
    if (k.drag || Math.hypot(x - k.x0, y - k.y0) > TAP_SLOP_PX) return 'drag';
    return now - k.t0 <= TAP_MAX_MS ? 'tap' : null; // segurou parado: nem toque nem arrasto
  }

  /** pinça / segundo dedo: nenhum dos dedos atuais vira toque */
  cancelAll() { for (const k of this.t.values()) if (!k.solo) k.cancelled = true; }
  forget(id: number) { this.t.delete(id); }
  get size() { return this.t.size; }
}
