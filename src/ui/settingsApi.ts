/**
 * Rodada 11 — CONTRATO do painel de AJUSTES (sem DOM; pode ser importado de qualquer lugar sem ciclo):
 *  - `openSettings(tab)` abre o painel na aba pedida (o menu do jogo do Esc, agente A, chama daqui);
 *  - `setControlsOpener(fn)` registra quem abre a tela de CONTROLES/teclas (agente A). A aba "Controles" do painel
 *    delega para ela; sem registro, cai na ajuda de teclas do HUD.
 */
export type SettingsTab = 'geral' | 'audio' | 'graficos' | 'interface' | 'controles';
export const SETTINGS_TABS: readonly SettingsTab[] = ['geral', 'audio', 'graficos', 'interface', 'controles'];
export const TAB_LABEL: Record<SettingsTab, string> = { geral: 'Geral', audio: 'Áudio', graficos: 'Gráficos', interface: 'Interface', controles: 'Controles' };

export function parseTab(v: unknown): SettingsTab {
  return SETTINGS_TABS.includes(v as SettingsTab) ? (v as SettingsTab) : 'geral';
}

/** navegação por teclado na fileira de abas (setas circulam, Home/End vão às pontas); null = tecla não é de aba */
export function nextTab(current: SettingsTab, key: string): SettingsTab | null {
  const i = SETTINGS_TABS.indexOf(current), n = SETTINGS_TABS.length;
  const to = key === 'ArrowRight' ? (i + 1) % n : key === 'ArrowLeft' ? (i + n - 1) % n : key === 'Home' ? 0 : key === 'End' ? n - 1 : -1;
  return to < 0 ? null : SETTINGS_TABS[to];
}

let settingsOpener: ((tab: SettingsTab) => void) | null = null;
let controlsOpener: (() => void) | null = null;

/** abre o painel de ajustes na aba `tab`. Devolve false se o jogo ainda não montou o painel. */
export function openSettings(tab: SettingsTab = 'geral'): boolean {
  if (!settingsOpener) return false;
  settingsOpener(parseTab(tab));
  return true;
}

/** o SettingsPanel se registra ao ser criado */
export function registerSettingsOpener(fn: ((tab: SettingsTab) => void) | null) { settingsOpener = fn; }

/** tela de controles (agente A); null remove */
export function setControlsOpener(fn: (() => void) | null) { controlsOpener = fn; }

/** a aba "Controles" chama: true se havia uma tela registrada */
export function openControls(): boolean {
  if (!controlsOpener) return false;
  controlsOpener();
  return true;
}

export function hasControlsOpener(): boolean { return !!controlsOpener; }
