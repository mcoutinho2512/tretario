/** Controles de toque: joystick virtual (esquerda), arrasto de câmera (direita), pular / usar / ações / chat / correr. */
import type { InputManager } from '../input/InputManager';
import { TapTracker } from '../input/tapGesture';

export class TouchControls {
  readonly el: HTMLDivElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  private pinchDist = 0;
  private useBtn!: HTMLButtonElement;
  /** rodada 9 — confronto: SOCO / CHUTE / ESQUIVA só com contexto de confronto (zona, evento ou modo interação) */
  private combatEl: HTMLDivElement;
  /** botão CHAT (o HUD abre o painel do chat) */
  onChat?: () => void;
  onMenu?: () => void;
  /** rodada 10 — TOQUE (não arrasto) no mundo em (x, y): o InteractionSystem decide se havia objeto ali */
  onTap?: (x: number, y: number) => void;
  /** rodada 10 — toque × arrasto (src/input/tapGesture.ts) e QA */
  private taps = new TapTracker();
  readonly tapStats = { taps: 0, drags: 0 };

  constructor(private input: InputManager) {
    this.el = document.createElement('div');
    this.el.className = 'touch-layer';
    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    this.el.appendChild(this.base);
    // rodada 8: poucos botões fixos, ao alcance do polegar direito. USAR só aparece quando há algo para usar;
    // CORRER é um alternador pequeno (o joystick no fim do curso já corre); o resto fica no menu ☰ do HUD.
    const jumpBtn = this.button('PULAR', 'touch-btn jump');
    const useBtn = (this.useBtn = this.button('USAR', 'touch-btn use'));
    useBtn.hidden = true;
    useBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.queueToggle('use'); });
    const actBtn = this.button('AÇÕES', 'touch-btn actions small');
    actBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.queueToggle('wheel'); });
    const chatBtn = this.button('CHAT', 'touch-btn chat small');
    chatBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.onChat?.(); });
    const runBtn = this.button('CORRER', 'touch-btn run small');
    runBtn.setAttribute('aria-pressed', 'false');
    runBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.touchRun = !input.touchRun; runBtn.classList.toggle('on', input.touchRun); runBtn.setAttribute('aria-pressed', String(input.touchRun)); });
    jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.queueJump(); });
    // contextuais (não contam nos fixos): aparecem/somem com o contexto de confronto
    this.combatEl = document.createElement('div');
    this.combatEl.className = 'touch-combat';
    this.combatEl.hidden = true;
    for (const [label, t] of [['SOCO', 'cbt_punch'], ['CHUTE', 'cbt_kick'], ['ESQUIVA', 'cbt_dodge']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `touch-btn cbt ${t}`;
      b.textContent = label;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.queueToggle(t); });
      this.combatEl.appendChild(b);
    }
    this.el.appendChild(this.combatEl);
    this.el.addEventListener('touchstart', this.onStart, { passive: false });
    this.el.addEventListener('touchmove', this.onMove, { passive: false });
    this.el.addEventListener('touchend', this.onEnd);
    this.el.addEventListener('touchcancel', this.onEnd);
  }

  /** rodada 9: botões de confronto (só escreve no DOM quando muda) */
  setCombatVisible(v: boolean) { if (this.combatEl.hidden === v) this.combatEl.hidden = !v; }
  get combatVisible() { return !this.combatEl.hidden; }

  /** rodada 10: em veículo esconde PULAR/USAR/confronto (o SAIR grande fica no HUD do veículo) */
  setRiding(v: boolean) { if (this.el.classList.contains('riding') !== v) this.el.classList.toggle('riding', v); }

  /** USAR só quando há algo perto (o HUD liga quando a ação contextual muda) */
  setUseVisible(v: boolean) { if (this.useBtn.hidden === v) this.useBtn.hidden = !v; }

  private button(label: string, cls: string) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    this.el.appendChild(b);
    return b;
  }

  private onStart = (e: TouchEvent) => {
    e.preventDefault();
    const now = performance.now();
    if (e.touches.length >= 2) this.taps.cancelAll(); // pinça / dois dedos: nenhum vira toque
    for (const t of Array.from(e.changedTouches)) {
      if (e.touches.length < 2) this.taps.begin(t.identifier, t.clientX, t.clientY, now);
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
        // rodada 10: só gira depois de passar do limiar do toque (um toque não mexe a câmera); o 1º delta parte da
        // origem do dedo (não perde o movimento do limiar)
        const wasDrag = this.taps.isDrag(t.identifier);
        if (!this.taps.move(t.identifier, t.clientX, t.clientY)) continue;
        if (!wasDrag) this.lastLook = this.taps.origin(t.identifier) ?? this.lastLook;
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
    const now = performance.now();
    for (const t of Array.from(e.changedTouches)) {
      const g = e.type === 'touchcancel' ? (this.taps.forget(t.identifier), null) : this.taps.end(t.identifier, t.clientX, t.clientY, now);
      if (g === 'tap') { this.tapStats.taps++; this.onTap?.(t.clientX, t.clientY); }
      else if (g === 'drag') this.tapStats.drags++;
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
