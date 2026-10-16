/**
 * Rasterização do conteúdo vetorial (src/graffiti/codec.ts) num contexto 2D — a MESMA função desenha a prévia do
 * editor e o tile do atlas (src/graffiti/GraffitiRenderer.ts). Só cliente.
 */
import { CANVAS_H, CANVAS_W, PALETTE, WIDTHS, type GraffitiContent, type GraffitiItem } from './codec';

const css = (c: number) => `#${(PALETTE[c] ?? PALETTE[0]).toString(16).padStart(6, '0')}`;
/** contorno do texto: escuro em cor clara e vice-versa (legível em qualquer parede) */
const outline = (c: number) => {
  const v = PALETTE[c] ?? 0;
  const l = 0.3 * ((v >> 16) & 255) + 0.59 * ((v >> 8) & 255) + 0.11 * (v & 255);
  return l > 140 ? 'rgba(17,17,17,0.85)' : 'rgba(244,241,234,0.85)';
};

/** símbolos em espaço unitário (−1..1, y para baixo); `stroke` = desenhado só com contorno */
const SYMBOL_PATHS: { path: () => Path2D; stroke?: boolean }[] = [
  { path: () => new Path2D('M0 0.9 C-0.2 0.7 -1 0.25 -1 -0.3 C-1 -0.75 -0.65 -0.95 -0.4 -0.95 C-0.2 -0.95 -0.05 -0.82 0 -0.62 C0.05 -0.82 0.2 -0.95 0.4 -0.95 C0.65 -0.95 1 -0.75 1 -0.3 C1 0.25 0.2 0.7 0 0.9 Z') },
  {
    path: () => {
      const p = new Path2D();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1;
        if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r); else p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      p.closePath();
      return p;
    },
  },
  { path: () => new Path2D('M-1 -0.25 L0.2 -0.25 L0.2 -0.7 L1 0 L0.2 0.7 L0.2 0.25 L-1 0.25 Z') },
  {
    stroke: true,
    path: () => {
      const p = new Path2D();
      p.arc(0, 0, 0.86, 0, Math.PI * 2);
      p.moveTo(0, -0.86); p.lineTo(0, 0.86);
      p.moveTo(0, 0); p.lineTo(-0.61, 0.61);
      p.moveTo(0, 0); p.lineTo(0.61, 0.61);
      return p;
    },
  },
  { stroke: true, path: () => { const p = new Path2D(); p.arc(0, 0, 0.86, 0, Math.PI * 2); return p; } },
  {
    stroke: true,
    path: () => {
      const p = new Path2D();
      p.arc(0, 0, 0.42, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; p.moveTo(Math.cos(a) * 0.62, Math.sin(a) * 0.62); p.lineTo(Math.cos(a) * 0.98, Math.sin(a) * 0.98); }
      return p;
    },
  },
];
let paths: Path2D[] | null = null;

/** fonte do texto (pilha comum em desktop/celular; sem baixar fonte) */
export const textFont = (px: number) => `900 ${px}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;

export function drawItem(ctx: CanvasRenderingContext2D, it: GraffitiItem) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (it.k === 'line') {
    const p = it.pts;
    ctx.strokeStyle = css(it.color);
    ctx.lineWidth = WIDTHS[it.width] ?? WIDTHS[1];
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1]); // um toque = um ponto
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  } else if (it.k === 'stamp') {
    paths ??= SYMBOL_PATHS.map((s) => s.path());
    const def = SYMBOL_PATHS[it.sym];
    if (!def) return;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate((it.rot / 256) * Math.PI * 2);
    const k = it.size / 2;
    ctx.scale(k, k);
    if (def.stroke) { ctx.strokeStyle = css(it.color); ctx.lineWidth = 0.16; ctx.stroke(paths[it.sym]); }
    else { ctx.fillStyle = css(it.color); ctx.fill(paths[it.sym]); }
    ctx.restore();
  } else {
    ctx.font = textFont(it.size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, it.size * 0.14);
    ctx.strokeStyle = outline(it.color);
    ctx.strokeText(it.text, it.x, it.y, CANVAS_W - 8);
    ctx.fillStyle = css(it.color);
    ctx.fillText(it.text, it.x, it.y, CANVAS_W - 8);
  }
}

/**
 * Desenha o grafite inteiro em (x, y) com escala `scale` (1 = 256×128 px). Recorta na área do desenho.
 * `spray` dá a borda levemente difusa do spray (barato: um único blur por tile).
 */
export function drawGraffiti(ctx: CanvasRenderingContext2D, c: Pick<GraffitiContent, 'items'>, x: number, y: number, scale: number, spray = true) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, CANVAS_W * scale, CANVAS_H * scale);
  ctx.clip();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (spray) { ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 1.5 * scale; }
  for (const it of c.items) drawItem(ctx, it);
  ctx.restore();
}
