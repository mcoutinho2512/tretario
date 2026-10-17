/**
 * Casca do HUD (rodada 8) — "o cenário é o protagonista": pouca coisa fixa, tudo discreto, some sozinho.
 *
 *  ┌ evento · estado ─────────── [zona] ──────────────── minimapa ┐
 *  │                                                     ⚙  ☰     │
 *  │                                                              │
 *  │ [chat]              [espectador] / [ação contextual]  Ações G│
 *  └──────────────────────────────────────────────────────────────┘
 *
 * Regras de desempenho: nada de DOM por quadro. `frame()` só consulta portões (RateGate): zona a 4 Hz, minimapa a
 * ≤ 10 Hz (4 Hz expandido parado), densidade a 1,5 Hz; textos só são escritos quando mudam (TextSlot).
 *
 * Encaixes para outros componentes (cada um dono do seu): `mountChat` (painel do chat + botão CHAT no celular),
 * `mountSpectator` (seletor de câmeras), `hooks.openCharacterEditor` (PERFIL/PERSONAGEM), `hooks.logout`.
 * Zonas: `zones` (rastreador com histerese), `onZoneChange`, `setFocusProvider` (câmera de espectador).
 * Rodada 9: `mountTracker` (missão em destaque, abaixo do estado), `addMenuItem` (PROGRESSO) e `notice` — fila curta de
 * avisos (objetivo/missão/conquista/nível/recompensa), um por vez, só DOM na chegada/saída de um aviso.
 */
import type { WorldManifest } from '../../world/types';
import type { ZoneDefinition } from '../../world/zones';
import { ZoneTracker, type ZoneChange } from '../../world/zoneTracker';
import type { QualityLevel } from '../../core/settings';
import { API } from '../../identity/types';
import { Minimap } from './Minimap';
import { SettingsPanel } from './SettingsPanel';
import { HudPrefsStore } from './hudPrefs';
import { AutoHide, RateGate, TextSlot, setClass } from './throttle';

/** componente montado num encaixe do HUD */
export interface HudPanel {
  readonly el: HTMLElement;
  /** o HUD pede para recolher/expandir (preferência "chat recolhido", HUD limpo) */
  setCollapsed?(collapsed: boolean): void;
}

/** painel de chat (agente C): o botão CHAT do celular e a tecla do HUD chamam `toggle` */
export interface ChatPanelLike extends HudPanel {
  toggle(open?: boolean): void;
}

export interface HudHooks {
  /** PERFIL / PERSONAGEM (editor do agente B) */
  openCharacterEditor?: () => void;
  /** sair da conta (padrão: POST /api/auth/logout e volta à home) */
  logout?: () => Promise<void> | void;
}

/** quem pode ter amostras de densidade (CrowdDirector) */
export interface DensitySource {
  requestSample(fn: (agents: readonly { x: number; z: number }[]) => void): void;
}

export interface HudFocus { x: number; z: number; heading: number; camYaw: number; moving: boolean }

export class HudShell {
  readonly prefs = new HudPrefsStore();
  readonly minimap: Minimap;
  readonly settings: SettingsPanel;
  readonly zones: ZoneTracker;
  readonly hooks: HudHooks = {};
  /** soltar/recapturar o mouse quando um painel abre/fecha */
  onModal?: (open: boolean) => void;
  clean = false;
  private touchUi = false;

