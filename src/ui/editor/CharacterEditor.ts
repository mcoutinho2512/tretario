/**
 * Rodada 11 — EDITOR DE PERSONAGEM "de jogo" (docs/CHARACTERS.md): painel lateral com abas (CORPO, CABELO, CAMISA,
 * CALÇA/SHORT, CALÇADO, ACESSÓRIOS, TORCIDA) e o avatar grande ao lado (prévia 3D reutilizável,
 * src/ui/preview/sharedPreview.ts). Desfazer/refazer/restaurar, salvar e cancelar; itens bloqueados com cadeado e o
 * motivo da progressão (clicar mostra o item só na PRÉVIA — "experimentar" — sem entrar no visual salvo).
 * Mesma tela na home (antes de entrar) e como overlay no jogo (o jogo segue por baixo); Esc pela pilha única
 * (src/ui/escStack.ts). O HTML estático fica em index.html (#start); a lógica pura em ./editorState.ts.
 * A aba TORCIDA reaproveita os cartões da tela TORCIDA (supporterCard) e o "vestir as cores" (supporterOutfit).
 */
import {
  ACCESSORIES, BOTTOMS, HAIR_OLD, HAIR_YOUNG, SHOES, SKIN_TONES, TOPS, randomAppearance,
  type Accessory, type BodyType, type CharacterAppearance,
} from '../../characters/bodyTypes';
import { STYLE_LABELS, resolveStyle, stylesFor, SLOT_FIELD, type GarmentSlot } from '../../characters/garments';
import { sameAppearance } from '../../characters/validateAppearance';
import type { ItemEntitlements, ItemKey } from '../../characters/unlocks';
import { DESIGNS, DESIGN_BY_ID } from '../../social/designs';
import { loadSupporterData, supporterGroup, supporterOutfit } from '../../supporters/data';
import type { SupporterData } from '../../supporters/types';
import { supporterCard } from '../supporterPicker';
import { pushEsc } from '../escStack';
import type { SharedPreviewHandle, PreviewPose } from '../preview/sharedPreview';
import {
  EDITOR_TABS, EditorHistory, changedTabs, itemKey, lockInfo, pickAccessory, pickBody, pickColor, pickDesign, pickStyle, wearOutfit,
  type ColorKey, type EditorSnapshot, type EditorTabId,
} from './editorState';
import './editor.css';

export const ACC_COLORS = [0x1f1f1f, 0x2b4a7a, 0x8a2a2a, 0xd8d0c0, 0x3d6b3d, 0x6b4a2a, 0xe0b030];
export const ACC_LABEL: Record<Accessory, string> = { nenhum: 'Nenhum', bone: 'Boné', chapeu: 'Chapéu', oculos: 'Óculos', mochila: 'Sacola', bolsa: 'Bolsa' };
const PALETTES: Record<ColorKey, readonly number[]> = { skin: SKIN_TONES, hair: [...HAIR_YOUNG, ...HAIR_OLD], top: TOPS, bottom: BOTTOMS, shoes: SHOES, acc: ACC_COLORS };
const COLOR_NAME: Record<ColorKey, string> = { skin: 'tom de pele', hair: 'cor do cabelo', top: 'cor da camisa', bottom: 'cor da calça', shoes: 'cor do calçado', acc: 'cor do acessório' };
/** camisas de futebol: só cores/padrões (designs.ts, alvo 'shirt') */
const SHIRT_DESIGNS = DESIGNS.filter((d) => d.targets.includes('shirt'));
const BODIES: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export type SaveResult = { ok: true; accepted: EditorSnapshot; msg?: string } | { ok: false; error: string; status?: number };

