/**
 * Rodada 11 — preferências de entrada locais (por aparelho): sensibilidade da câmera e eixo Y invertido.
 * A tela de ajustes (agente D) lê/escreve aqui; o InputManager aplica na hora (`onChange`). docs/DESKTOP_CONTROLS.md
 */
export interface InputPrefs {
  /** multiplicador da sensibilidade da câmera (1 = padrão; 0,25–3) */
  sensitivity: number;
  /** arrastar para cima olha para baixo */
  invertY: boolean;
}

export const INPUT_PREFS_DEFAULT: InputPrefs = { sensitivity: 1, invertY: false };
/** radianos por pixel com sensitivity = 1 (o mesmo ganho de antes, com o mouse capturado) */
export const BASE_LOOK_RAD_PER_PX = 0.0024;
const KEY = 'pv3d.input';

export function sanitizeInputPrefs(v: unknown): InputPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<InputPrefs>;
  const s = Number(o.sensitivity);
  return {
    sensitivity: Number.isFinite(s) ? Math.min(3, Math.max(0.25, s)) : INPUT_PREFS_DEFAULT.sensitivity,
    invertY: o.invertY === true,
  };
}

class InputPrefsStore {
  private v: InputPrefs;
  private fns = new Set<(p: InputPrefs) => void>();
  constructor() {
    let raw: unknown = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* sem armazenamento */ }
    this.v = sanitizeInputPrefs(raw);
  }
  get value(): InputPrefs { return this.v; }
  set(p: Partial<InputPrefs>) {
    this.v = sanitizeInputPrefs({ ...this.v, ...p });
    try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch { /* sem armazenamento */ }
    for (const f of this.fns) f(this.v);
  }
  onChange(fn: (p: InputPrefs) => void) { this.fns.add(fn); return () => this.fns.delete(fn); }
}

export const inputPrefs = new InputPrefsStore();
