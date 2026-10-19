/**
 * Barra de ações (rodada 9.1) — segunda porta de entrada, fácil de achar, para o que já existe: veículos, itens, pichar,
 * confronto, gestos, personagem e mapa. Centro inferior (só jogador; o espectador fica com a barra de câmeras). As
 * categorias com opções abrem um popover para cima (mouse, teclado e toque); Esc ou clique fora fecham.
 *
 * NADA de lógica de ação aqui: cada botão chama o mesmo caminho da tecla/roda (`deps`) — itens/gestos vêm de
 * actionOptions.ts (a roda G usa as mesmas opções), golpes entram como as teclas R/Q/C/F, USAR como E, pichar como E
 * perto da parede, resumo do confronto lido do CombatHud. Estado do popover e veículos perto: actionBarState.ts (puro).
 *
 * Custo: nada por quadro. `update()` passa por um RateGate (4 Hz) e só escreve no DOM quando algo muda (TextSlot,
 * setClass, assinatura do popover aberto). Celular: fileira compacta só de ícones (44 px) acima dos controles de toque.
 */
import { keyLabel, keysFor, type GameAction } from '../../input/keymap'; // rodada 11 — entrada
import { ACTION_CATEGORIES } from '../../social/actions';
import { PROP_BY_ID } from '../../social/props';
import { DESIGN_BY_ID } from '../../social/designs';
import { actionOptions, itemOptions, type ActionOption, type SocialLike } from '../actionOptions';
import { BAR_CATS, PopoverState, distLabel, hintText, hintVisible, type BarCat, type NearVehicle } from './actionBarState';
import { RateGate, TextSlot, setClass } from './throttle';
import type { CombatHudState } from '../../combat/CombatHud';
import { uiZoom } from '../uiPrefs'; // rodada 11 — escala da interface
/** rótulo da tecla efetiva (remapeamentos locais valem) */
const kk = (a: GameAction) => keyLabel(keysFor(a)[0] ?? '') || '—';

export interface ActionBarDeps {
  touch: boolean;
  social: SocialLike & { design: number; cycleDesign(step: number): void };
  /** itens de confronto oferecidos (possuído, ou todos com `freeCombatProps`) — o mesmo da roda */
  extraProps(): readonly number[];
  /** ação contextual de veículo ("E — USAR BICICLETA", "E — DESCER DO TRIO"…) ou '' — o texto do HUD, já calculado */
  vehiclePrompt(): string;
  /** veículos livres por perto (um por tipo) */
  vehicles(): NearVehicle[];
  vehicleLabel(kind: string): string;
  /** E / USAR */
  use(): void;
  /** direção para um ponto (alvo no minimapa + mapa expandido + aviso de distância), sem teleporte */
  showTarget(x: number, z: number, label: string, d: number): void;
  /** abre o editor de grafite se houver superfície liberada perto; false = longe */
  pichar(): boolean;
  /** golpes: as mesmas entradas das teclas (cbt_punch/cbt_kick/cbt_dodge) e o empurrão (action) */
  press(k: 'cbt_punch' | 'cbt_kick' | 'cbt_dodge' | 'action'): void;
  /** último estado do HUD de confronto (null = confronto indisponível) */
  combatState(): CombatHudState | null;
  openCharacterEditor(): void;
  toggleMap(): void;
  flash(msg: string): void;
}

/** ids dos itens de confronto no atalho do Confronto (props.ts) */
const COMBAT_QUICK: readonly { id: number; label: string }[] = [
  { id: 11, label: 'Taco' }, { id: 12, label: 'Barra' }, { id: 13, label: 'Spray' },
];

