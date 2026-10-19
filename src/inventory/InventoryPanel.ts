/**
 * Rodada 11 — PAINEL do inventário (DOM; desktop primeiro, mouse). docs/INVENTORY.md
 *
 *   ┌ INVENTÁRIO ───────────────────────────────── equipado: … ─ × ┐
 *   │ Roupas      │ [Todos][Equipados][Desbloqueados][Novos]   │ prévia 3D     │
 *   │ Acessórios  │ ▢ ▢ ▢ ▢ ▢ ▢                                 │ (girar/zoom,  │
 *   │ Itens …     │ ▢ ▢ ▢ ▢ (clique = escolher, duplo = equipar)│ frente/costas)│
 *   │             │                                            │ nome · tipo   │
 *   │             │                                            │ EQUIPAR …     │
 *   └─────────────┴────────────────────────────────────────────┴───────────────┘
 *
 * Custo: tudo criado UMA vez no construtor; ouvintes por DELEGAÇÃO (um por área, nunca por item); a grade é refeita
 * só quando muda categoria/filtro/estado (assinatura). Não pausa o mundo. A prévia 3D (um renderer) só existe com o
 * painel aberto numa categoria que a usa, e é descartada ao fechar (previewAdapter.ts).
 */
import type { InventoryCategory, InventoryFilter, QuickbarLayout } from './types';
import { CATEGORY_LABEL, FILTER_LABEL, categoriesWithContent, equippedBySlot, filterItems, type InventoryEntry } from './catalog';
import { LOCK, iconHtml } from './icons';

const FILTERS: InventoryFilter[] = ['TODOS', 'EQUIPADOS', 'DESBLOQUEADOS', 'NOVOS'];
const STATE_LABEL = { equipped: 'Equipado', available: 'Disponível', locked: 'Bloqueado' } as const;
const SLOT_LABEL: Record<string, string> = { HEAD: 'Cabelo', TORSO: 'Parte de cima', LEGS: 'Parte de baixo', FEET: 'Calçado', HAND: 'Mão', ACCESSORY: 'Acessório', TITLE: 'Título', SUPPORTER: 'Torcida', BACK: 'Costas' };

export interface InventoryPanelActions {
  select(key: string): void;
  equip(key: string): void;
  unequip(key: string): void;
  pin(key: string, index: number): void;
  close(): void;
  /** prévia: lado e zoom */
  view(side: 'front' | 'back'): void;
  zoom(by: number): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); if (cls) e.className = cls; parent?.appendChild(e); return e;
};

export class InventoryPanel {
  readonly el: HTMLDivElement;
  /** onde a prévia 3D se monta (o controlador cria/descarta o renderer) */
  readonly previewHost: HTMLDivElement;
  category: InventoryCategory | null = null;
  filter: InventoryFilter = 'TODOS';
  selected: string | null = null;
  pending: string | null = null;
  private cats: HTMLElement;
  private filters: HTMLElement;
  private grid: HTMLDivElement;
  private empty: HTMLDivElement;
  private summary: HTMLDivElement;
  private side: HTMLElement;
  private card: HTMLDivElement;
  private detail: HTMLDivElement;
  private actions: HTMLDivElement;
  private previewWrap: HTMLDivElement;
  private items: InventoryEntry[] = [];
  private layout: QuickbarLayout = [null, null, null, null, null];
  private sig = '';
  /** QA: quantas vezes a grade foi refeita */
  renders = 0;

