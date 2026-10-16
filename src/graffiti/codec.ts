/**
 * Conteúdo de um grafite como VETOR compacto (binário) — módulo puro, compartilhado cliente/servidor.
 * Nada de imagem na rede: cada cliente rasteriza localmente (src/graffiti/raster.ts) num tile pequeno.
 *
 * Espaço do desenho: x ∈ 0..255 (largura), y ∈ 0..127 (altura, para baixo) — mesma proporção 2:1 do retângulo.
 *
 * Formato v1 (little-endian):
 *   u8 versão · u16 s, u16 t, u16 w, u16 h (cm, retângulo na superfície) · u8 nº de itens · itens:
 *   traço   u8 0 · u8 cor<<4|espessura · u8 n · n × (u8 x, u8 y)                     3 + 2n bytes
 *   símbolo u8 1 · u8 cor<<4         · u8 símbolo · u8 x · u8 y · u8 tamanho · u8 rot  7 bytes
 *   texto   u8 2 · u8 cor<<4         · u8 x · u8 y · u8 tamanho · u8 len · UTF-8         6 + len bytes  (MODERÁVEL)
 */
import type { GraffitiRect } from './surfaces';

export const CODEC_VERSION = 1;
export const CANVAS_W = 256;
export const CANVAS_H = 128;

/** paleta fixa (índice de 4 bits) — spray de rua + verde/amarelo */
export const PALETTE = [
  0x111111, 0xf4f1ea, 0xd92b2b, 0xf7d117, 0x1f9d55, 0x1f5fd1, 0xff5fa2, 0xff8a1f, 0x7b3fc4, 0x22c7d6, 0xb8bcc2, 0x7a4a26,
] as const;
/** espessuras do traço (unidades do desenho) */
export const WIDTHS = [3, 7, 14] as const;
/** símbolos básicos (carimbos) */
export const SYMBOLS = ['coracao', 'estrela', 'seta', 'paz', 'circulo', 'sol'] as const;

export type GraffitiItem =
  | { k: 'line'; color: number; width: number; pts: number[] }
  | { k: 'stamp'; color: number; sym: number; x: number; y: number; size: number; rot: number }
  | { k: 'text'; color: number; x: number; y: number; size: number; text: string };

export interface GraffitiContent { rect: GraffitiRect; items: GraffitiItem[] }

const u8 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const cm = (m: number) => Math.max(0, Math.min(65535, Math.round(m * 100)));

export function encodeGraffiti(c: GraffitiContent): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [CODEC_VERSION];
  const p16 = (n: number) => parts.push(n & 255, (n >> 8) & 255);
  p16(cm(c.rect.s)); p16(cm(c.rect.t)); p16(cm(c.rect.w)); p16(cm(c.rect.h));
  const items = c.items.slice(0, 255);
  parts.push(items.length);
  for (const it of items) {
    const col = (it.color & 15) << 4;
    if (it.k === 'line') {
      const n = Math.min(255, it.pts.length >> 1);
      parts.push(0, col | (it.width & 15), n);
      for (let i = 0; i < n; i++) parts.push(u8(it.pts[i * 2]), Math.min(CANVAS_H - 1, u8(it.pts[i * 2 + 1])));
    } else if (it.k === 'stamp') {
      parts.push(1, col, it.sym & 255, u8(it.x), Math.min(CANVAS_H - 1, u8(it.y)), u8(it.size), u8(it.rot));
    } else {
      const bytes = enc.encode(it.text).slice(0, 255);
      parts.push(2, col, u8(it.x), Math.min(CANVAS_H - 1, u8(it.y)), u8(it.size), bytes.length, ...bytes);
    }
  }
  return Uint8Array.from(parts);
}

/** decodifica; null se malformado (o servidor rejeita) — nunca lança */
export function decodeGraffiti(b: Uint8Array): GraffitiContent | null {
  if (!(b instanceof Uint8Array) || b.length < 10 || b[0] !== CODEC_VERSION) return null;
  const r16 = (o: number) => b[o] | (b[o + 1] << 8);
  const rect = { s: r16(1) / 100, t: r16(3) / 100, w: r16(5) / 100, h: r16(7) / 100 };
  const n = b[9];
  const items: GraffitiItem[] = [];
  const dec = new TextDecoder('utf-8', { fatal: true });
  let o = 10;
  for (let i = 0; i < n; i++) {
    if (o + 2 > b.length) return null;
    const kind = b[o], color = b[o + 1] >> 4, low = b[o + 1] & 15;
    o += 2;
    if (kind === 0) {
      if (o + 1 > b.length) return null;
      const np = b[o++];
      if (o + np * 2 > b.length) return null;
      items.push({ k: 'line', color, width: low, pts: Array.from(b.subarray(o, o + np * 2)) });
      o += np * 2;
    } else if (kind === 1) {
      if (o + 5 > b.length) return null;
      items.push({ k: 'stamp', color, sym: b[o], x: b[o + 1], y: b[o + 2], size: b[o + 3], rot: b[o + 4] });
      o += 5;
    } else if (kind === 2) {
      if (o + 4 > b.length) return null;
      const len = b[o + 3];
      if (o + 4 + len > b.length) return null;
      let text: string;
      try { text = dec.decode(b.subarray(o + 4, o + 4 + len)); } catch { return null; }
      items.push({ k: 'text', color, x: b[o], y: b[o + 1], size: b[o + 2], text });
      o += 4 + len;
    } else return null;
  }
  if (o !== b.length) return null; // sobra = lixo
  return { rect, items };
}

/** simplificação de traço (Douglas-Peucker + distância mínima): menos bytes, mesma forma no tile 256×128 */
export function simplifyStroke(pts: number[], tol = 1.2): number[] {
  if (pts.length <= 4) return pts.slice();
  const n = pts.length >> 1;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, c] = stack.pop()!;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], cx = pts[c * 2], cy = pts[c * 2 + 1];
    const dx = cx - ax, dy = cy - ay, l = Math.hypot(dx, dy);
    let best = -1, bd = tol;
    for (let i = a + 1; i < c; i++) {
      // traço fechado (pontas coincidem): distância ao ponto, senão o círculo inteiro sumiria
      const d = l < 1e-6 ? Math.hypot(pts[i * 2] - ax, pts[i * 2 + 1] - ay) : Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / l;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, c]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(Math.round(pts[i * 2]), Math.round(pts[i * 2 + 1]));
  return out;
}
