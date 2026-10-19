/**
 * HUD de confronto (rodada 9) — discreto e auto-ocultável: condição, fôlego (stamina), item de confronto na mão e
 * estado da zona. Só aparece quando importa (em confronto há pouco, valores abaixo do máximo, ou ao entrar numa zona
 * de combate) e some sozinho. Montado pelo HudShell (`mountCombat`). Sem DOM por quadro: `set()` é chamado a ≤ 10 Hz
 * e só escreve o que mudou (TextSlot/setClass; barras por transform só na troca).
 */
import './combat.css';
import { TextSlot, setClass } from '../ui/hud/throttle';

export interface CombatHudState {
  stamina: number; staminaMax: number;
  condition: number; conditionMax: number;
  /** rótulo do item de confronto na mão ('' = nenhum) */
  item: string;
  /** texto da região ('ZONA DE CONFRONTO', 'ÁREA DE TREINO', 'DISPUTA') e se o confronto vale aqui (rodada 12: não há zona de paz) */
  zone: string; combatZone: boolean;
  protectedFx: boolean;
  /** mostrar? (decidido pelo cliente de confronto) */
  visible: boolean;
}

export class CombatHud {
  readonly el: HTMLDivElement;
  private zone: TextSlot;
  private item: TextSlot;
  private zoneEl: HTMLDivElement;
  private cond: HTMLElement;
  private stam: HTMLElement;
  private last = { c: -1, s: -1 };
  private pulseTimer = 0;
  /** QA: escritas no DOM */
  writes = 0;
  /** último estado recebido (a barra de ações lê daqui o resumo de condição/fôlego — sem recalcular nada) */
  state: CombatHudState | null = null;

  constructor() {
    const div = (cls: string, parent?: HTMLElement) => { const d = document.createElement('div'); d.className = cls; parent?.appendChild(d); return d; };
    this.el = div('cbt-hud');
    this.el.setAttribute('aria-live', 'off');
    this.zoneEl = div('cbt-zone', this.el);
    this.zone = new TextSlot(this.zoneEl);
    const row = (label: string, cls: string) => { const r = div('cbt-row', this.el); const b = document.createElement('b'); b.textContent = label; r.appendChild(b); const bar = div(`cbt-bar ${cls}`, r); const i = document.createElement('i'); bar.appendChild(i); return i; };
    this.cond = row('CONDIÇÃO', 'cbt-cond');
    this.stam = row('FÔLEGO', 'cbt-stam');
    this.item = new TextSlot(div('cbt-item', this.el));
  }

  set(s: CombatHudState) {
    this.state = s;
    if (setClass(this.el, 'show', s.visible)) this.writes++;
    if (!s.visible) return;
    if (this.zone.set(s.zone)) this.writes++;
    setClass(this.zoneEl, 'combat', s.combatZone);
    setClass(this.el, 'prot', s.protectedFx);
    if (this.item.set(s.item ? `NA MÃO: ${s.item.toUpperCase()}` : '')) this.writes++;
    const c = Math.round((100 * s.condition) / Math.max(1, s.conditionMax)), st = Math.round((100 * s.stamina) / Math.max(1, s.staminaMax));
    if (c !== this.last.c) { this.last.c = c; this.cond.style.transform = `scaleX(${c / 100})`; this.writes++; }
    if (st !== this.last.s) { this.last.s = st; this.stam.style.transform = `scaleX(${st / 100})`; this.writes++; }
  }

  /** acertou alguém / foi atingido: contorno rápido */
  pulse() {
    this.el.classList.add('hitpulse');
    clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => this.el.classList.remove('hitpulse'), 160);
  }

  get shown() { return this.el.classList.contains('show'); }
}