  constructor(a: InventoryPanelActions) {
    const root = (this.el = h('div', 'inv-root'));
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Inventário');
    const panel = h('div', 'inv-panel', root);
    const head = h('header', 'inv-head', panel);
    const t = h('h2', 'inv-title', head); t.textContent = 'INVENTÁRIO';
    this.summary = h('div', 'inv-summary', head);
    const x = h('button', 'inv-close', head); x.type = 'button'; x.textContent = '×'; x.title = 'Fechar (I ou Esc)'; x.setAttribute('aria-label', 'Fechar inventário');
    x.addEventListener('click', () => a.close());
    const body = h('div', 'inv-body', panel);
    this.cats = h('nav', 'inv-cats', body); this.cats.setAttribute('role', 'tablist'); this.cats.setAttribute('aria-label', 'Categorias');
    const list = h('section', 'inv-list', body);
    this.filters = h('div', 'inv-filters', list);
    this.filters.setAttribute('role', 'group'); this.filters.setAttribute('aria-label', 'Filtro');
    for (const f of FILTERS) { const b = h('button', 'inv-chip', this.filters); b.type = 'button'; b.dataset.f = f; b.textContent = FILTER_LABEL[f]; }
    this.grid = h('div', 'inv-grid', list); this.grid.setAttribute('role', 'listbox'); this.grid.setAttribute('aria-label', 'Itens');
    this.empty = h('div', 'inv-empty', list); this.empty.hidden = true;
    this.side = h('aside', 'inv-side', body);
    this.previewWrap = h('div', 'inv-preview', this.side);
    this.previewHost = h('div', 'inv-preview-host', this.previewWrap);
    const pc = h('div', 'inv-pv-ctl', this.previewWrap);
    for (const [k, label, tip] of [['front', 'Frente', 'Ver de frente'], ['back', 'Costas', 'Ver de costas'], ['zin', '+', 'Aproximar'], ['zout', '−', 'Afastar']] as const) {
      const b = h('button', 'inv-pv-btn', pc); b.type = 'button'; b.dataset.pv = k; b.textContent = label; b.title = tip;
    }
    this.card = h('div', 'inv-card', this.side);
    this.detail = h('div', 'inv-detail', this.side);
    this.actions = h('div', 'inv-actions', this.side);

    // ---- delegação: um ouvinte por área
    this.cats.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]'); if (b) this.setCategory(b.dataset.cat as InventoryCategory); });
    this.filters.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-f]'); if (b) { this.filter = b.dataset.f as InventoryFilter; this.render(true); } });
    this.grid.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-key]'); if (b) a.select(b.dataset.key!); });
    this.grid.addEventListener('dblclick', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      const it = b ? this.items.find((i) => i.key === b.dataset.key) : undefined;
      if (it) { if (it.state === 'equipped' && it.removable) a.unequip(it.key); else a.equip(it.key); }
    });
    this.actions.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (!b || b.disabled || !this.selected) return;
      if (b.dataset.act === 'equip') a.equip(this.selected);
      else if (b.dataset.act === 'unequip') a.unequip(this.selected);
      else if (b.dataset.act === 'pin') a.pin(this.selected, Number(b.dataset.i));
    });
    pc.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-pv]')?.dataset.pv;
      if (k === 'front' || k === 'back') a.view(k); else if (k === 'zin') a.zoom(0.25); else if (k === 'zout') a.zoom(-0.25);
    });
    // o clique/roda no painel não atravessa para o mundo (câmera/interação)
    for (const ev of ['pointerdown', 'mousedown', 'wheel', 'touchstart'] as const) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get open() { return !this.el.hidden; }
  show() { this.el.hidden = false; }
  hide() { this.el.hidden = true; }

  setCategory(c: InventoryCategory) {
    if (c === this.category) return;
    this.category = c;
    this.selected = null;
    this.render(true);
    this.onCategory?.(c);
  }
  /** o controlador liga/desliga a prévia 3D ao trocar de categoria */
  onCategory?: (c: InventoryCategory) => void;

  /** dados novos (abrir, mudança confirmada pelo servidor, acesso rápido) — só refaz o DOM se algo mudou */
  update(items: InventoryEntry[], layout: QuickbarLayout, force = false) {
    this.items = items;
    this.layout = layout;
    const cats = categoriesWithContent(items);
    if (!this.category || !cats.includes(this.category)) { this.category = cats[0] ?? null; this.selected = null; }
    this.render(force);
  }

  /** categoria atual usa a prévia 3D? (roupa/acessório, ou o item escolhido) */
  wants3d(): boolean {
    const sel = this.items.find((i) => i.key === this.selected);
    if (sel) return sel.preview3d;
    return this.category === 'ROUPAS' || this.category === 'ACESSORIOS';
  }

  selectedItem(): InventoryEntry | undefined { return this.items.find((i) => i.key === this.selected); }

  render(force = false) {
    const cat = this.category;
    const view = filterItems(this.items, this.filter, cat);
    const sig = `${cat}|${this.filter}|${this.pending}|${this.layout.join(',')}|${this.items.map((i) => `${i.key}${i.state[0]}${i.isNew ? 'n' : ''}`).join(';')}`;
    if (!force && sig === this.sig) { this.applySelection(); return; }
    this.sig = sig;
    this.renders++;
    // ---- categorias (só as com conteúdo), com contagem e ponto de NOVO
    const cats = categoriesWithContent(this.items);
    this.cats.innerHTML = cats.map((c) => {
      const all = this.items.filter((i) => i.category === c);
      const nw = all.some((i) => i.isNew);
      return `<button type="button" role="tab" class="inv-cat${c === cat ? ' on' : ''}" data-cat="${c}" aria-selected="${c === cat}">${CATEGORY_LABEL[c]}<span class="inv-count">${all.filter((i) => i.state !== 'locked').length}/${all.length}</span>${nw ? '<i class="inv-dot" title="Novidades"></i>' : ''}</button>`;
    }).join('');
    for (const b of this.filters.querySelectorAll<HTMLElement>('[data-f]')) b.classList.toggle('on', b.dataset.f === this.filter);
    // ---- grade
    this.grid.innerHTML = view.map((i) => {
      const tip = `${i.label} · ${i.kind} · ${STATE_LABEL[i.state]}${i.lockedReason ? ` (${i.lockedReason})` : ''} · ${i.state === 'locked' ? 'Bloqueado pela progressão' : i.state === 'equipped' ? (i.removable ? 'Duplo clique para desequipar' : 'Em uso') : 'Duplo clique para equipar'}`;
      const q = this.layout.indexOf(i.key as QuickbarLayout[number]);
      return `<button type="button" role="option" class="inv-tile s-${i.state}${i.key === this.pending ? ' pend' : ''}" data-key="${esc(i.key)}" title="${esc(tip)}" aria-selected="false">`
        + `<span class="inv-ico">${iconHtml(i)}</span><span class="inv-name">${esc(i.label)}</span>`
        + (i.state === 'equipped' ? '<span class="inv-badge eq" aria-label="equipado">✓</span>' : '')
        + (i.state === 'locked' ? `<span class="inv-badge lock" aria-label="bloqueado">${LOCK}</span>` : '')
        + (i.isNew ? '<span class="inv-badge new">NOVO</span>' : '')
        + (q >= 0 ? `<span class="inv-badge qk" title="Acesso rápido ${q + 1}">${q + 1}</span>` : '')
        + '</button>';
    }).join('');
    this.empty.hidden = view.length > 0;
    this.empty.textContent = this.filter === 'NOVOS' ? 'Nada novo por aqui.' : this.filter === 'EQUIPADOS' ? 'Nada desta categoria equipado agora.' : 'Nada nesta categoria ainda.';
    // ---- resumo do que está equipado (um por slot)
    const eq = equippedBySlot(this.items);
    this.summary.innerHTML = (['HAND', 'TORSO', 'ACCESSORY', 'TITLE', 'SUPPORTER'] as const).map((s) => `<span class="inv-sum" title="${SLOT_LABEL[s]}"><b>${SLOT_LABEL[s]}</b> ${esc(eq[s]?.label ?? (s === 'HAND' ? 'vazia' : '—'))}</span>`).join('');
    this.applySelection();
  }

  /** escolher um item NÃO refaz a grade (duplo clique continua no mesmo botão) — só a marca e o painel lateral */
  setSelected(key: string | null) { this.selected = key; this.applySelection(); }

  private applySelection() {
    for (const b of this.grid.children as HTMLCollectionOf<HTMLElement>) {
      const on = b.dataset.key === this.selected;
      if (b.classList.contains('sel') !== on) { b.classList.toggle('sel', on); b.setAttribute('aria-selected', String(on)); }
    }
    this.renderSide();
  }

  private sideSig = '';
  private renderSide() {
    const it = this.selectedItem();
    const want3d = this.wants3d();
    // só reescreve quando muda (o botão sob o cursor não é trocado no meio de um clique)
    const sig = `${this.category}|${it ? `${it.key}${it.state}` : ''}|${this.pending}|${this.layout.join(',')}|${want3d}`;
    if (sig === this.sideSig) return;
    this.sideSig = sig;
    this.previewWrap.hidden = !want3d;
    this.card.hidden = want3d || !it;
    if (it && !want3d) this.card.innerHTML = `<span class="inv-card-ico">${iconHtml(it)}</span>`;
    if (!it) {
      this.detail.innerHTML = `<div class="inv-d-name">${this.category ? CATEGORY_LABEL[this.category] : 'Inventário'}</div><div class="inv-d-hint">Escolha um item. Duplo clique equipa.</div>`;
      this.actions.innerHTML = '';
      return;
    }
    const st = it.state === 'locked' ? `Bloqueado — ${esc(it.lockedReason ?? 'progressão')}` : STATE_LABEL[it.state];
    this.detail.innerHTML = `<div class="inv-d-name">${esc(it.label)}</div><div class="inv-d-kind">${esc(it.kind)} · ${SLOT_LABEL[it.slot] ?? it.slot}</div><div class="inv-d-state s-${it.state}">${st}</div>`;
    const busy = this.pending === it.key;
    let html = '';
    if (it.state === 'locked') html += `<button type="button" class="inv-btn" data-act="equip" disabled>BLOQUEADO</button>`;
    else if (it.state === 'equipped') html += it.removable ? `<button type="button" class="inv-btn" data-act="unequip"${busy ? ' disabled' : ''}>DESEQUIPAR</button>` : '<button type="button" class="inv-btn" disabled>EM USO</button>';
    else html += `<button type="button" class="inv-btn primary" data-act="equip"${busy ? ' disabled' : ''}>${busy ? 'AGUARDANDO…' : 'EQUIPAR'}</button>`;
    if (it.quickbar) {
      html += '<div class="inv-pin" role="group" aria-label="Fixar no acesso rápido"><span>Acesso rápido</span>';
      for (let i = 0; i < 5; i++) html += `<button type="button" class="inv-pin-b${this.layout[i] === it.key ? ' on' : ''}" data-act="pin" data-i="${i}" title="Fixar na tecla ${i + 1}">${i + 1}</button>`;
      html += '</div>';
    }
    this.actions.innerHTML = html;
  }

  /** QA */
  info() {
    return { open: this.open, category: this.category, filter: this.filter, selected: this.selected, pending: this.pending, renders: this.renders, tiles: this.grid.childElementCount, cats: [...this.cats.querySelectorAll<HTMLElement>('[data-cat]')].map((b) => b.dataset.cat) };
  }
}