  private root: HTMLElement;
  private autoHide = new AutoHide();
  private zoneGate = new RateGate(4);
  private mapGate = new RateGate(10);
  private densityGate = new RateGate(1.5);
  private eventText: TextSlot;
  private statusText: TextSlot;
  private promptText: TextSlot;
  private promptEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private eventEl: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerName: HTMLDivElement;
  private bannerTimer = 0;
  private flashUntil = 0;
  private menu: HTMLDivElement;
  private menuBtn: HTMLButtonElement;
  private helpEl: HTMLDivElement;
  private chatSlot: HTMLDivElement;
  private specSlot: HTMLDivElement;
  private chat: ChatPanelLike | null = null;
  private density: DensitySource | null = null;
  private focusProvider: (() => { x: number; z: number }) | null = null;
  private zoneListeners = new Set<(c: ZoneChange) => void>();
  private touch: { setUseVisible(v: boolean): void; onChat?: () => void; onMenu?: () => void } | null = null;
  private lastFocus: HudFocus = { x: 0, z: 0, heading: 0, camYaw: 0, moving: false };
  private dirtyMap = true;
  // rodada 9 — progressão: encaixe do rastreador e fila de avisos
  private trackerSlot: HTMLDivElement;
  private noticeEl: HTMLDivElement;
  private noticeQ: { text: string; kind: string; ms: number }[] = [];
  private noticeBusy = false;
  /** QA: avisos já mostrados (texto e tipo) */
  readonly noticeLog: { text: string; kind: string; t: number }[] = [];

