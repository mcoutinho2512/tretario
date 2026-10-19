/**
 * Entrada unificada: teclado + mouse no desktop; joystick virtual + arrasto no toque.
 * Produz valores abstratos (mover, olhar, correr, pular, zoom) — o jogo não lê eventos crus.
 *
 * Rodada 11 — DESKTOP FIRST (docs/DESKTOP_CONTROLS.md): o cursor fica SEMPRE visível; nada pede pointer lock.
 *  - teclas vêm do mapa único (src/input/keymap.ts: DEFAULT_KEYMAP + remapeamentos locais);
 *  - clique esquerdo = selecionar/interagir (InteractionSystem via `pointFilter`) — nunca soco;
 *  - botão direito segurado + arrastar = girar a câmera; roda = zoom; menu de contexto bloqueado no canvas;
 *  - o mundo só recebe eventos cujo alvo é o canvas (HUD/painéis consomem antes) e nenhuma tecla de jogo vale
 *    com o foco num campo de texto (`isTypingTarget`, inclui SELECT).
 */
import { ACTION_TOGGLE, isTypingTarget, resolveKeymap, type GameAction } from './keymap';
import { MouseGesture, isWorldTarget } from './mouseGesture';
import { BASE_LOOK_RAD_PER_PX, inputPrefs } from './inputPrefs';

export class InputManager {
  /** códigos de tecla pressionados agora (a ação sai do mapa efetivo) */
  private keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private zoomD = 0;
  private jumpQueued = false;
  private toggles = new Set<string>();
  private map = resolveKeymap();
  /** joystick virtual (−1..1) */
  touchMove = { x: 0, y: 0 };
  touchRun = false;
  /** rodada 11: SEMPRE false — o jogo não captura o mouse (campo mantido para quem ainda consulta) */
  readonly pointerLocked = false;
  readonly isTouch: boolean;
  /** clique esquerdo (x, y) da tela no mundo → InteractionSystem.pointAt. true = consumido */
  pointFilter: ((x: number, y: number) => boolean) | null = null;
  /** rodada 11 — a roda de ações aberta usa 1–4 para categorias: nesses momentos 1–5 não vão para o acesso rápido */
  quickBlocked: (() => boolean) | null = null;
  /** gesto do mouse sobre o mundo (clique × arrasto, câmera) */
  readonly mouse = new MouseGesture();
  /** radianos por pixel (ajustável: `inputPrefs.sensitivity`) */
  sensitivity = BASE_LOOK_RAD_PER_PX;
  invertY = false;
  /** QA: contadores */
  readonly stats = { worldClicks: 0, worldDrags: 0, uiBlocked: 0, typingBlocked: 0, quickToWheel: 0 };

  constructor(private canvas: HTMLCanvasElement, isTouch: boolean) {
    this.isTouch = isTouch;
    const applyPrefs = () => { this.sensitivity = BASE_LOOK_RAD_PER_PX * inputPrefs.value.sensitivity; this.invertY = inputPrefs.value.invertY; };
    applyPrefs();
    inputPrefs.onChange(applyPrefs);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => { this.keys.clear(); this.endGesture(); });