// ícones próprios (SVG simples, traço 1,8, cor do texto) — nada de pacote de ícones
const svg = (body: string, cls = 'ab-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS: Record<BarCat, string> = {
  veiculos: svg('<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M13 6h3"/>'),
  itens: svg('<path d="M6 21V3"/><path d="M6 4h11l-2.5 4L17 12H6"/>'),
  pichar: svg('<rect x="7" y="9" width="8" height="12" rx="1.5"/><path d="M9 9V6h4v3M11 6V4"/><path d="M17 5h.01M19.5 3.5h.01M19.5 7h.01"/>'),
  confronto: svg('<path d="M12 2l2.2 5.6L20 6l-3.6 4.8L21 14l-5.8.6L14 21l-2-5.2L10 21l-1.2-6.4L3 14l4.6-3.2L4 6l5.8 1.6z"/>'),
  gestos: svg('<circle cx="12" cy="5" r="2"/><path d="M12 8v7M12 15l-3 6M12 15l3 6M12 10l-5-4M12 10l5-4"/>'),
  personagem: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  mapa: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
};
const CHEVRON = svg('<path d="M7 14l5-5 5 5"/>', 'ab-up');

type Entry = { label: string; kbd?: string; active?: boolean; disabled?: boolean; id?: string; pick: () => void; closes?: boolean };
type Section = { title?: string; entries: Entry[]; extra?: HTMLElement };

export class ActionBar {
  readonly el: HTMLDivElement;
  readonly state = new PopoverState();
  /** a casca registra a camada do Esc quando o popover abre/fecha */
  onModal?: (open: boolean) => void;
  /** a casca tira o esmaecimento */
  onPoke?: () => void;
  private row: HTMLDivElement;
  private pop: HTMLDivElement;
  private popTitle: HTMLDivElement;
  private popBody: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private btns = new Map<BarCat, HTMLButtonElement>();
  private meter: HTMLElement;
  private meterC: HTMLElement;
  private meterS: HTMLElement;
  private gate = new RateGate(4);
  private sig = '';
  private last = { c: -1, s: -1 };
  private startedAt = -1;
  private movedAt: number | null = null;
  private hintSlot: TextSlot;
  /** QA: renderizações do popover e escritas de estado */
  readonly stats = { renders: 0, writes: 0, picks: 0, editorOpens: 0, mapToggles: 0, pichar: 0 };

