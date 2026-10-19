/**
 * Rodada 11 — barra do ACESSO RÁPIDO no HUD (centro inferior, acima da barra de ações): botão INVENTÁRIO (I) + 5 slots
 * (teclas 1–5 ou clique; o cursor continua visível). Slot aceso = item NA MÃO agora (a mesma fonte do indicador MÃOS
 * e do avatar). Nada por quadro: `set` compara uma assinatura e só então escreve no DOM; um ouvinte (delegação).
 */
import type { QuickbarLayout } from './types';
import { BAG, LOCK, iconHtml } from './icons';
import type { InventoryEntry } from './catalog';

export interface QuickSlotView { key: string | null; item: InventoryEntry | null; active: boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class QuickbarView {
  readonly el: HTMLDivElement;
  private slots: HTMLDivElement;
  private badge: HTMLSpanElement;
  private sig = '';
  /** QA: escritas no DOM */
  writes = 0;

  constructor(touch: boolean, on: { open(): void; use(i: number): void }) {
    const el = (this.el = document.createElement('div'));
    el.className = 'inv-quick hud-fadeable';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Acesso rápido');
    const inv = document.createElement('button');
    inv.type = 'button'; inv.className = 'inv-open'; inv.dataset.open = '1';
    inv.title = touch ? 'Inventário' : 'Inventário (I)';
    inv.innerHTML = `${BAG}<span>Inventário</span>${touch ? '' : '<kbd>I</kbd>'}`;
    this.badge = document.createElement('span'); this.badge.className = 'inv-new-dot'; this.badge.hidden = true;
    inv.appendChild(this.badge);
    this.slots = document.createElement('div'); this.slots.className = 'inv-qslots';
    el.append(inv, this.slots);
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-open]')) { on.open(); return; }
      const b = t.closest<HTMLElement>('[data-q]');
      if (b) on.use(Number(b.dataset.q));
    });
    for (const ev of ['pointerdown', 'mousedown', 'touchstart'] as const) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  }

  set(slots: QuickSlotView[], hasNew: boolean) {
    const sig = `${hasNew}|${slots.map((s) => `${s.key}:${s.item?.state ?? ''}:${s.active ? 1 : 0}`).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.writes++;
    this.badge.hidden = !hasNew;
    this.slots.innerHTML = slots.map((s, i) => {
      const it = s.item;
      const locked = it?.state === 'locked';
      const tip = it ? `${i + 1} — ${it.label} · ${it.kind} · ${s.active ? 'Na mão (aperte de novo para guardar)' : locked ? `Bloqueado (${it.lockedReason ?? 'progressão'})` : 'Clique ou tecla para pegar'}` : `${i + 1} — vazio (fixe um item no inventário)`;
      return `<button type="button" class="inv-q${s.active ? ' on' : ''}${locked ? ' locked' : ''}${it ? '' : ' empty'}" data-q="${i}" title="${esc(tip)}" aria-pressed="${s.active}">`
        + `<kbd>${i + 1}</kbd>${it ? `<span class="inv-q-ico">${iconHtml(it)}</span>` : ''}${locked ? `<span class="inv-q-lock">${LOCK}</span>` : ''}</button>`;
    }).join('');
  }

  /** QA */
  info() { return { writes: this.writes, slots: [...this.slots.children].map((b) => ({ on: b.classList.contains('on'), title: (b as HTMLElement).title })) }; }
}

export type { QuickbarLayout };
