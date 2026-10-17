/**
 * Modo de desenho (DOM): traço livre, paleta, espessuras, símbolos e texto curto. Funciona com mouse e toque
 * (pointer events), fecha com Esc ou ✕. O desenho é LOCAL até "PICHAR": só então vira um gf_new (vetor compacto).
 */
import './graffiti.css';
import { CANVAS_H, CANVAS_W, PALETTE, SYMBOLS, encodeGraffiti, simplifyStroke, type GraffitiItem } from './codec';
import { drawGraffiti, drawItem } from './raster';
import { GF_RULES } from './rules';
import { checkText, MAX_TEXT_CHARS } from '../moderation/basicFilter';
import { GRAFFITI_SIZES } from './surfaces';

type Tool = 'trace' | 'stamp' | 'text';
const SYMBOL_LABEL: Record<(typeof SYMBOLS)[number], string> = { coracao: '♥', estrela: '★', seta: '➜', paz: '☮', circulo: '○', sol: '☀' };
const STAMP_SIZE = [26, 42, 62];
const TEXT_SIZE = [18, 28, 40];
const TEXT_REASON: Record<string, string> = { vazio: 'Escreva algo', longo: `Máximo ${MAX_TEXT_CHARS} caracteres`, bloqueado: 'Texto não permitido (palavrão/ódio)', spam: 'Sem links ou telefones', caracteres: 'Caracteres não permitidos' };
/** densidade da prévia (2× o tile) */
const PX = 2;

export interface EditorResult { items: GraffitiItem[]; size: number }

