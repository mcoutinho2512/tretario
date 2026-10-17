/**
 * Interface do espectador (rodada 8): seletor de câmeras (componente montável — o HUD geral decide onde) e selo
 * "MODO ESPECTADOR". Atalhos 1–6 (ignorados enquanto se digita no chat ou em outro campo).
 */
import './spectator.css';
import { SPEC_CAMS, type SpecCamMode } from './SpectatorCamera';

export class CameraSwitcher {
  readonly el: HTMLDivElement;
  onSelect: ((m: SpecCamMode) => void) | null = null;
  private buttons = new Map<SpecCamMode, HTMLButtonElement>();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'spec-cams';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Câmeras do espectador');
    for (const c of SPEC_CAMS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'spec-cam';
      b.dataset.cam = c.id;
      b.innerHTML = `<kbd>${c.key}</kbd>${c.label}`;
      b.title = `${c.label} (tecla ${c.key})`;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.onSelect?.(c.id); });
      this.buttons.set(c.id, b);
      this.el.appendChild(b);
    }
  }

  setActive(m: SpecCamMode) {
    for (const [id, b] of this.buttons) b.setAttribute('aria-pressed', String(id === m));
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    const c = SPEC_CAMS.find((x) => e.code === `Digit${x.key}` || e.code === `Numpad${x.key}`);
    if (c) { e.preventDefault(); this.onSelect?.(c.id); }
  };

  /** monta no elemento dado e liga os atalhos de teclado */
  mount(parent: HTMLElement) { parent.appendChild(this.el); window.addEventListener('keydown', this.onKey); }
  unmount() { this.el.remove(); window.removeEventListener('keydown', this.onKey); }
}

export class SpectatorBadge {
  readonly el: HTMLDivElement;
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'spec-badge';
    this.el.innerHTML = '<b>MODO ESPECTADOR</b><span>assistindo ao vivo</span>';
  }
  /** texto secundário (ex.: câmera atual, pessoas na vista) */
  set(sub: string) { const s = this.el.querySelector('span'); if (s && s.textContent !== sub) s.textContent = sub; }
}