export interface EditorDeps {
  /** validador ÚNICO com os direitos da conta (o que se vê é o que o servidor aceita) */
  validate(raw: unknown): CharacterAppearance | null;
  /** direitos atuais (cadeados) e requisito de progressão de um item */
  entitlements(): ItemEntitlements;
  requirement(item: string): string | null;
  /** atualiza os cadeados (GET /api/me/progress); o editor redesenha quando terminar */
  refreshUnlocks(): Promise<void>;
  /** grava aparência e torcida (servidor com conta; aparelho sem conta) */
  save(s: EditorSnapshot, prev: EditorSnapshot): Promise<SaveResult>;
  /** a cada mudança (visual de visitante guardado no aparelho) */
  onChange?(s: EditorSnapshot): void;
}

export interface EditorOpenOptions {
  first?: boolean;
  overlay?: boolean;
  account: boolean;
  nick: string;
  initial: EditorSnapshot;
  saved: EditorSnapshot;
  /** aba inicial (padrão: a última usada) */
  tab?: EditorTabId;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class CharacterEditor {
  readonly root = $('start');
  private hist: EditorHistory;
  private preview: SharedPreviewHandle | null = null;
  private previewP: Promise<void> | null = null;
  private mod: typeof import('../preview/sharedPreview') | null = null;
  private tab: EditorTabId = 'CORPO';
  private opts: EditorOpenOptions | null = null;
  private done: ((saved: boolean) => void) | null = null;
  private popEsc: (() => void) | null = null;
  private sup: SupporterData | null = null;
  private saving = false;
  private noteEl = $('editor-note');
  private saveBtn = $<HTMLButtonElement>('explore');
  private trying = false;

  constructor(private deps: EditorDeps) {
    this.hist = new EditorHistory({ app: deps.validate({ body: 'homem' })!, sup: null });
    this.buildStatic();
    this.root.addEventListener('keydown', (e) => this.onKey(e));
  }

  get snapshot(): EditorSnapshot { return this.hist.current; }
  get isOpen() { return !!this.opts; }
  get handle() { return this.preview; }
  get history() { return this.hist; }

  // ------------------------------------------------------------------ abrir / fechar
  open(o: EditorOpenOptions): Promise<boolean> {
    if (this.opts) this.finish(false);
    this.opts = o;
    const initial = { app: this.deps.validate(o.initial.app) ?? o.initial.app, sup: o.initial.sup };
    this.hist.reset(initial, o.saved);
    $('name-field').classList.toggle('hidden', o.account);
    const an = $('account-nick');
    an.classList.toggle('hidden', !o.account);
    an.innerHTML = o.account ? 'Seu apelido na avenida: <b></b>' : '';
    if (o.account) an.querySelector('b')!.textContent = o.nick;
    $('editor-title').textContent = o.first ? 'CRIE SEU PERSONAGEM' : 'PERSONAGEM';
    $('editor-eyebrow').textContent = o.first ? 'PASSO 2 DE 3 · DEPOIS: GRUPO E AVENIDA' : 'PERSONAGEM · CUSTOMIZAR';
    this.saveBtn.querySelector('span')!.textContent = o.account ? (o.first ? 'Salvar e continuar' : 'Salvar') : 'Salvar neste aparelho';
    $('ed-cancel').textContent = o.first ? 'Voltar' : 'Cancelar';
    this.saveBtn.disabled = false;
    this.root.classList.toggle('overlay', !!o.overlay);
    this.root.classList.remove('hidden');
    this.root.scrollTop = 0;
    if (o.overlay) document.exitPointerLock?.(); // cursor visível no editor (o jogo segue por baixo)
    this.popEsc = pushEsc({ id: 'editor', priority: 200, close: () => this.cancel() });
    this.setTab(o.tab ?? this.tab, false);
    this.render();
    this.setNote('');
    void this.deps.refreshUnlocks().then(() => { if (this.opts) this.render(); });
    void loadSupporterData().then((d) => { this.sup = d; if (this.opts) this.renderSupporters(); });
    this.mountPreview();
    requestAnimationFrame(() => this.root.querySelector<HTMLElement>(`.ed-tab[data-tab="${this.tab}"]`)?.focus({ preventScroll: true }));
    return new Promise((res) => { this.done = res; });
  }

  private mountPreview() {
    if (this.preview) { this.preview.show(this.hist.current.app); return; }
    const loading = $('preview-loading');
    loading.textContent = 'Montando personagem…';
    loading.classList.remove('hidden');
    this.previewP ??= import('../preview/sharedPreview').then((mod) => {
      this.mod = mod;
      this.previewP = null;
      if (!this.opts || this.preview) return;
      const h = (this.preview = mod.createSharedPreview($('avatar-stage')));
      h.show(this.hist.current.app);
      void h.ready.then(() => { if (this.preview === h) loading.classList.add('hidden'); });
      (window as unknown as { __pvStart?: unknown }).__pvStart = { preview: h, look: () => this.hist.current.app, editor: this };
    }).catch((e) => { this.previewP = null; console.warn('[prévia] indisponível', e); loading.textContent = 'Prévia 3D indisponível neste navegador'; });
  }

  /** ao entrar no jogo: fecha a prévia e libera o renderer compartilhado na hora (sem esperar o ócio) */
  releasePreview() {
    this.preview?.dispose();
    this.preview = null;
    this.mod?.disposeSharedPreview();
  }

  /** cancelar: descarta o que não foi salvo */
  cancel() { this.finish(false); }

  private finish(saved: boolean) {
    if (!this.opts) return;
    this.popEsc?.();
    this.popEsc = null;
    // a prévia sai (o renderer compartilhado fica ocioso e é descartado depois — sharedPreview.ts)
    this.preview?.dispose();
    this.preview = null;
    this.root.classList.add('hidden');
    this.root.classList.remove('overlay');
    this.opts = null;
    this.trying = false;
    const d = this.done;
    this.done = null;
    d?.(saved);
  }

  async save() {
    if (!this.opts || this.saving) return;
    const cur = this.hist.current;
    const s: EditorSnapshot = { app: this.deps.validate(cur.app) ?? cur.app, sup: cur.sup };
    this.saving = true;
    this.saveBtn.disabled = true;
    this.setNote('Salvando…');
    const r = await this.deps.save(s, this.hist.savedState).catch((e): SaveResult => ({ ok: false, error: String(e?.message ?? e) }));
    this.saving = false;
    this.saveBtn.disabled = false;
    if (!this.opts) return;
    if (!r.ok) { this.setNote(r.error, 'bad'); return; }
    this.hist.markSaved(r.accepted);
    this.setNote(r.msg ?? 'Personagem salvo.', 'ok');
    this.finish(true);
  }

  // ------------------------------------------------------------------ edição
  private apply(next: Partial<EditorSnapshot>) {
    const cur = this.hist.current;
    const app = next.app ? this.deps.validate(next.app) ?? cur.app : cur.app;
    const changed = this.hist.push({ app, sup: next.sup === undefined ? cur.sup : next.sup });
    this.trying = false;
    if (changed) this.deps.onChange?.(this.hist.current);
    this.render();
    this.setNote(this.hist.dirty && this.opts?.account ? 'Alterações não salvas.' : '');
  }

  /** item bloqueado: só na prévia ("experimentar"), com o motivo; o visual salvo não muda */
  private tryOn(app: CharacterAppearance, key: ItemKey) {
    const li = lockInfo(key, this.deps.entitlements(), this.deps.requirement);
    this.trying = true;
    this.preview?.show(app);
    this.setNote(`Bloqueado — ${li.reason}. Você vê na prévia, mas só pode salvar depois de liberar (☰ → Progresso, na avenida).`, 'bad');
  }

  private pick(app: CharacterAppearance, key: ItemKey | null) {
    if (key && lockInfo(key, this.deps.entitlements(), this.deps.requirement).locked) { this.tryOn(app, key); return; }
    this.apply({ app });
  }

  undo() { if (this.hist.undo()) this.afterHistory('Desfeito.'); }
  redo() { if (this.hist.redo()) this.afterHistory('Refeito.'); }
  restore() { if (this.hist.restore()) this.afterHistory('Visual salvo restaurado (dá para desfazer).'); }
  private afterHistory(msg: string) {
    this.trying = false;
    this.deps.onChange?.(this.hist.current);
    this.render();
    this.setNote(msg);
  }

  randomize() {
    // SURPREENDA-ME: corpo, peças e cores pelas regras da multidão, validado e sem repetir (chapéu/boné sobre crespo
    // volumoso atravessa a malha: o sorteio evita)
    const clash = (a: CharacterAppearance) => (a.accessory === 'bone' || a.accessory === 'chapeu') && a.hairStyle === 'afro';
    const cur = this.hist.current.app;
    let r = cur;
    for (let i = 0; i < 20 && (sameAppearance(r, cur) || clash(r)); i++) {
      const body = BODIES[Math.floor(Math.random() * BODIES.length)];
      const a = randomAppearance((Math.random() * 2 ** 32) >>> 0, body, { football: 0.2 });
      r = this.deps.validate({ ...a, accessory: a.accessory ?? 'nenhum', acc: a.acc ?? ACC_COLORS[0] }) ?? r;
    }
    this.apply({ app: r });
  }

  setTab(t: EditorTabId, focus = true) {
    this.tab = t;
    for (const b of this.root.querySelectorAll<HTMLElement>('.ed-tab')) {
      const on = b.dataset.tab === t;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus({ preventScroll: true });
    }
    for (const p of this.root.querySelectorAll<HTMLElement>('.ed-panel')) p.hidden = p.dataset.tab !== t;
    this.root.querySelector('.builder-scroll')?.scrollTo?.({ top: 0 });
    // câmera acompanha a categoria (cabelo/acessório: perto; calçado: corpo inteiro)
    if (this.preview) this.preview.zoom(0, t === 'CABELO' ? 0.75 : t === 'ACESSORIOS' && this.hist.current.app.accessory !== 'mochila' && this.hist.current.app.accessory !== 'bolsa' ? 0.45 : 0);
  }

  // ------------------------------------------------------------------ interface
  private buildStatic() {
    // abas
    const tabs = $('ed-tabs');
    tabs.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.ed-tab'); if (b) this.setTab(b.dataset.tab as EditorTabId); });
    tabs.addEventListener('keydown', (e) => {
      const ids = EDITOR_TABS.map((t) => t.id);
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      this.setTab(ids[(ids.indexOf(this.tab) + d + ids.length) % ids.length]);
    });
    // cores
    for (const el of this.root.querySelectorAll<HTMLElement>('.swatches[data-key]')) {
      const key = el.dataset.key as ColorKey;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', COLOR_NAME[key]);
      for (const c of PALETTES[key]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = hex(c);
        b.dataset.color = String(c);
        b.setAttribute('aria-label', `${COLOR_NAME[key]} ${hex(c)}`);
        b.addEventListener('click', () => this.pick(pickColor(this.hist.current.app, key, c), null));
        el.appendChild(b);
      }
    }
    // acessórios
    const chips = $('acc-chips');
    for (const a of ACCESSORIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.acc = a;
      b.textContent = ACC_LABEL[a];
      b.addEventListener('click', () => this.pick(pickAccessory(this.hist.current.app, a), itemKey({ kind: 'accessory', acc: a })));
      chips.appendChild(b);
    }
    // camisas de futebol (designs)
    const des = $('shirt-designs');
    for (const d of [null, ...SHIRT_DESIGNS]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.design = String(d?.id ?? 0);
      const dot = document.createElement('i');
      dot.className = 'dot';
      const p = d?.palette;
      dot.style.background = p ? `linear-gradient(90deg, ${p.bg} 0 50%, ${p.accent ?? p.fg} 50% 100%)` : 'transparent';
      b.append(dot, d ? d.label : 'Nenhuma');
      b.addEventListener('click', () => this.pick(pickDesign(this.hist.current.app, d), d ? itemKey({ kind: 'design', id: d.id }) : null));
      des.appendChild(b);
    }
    // corpo
    for (const r of this.root.querySelectorAll<HTMLInputElement>('input[name=av]')) {
      r.addEventListener('change', () => { if (r.checked) this.pick(pickBody(this.hist.current.app, r.value as BodyType), null); });
    }
    // torcida
    $('ed-sup').addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('.sup-card');
      if (!c || !this.sup) return;
      const id = c.dataset.key!;
      this.apply({ sup: id === this.sup.neutralId ? null : id });
      this.renderSupporters();
    });
    $('ed-wear').addEventListener('click', () => {
      const g = supporterGroup(this.sup, this.hist.current.sup);
      if (g) { this.apply({ app: wearOutfit(this.hist.current.app, supporterOutfit(g)) }); this.setNote(`Cores de ${g.displayName} vestidas (dá para desfazer).`); }
    });
    // rodapé
    $('ed-undo').addEventListener('click', () => this.undo());
    $('ed-redo').addEventListener('click', () => this.redo());
    $('ed-restore').addEventListener('click', () => this.restore());
    $('ed-cancel').addEventListener('click', () => this.cancel());
    $('randomize').addEventListener('click', () => this.randomize());
    this.saveBtn.addEventListener('click', () => void this.save());
    // prévia: poses, giro, zoom, frente/costas
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.pose-btn[data-pose]')) {
      b.addEventListener('click', () => {
        this.preview?.setPose(b.dataset.pose as PreviewPose);
        for (const o of this.root.querySelectorAll('.pose-btn[data-pose]')) o.setAttribute('aria-pressed', String(o === b));
      });
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.pose-btn[data-rot]')) b.addEventListener('click', () => this.preview?.rotate(Number(b.dataset.rot) * Math.PI / 4));
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.pose-btn[data-zoom]')) b.addEventListener('click', () => this.preview?.zoom(Number(b.dataset.zoom) * 0.5));
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.pose-btn[data-view]')) {
      b.addEventListener('click', () => {
        this.preview?.view(b.dataset.view as 'front' | 'back');
        for (const o of this.root.querySelectorAll('.pose-btn[data-view]')) o.setAttribute('aria-pressed', String(o === b));
      });
    }
  }

  private onKey(e: KeyboardEvent) {
    if (!this.opts) return;
    const typing = (e.target as HTMLElement).matches?.('input[type=text], input:not([type]), textarea');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
    else if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
  }

  /** marca um botão de item (pressionado, cadeado e motivo) */
  private mark(b: HTMLElement, pressed: boolean, key: ItemKey | null) {
    b.setAttribute('aria-pressed', String(pressed));
    const li = key ? lockInfo(key, this.deps.entitlements(), this.deps.requirement) : { locked: false, reason: '' };
    b.classList.toggle('locked', li.locked);
    if (li.locked) { b.dataset.req = li.reason; b.title = `Bloqueado — ${li.reason} (clique para ver na prévia)`; }
    else { delete b.dataset.req; b.removeAttribute('title'); }
  }

  render() {
    const { app } = this.hist.current;
    for (const el of this.root.querySelectorAll<HTMLElement>('.swatches[data-key]')) {
      const key = el.dataset.key as ColorKey;
      for (const b of el.children as HTMLCollectionOf<HTMLElement>) b.setAttribute('aria-pressed', String(Number(b.dataset.color) === app[key]));
    }
    for (const b of $('acc-chips').children as HTMLCollectionOf<HTMLElement>) this.mark(b, b.dataset.acc === (app.accessory ?? 'nenhum'), itemKey({ kind: 'accessory', acc: b.dataset.acc as Accessory }));
    // modelo de cada peça (depende do corpo: só o que ele veste)
    for (const el of this.root.querySelectorAll<HTMLElement>('.style-chips[data-slot]')) {
      const slot = el.dataset.slot as GarmentSlot, field = SLOT_FIELD[slot];
      if (el.dataset.body !== app.body) {
        el.dataset.body = app.body;
        el.replaceChildren(...stylesFor(app.body, slot).map((st) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip';
          b.dataset.style = st;
          b.textContent = STYLE_LABELS[st as keyof typeof STYLE_LABELS] ?? st;
          b.addEventListener('click', () => this.pick(pickStyle(this.hist.current.app, slot, st), itemKey({ kind: 'style', slot, style: st })));
          return b;
        }));
      }
      const cur = resolveStyle(app.body, slot, app[field]);
      for (const b of el.children as HTMLCollectionOf<HTMLElement>) this.mark(b, b.dataset.style === cur, itemKey({ kind: 'style', slot, style: b.dataset.style! }));
    }
    const dsel = DESIGN_BY_ID.has(app.shirtDesign ?? 0) ? app.shirtDesign : 0;
    for (const b of $('shirt-designs').children as HTMLCollectionOf<HTMLElement>) {
      const id = Number(b.dataset.design);
      this.mark(b, id === dsel, id ? itemKey({ kind: 'design', id }) : null);
    }
    $('acc-color-wrap').classList.toggle('hidden', (app.accessory ?? 'nenhum') === 'nenhum');
    for (const r of this.root.querySelectorAll<HTMLInputElement>('input[name=av]')) r.checked = r.value === app.body;
    // abas alteradas (em relação ao salvo) e histórico
    const ch = changedTabs(this.hist.current, this.hist.savedState);
    for (const b of this.root.querySelectorAll<HTMLElement>('.ed-tab')) b.classList.toggle('changed', ch.has(b.dataset.tab as EditorTabId));
    $<HTMLButtonElement>('ed-undo').disabled = !this.hist.canUndo;
    $<HTMLButtonElement>('ed-redo').disabled = !this.hist.canRedo;
    $<HTMLButtonElement>('ed-restore').disabled = !this.hist.canRestore;
    this.renderSupporters();
    if (!this.trying) this.preview?.show(app);
  }

  private renderSupporters() {
    const list = $('ed-sup');
    const data = this.sup;
    $('ed-tab-sup').hidden = !data?.groups.length;
    if (!data) return;
    if (list.dataset.v !== String(data.version) || !list.childElementCount) {
      list.dataset.v = String(data.version);
      list.innerHTML = [...data.groups.map((g) => supporterCard(g, data.neutralId)), supporterCard(null, data.neutralId)].join('');
    }
    const sel = this.hist.current.sup ?? data.neutralId;
    for (const c of list.querySelectorAll<HTMLElement>('.sup-card')) c.setAttribute('aria-checked', String(c.dataset.key === sel));
    const g = supporterGroup(data, this.hist.current.sup);
    const wear = $<HTMLButtonElement>('ed-wear');
    wear.disabled = !g;
    wear.textContent = g ? `Vestir as cores de ${g.shortName}` : 'Vestir as cores';
    const wearing = !!g && this.hist.current.app.shirtDesign === g.clothingSet.shirtDesign;
    wear.setAttribute('aria-pressed', String(wearing));
    $('ed-sup-note').textContent = !g ? 'Sem torcida: nada muda no seu visual.'
      : wearing ? 'Você está com a camisa da torcida.' : 'A camisa e as cores sugeridas entram no seu visual (dá para trocar nas outras abas).';
  }

  setNote(msg: string, kind: '' | 'ok' | 'bad' = '') {
    this.noteEl.textContent = msg || (this.opts?.overlay ? 'O jogo continua por baixo. Esc fecha sem salvar.' : 'Arraste para girar · role para aproximar · Ctrl+Z desfaz.');
    this.noteEl.className = `foot-note ${msg ? kind : ''}`;
  }
}
