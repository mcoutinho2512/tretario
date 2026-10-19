/**
 * Rodada 11 — limite de FPS escolhido pelo jogador (painel de ajustes → GRÁFICOS), aplicado AO VIVO no
 * FrameGovernor. 'auto' = o do aparelho (30 no celular, 60 no desktop). 'unlimited' = taxa do monitor (rAF).
 * Guardado só no navegador (`pv3d.fps`); `?fps=30|60|0` na URL sobrepõe (testes).
 */
import type { FpsLimit } from './frameGovernor';

export type FpsChoice = 'auto' | '30' | '60' | 'unlimited';
export const FPS_CHOICES: readonly FpsChoice[] = ['auto', '30', '60', 'unlimited'];
const KEY = 'pv3d.fps';

export function parseFpsChoice(v: unknown): FpsChoice {
  return FPS_CHOICES.includes(v as FpsChoice) ? (v as FpsChoice) : 'auto';
}

export function loadFpsChoice(): FpsChoice {
  try { return parseFpsChoice(localStorage.getItem(KEY)); } catch { return 'auto'; }
}
export function saveFpsChoice(c: FpsChoice) {
  try { localStorage.setItem(KEY, c); } catch { /* sem storage */ }
}

/** limite efetivo: URL (`?fps=30|60|0`) > escolha do jogador > aparelho */
export function resolveFpsLimit(choice: FpsChoice, deviceFps: 30 | 60, urlFps: string | null = null): FpsLimit {
  if (urlFps === '30') return 30;
  if (urlFps === '60') return 60;
  if (urlFps === '0' || urlFps === 'unlimited') return 0;
  if (choice === '30') return 30;
  if (choice === '60') return 60;
  if (choice === 'unlimited') return 0;
  return deviceFps;
}

export const FPS_LABEL: Record<FpsChoice, string> = { auto: 'Automático', '30': '30', '60': '60', unlimited: 'Sem limite' };
