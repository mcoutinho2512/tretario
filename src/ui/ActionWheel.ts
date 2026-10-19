/**
 * Roda de ações (radial): G no desktop, botão "AÇÕES" no toque. Não ocupa a tela: só aparece aberta.
 * Categorias no anel interno (GESTOS, MANIFESTAÇÃO, DANÇA, ITENS); as opções da categoria no anel externo.
 * ITENS: pegar/largar item e trocar o design do item na mão (◀ ▶ no centro).
 * Tudo vem dos registros (actions.ts / props.ts / designs.ts) via actionOptions.ts — a barra de ações usa as mesmas opções.
 */
import { EscSlot } from './escStack'; // rodada 11 — entrada
import { isTypingTarget } from '../input/keymap'; // rodada 11 — entrada
import { ACTION_CATEGORIES, type ActionCategory } from '../social/actions';
import { PROP_BY_ID } from '../social/props';
import { actionOptions, itemOptions } from './actionOptions';
import { DESIGN_BY_ID } from '../social/designs';
import type { SocialController } from '../social/SocialController';

export class ActionWheel {
  readonly el: HTMLDivElement;
  private ring: HTMLDivElement;
  private center: HTMLDivElement;
  private cat: ActionCategory = 'gestos';
  open = false;
  private esc = new EscSlot('roda', 50, () => this.close());
  /** chamado ao abrir/fechar (avisa o HUD) */
  onToggle?: (open: boolean) => void;
  /** rodada 9: itens além dos sociais — o item de confronto que o jogador POSSUI (pego no chão/apoio) */
  extraProps: () => number[] = () => [];

  constructor(private social: SocialController) {
    this.el = document.createElement('div');
    this.el.className = 'action-wheel';
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    this.ring = document.createElement('div');
    this.ring.className = 'aw-ring';
    this.center = document.createElement('div');
    this.center.className = 'aw-center';
    this.el.append(this.ring, this.center);
    window.addEventListener('keydown', (e) => {
      if (!this.open || isTypingTarget(e.target)) return;
      // Esc: pilha única (rodada 11). 1–4 trocam de categoria (prioridade sobre o acesso rápido: InputManager.quickBlocked)
      const n = Number(e.key);
      if (n >= 1 && n <= ACTION_CATEGORIES.length) { this.cat = ACTION_CATEGORIES[n - 1].key; this.render(); }
    });
  }

  toggle() { if (this.open) this.close(); else this.show(); }

  show() {
    this.open = true;
    this.esc.set(true);
    this.el.classList.add('open');
    this.render();
    this.onToggle?.(true);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.esc.set(false);
    this.el.classList.remove('open');
    this.onToggle?.(false);
  }

  private option(label: string, angle: number, radius: number, cls: string, onPick: () => void, active = false, disabled = false) {
    const b = document.createElement('button');
    b.className = `aw-opt ${cls}${active ? ' active' : ''}${disabled ? ' disabled' : ''}`;
    b.textContent = label;
    b.style.transform = `translate(-50%, -50%) translate(${Math.sin(angle) * radius}px, ${-Math.cos(angle) * radius}px)`;
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); onPick(); });
    this.ring.appendChild(b);
  }

  private render() {
    this.ring.textContent = '';
    const s = this.social;
    // anel interno: categorias
    ACTION_CATEGORIES.forEach((c, i) => {
      const a = (i / ACTION_CATEGORIES.length) * Math.PI * 2 + Math.PI / ACTION_CATEGORIES.length;
      this.option(c.label, a, 108, 'aw-cat', () => { this.cat = c.key; this.render(); }, c.key === this.cat);
    });
    // anel externo: opções
    const held = PROP_BY_ID.get(s.prop);
    // opções vêm de actionOptions.ts (a barra de ações usa as mesmas)
    const items = (this.cat === 'itens' ? itemOptions(s, this.extraProps()) : actionOptions(s, this.cat))
      .map((o) => ({ ...o, pick: () => { o.pick(); if (this.cat !== 'itens' && o.closes) this.close(); } }));
    const n = items.length;
    const r = n > 12 ? 222 : 196;
    items.forEach((it, i) => this.option(it.label, (i / n) * Math.PI * 2, r, 'aw-act', it.pick, it.active, it.disabled));
    // centro: item na mão + troca de design
    this.center.textContent = '';
    const title = document.createElement('div');
    title.className = 'aw-title';
    title.textContent = held ? held.label : 'AÇÕES';
    this.center.appendChild(title);
    if (held?.designSlot) {
      const row = document.createElement('div');
      row.className = 'aw-design';
      const prev = document.createElement('button'); prev.textContent = '◀';
      const next = document.createElement('button'); next.textContent = '▶';
      const name = document.createElement('span'); name.textContent = DESIGN_BY_ID.get(s.design)?.label ?? '';
      prev.addEventListener('pointerdown', (e) => { e.stopPropagation(); s.cycleDesign(-1); this.render(); });
      next.addEventListener('pointerdown', (e) => { e.stopPropagation(); s.cycleDesign(1); this.render(); });
      row.append(prev, name, next);
      this.center.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'aw-hint';
    hint.textContent = 'G/Esc fecha · 1–4 categorias';
    this.center.appendChild(hint);
  }
}
