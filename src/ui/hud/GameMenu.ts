/**
 * Rodada 11 — MENU DO JOGO (Esc sem nada aberto · docs/DESKTOP_CONTROLS.md). Sobreposição: o mundo NÃO pausa e a
 * conexão continua. CONTINUAR · CONFIGURAÇÕES · CONTROLES · ÁUDIO · GRÁFICOS · SAIR (com confirmação). As abas de
 * ajustes chamam `openSettings(tab)` da casca do HUD (painel do agente D).
 */
import { EscSlot } from '../escStack';

export type SettingsTab = 'geral' | 'audio' | 'graficos' | 'interface';

export interface GameMenuDeps {
  openSettings(tab: SettingsTab): void;
  openControls(): void;
  /** sair do evento (volta à tela inicial) */
  exit(): void;
}

export class GameMenu {
  readonly el: HTMLDivElement;
  private card: HTMLDivElement;
  private confirmEl: HTMLDivElement;
  private esc = new EscSlot('menu-jogo', 100, () => this.toggle(false));
  private confirmEsc = new EscSlot('menu-sair', 300, () => this.showConfirm(false));
  onToggle?: (open: boolean) => void;
  /** QA */
  readonly log: string[] = [];

  constructor(d: GameMenuDeps) {
    const el = (this.el = document.createElement('div'));
    el.className = 'game-menu';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Menu do jogo');
    const card = (this.card = document.createElement('div'));
    card.className = 'gm-card';
    const h = document.createElement('h2');
    h.textContent = 'Menu';
    const sub = document.createElement('p');
    sub.className = 'gm-sub';
    sub.textContent = 'O evento continua acontecendo enquanto o menu está aberto.';
    card.append(h, sub);
    const items: [string, string, () => void][] = [
      ['continuar', 'CONTINUAR', () => this.toggle(false)],
      ['configuracoes', 'CONFIGURAÇÕES', () => this.go(() => d.openSettings('geral'))],
      ['controles', 'CONTROLES', () => this.go(() => d.openControls())],
      ['audio', 'ÁUDIO', () => this.go(() => d.openSettings('audio'))],
      ['graficos', 'GRÁFICOS', () => this.go(() => d.openSettings('graficos'))],
      ['sair', 'SAIR', () => this.showConfirm(true)],
    ];
    for (const [id, label, fn] of items) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `gm-btn${id === 'sair' ? ' danger' : ''}`; b.dataset.item = id; b.textContent = label;
      b.addEventListener('click', () => { this.log.push(id); fn(); });
      card.appendChild(b);
    }
    const c = (this.confirmEl = document.createElement('div'));
    c.className = 'gm-confirm';
    c.hidden = true;
    c.setAttribute('role', 'alertdialog');
    const q = document.createElement('p');
    q.textContent = 'Sair do evento e voltar à tela inicial?';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.className = 'gm-btn danger'; yes.dataset.item = 'sair-sim'; yes.textContent = 'SAIR DO EVENTO';
    yes.addEventListener('click', () => { this.log.push('sair-sim'); d.exit(); });
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'gm-btn'; no.dataset.item = 'sair-nao'; no.textContent = 'FICAR';
    no.addEventListener('click', () => this.showConfirm(false));
    c.append(q, yes, no);
    card.appendChild(c);
    el.appendChild(card);
    el.addEventListener('pointerdown', (e) => { if (e.target === el) this.toggle(false); });
  }

  get open() { return !this.el.hidden; }

  toggle(v = !this.open) {
    if (v === this.open) return;
    this.el.hidden = !v;
    this.esc.set(v);
    if (!v) this.showConfirm(false);
    else this.card.querySelector<HTMLElement>('.gm-btn')?.focus({ preventScroll: true });
    this.log.push(v ? 'open' : 'close');
    this.onToggle?.(v);
  }

  /** fecha o menu e abre o painel pedido (Esc no painel volta ao jogo, não ao menu) */
  private go(fn: () => void) { this.toggle(false); fn(); }

  private showConfirm(v: boolean) {
    if (this.confirmEl.hidden === !v) return;
    this.confirmEl.hidden = !v;
    this.confirmEsc.set(v);
    for (const b of this.card.querySelectorAll<HTMLButtonElement>(':scope > .gm-btn')) b.disabled = v;
    if (v) this.confirmEl.querySelector<HTMLElement>('[data-item="sair-nao"]')?.focus({ preventScroll: true });
  }
}