  constructor(private deps: ActionBarDeps) {
    const div = (cls: string, parent?: HTMLElement) => { const d = document.createElement('div'); d.className = cls; parent?.appendChild(d); return d; };
    this.el = div('action-bar');
    this.hintEl = div('ab-hint hud-fadeable', this.el);
    this.hintSlot = new TextSlot(this.hintEl);
    this.hintSlot.set(hintText(deps.touch));
    this.pop = div('ab-pop', this.el);
    this.pop.hidden = true;
    this.pop.setAttribute('role', 'menu');
    this.popTitle = div('ab-pop-title', this.pop);
    this.popBody = div('ab-pop-body', this.pop);
    this.row = div('ab-row hud-fadeable', this.el);
    this.row.setAttribute('role', 'toolbar');
    this.row.setAttribute('aria-label', 'Barra de ações');
    BAR_CATS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ab-btn ab-${c.key}`;
      b.dataset.cat = c.key;
      b.setAttribute('aria-label', c.name);
      b.title = c.name;
      b.innerHTML = `${ICONS[c.key]}<span class="ab-lbl">${c.label}</span>${c.popover ? CHEVRON : ''}`;
      if (c.popover) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); }
      b.addEventListener('click', (e) => this.onCat(c.key, e.detail === 0));
      this.row.appendChild(b);
      this.btns.set(c.key, b);
    });
    // mini barras de condição/fôlego no botão Confronto (só quando o HUD de confronto está mostrando)
    this.meter = document.createElement('span');
    this.meter.className = 'ab-meter';
    this.meter.setAttribute('aria-hidden', 'true');
    this.meterC = document.createElement('i'); this.meterS = document.createElement('i');
    this.meter.append(this.meterC, this.meterS);
    this.btns.get('confronto')!.appendChild(this.meter);

    this.state.onChange = (open, prev) => {
      if (prev) { const pb = this.btns.get(prev)!; pb.setAttribute('aria-expanded', 'false'); pb.classList.remove('open'); }
      if (open) { const b = this.btns.get(open)!; b.setAttribute('aria-expanded', 'true'); b.classList.add('open'); }
      this.pop.hidden = !open;
      if (open) this.render(true);
      else this.sig = '';
      if (!!open !== !!prev) this.onModal?.(!!open);
    };
    this.el.addEventListener('keydown', this.onKey);
    // clique/toque fora fecha
    document.addEventListener('pointerdown', (e) => this.state.pointerDown(this.el.contains(e.target as Node)), { passive: true });
    this.el.addEventListener('pointerdown', () => this.onPoke?.(), { passive: true });
  }

  get open() { return this.state.open; }
  close() { this.state.close(); }
  /** rodada 11: Esc pela pilha única (listener em captura, antes do onKey da barra) — fecha e, se o foco estava no
   * popover (navegação por teclado), devolve-o ao botão que abriu */
  closeFromEsc() { const inside = this.pop.contains(document.activeElement); this.state.close(); if (inside) this.btns.get(this.lastOpen)?.focus(); }

  // ------------------------------------------------------------------ categorias
  private onCat(cat: BarCat, keyboard: boolean) {
    this.onPoke?.();
    const btn = this.btns.get(cat)!;
    if (!keyboard) btn.blur(); // depois do clique, Espaço volta a ser pulo (não reaperta o botão)
    if (this.state.toggle(cat)) { if (keyboard) this.focusItem(0); return; }
    switch (cat) {
      case 'pichar':
        this.stats.pichar++;
        if (!this.deps.pichar()) this.deps.flash('Aproxime-se de um tapume ou parede liberada para pichar');
        break;
      case 'personagem': this.stats.editorOpens++; this.deps.openCharacterEditor(); break;
      case 'mapa': this.stats.mapToggles++; this.deps.toggleMap(); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ teclado
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const nav = NAV_KEYS.has(e.code);
    if (this.pop.contains(t)) {
      const items = this.items();
      const r = this.state.keyInPopover(e.code, items.length);
      if (r.kind === 'focus') this.focusItem(r.index);
      else if (r.kind === 'close') this.btns.get(this.lastOpen)?.focus();
    } else {
      const at = BAR_CATS.findIndex((c) => this.btns.get(c.key) === t);
      if (at < 0) return;
      const r = this.state.keyOnBar(e.code, at);
      if (r.kind === 'focus') this.btns.get(BAR_CATS[r.index].key)!.focus();
      else if (r.kind === 'open') this.focusItem(0);
    }
    // teclas de navegação ficam na barra (não andam/pulam o personagem); o resto segue para o jogo
    if (nav) { e.stopPropagation(); if (e.code !== 'Enter' && e.code !== 'Space') e.preventDefault(); }
  };
  private lastOpen: BarCat = 'veiculos';

  private items() { return [...this.popBody.querySelectorAll<HTMLButtonElement>('button')]; }

  private focusItem(i: number) {
    const items = this.items();
    if (!items.length) return;
    this.state.focus = Math.max(0, Math.min(items.length - 1, i));
    items[this.state.focus].focus({ preventScroll: false });
  }

  // ------------------------------------------------------------------ popover
  private sections(cat: BarCat): Section[] {
    const d = this.deps, s = d.social;
    const fromOpts = (o: ActionOption[], closes: boolean, prefix: string): Entry[] => o.map((x) => ({ label: x.label, active: x.active, disabled: x.disabled, id: `${prefix}${x.id}`, pick: x.pick, closes: closes && x.closes }));
    switch (cat) {
      case 'veiculos': {
        const prompt = d.vehiclePrompt();
        const out: Section[] = [];
        // "E — USAR BICICLETA" / "E — descer · W pedalar…": a tecla vai no <kbd>, a ajuda de direção fica no HUD
        const useLabel = prompt.replace(/^E — /, '').split(' · ')[0];
        if (prompt) out.push({ entries: [{ label: useLabel.charAt(0).toUpperCase() + useLabel.slice(1), kbd: d.touch ? undefined : 'E', id: 'use', pick: () => d.use(), closes: true }] });
        const list = d.vehicles();
        out.push({
          title: list.length ? 'Por perto' : undefined,
          entries: list.length
            ? list.map((v) => ({ label: `${d.vehicleLabel(v.kind)} · ${distLabel(v.d)}`, id: `v_${v.kind}`, pick: () => d.showTarget(v.x, v.z, d.vehicleLabel(v.kind), v.d), closes: true }))
            : [{ label: 'Nenhum veículo livre por perto', disabled: true, id: 'none', pick: () => d.flash('Nenhum veículo livre por perto — estações de bicicleta e patinete ficam nas calçadas') }],
        });
        return out;
      }
      case 'itens': {
        const extra = d.extraProps();
        const held = PROP_BY_ID.get(s.prop);
        const sec: Section = { entries: fromOpts(itemOptions(s, extra), false, 'p') };
        if (held?.designSlot) sec.extra = this.designRow();
        return [sec];
      }
      case 'confronto': {
        const extra = new Set(d.extraProps());
        return [
          { title: 'Golpes', entries: [
            { label: 'Soco', kbd: d.touch ? undefined : kk('punch'), id: 'cbt_punch', pick: () => d.press('cbt_punch') },
            { label: 'Chute', kbd: d.touch ? undefined : kk('kick'), id: 'cbt_kick', pick: () => d.press('cbt_kick') },
            { label: 'Esquiva', kbd: d.touch ? undefined : kk('dodge'), id: 'cbt_dodge', pick: () => d.press('cbt_dodge') },
            { label: 'Empurrão', kbd: d.touch ? undefined : kk('push'), id: 'action', pick: () => d.press('action') },
          ] },
          { title: 'Pegar rápido', entries: COMBAT_QUICK.map((q) => ({
            label: q.label, id: `p${q.id}`, active: s.prop === q.id, disabled: !extra.has(q.id),
            pick: () => (extra.has(q.id) ? s.requestProp(q.id) : d.flash(`${q.label}: pegue num ponto de apoio (áreas de confronto) — T pega`)),
          })) },
        ];
      }
      case 'gestos':
        return ACTION_CATEGORIES.filter((c) => c.key !== 'itens').map((c) => ({ title: cap(c.label), entries: fromOpts(actionOptions(s, c.key), true, 'a') }));
      default: return [];
    }
  }

  /** ◀ design ▶ do item na mão (mesmo atalho da roda) */
  private designRow() {
    const s = this.deps.social;
    const row = document.createElement('div');
    row.className = 'ab-design';
    const mk = (txt: string, aria: string, step: number) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ab-dbtn'; b.textContent = txt; b.setAttribute('aria-label', aria);
      b.addEventListener('click', () => { s.cycleDesign(step); this.render(false); });
      return b;
    };
    const name = document.createElement('span');
    name.textContent = DESIGN_BY_ID.get(s.design)?.label ?? '';
    row.append(mk('◀', 'Design anterior', -1), name, mk('▶', 'Próximo design', 1));
    return row;
  }

  /** assinatura do conteúdo (re-render só quando muda) */
  private signature(cat: BarCat): string {
    const d = this.deps, s = d.social;
    switch (cat) {
      case 'veiculos': return `${d.vehiclePrompt()}|${d.vehicles().map((v) => `${v.kind}:${distLabel(v.d)}`).join(',')}`;
      case 'itens': case 'confronto': return `${s.prop}|${s.design}|${d.extraProps().join(',')}`;
      case 'gestos': return `${s.act}|${s.prop}`;
      default: return '';
    }
  }

  private render(first: boolean) {
    const cat = this.state.open;
    if (!cat) return;
    this.lastOpen = cat;
    const keepFocus = this.pop.contains(document.activeElement);
    this.sig = this.signature(cat);
    this.stats.renders++;
    const def = BAR_CATS.find((c) => c.key === cat)!;
    this.popTitle.textContent = def.name;
    this.pop.setAttribute('aria-label', def.name);
    this.popBody.textContent = '';
    for (const sec of this.sections(cat)) {
      if (sec.title) { const h = document.createElement('div'); h.className = 'ab-sec'; h.setAttribute('role', 'presentation'); h.textContent = sec.title; this.popBody.appendChild(h); }
      const grid = document.createElement('div');
      grid.className = 'ab-grid';
      for (const en of sec.entries) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.className = `ab-opt${en.active ? ' active' : ''}${en.disabled ? ' disabled' : ''}`;
        if (en.id) b.dataset.id = en.id;
        if (en.disabled) b.setAttribute('aria-disabled', 'true');
        if (en.active) b.setAttribute('aria-current', 'true');
        b.textContent = en.label;
        if (en.kbd) { const k = document.createElement('kbd'); k.textContent = en.kbd; b.appendChild(k); }
        b.addEventListener('click', (e) => {
          this.stats.picks++;
          this.onPoke?.();
          en.pick();
          if (en.closes) { this.state.close(); if (e.detail === 0) this.btns.get(cat)?.focus(); }
          else this.render(false);
          if (e.detail > 0) b.blur();
        });
        grid.appendChild(b);
      }
      this.popBody.appendChild(grid);
      if (sec.extra) this.popBody.appendChild(sec.extra);
    }
    if (first) this.place(cat);
    if (keepFocus && !first) this.focusItem(this.state.focus);
  }

  /** alinha o popover ao botão (uma leitura de layout, só ao abrir); no toque fica centralizado (CSS) */
  private place(cat: BarCat) {
    if (this.deps.touch) return;
    const b = this.btns.get(cat)!, bar = this.el.getBoundingClientRect(), br = b.getBoundingClientRect();
    // rodada 11 — escala da interface: medidas em pixels da tela; o `left` é escrito em pixels do HUD (÷ zoom)
    const z = uiZoom();
    const w = this.pop.offsetWidth * z, vw = window.innerWidth;
    const left = Math.max(8 - bar.left, Math.min(vw - 8 - w - bar.left, br.left + br.width / 2 - bar.left - w / 2));
    this.pop.style.left = `${Math.round(left / z)}px`;
  }

  // ------------------------------------------------------------------ portão (≤ 4 Hz)
  update(now: number, moving: boolean) {
    if (this.startedAt < 0) this.startedAt = now;
    if (moving && this.movedAt === null) this.movedAt = now;
    if (!this.gate.due(now)) return;
    // dica de controles: primeiros minutos ou até o 1º movimento
    if (setClass(this.hintEl, 'gone', !hintVisible(now - this.startedAt, this.movedAt === null ? null : now - this.movedAt))) this.stats.writes++;
    // veículo usável perto: ponto no botão
    if (setClass(this.btns.get('veiculos')!, 'ready', !!this.deps.vehiclePrompt())) this.stats.writes++;
    // confronto: mini barras quando o HUD de confronto está à vista
    const cs = this.deps.combatState();
    const show = !!cs?.visible;
    if (setClass(this.meter, 'show', show)) this.stats.writes++;
    if (cs && show) {
      const c = Math.round((20 * cs.condition) / Math.max(1, cs.conditionMax)), st = Math.round((20 * cs.stamina) / Math.max(1, cs.staminaMax));
      if (c !== this.last.c) { this.last.c = c; this.meterC.style.transform = `scaleX(${c / 20})`; this.stats.writes++; }
      if (st !== this.last.s) { this.last.s = st; this.meterS.style.transform = `scaleX(${st / 20})`; this.stats.writes++; }
    }
    // popover aberto: re-render só quando o conteúdo muda
    const open = this.state.open;
    if (open && this.signature(open) !== this.sig) this.render(false);
  }

  /** QA */
  qa() {
    const r = this.el.getBoundingClientRect();
    return {
      open: this.state.open, hint: { text: this.hintSlot.value, shown: !this.hintEl.classList.contains('gone') },
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      buttons: BAR_CATS.map((c) => { const b = this.btns.get(c.key)!.getBoundingClientRect(); return { cat: c.key, x: b.x, y: b.y, w: b.width, h: b.height, ready: this.btns.get(c.key)!.classList.contains('ready') }; }),
      items: this.state.open ? this.items().map((b) => ({ id: b.dataset.id ?? '', label: b.textContent ?? '', active: b.classList.contains('active'), disabled: b.classList.contains('disabled') })) : [],
      meter: this.meter.classList.contains('show'),
      stats: { ...this.stats },
    };
  }
}

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape', 'Enter', 'Space']);
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
