import { isTypingTarget } from './keymap'; // rodada 11 — inventário (o AGENTE A integra no keymap)
import { escTop, handleEsc } from '../ui/escStack'; // rodada 11 — inventário (o AGENTE A integra no keymap)

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
  /** rodada 10 — interação (InteractionSystem.pointAt): clique em (x, y) da tela; true = consumido */
  pointFilter: ((x: number, y: number, locked: boolean) => boolean) | null = null;
  sensitivity = 0.0024;

  constructor(private canvas: HTMLCanvasElement, isTouch: boolean) {
    this.isTouch = isTouch;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('click', (e) => {
      if (this.isTouch || this.pointerLocked) return;
      // rodada 10 — interação: clique (mouse solto) num objeto interage em vez de capturar o mouse
      if (this.pointFilter?.(e.clientX, e.clientY, false)) return;
      this.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    // rodada 9 — confronto: mouse esquerdo = soco (só com o mouse capturado: o 1º clique só captura), direito = chute
    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked || this.isTouch) return;
      // rodada 10 — mouse capturado: mira no centro da tela; veículo/item ao alcance ali = interação (não soco)
      if (e.button === 0 && this.pointFilter) {
        const r = canvas.getBoundingClientRect();
        if (this.pointFilter(r.left + r.width / 2, r.top + r.height / 2, true)) return;
      }
      if (e.button === 0) this.toggles.add('cbt_punch');
      else if (e.button === 2) this.toggles.add('cbt_kick');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    // digitando num campo (chat, apelido…): a tecla é do campo, não do jogo
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // rodada 11 — inventário (o AGENTE A integra no keymap): I abre/fecha; 1–5 acesso rápido; Esc fecha o painel do
    // topo da pilha única (src/ui/escStack.ts) quando há um — sem pilha, o comportamento antigo segue igual
    if (!isTypingTarget(e.target) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'KeyI') this.toggles.add('inventory');
      const q = /^Digit([1-5])$/.exec(e.code);
      if (q) this.toggles.add(`quick_${q[1]}`);
      if (e.code === 'Escape' && escTop()) handleEsc();
    }
    if (this.moveBlocked && /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right))$/.test(e.code)) return; // rodada 11 — inventário aberto: personagem parado
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
    // rodada 9 — confronto (docs/COMBAT.md): R soco (sem mouse) · Q chute · C esquiva; F continua empurrão
    if (e.code === 'KeyR' && !e.repeat) this.toggles.add('cbt_punch');
    if (e.code === 'KeyQ' && !e.repeat) this.toggles.add('cbt_kick');
    if (e.code === 'KeyC' && !e.repeat) this.toggles.add('cbt_dodge');
    // rodada 9: itens de confronto — T pegar/trocar, Z largar, X guardar/sacar
    if (e.code === 'KeyT' && !e.repeat) this.toggles.add('item');
    if (e.code === 'KeyZ' && !e.repeat) this.toggles.add('drop');
    if (e.code === 'KeyX' && !e.repeat) this.toggles.add('stow');
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** rodada 11 — inventário aberto: teclas de andar/correr/pular não movem o personagem (o mundo não pausa) */
  moveBlocked = false;
  setMoveBlocked(on: boolean) { this.moveBlocked = on; if (on) { for (const k of [...this.keys]) if (/^(Key[WASD]|Arrow|Shift)/.test(k)) this.keys.delete(k); this.jumpQueued = false; } }

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
  /** solta tudo que estava pressionado (o chat abriu: W segurado não continua andando) */
  releaseAll() { this.keys.clear(); this.jumpQueued = false; this.touchMove.x = this.touchMove.y = 0; }
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
