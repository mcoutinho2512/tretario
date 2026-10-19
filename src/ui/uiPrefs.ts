/**
 * Rodada 11 — preferências de INTERFACE (só no navegador, `pv3d.ui`): escala da interface (80/90/100/110/125 %) e
 * "reduzir movimento". A escala vira a variável CSS `--ui-scale` em <html> e é aplicada com `zoom` aos blocos do HUD e
 * aos painéis (src/ui/style.css "escala da interface") — NUNCA ao canvas do jogo nem aos rótulos presos ao mundo
 * (nomes, realce de interação), que seguem posições de tela em pixels.
 * "Reduzir movimento": classe `reduce-motion` em <html> (sem transições/animações do HUD, sem giro de abertura da
 * câmera, véus de tela no modo reduzido); quem mexe na câmera consulta `isReduceMotion()`.
 */
export const UI_SCALES = [80, 90, 100, 110, 125] as const;
export type UiScale = (typeof UI_SCALES)[number];

export interface UiPrefs { scale: UiScale; reduceMotion: boolean }

const KEY = 'pv3d.ui';

/** qualquer valor → a escala válida mais próxima (texto/número; fora da faixa vai para 80 ou 125; inválido → 100) */
export function clampUiScale(v: unknown): UiScale {
  const n = typeof v === 'string' ? Number(v.replace('%', '')) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return 100;
  const pct = n > 0 && n <= 2 ? n * 100 : n; // aceita 1.1 como 110 %
  let best: UiScale = 100;
  for (const s of UI_SCALES) if (Math.abs(s - pct) < Math.abs(best - pct)) best = s;
  return best;
}

function systemReduceMotion(): boolean {
  try { return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function parseUiPrefs(raw: unknown, fallbackReduce = false): UiPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { scale: r.scale === undefined ? 100 : clampUiScale(r.scale), reduceMotion: typeof r.reduceMotion === 'boolean' ? r.reduceMotion : fallbackReduce };
}

type Listener = (p: UiPrefs) => void;
let current: UiPrefs | null = null;
const listeners = new Set<Listener>();

export function uiPrefs(): UiPrefs {
  if (!current) {
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* sem storage */ }
    current = parseUiPrefs(saved, systemReduceMotion());
  }
  return current;
}

export function setUiPrefs(patch: Partial<UiPrefs>) {
  const next = parseUiPrefs({ ...uiPrefs(), ...patch });
  if (next.scale === current!.scale && next.reduceMotion === current!.reduceMotion) return;
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem storage */ }
  applyUiPrefs();
  for (const fn of listeners) fn(next);
}

export function onUiPrefs(fn: Listener) { listeners.add(fn); return () => listeners.delete(fn); }

export function isReduceMotion(): boolean { return uiPrefs().reduceMotion; }

/** fator de zoom EFETIVO do HUD (1 onde o navegador não tem CSS `zoom`) — para medidas feitas em JS dentro do HUD */
export function uiZoom(): number {
  try { if (typeof CSS === 'undefined' || !CSS.supports('zoom', '1.1')) return 1; } catch { return 1; }
  return uiPrefs().scale / 100;
}

/** escreve a escala/movimento no documento (chamado ao iniciar e a cada mudança) */
export function applyUiPrefs(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined) {
  if (!doc) return;
  const p = uiPrefs();
  doc.documentElement.style.setProperty('--ui-scale', String(p.scale / 100));
  doc.documentElement.classList.toggle('reduce-motion', p.reduceMotion);
}

/** testes: esquece o estado em memória */
export function _resetUiPrefs() { current = null; listeners.clear(); }
