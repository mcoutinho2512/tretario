/** Geometria 2D (plano XZ) usada no pipeline. */
import type { XZ } from '../../src/world/types';

export function polygonArea(pts: XZ[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

export function centroid(pts: XZ[]): XZ {
  let x = 0, z = 0, a = 0;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    x += (pts[j][0] + pts[i][0]) * f;
    z += (pts[j][1] + pts[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of pts) { sx += p[0]; sz += p[1]; }
    return [sx / n, sz / n];
  }
  return [x / (3 * a), z / (3 * a)];
}

export function pointInPolygon(p: XZ, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distPointSeg(p: XZ, a: XZ, b: XZ): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export function distPointPolyline(p: XZ, line: XZ[]): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, distPointSeg(p, line[i], line[i + 1]));
  return d;
}

export function polylineLength(pts: XZ[]): number {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return l;
}

/** Amostra pontos a cada `step` metros ao longo da polilinha, com o ângulo local. */
export function samplePolyline(pts: XZ[], step: number, offset = 0): { p: XZ; dir: number }[] {
  const out: { p: XZ; dir: number }[] = [];
  let acc = -offset;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    let t = acc <= 0 ? -acc : step - acc;
    while (t <= len) {
      out.push({ p: [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len], dir });
      t += step;
    }
    acc = (acc + len) % step;
  }
  return out;
}

/** Douglas-Peucker */
export function simplify(pts: XZ[], tol: number): XZ[] {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPointSeg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const l = simplify(pts.slice(0, idx + 1), tol);
    const r = simplify(pts.slice(idx), tol);
    return l.slice(0, -1).concat(r);
  }
  return [pts[0], pts[pts.length - 1]];
}

/** Retângulo orientado mínimo aproximado (por arestas do fecho convexo). */
export function orientedBox(pts: XZ[]): { center: XZ; axis: number; length: number; width: number } {
  const hull = convexHull(pts);
  let best = { area: Infinity, axis: 0, cx: 0, cz: 0, l: 0, w: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      let l = maxU - minU, w = maxV - minV, axis = ang;
      if (w > l) { [l, w] = [w, l]; axis = ang + Math.PI / 2; }
      best = { area, axis, cx: cu * c - cv * s, cz: cu * s + cv * c, l, w };
    }
  }
  return { center: [best.cx, best.cz], axis: best.axis, length: best.l, width: best.w };
}

export function convexHull(points: XZ[]): XZ[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: XZ, a: XZ, b: XZ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XZ[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XZ[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Hash determinístico simples (para sementes por edifício). */
export function hash32(n: number): number {
  let x = n | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = (x >>> 16) ^ x;
  return (x >>> 0) / 4294967295;
}

/** remove ponto final duplicado (anel fechado → aberto) */
export function openRing(pts: XZ[]): XZ[] {
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) return pts.slice(0, -1);
  return pts;
}