export class GraffitiEditor {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private msg: HTMLDivElement;
  private title: HTMLElement;
  private meter: HTMLElement;
  private textIn: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private items: GraffitiItem[] = [];
  private stroke: number[] | null = null;
  private tool: Tool = 'trace';
  private color = 1;
  private width = 1;
  private sym = 0;
  private size = 1;
  private busy = false;
  isOpen = false;
  onSubmit: ((r: EditorResult) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'gf-editor';
    this.el.innerHTML = `
      <div class="gf-panel" role="dialog" aria-label="Pichar">
        <div class="gf-head"><b class="gf-title">PICHAR</b><small class="gf-meter"></small><button class="gf-close" aria-label="Fechar">✕</button></div>
        <canvas class="gf-canvas" width="${CANVAS_W * PX}" height="${CANVAS_H * PX}"></canvas>
        <div class="gf-row gf-colors"><span class="lbl">Cor</span></div>
        <div class="gf-row"><span class="lbl">Ferram.</span>
          <button class="gf-btn" data-tool="trace">Traço</button><button class="gf-btn" data-tool="stamp">Símbolo</button><button class="gf-btn" data-tool="text">Texto</button>
          <span class="lbl" style="margin-left:8px">Espess.</span>
          <button class="gf-btn" data-w="0">fina</button><button class="gf-btn" data-w="1">média</button><button class="gf-btn" data-w="2">grossa</button>
        </div>
        <div class="gf-row gf-syms"><span class="lbl">Símbolo</span></div>
        <div class="gf-row gf-textrow"><span class="lbl">Texto</span><input class="gf-text" maxlength="${MAX_TEXT_CHARS}" placeholder="até ${MAX_TEXT_CHARS} letras — toque no desenho para colocar" /></div>
        <div class="gf-row"><span class="lbl">Tamanho</span>
          <button class="gf-btn" data-size="0">P</button><button class="gf-btn" data-size="1">M</button><button class="gf-btn" data-size="2">G</button>
          <button class="gf-btn" data-act="undo">Desfazer</button><button class="gf-btn" data-act="clear">Limpar</button>
          <button class="gf-btn gf-send" data-act="send">PICHAR</button>
        </div>
        <div class="gf-msg"></div>
      </div>`;
    root.appendChild(this.el);
    const q = <T extends Element>(s: string) => this.el.querySelector(s) as T;
    this.canvas = q('.gf-canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.msg = q('.gf-msg');
    this.title = q('.gf-title');
    this.meter = q('.gf-meter');
    this.textIn = q('.gf-text');
    this.sendBtn = q('[data-act="send"]');
    const colors = q<HTMLDivElement>('.gf-colors');
    PALETTE.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'gf-sw';
      b.dataset.color = String(i);
      b.style.background = `#${c.toString(16).padStart(6, '0')}`;
      b.setAttribute('aria-label', `cor ${i + 1}`);
      colors.appendChild(b);
    });
    const syms = q<HTMLDivElement>('.gf-syms');
    SYMBOLS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'gf-btn';
      b.dataset.sym = String(i);
      b.textContent = SYMBOL_LABEL[s];
      b.title = s;
      syms.appendChild(b);
    });
    this.el.addEventListener('click', this.onClick);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    // teclado: enquanto aberto, nada chega ao jogo (fase de captura na janela, antes do InputManager)
    window.addEventListener('keydown', this.onKey, true);
    this.textIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.placeText(CANVAS_W / 2, CANVAS_H / 2); e.preventDefault(); } });
    this.refresh();
  }

  open(title: string) {
    this.isOpen = true;
    this.busy = false;
    this.items = [];
    this.stroke = null;
    this.title.textContent = title;
    this.setStatus('Desenhe com o dedo ou o mouse. Nada é enviado até você tocar em PICHAR.');
    this.el.classList.add('open');
    if (document.pointerLockElement) document.exitPointerLock();
    this.refresh();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    this.textIn.blur();
    this.onClose?.();
  }

  /** resposta do servidor: fecha no sucesso; na recusa mantém o desenho para corrigir */
  setBusy(b: boolean) { this.busy = b; this.refresh(); }
  setStatus(m: string, err = false) { this.msg.textContent = m; this.msg.classList.toggle('err', err); }

  /** QA/automação: itens atuais */
  get draft(): readonly GraffitiItem[] { return this.items; }

  private onKey = (e: KeyboardEvent) => {
    if (!this.isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    e.stopPropagation();
  };

  private onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (t.classList.contains('gf-close')) return this.close();
    if (d.color) this.color = Number(d.color);
    if (d.tool) this.tool = d.tool as Tool;
    if (d.w) this.width = Number(d.w);
    if (d.sym) { this.sym = Number(d.sym); this.tool = 'stamp'; }
    if (d.size) this.size = Number(d.size);
    if (d.act === 'undo') this.items.pop();
    if (d.act === 'clear') this.items = [];
    if (d.act === 'send') this.submit();
    this.refresh();
  };

  private toLocal(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [Math.max(0, Math.min(CANVAS_W - 1, ((e.clientX - r.left) / r.width) * CANVAS_W)), Math.max(0, Math.min(CANVAS_H - 1, ((e.clientY - r.top) / r.height) * CANVAS_H))];
  }

  private onDown = (e: PointerEvent) => {
    if (this.busy) return;
    e.preventDefault();
    const [x, y] = this.toLocal(e);
    if (this.tool === 'trace') {
      if (!this.room(2)) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.stroke = [x, y];
    } else if (this.tool === 'stamp') {
      if (!this.room(4)) return;
      this.items.push({ k: 'stamp', color: this.color, sym: this.sym, x, y, size: STAMP_SIZE[this.width], rot: 0 });
    } else this.placeText(x, y);
    this.refresh();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.stroke) return;
    const [x, y] = this.toLocal(e);
    const n = this.stroke.length;
    if (Math.hypot(x - this.stroke[n - 2], y - this.stroke[n - 1]) < 1.5) return;
    this.stroke.push(x, y);
    // traço longo vira vários (no máximo 255 pontos por traço no formato)
    if (this.stroke.length >= 400) { this.commitStroke(); this.stroke = [x, y]; }
    this.draw();
  };

  private onUp = () => { if (this.stroke) { this.commitStroke(); this.stroke = null; this.refresh(); } };

  private commitStroke() {
    const s = this.stroke!;
    const pts = simplifyStroke(s.map((v) => Math.round(v)));
    if (this.room(pts.length / 2)) this.items.push({ k: 'line', color: this.color, width: this.width, pts });
  }

  private placeText(x: number, y: number) {
    const v = checkText(this.textIn.value);
    if (!v.ok) { this.setStatus(TEXT_REASON[v.reason] ?? 'Texto inválido', true); return; }
    if (this.items.filter((i) => i.k === 'text').length >= GF_RULES.maxTexts) { this.setStatus(`No máximo ${GF_RULES.maxTexts} textos`, true); return; }
    if (!this.room(4)) return;
    this.items.push({ k: 'text', color: this.color, x, y, size: TEXT_SIZE[this.width], text: v.text });
    this.textIn.value = '';
    this.setStatus('');
    this.refresh();
  }

  /** cabe mais `pts` pontos sem passar dos limites? */
  private room(pts: number) {
    const used = this.items.reduce((n, i) => n + (i.k === 'line' ? i.pts.length / 2 : 4), 0);
    if (this.items.length >= GF_RULES.maxItems || used + pts > GF_RULES.maxPoints || this.bytes() > GF_RULES.maxBytes - 64) {
      this.setStatus('Limite do desenho atingido — envie ou desfaça algo', true);
      return false;
    }
    return true;
  }

  private bytes() { return encodeGraffiti({ rect: { s: 0, t: 0, w: 1, h: 0.5 }, items: this.items }).length; }

  private submit() {
    if (this.busy || !this.items.length) { if (!this.items.length) this.setStatus('Desenhe algo primeiro', true); return; }
    this.onSubmit?.({ items: this.items.slice(), size: GRAFFITI_SIZES[this.size] });
  }

  private refresh() {
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-color]')) b.classList.toggle('on', Number(b.dataset.color) === this.color);
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-tool]')) b.classList.toggle('on', b.dataset.tool === this.tool);
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-w]')) b.classList.toggle('on', Number(b.dataset.w) === this.width);
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-sym]')) b.classList.toggle('on', this.tool === 'stamp' && Number(b.dataset.sym) === this.sym);
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-size]')) b.classList.toggle('on', Number(b.dataset.size) === this.size);
    (this.el.querySelector('.gf-syms') as HTMLElement).style.display = this.tool === 'stamp' ? '' : 'none';
    (this.el.querySelector('.gf-textrow') as HTMLElement).style.display = this.tool === 'text' ? '' : 'none';
    this.sendBtn.disabled = this.busy || !this.items.length;
    this.sendBtn.textContent = this.busy ? 'Enviando…' : 'PICHAR';
    this.meter.textContent = `${GRAFFITI_SIZES[this.size].toFixed(1)} × ${(GRAFFITI_SIZES[this.size] / 2).toFixed(1)} m · ${this.bytes()} / ${GF_RULES.maxBytes} B`;
    this.draw();
  }

  private draw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    drawGraffiti(c, { items: this.items }, 0, 0, PX);
    if (this.stroke && this.stroke.length >= 2) {
      c.save(); c.scale(PX, PX);
      drawItem(c, { k: 'line', color: this.color, width: this.width, pts: this.stroke });
      c.restore();
    }
  }
}
