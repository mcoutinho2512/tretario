/**
 * Indicador "MÃOS / ITEM ATUAL" (rodada 9): pílula discreta no canto inferior direito, acima de "Ações G". Some com o
 * HUD (hud-fadeable) e volta quando muda. Nada por quadro: `set` só escreve no DOM quando o texto muda (TextSlot).
 * No toque, tocar na pílula faz a ação sugerida (pegar / largar).
 */
import { TextSlot, setClass } from './throttle';

export interface HandState {
  /** item na mão (rótulo) ou null = mãos vazias */
  held: string | null;
  /** item de confronto possuído mas guardado (rótulo) */
  stowed: string | null;
  /** item no chão/apoio ao alcance (rótulo) */
  near: string | null;
  /** possui um item de confronto (pode largar) */
  canDrop: boolean;
}

export class HandIndicator {
  readonly el: HTMLDivElement;
  private title: TextSlot;
  private hint: TextSlot;
  onTap?: () => void;
  /** o HUD esmaecido volta a aparecer quando o conteúdo muda */
  onChange?: () => void;

  constructor(private touch: boolean) {
    const el = (this.el = document.createElement('div'));
    el.className = 'hud-hand hud-fadeable';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const k = document.createElement('div'); k.className = 'hh-kicker'; k.textContent = 'Mãos';
    const t = document.createElement('div'); t.className = 'hh-item';
    const h = document.createElement('div'); h.className = 'hh-hint';
    el.append(k, t, h);
    this.title = new TextSlot(t);
    this.hint = new TextSlot(h);
    el.addEventListener('pointerdown', (e) => { if (this.touch) { e.stopPropagation(); this.onTap?.(); } });
    this.set({ held: null, stowed: null, near: null, canDrop: false });
  }

  set(s: HandState) {
    const a = this.title.set(s.held ?? (s.stowed ? `Vazias · ${s.stowed} guardado` : 'Vazias'));
    const key = (k: string) => (this.touch ? '' : `${k} `);
    const hint = s.near ? `${key('T')}pegar ${s.near.toLowerCase()}` : s.canDrop ? `${this.touch ? 'toque: ' : ''}${key('Z')}largar${this.touch ? '' : ` · X ${s.held ? 'guardar' : 'sacar'}`}` : '';
    const b = this.hint.set(hint);
    setClass(this.el, 'armed', !!s.held && s.canDrop && !s.stowed);
    setClass(this.el, 'empty', !s.held && !s.near && !s.canDrop);
    if (a || b) this.onChange?.();
  }

  get text() { return { item: this.title.value, hint: this.hint.value }; }
}
