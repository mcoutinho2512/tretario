/**
 * Rodada 11 — mouse no desktop SEM pointer lock (docs/DESKTOP_CONTROLS.md). Lógica PURA (sem DOM; tests/desktopInput.test.ts):
 *
 *  - botão ESQUERDO: solto sem passar do limiar (CLICK_SLOP_PX e CLICK_MAX_MS) = CLIQUE → seleciona/interage
 *    (InteractionSystem.pointAt). Passou do limiar = ARRASTO → gira a câmera (alternativa para trackpad) e NÃO clica:
 *    arrastar por cima de um jogador não abre o painel dele.
 *  - botão DIREITO: segurou e arrastou = gira a câmera (o cursor continua visível); solto, volta a interagir na hora.
 *    Clique curto do direito não faz nada (sem menu contextual: a prioridade é a câmera).
 *  - o mundo só recebe eventos cujo alvo é o próprio canvas (`isWorldTarget`): HUD, painéis, inventário, chat e
 *    ajustes consomem o clique/roda antes do mundo.
 */
import { CLICK_MAX_MS, CLICK_SLOP_PX } from './keymap';

export type MouseRelease = 'click' | 'drag' | 'none';

interface Press { button: number; x: number; y: number; t: number; lx: number; ly: number; dragging: boolean }

/** botões tratados: 0 = esquerdo, 2 = direito */
export class MouseGesture {
  private press: Press | null = null;
  /** deltas de olhar acumulados (px) */
  lookX = 0;
  lookY = 0;
  /** instante (ms) em que o último arrasto de câmera terminou (a câmera de veículo volta ~1 s depois) */
  lastLookEnd = -Infinity;

  constructor(private slopPx = CLICK_SLOP_PX, private maxMs = CLICK_MAX_MS) {}

  /** algum botão pressionado sobre o mundo */
  get active() { return !!this.press; }
  /** girando a câmera agora (direito pressionado, ou esquerdo já virou arrasto) */
  get looking() { return !!this.press && (this.press.button === 2 || this.press.dragging); }
  get button() { return this.press?.button ?? -1; }

  down(button: number, x: number, y: number, t: number): boolean {
    if (button !== 0 && button !== 2) return false;
    if (this.press) return false; // segundo botão durante um gesto: ignora (o primeiro manda)
    this.press = { button, x, y, t, lx: x, ly: y, dragging: false };
    return true;
  }

  /** movimento com o botão pressionado; devolve se girou a câmera neste movimento */
  move(x: number, y: number): boolean {
    const p = this.press;
    if (!p) return false;
    if (!p.dragging && Math.hypot(x - p.x, y - p.y) > this.slopPx) p.dragging = true;
    const dx = x - p.lx, dy = y - p.ly;
    p.lx = x; p.ly = y;
    // direito gira desde o 1º pixel (resposta imediata); esquerdo só depois de virar arrasto
    if (p.button === 2 || p.dragging) { this.lookX += dx; this.lookY += dy; return dx !== 0 || dy !== 0; }
    return false;
  }

  /** soltou o botão: 'click' (esquerdo dentro do limiar), 'drag' (girou) ou 'none' (outro botão / direito curto) */
  up(button: number, x: number, y: number, t: number): MouseRelease {
    const p = this.press;
    if (!p || p.button !== button) return 'none';
    this.move(x, y);
    this.press = null;
    const drag = p.dragging || Math.hypot(x - p.x, y - p.y) > this.slopPx;
    if (drag || p.button === 2) this.lastLookEnd = t;
    if (drag) return 'drag';
    if (p.button === 2) return 'none';
    return t - p.t <= this.maxMs ? 'click' : 'none';
  }

  /** perdeu o foco / o ponteiro saiu: encerra sem clicar */
  cancel(t: number) {
    if (this.press && (this.press.button === 2 || this.press.dragging)) this.lastLookEnd = t;
    this.press = null;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = this.lookY = 0;
    return r;
  }
}

/** regra "UI consome antes do mundo": só o canvas do jogo é alvo do mundo (clique, roda, botão direito) */
export function isWorldTarget(target: EventTarget | null, canvas: EventTarget): boolean {
  return !!target && target === canvas;
}
