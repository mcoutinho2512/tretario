/**
 * Painel de AJUSTES do jogo (rodada 8): qualidade gráfica (preset existente; aplica ao recarregar), nomes dos
 * jogadores, auto-ocultar o HUD, chat recolhido por padrão, som (reservado). Folha lateral (desktop) / inferior
 * (celular); `role=dialog`, foco no primeiro controle, Esc fecha. Montado uma vez; só muda o que o jogador mexe.
 */
import { loadQualityChoice, saveQualityChoice, type QualityChoice, type QualityLevel } from '../../core/settings';
import type { HudPrefsStore } from './hudPrefs';

const QUALITY: [QualityChoice, string][] = [['auto', 'Automática'], ['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Ultra']];
const NAMES: [string, string][] = [['TODOS', 'Todos'], ['PROXIMOS', 'Próximos'], ['NENHUM', 'Nenhum']];

export class SettingsPanel {
  readonly el: HTMLDivElement;
  open = false;
  onToggle?: (open: boolean) => void;
  private reloadRow: HTMLDivElement;

  constructor(prefs: HudPrefsStore, currentLevel: QualityLevel) {
    const el = (this.el = document.createElement('div'));
    el.className = 'hud-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', 'Ajustes');
    el.hidden = true;
    const head = document.createElement('div');
    head.className = 'sheet-head';
    const h = document.createElement('h2');
    h.textContent = 'Ajustes';
    const close = document.createElement('button');
    close.className = 'sheet-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Fechar ajustes');
    close.textContent = '×';
    close.addEventListener('click', () => this.toggle(false));
    head.append(h, close);
    el.appendChild(head);

    const saved = loadQualityChoice();
    el.appendChild(this.segment('Qualidade gráfica', 'q', QUALITY, saved, (v) => {
      saveQualityChoice(v as QualityChoice);
      this.reloadRow.hidden = false;
    }, `Agora: ${LEVEL_LABEL[currentLevel]}`));
    this.reloadRow = document.createElement('div');
    this.reloadRow.className = 'sheet-note';
    this.reloadRow.hidden = true;
    const rl = document.createElement('button');
    rl.type = 'button';
    rl.className = 'sheet-btn';
    rl.textContent = 'Recarregar para aplicar';
    rl.addEventListener('click', () => location.reload());
    this.reloadRow.append(rl);
    el.appendChild(this.reloadRow);

    el.appendChild(this.segment('Nomes dos jogadores', 'names', NAMES, prefs.value.names, (v) => prefs.set({ names: v as never })));
    el.appendChild(this.check('Esconder o HUD sozinho', 'Some quando você anda; volta ao mexer no mouse, tocar ou abrir algo', prefs.value.hudAutoHide, (v) => prefs.set({ hudAutoHide: v })));
    el.appendChild(this.check('Chat recolhido ao entrar', '', prefs.value.chatCollapsed, (v) => prefs.set({ chatCollapsed: v })));
    el.appendChild(this.check('Som', 'Em breve — o jogo ainda não tem áudio', prefs.value.sound, (v) => prefs.set({ sound: v })));
    const keys = document.createElement('p');
    keys.className = 'sheet-foot';
    keys.textContent = 'H ou P: HUD limpo · M: mapa · G: ações · F1: controles';
    el.appendChild(keys);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.toggle(false); e.stopPropagation(); } });
  }

  toggle(v = !this.open) {
    if (v === this.open) return;
    this.open = v;
    this.el.hidden = !v;
    if (v) (this.el.querySelector<HTMLElement>('input:checked') ?? this.el.querySelector<HTMLElement>('input'))?.focus({ preventScroll: true });
    this.onToggle?.(v);
  }

  private segment(title: string, name: string, opts: [string, string][], value: string, on: (v: string) => void, hint = '') {
    const fs = document.createElement('fieldset');
    fs.className = 'sheet-seg';
    const lg = document.createElement('legend');
    lg.textContent = title;
    fs.appendChild(lg);
    const row = document.createElement('div');
    row.className = 'seg-row';
    for (const [v, label] of opts) {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'radio';
      i.name = `hud-${name}`;
      i.value = v;
      i.checked = v === value;
      i.addEventListener('change', () => { if (i.checked) on(v); });
      const s = document.createElement('span');
      s.textContent = label;
      l.append(i, s);
      row.appendChild(l);
    }
    fs.appendChild(row);
    if (hint) { const p = document.createElement('small'); p.textContent = hint; fs.appendChild(p); }
    return fs;
  }

  private check(title: string, hint: string, value: boolean, on: (v: boolean) => void) {
    const l = document.createElement('label');
    l.className = 'sheet-check';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = value;
    i.addEventListener('change', () => on(i.checked));
    const t = document.createElement('span');
    t.textContent = title;
    l.append(i, t);
    if (hint) { const s = document.createElement('small'); s.textContent = hint; l.appendChild(s); }
    return l;
  }
}

const LEVEL_LABEL: Record<QualityLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra' };
