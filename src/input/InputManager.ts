/**
 * Entrada unificada: teclado + mouse (pointer lock) no desktop; joystick virtual + arrasto no toque.
 * Produz valores abstratos (mover, olhar, correr, pular, zoom) — o jogo não lê eventos crus.
 */
export class InputManager {
  private keys = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private zoomD = 0;
  private jumpQueued = false;
  private toggles = new Set<string>();
  /** joystick virtual (−1..1) */
  touchMove = { x: 0, y: 0 };
  touchRun = false;
  pointerLocked = false;
  readonly isTouch: boolean;
  sensitivity = 0.0024;

  constructor(private canvas: HTMLCanvasElement, isTouch: boolean) {
    this.isTouch = isTouch;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('click', () => {
      if (!this.isTouch && !this.pointerLocked) this.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    canvas.addEventListener('wheel', (e) => {
      this.zoomD += Math.sign(e.deltaY) * 0.12;
      e.preventDefault();
    }, { passive: false });
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => { /* navegador recusou (ex.: sem gesto) */ });
    } catch { /* ignore */ }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space') { if (!e.repeat) this.jumpQueued = true; e.preventDefault(); }
    if (e.code === 'F3') { e.preventDefault(); this.toggles.add('debug'); }
    if (e.code === 'F1') { e.preventDefault(); this.toggles.add('controls'); }
    if (e.code === 'KeyM' && !e.repeat) this.toggles.add('map');
    if (e.code === 'KeyH' && !e.repeat) this.toggles.add('help');
    if (e.code === 'KeyP' && !e.repeat) this.toggles.add('photo');
    if (e.code === 'KeyE' && !e.repeat) this.toggles.add('use');
    if (e.code === 'KeyK' && !e.repeat) this.toggles.add('mode');
    if (e.code === 'KeyF' && !e.repeat) this.toggles.add('action');
    if (e.code === 'KeyG' && !e.repeat) this.toggles.add('wheel');
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** eixo de movimento local (x = direita, y = frente) */
  moveAxis(): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.touchMove.x;
    y += this.touchMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchRun || Math.hypot(this.touchMove.x, this.touchMove.y) > 0.92;
  }

  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  queueJump() { this.jumpQueued = true; }
  queueToggle(name: string) { this.toggles.add(name); }

  addLook(dx: number, dy: number) { this.lookDX += dx; this.lookDY += dy; }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX * this.sensitivity, dy: this.lookDY * this.sensitivity };
    this.lookDX = this.lookDY = 0;
    return r;
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
    return this.keys.size > 0 || Math.abs(this.lookDX) + Math.abs(this.lookDY) > 2 || Math.hypot(this.touchMove.x, this.touchMove.y) > 0.1;
  }
}