  constructor(root: HTMLElement, manifest: WorldManifest, zones: readonly ZoneDefinition[], opts: { touch: boolean; level: QualityLevel }) {
    this.root = root;
    root.classList.toggle('touch', opts.touch);
    this.touchUi = opts.touch;
    this.zones = new ZoneTracker(zones, manifest.pvAxis as [number, number][]);
    const div = (cls: string, parent: HTMLElement = root) => { const d = document.createElement('div'); d.className = cls; parent.appendChild(d); return d; };

    // ---- alto à esquerda: evento + estado (modo / avisos curtos)
    const tl = div('hud-tl');
    this.eventEl = div('hud-event hud-fadeable', tl);
    this.statusEl = div('hud-status hud-fadeable', tl);
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    this.eventText = new TextSlot(this.eventEl);
    this.statusText = new TextSlot(this.statusEl);
    this.trackerSlot = div('hud-slot-tracker', tl);

    // ---- aviso de zona (centro, alto)
    this.banner = div('zone-banner');
    this.banner.setAttribute('aria-live', 'polite');
    const kicker = div('zb-kicker', this.banner);
    kicker.textContent = 'Presidente Vargas';
    this.bannerName = div('zb-name', this.banner);
    this.noticeEl = div('hud-notice');
    this.noticeEl.setAttribute('role', 'status');
    this.noticeEl.setAttribute('aria-live', 'polite');

    // ---- alto à direita: minimapa + botões
    const tr = div('hud-tr');
    this.minimap = new Minimap(manifest, zones, { compactSize: opts.touch ? 118 : 184 });
    tr.appendChild(this.minimap.el);
    this.minimap.el.addEventListener('click', () => { this.dirtyMap = true; this.mapGate.poke(); });
    const btns = div('hud-btns hud-fadeable', tr);
    const gear = this.iconButton('⚙', 'Ajustes', btns);
    this.menuBtn = this.iconButton('☰', 'Menu', btns);
    this.menuBtn.setAttribute('aria-haspopup', 'menu');
    this.menuBtn.setAttribute('aria-expanded', 'false');

    // ---- menu (perfil/personagem, controles, HUD limpo, sair)
    this.menu = div('hud-menu', tr);
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    this.menuItem('Perfil / personagem', () => this.openCharacterEditor());
    this.menuItem('Ajustes', () => this.settings.toggle(true));
    this.menuItem('Controles', () => this.toggleHelp(true));
    this.menuItem('Mapa expandido', () => this.toggleMap());
    this.menuItem('HUD limpo', () => this.toggleClean(true));
    this.menuItem('Sair da conta', () => void this.logout(), 'danger');

    // ---- baixo: chat (esq.), espectador + ação contextual (centro), ações (dir.)
    this.chatSlot = div('hud-slot-chat');
    const bc = div('hud-bc');
    this.specSlot = div('hud-slot-spectator', bc);
    this.promptEl = div('use-prompt', bc);
    this.promptText = new TextSlot(this.promptEl);
    if (!opts.touch) {
      const br = div('hud-br hud-fadeable');
      const act = document.createElement('button');
      act.type = 'button';
      act.className = 'hud-pill';
      act.innerHTML = 'Ações <kbd>G</kbd>';
      act.addEventListener('click', () => this.onActions?.());
      br.appendChild(act);
    }

    // ---- ajustes, controles, restaurar HUD (no modo limpo)
    this.settings = new SettingsPanel(this.prefs, opts.level);
    root.appendChild(this.settings.el);
    this.settings.onToggle = (open) => { this.poke(); this.onModal?.(open || !this.menu.hidden); };
    gear.addEventListener('click', () => this.settings.toggle());
    this.menuBtn.addEventListener('click', () => this.toggleMenu());
    this.helpEl = div('hud-help');
    this.helpEl.hidden = true;
    this.helpEl.innerHTML = opts.touch
      ? '<b>Controles</b><br>Joystick: andar (até o fim corre) · Arraste: câmera · Pinça: zoom<br>PULAR · USAR (quando há algo perto) · AÇÕES · CHAT · ☰ menu'
      : '<b>Controles</b><br><kbd>WASD</kbd> andar · <kbd>Shift</kbd> correr · <kbd>Espaço</kbd> pular · <kbd>Mouse</kbd> câmera · <kbd>Roda</kbd> zoom<br><kbd>E</kbd> usar / subir no trio / pichar · <kbd>G</kbd> ações · <kbd>K</kbd> modo · <kbd>F</kbd> empurrar (modo interação)<br><kbd>M</kbd> mapa · <kbd>H</kbd>/<kbd>P</kbd> HUD limpo · <kbd>F1</kbd> controles · <kbd>F3</kbd> debug · <kbd>Esc</kbd> soltar o mouse';
    this.helpEl.addEventListener('click', () => this.toggleHelp(false));
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'hud-restore';
    restore.textContent = 'Mostrar HUD';
    restore.addEventListener('click', () => this.toggleClean(false));
    root.appendChild(restore);
    const hint = div('hud-hint hud-fadeable');
    hint.textContent = opts.touch ? '☰ menu · toque no mapa para expandir' : 'F1 controles · M mapa · G ações · H HUD limpo';
    setTimeout(() => hint.remove(), 9000);

    // ---- auto-ocultar: volta ao mexer no HUD / mouse solto / teclas de HUD
    this.autoHide.enabled = this.prefs.value.hudAutoHide;
    this.prefs.onChange((p) => { this.autoHide.enabled = p.hudAutoHide; this.chat?.setCollapsed?.(p.chatCollapsed); this.poke(); });
    const poke = () => this.poke();
    document.addEventListener('pointermove', () => { if (!document.pointerLockElement) poke(); }, { passive: true });
    root.addEventListener('pointerdown', poke, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (MOVE_KEYS.has(e.code)) return;
      poke();
      if (e.code === 'Escape') { this.toggleMenu(false); this.toggleHelp(false); }
    });
    document.addEventListener('pointerdown', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target as Node) && e.target !== this.menuBtn) this.toggleMenu(false); });
    this.poke();
  }

  /** abrir a roda de ações (o jogo liga) */
  onActions?: () => void;

  // ------------------------------------------------------------------ encaixes
  /** painel do chat (agente C) no canto inferior esquerdo; o botão CHAT do celular chama `toggle` */
  mountChat(panel: ChatPanelLike) {
    this.chat = panel;
    this.chatSlot.replaceChildren(panel.el);
    panel.setCollapsed?.(this.prefs.value.chatCollapsed);
  }

  /** rodada 9 — rastreador de missão (src/ui/progress), abaixo do estado no alto à esquerda */
  mountTracker(panel: HudPanel) { this.trackerSlot.replaceChildren(panel.el); }

  /** rodada 9 — item extra no menu (ex.: PROGRESSO), logo depois de "Perfil / personagem" */
  addMenuItem(label: string, fn: () => void) {
    this.menuItem(label, fn);
    const b = this.menu.lastElementChild!;
    this.menu.insertBefore(b, this.menu.children[1] ?? null);
  }

  /**
   * rodada 9 — aviso curto no alto ao centro (fila: um por vez, `ms` cada; no máximo 6 esperando). Aparece mesmo com
   * o HUD esmaecido/limpo? Não no modo foto (HUD limpo): fica na fila até voltar.
   */
  notice(text: string, kind = 'info', ms = 3200) {
    if (this.noticeQ.length >= 6) this.noticeQ.shift();
    this.noticeQ.push({ text, kind, ms });
    if (!this.noticeBusy) this.nextNotice();
  }

  private nextNotice() {
    const n = this.clean ? undefined : this.noticeQ.shift();
    if (!n) { this.noticeBusy = false; this.noticeEl.classList.remove('show'); if (this.clean && this.noticeQ.length) setTimeout(() => this.nextNotice(), 1000); return; }
    this.noticeBusy = true;
    this.poke(); // aviso de progresso acorda o HUD (rastreador visível junto)
    if (this.noticeQ.length >= 2) n.ms = Math.max(1400, n.ms * 0.55); // fila longa: anda mais rápido
    this.noticeEl.className = `hud-notice show k-${n.kind}`;
    this.noticeEl.textContent = n.text;
    this.noticeLog.push({ text: n.text, kind: n.kind, t: Date.now() });
    if (this.noticeLog.length > 50) this.noticeLog.shift();
    setTimeout(() => { this.noticeEl.classList.remove('show'); setTimeout(() => this.nextNotice(), 260); }, n.ms);
  }

  /** seletor de câmeras do espectador (agente D), acima da ação contextual */
  mountSpectator(panel: HudPanel) { this.specSlot.replaceChildren(panel.el); }

  /** posição que define a zona/minimapa (padrão: o jogador); câmera de espectador passa a sua. null = jogador */
  setFocusProvider(fn: (() => { x: number; z: number }) | null) { this.focusProvider = fn; this.zones.reset(); this.zoneGate.poke(); }

  onZoneChange(fn: (c: ZoneChange) => void) { this.zoneListeners.add(fn); return () => this.zoneListeners.delete(fn); }

  attachCrowd(src: DensitySource) { this.density = src; }

  attachTouch(t: { setUseVisible(v: boolean): void; onChat?: () => void; onMenu?: () => void }) {
    this.touch = t;
    t.onChat = () => { this.poke(); this.chat?.toggle(); };
    t.onMenu = () => this.toggleMenu();
    t.setUseVisible(!!this.promptText.value);
  }

  // ------------------------------------------------------------------ conteúdo
  setEvent(name: string | null | undefined) { this.eventText.set(name ? name : ''); }
  /** texto do estado quando não há aviso (modo pacífico/interação) */
  setMode(text: string, combat: boolean) {
    if (performance.now() < this.flashUntil) return;
    this.statusText.set(text);
    setClass(this.statusEl, 'combat', combat);
    setClass(this.statusEl, 'flash', false);
  }
  /** aviso curto (2,5 s): aparece mesmo com o HUD esmaecido */
  flash(msg: string, ms = 2500) {
    this.flashUntil = performance.now() + ms;
    this.statusText.set(msg);
    setClass(this.statusEl, 'flash', true);
  }
  /** ação contextual (E — USAR…); vazio esconde */
  setPrompt(text: string) {
    // no toque a tecla não existe: o botão USAR aparece
    if (!this.promptText.set(this.touchUi ? text.replace(/^E — /, '') : text)) return;
    setClass(this.promptEl, 'show', !!text);
    this.touch?.setUseVisible(!!text);
  }

  // ------------------------------------------------------------------ modos
  poke() {
    this.autoHide.poke(performance.now()); // o próximo frame() tira o esmaecimento
  }

  toggleClean(v = !this.clean) {
    if (v === this.clean) return;
    this.clean = v;
    setClass(this.root, 'photo', v);
    if (v) { this.toggleMenu(false); this.settings.toggle(false); this.toggleHelp(false); this.minimap.toggleExpanded(false); }
    this.chat?.setCollapsed?.(v || this.prefs.value.chatCollapsed);
    this.poke();
  }

  toggleMap(v?: boolean) {
    this.minimap.toggleExpanded(v);
    this.dirtyMap = true;
    this.mapGate.poke();
    this.poke();
  }

  toggleHelp(v = this.helpEl.hidden) { this.helpEl.hidden = !v; }

  toggleMenu(v = this.menu.hidden) {
    if (v === !this.menu.hidden) return;
    this.menu.hidden = !v;
    this.menuBtn.setAttribute('aria-expanded', String(v));
    if (v) this.menu.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    this.onModal?.(v || this.settings.open);
  }

  get anyModal() { return !this.menu.hidden || this.settings.open; }

  // ------------------------------------------------------------------ por quadro (só portões)
  frame(now: number, f: HudFocus) {
    this.lastFocus = f;
    if (this.autoHide.update(now, f.moving)) setClass(this.root, 'dim', this.autoHide.faded);
    if (this.zoneGate.due(now)) {
      const p = this.focusProvider?.() ?? f;
      const ch = this.zones.update(p.x, p.z, now);
      if (ch) this.onZone(ch);
    }
    if (this.clean) return;
    if (this.density && this.densityGate.due(now)) this.density.requestSample((list) => { this.minimap.sampleDensity(list); this.dirtyMap = true; });
    // expandido e parado: 4 Hz basta (só o calor e o trio mudam)
    this.mapGate.hz = this.minimap.expanded && !f.moving ? 4 : 10;
    if (this.mapGate.due(now) || this.dirtyMap) {
      this.dirtyMap = false;
      this.minimap.draw(f.x, f.z, f.heading, f.camYaw);
    }
  }

  private onZone(ch: ZoneChange) {
    const z = ch.to;
    this.minimap.setCaption(z ? z.name : '');
    for (const fn of this.zoneListeners) fn(ch);
    if (!z) return;
    this.bannerName.textContent = z.name;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // reinicia a transição (só na troca de zona)
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 3400);
  }

  // ------------------------------------------------------------------ ações do menu
  private openCharacterEditor() {
    this.toggleMenu(false);
    if (this.hooks.openCharacterEditor) { this.hooks.openCharacterEditor(); return; }
    window.dispatchEvent(new CustomEvent('pv:open-character-editor'));
    this.flash('Editor de personagem: em breve');
  }

  private async logout() {
    this.toggleMenu(false);
    if (this.hooks.logout) { await this.hooks.logout(); return; }
    try { await fetch(API.logout, { method: 'POST', credentials: 'same-origin' }); } catch { /* sem API */ }
    location.href = location.pathname;
  }

  private iconButton(icon: string, label: string, parent: HTMLElement) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hud-icon';
    b.textContent = icon;
    b.title = label;
    b.setAttribute('aria-label', label);
    parent.appendChild(b);
    return b;
  }

  private menuItem(label: string, fn: () => void, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (cls) b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => { fn(); if (!this.menu.hidden) this.toggleMenu(false); });
    this.menu.appendChild(b);
  }

  /** QA: estado e custo do HUD */
  info() {
    return {
      clean: this.clean, dim: this.autoHide.faded, expanded: this.minimap.expanded, zone: this.zones.current?.id ?? null,
      prefs: { ...this.prefs.value }, minimap: { ...this.minimap.stats, drawMs: +this.minimap.stats.drawMs.toFixed(3), densityMs: +this.minimap.stats.densityMs.toFixed(3) },
      writes: { event: this.eventText.writes, status: this.statusText.writes, prompt: this.promptText.writes },
      focus: { x: Math.round(this.lastFocus.x), z: Math.round(this.lastFocus.z) },
    };
  }
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
