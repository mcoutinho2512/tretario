/**
 * Rodada 10 — HUD contextual de VEÍCULO (docs/HUD.md): em carro/moto/bicicleta/patinete/carro de som/trio mostra só
 * a velocidade e SAIR. No toque, SAIR é um botão grande no lugar do PULAR (TouchControls.setRiding esconde PULAR,
 * USAR e confronto); o joystick já é acelerar (↑), frear/ré (↓) e virar (←/→); CORRER = mais rápido.
 * Custo: `set` a ≤ 5 Hz (RateGate) e só escreve quando o texto muda.
 */
import { RateGate, TextSlot } from './throttle';

export class VehicleHud {
  readonly el: HTMLDivElement;
  private speed: HTMLDivElement;
  private speedText: TextSlot;
  private hint: HTMLDivElement;
  private exitBtn: HTMLButtonElement;
  private gate = new RateGate(5);
  private kind = '';

  constructor(private touch: boolean, onExit: () => void) {
    const el = (this.el = document.createElement('div'));
    el.className = 'veh-hud';
    el.hidden = true;
    this.speed = document.createElement('div');
    this.speed.className = 'veh-speed';
    this.speed.setAttribute('aria-live', 'off');
    this.speedText = new TextSlot(this.speed);
    const b = (this.exitBtn = document.createElement('button'));
    b.type = 'button';
    b.className = 'veh-exit';
    b.textContent = 'SAIR';
    b.setAttribute('aria-label', 'Sair do veículo');
    if (!touch) b.title = 'Sair do veículo (tecla E)'; // rodada 11 — entrada
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onExit(); b.blur(); });
    // no toque, touchstart: resposta imediata (sem atraso do clique) e sem virar arrasto de câmera
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); onExit(); }, { passive: false });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.hint = document.createElement('div');
    this.hint.className = 'veh-hint';
    // desktop: a ação contextual do HUD já mostra as teclas do veículo (RIDE_HELP); toque: a dica do joystick
    this.hint.textContent = 'joystick ↑ acelera · ↓ freia/ré · ←→ vira';
    el.append(this.speed, b);
    if (touch) el.append(this.hint);
  }

  /** veículo em uso (rótulo, tipo, saída) e velocidade (m/s); null = a pé */
  set(v: { label: string; kind: string; exitLabel: string } | null, speedMs: number, now = performance.now()) {
    if (!v) { if (!this.el.hidden) { this.el.hidden = true; this.kind = ''; } return; }
    if (this.kind !== v.kind) {
      this.kind = v.kind;
      this.exitBtn.textContent = v.exitLabel.toUpperCase();
      this.el.hidden = false;
      this.gate.poke();
    }
    if (!this.gate.due(now)) return;
    this.speedText.set(`${v.label.toUpperCase()} · ${Math.round(Math.abs(speedMs) * 3.6)} km/h`);
  }

  get info() { return { shown: !this.el.hidden, text: this.speedText.value, exit: this.exitBtn.textContent, touch: this.touch }; }
}