    // ---- mouse (desktop): só eventos de mouse cujo alvo é o canvas começam um gesto
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || this.isTouch) return;
      if (!isWorldTarget(e.target, canvas)) { this.stats.uiBlocked++; return; }
      if (!this.mouse.down(e.button, e.clientX, e.clientY, performance.now())) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* sem captura: os eventos ainda chegam pela janela */ }
      // foco volta ao jogo (clicar no cenário tira o foco do chat/campo)
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && isTypingTarget(a)) a.blur();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.mouse.active) return;
      if (e.buttons === 0) { this.endGesture(); return; } // soltou fora sem pointerup (segurança)
      const was = this.mouse.looking;
      this.mouse.move(e.clientX, e.clientY);
      if (this.mouse.looking !== was) this.paintCursor();
    });
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !this.mouse.active) return;
      const btn = this.mouse.button;
      // acordes (direito + esquerdo): o pointerup chega com o último botão solto — encerra sem clicar
      if (e.button !== btn) { this.endGesture(); try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } return; }
      const r = this.mouse.up(e.button, e.clientX, e.clientY, performance.now());
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      this.paintCursor();
      if (r === 'drag') this.stats.worldDrags++;
      if (r === 'click' && btn === 0) { this.stats.worldClicks++; this.pointFilter?.(e.clientX, e.clientY); }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => this.endGesture());
    canvas.addEventListener('lostpointercapture', () => { if (this.mouse.active) this.endGesture(); });
    // botão direito é câmera: nunca abre o menu do navegador sobre o cenário
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (!isWorldTarget(e.target, canvas)) return;
      this.zoomD += Math.sign(e.deltaY) * 0.12;
      e.preventDefault();
    }, { passive: false });
  }

  /** rodada 11: o jogo não captura mais o mouse — mantido como no-op para chamadas antigas */
  requestLock() { /* sem pointer lock (docs/DESKTOP_CONTROLS.md) */ }

  /** girando a câmera com o mouse agora (botão direito, ou esquerdo arrastando) */
  get looking() { return this.mouse.looking; }
  /** instante (performance.now) do fim do último arrasto de câmera */
  get lastLookEnd() { return this.mouse.lastLookEnd; }

  /** remapeamento salvo: relê o mapa efetivo */
  reloadKeymap() { this.map = resolveKeymap(); this.keys.clear(); }

  private endGesture() { this.mouse.cancel(performance.now()); this.paintCursor(); }

  private cursorNow = '';
  private paintCursor() {
    // durante o arrasto de câmera: mão fechada (o cursor continua visível); fora dele, o InteractionSystem decide
    const c = this.mouse.looking ? 'grabbing' : '';
    if (c === this.cursorNow) return;
    this.cursorNow = c;
    this.canvas.classList.toggle('cam-drag', !!c);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // digitando num campo (chat, apelido, seletor…): a tecla é do campo, não do jogo
    if (isTypingTarget(e.target)) { this.stats.typingBlocked++; return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // atalhos do navegador/sistema
    const a = this.map.get(e.code);
    if (!a) return;
    if (e.code === 'Space' || e.code === 'F1' || e.code === 'F3' || e.code.startsWith('Arrow')) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat) return;
    if (a === 'jump') { this.jumpQueued = true; return; }
    if (a.startsWith('quick_') && this.quickBlocked?.()) { this.stats.quickToWheel++; return; } // roda aberta: 1–4 são dela
    const t = ACTION_TOGGLE[a];
    if (t) this.toggles.add(t);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private held(a: GameAction) {
    for (const k of this.keys) if (this.map.get(k) === a) return true;
    return false;
  }

  /** rodada 11 — inventário aberto: andar/correr/pular não movem o personagem (o mundo não pausa) */
  moveBlocked = false;
  setMoveBlocked(on: boolean) { this.moveBlocked = on; if (on) this.jumpQueued = false; }

  /** eixo de movimento local (x = direita, y = frente) */
  moveAxis(): { x: number; y: number } {
    if (this.moveBlocked) return { x: 0, y: 0 }; // rodada 11 — inventário
    let x = 0, y = 0;
    if (this.held('move_forward')) y += 1;
    if (this.held('move_back')) y -= 1;
    if (this.held('move_right')) x += 1;
    if (this.held('move_left')) x -= 1;
    x += this.touchMove.x;
    y += this.touchMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  running(): boolean {
    return this.held('run') || this.touchRun || Math.hypot(this.touchMove.x, this.touchMove.y) > 0.92;
  }

  consumeJump(): boolean {
    if (this.moveBlocked) { this.jumpQueued = false; return false; } // rodada 11 — inventário
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  queueJump() { this.jumpQueued = true; }
  /** solta tudo que estava pressionado (o chat abriu: W segurado não continua andando) */
  releaseAll() { this.keys.clear(); this.jumpQueued = false; this.touchMove.x = this.touchMove.y = 0; }
  queueToggle(name: string) { this.toggles.add(name); }

  addLook(dx: number, dy: number) { this.lookDX += dx; this.lookDY += dy; }

  consumeLook(): { dx: number; dy: number } {
    const m = this.mouse.consumeLook();
    const dx = this.lookDX + m.dx, dy = this.lookDY + m.dy * (this.invertY ? -1 : 1);
    this.lookDX = this.lookDY = 0;
    return { dx: dx * this.sensitivity, dy: dy * this.sensitivity };
  }

  consumeZoom(): number {
    const z = this.zoomD;
    this.zoomD = 0;
    return z;
  }

  addZoom(d: number) { this.zoomD += d; }

  consumeToggle(name: string): boolean {
    return this.toggles.delete(name);
  }

  /** houve input do jogador neste frame? (para interromper a intro de câmera) */
  hasActivity(): boolean {
    return this.keys.size > 0 || this.mouse.looking || Math.abs(this.lookDX) + Math.abs(this.lookDY) > 2 || Math.hypot(this.touchMove.x, this.touchMove.y) > 0.1;
  }

  /** QA (__pv.input()) */
  info() {
    return { looking: this.mouse.looking, held: [...this.keys].map((k) => this.map.get(k)), sensitivity: this.sensitivity, invertY: this.invertY, stats: { ...this.stats }, pointerLockElement: !!document.pointerLockElement };
  }
}
