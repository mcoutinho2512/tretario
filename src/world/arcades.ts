/**
 * Galerias (térreo recuado com colunata, padrão dos prédios do PA da Pres. Vargas).
 * Módulo PURO (sem three.js): usado pelo cliente (malhas, colisão) e pelo servidor (colisão autoritativa).
 */
import type { BuildingRec, XZ } from './types';

function pointInRing(p: XZ, ring: XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const ARCADE_HEIGHT = 6.5;
export interface ArcadeSpan { a: XZ; c: XZ; n: XZ; ai: XZ; ci: XZ; depth: number; height: number; columns: XZ[] }

export function arcadeSpans(b: BuildingRec): ArcadeSpan[] {
  if (!b.arcadeEdges?.length || b.minHeight > 0.5) return [];
  const ring = b.poly.outer;
  const out: ArcadeSpan[] = [];
  for (const i of b.arcadeEdges) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    if (!a || !c) continue;
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 6) continue;
    let nx = dz / len, nz = -dx / len;
    const mid: XZ = [(a[0] + c[0]) / 2 + nx * 0.4, (a[1] + c[1]) / 2 + nz * 0.4];
    if (pointInRing(mid, ring)) { nx = -nx; nz = -nz; }
    // profundidade limitada pela profundidade do prédio (testa ponto interno)
    let depth = 4.2;
    while (depth > 2 && !pointInRing([(a[0] + c[0]) / 2 - nx * (depth + 1.5), (a[1] + c[1]) / 2 - nz * (depth + 1.5)], ring)) depth -= 0.5;
    if (depth <= 2) continue;
    const ux = dx / len, uz = dz / len;
    const columns: XZ[] = [];
    const nCols = Math.max(1, Math.round((len - 1.2) / 4.6));
    const step = (len - 1.2) / nCols;
    for (let k = 0; k <= nCols; k++) {
      const t = 0.6 + k * step;
      columns.push([a[0] + ux * t - nx * 0.35, a[1] + uz * t - nz * 0.35]);
    }
    out.push({ a, c, n: [nx, nz], ai: [a[0] - nx * depth, a[1] - nz * depth], ci: [c[0] - nx * depth, c[1] - nz * depth], depth, height: Math.min(ARCADE_HEIGHT, b.height * 0.5), columns });
  }
  return out;
}

