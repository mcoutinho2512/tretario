/** Controles de toque: joystick virtual (esquerda), arrasto de câmera (direita), botões correr/pular. */
import type { InputManager } from '../input/InputManager';

export class TouchControls {
  readonly el: HTMLDivElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private pinchDist = 0;

  constructor(private input: InputManager) {
    this.el = document.createElement('div');
    this.el.className = 'touch-layer';
    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    this.el.appendChild(this.base);
    const runBtn = this.button('CORRER', 'touch-btn run');
    const jumpBtn = this.button('PULAR', 'touch-btn jump');
    const useBtn = this.button('USAR', 'touch-btn use');
    useBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.queueToggle('use'); });
    const actBtn = this.button('AÇÕES', 'touch-btn actions');
    actBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.queueToggle('wheel'); });
    runBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.touchRun = !input.touchRun; runBtn.classList.toggle('on', input.touchRun); });
    jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); input.queueJump(); });
    this.el.addEventListener('touchstart', this.onStart, { passive: false });
    this.el.addEventListener('touchmove', this.onMove, { passive: false });
    this.el.addEventListener('touchend', this.onEnd);
    this.el.addEventListener('touchcancel', this.onEnd);
  }

  private button(label: string, cls: string) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    this.el.appendChild(b);
    return b;
  }

  private onStart = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickCenter = { x: t.clientX, y: t.clientY };
        this.base.style.left = `${t.clientX - 60}px`;
        this.base.style.top = `${t.clientY - 60}px`;
        this.base.classList.add('active');
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lastLook = { x: t.clientX, y: t.clientY };
      }
    }
    if (e.touches.length === 2 && this.stickId === null) {
      this.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  };

  private onMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        let dx = (t.clientX - this.stickCenter.x) / 55, dy = (t.clientY - this.stickCenter.y) / 55;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.input.touchMove.x = dx;
        this.input.touchMove.y = -dy;
        this.knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      } else if (t.identifier === this.lookId) {
        this.input.addLook((t.clientX - this.lastLook.x) * 1.6, (t.clientY - this.lastLook.y) * 1.6);
        this.lastLook = { x: t.clientX, y: t.clientY };
      }
    }
    if (e.touches.length === 2 && this.stickId === null && this.pinchDist > 0) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      this.input.addZoom((this.pinchDist - d) * 0.006);
      this.pinchDist = d;
    }
  };

  private onEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.input.touchMove.x = this.input.touchMove.y = 0;
        this.knob.style.transform = '';
        this.base.classList.remove('active');
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
      }
    }
    if (e.touches.length < 2) this.pinchDist = 0;
  };
}
