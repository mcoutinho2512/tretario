/**
 * Paredes de colisão 2D com faixa de altura — módulo PURO (sem DOM/three), compartilhado por
 * cliente, servidor e pipeline. A MESMA função gera as paredes dos dois lados → sem divergência.
 */
import type { BuildingRec, LineRec, Poly, XZ } from '../world/types';
import { arcadeSpans } from '../world/arcades';

export interface Seg { ax: number; az: number; bx: number; bz: number; bottom: number; top: number }

function ringSegs(ring: XZ[], bottom: number, top: number, out: Seg[]): Seg[] {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    out.push({ ax: a[0], az: a[1], bx: c[0], bz: c[1], bottom, top });
  }
  return out;
}

/** Paredes de um edifício (inclui galerias: fachada só acima do teto, parede interna e colunas). */
export function buildingWalls(b: BuildingRec, out: Seg[] = []): Seg[] {
  if (b.canopy || b.minHeight > 2.2) return out; // marquises: passa por baixo
  const spans = arcadeSpans(b);
  if (!spans.length) ringSegs(b.poly.outer, b.minHeight, b.height, out);
  else {
    const ring = b.poly.outer;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const sp = spans.find((s) => (s.a === a && s.c === c) || (s.a === c && s.c === a));
      out.push({ ax: a[0], az: a[1], bx: c[0], bz: c[1], bottom: sp ? sp.height : b.minHeight, top: b.height });
    }
    for (const sp of spans) {
      out.push({ ax: sp.ai[0], az: sp.ai[1], bx: sp.ci[0], bz: sp.ci[1], bottom: 0, top: sp.height });
      out.push({ ax: sp.a[0], az: sp.a[1], bx: sp.ai[0], bz: sp.ai[1], bottom: 0, top: sp.height });
      out.push({ ax: sp.c[0], az: sp.c[1], bx: sp.ci[0], bz: sp.ci[1], bottom: 0, top: sp.height });
      for (const col of sp.columns) {
        const w = 0.3;
        ringSegs([[col[0] - w, col[1] - w], [col[0] + w, col[1] - w], [col[0] + w, col[1] + w], [col[0] - w, col[1] + w]], 0, sp.height, out);
      }
    }
  }
  for (const h of b.poly.holes ?? []) ringSegs(h, b.minHeight, b.height, out);
  return out;
}

/** Gradis e muros relevantes do OSM. */
export function barrierWalls(lines: LineRec[], out: Seg[] = []): Seg[] {
  for (const l of lines) {
    if (l.kind !== 'fence' && l.kind !== 'wall') continue;
    for (let i = 0; i < l.pts.length - 1; i++) {
      const a = l.pts[i], b = l.pts[i + 1];
      out.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], bottom: 0, top: l.kind === 'fence' ? 2.2 : 2.4 });
    }
  }
  return out;
}

/** Bordas de áreas não caminháveis (água, plataformas ferroviárias) como paredes baixas. */
export function areaEdgeWalls(polys: Poly[], top: number, out: Seg[] = []): Seg[] {
  for (const p of polys) for (const r of [p.outer, ...(p.holes ?? [])]) ringSegs(r, 0, top, out);
  return out;
}

const CELL = 16;

/** Grade espacial de segmentos: empurrar círculos e raycast. */
export class WallGrid {
  private grid = new Map<number, Seg[]>();
  segmentCount = 0;

  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  addSegment(s: Seg) {
    const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL), x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
    const z0 = Math.floor(Math.min(s.az, s.bz) / CELL), z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      const arr = this.grid.get(k);
      if (arr) arr.push(s); else this.grid.set(k, [s]);
    }
    this.segmentCount++;
  }

  addAll(segs: Seg[]) {
    for (const s of segs) this.addSegment(s);
  }

  addPolygon(ring: XZ[], bottom: number, top: number) {
    this.addAll(ringSegs(ring, bottom, top, []));
  }

  /** segmentos próximos (para ragdoll/física local) */
  near(x: number, z: number, r: number): Seg[] {
    const out = new Set<Seg>();
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++)
        for (const s of this.grid.get(this.key(ix, iz)) ?? []) out.add(s);
    return [...out];
  }

  /** Empurra um círculo para fora das paredes cuja faixa de altura intersecta [y, y+h]. */
  resolveCircle(pos: { x: number; y: number; z: number }, radius: number, height: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const ix0 = Math.floor((pos.x - radius) / CELL), ix1 = Math.floor((pos.x + radius) / CELL);
      const iz0 = Math.floor((pos.z - radius) / CELL), iz1 = Math.floor((pos.z + radius) / CELL);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const arr = this.grid.get(this.key(ix, iz));
        if (!arr) continue;
        for (const s of arr) {
          if (s.top < pos.y + 0.3 || s.bottom > pos.y + height) continue;
          const dx = s.bx - s.ax, dz = s.bz - s.az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((pos.x - s.ax) * dx + (pos.z - s.az) * dz) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = s.ax + dx * t, cz = s.az + dz * t;
          const ox = pos.x - cx, oz = pos.z - cz;
          const d = Math.hypot(ox, oz);
          if (d < radius && d > 1e-6) {
            const push = radius - d;
            pos.x += (ox / d) * push;
            pos.z += (oz / d) * push;
            moved = hit = true;
          }
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  /** Primeira interseção do segmento 3D a→b com paredes (fração 0–1), ou 1 se livre. */
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number, minTop = -Infinity): number {
    let best = 1;
    const ix0 = Math.floor(Math.min(ax, bx) / CELL), ix1 = Math.floor(Math.max(ax, bx) / CELL);
    const iz0 = Math.floor(Math.min(az, bz) / CELL), iz1 = Math.floor(Math.max(az, bz) / CELL);
    const rx = bx - ax, rz = bz - az;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const arr = this.grid.get(this.key(ix, iz));
      if (!arr) continue;
      for (const s of arr) {
        if (s.top < minTop) continue;
        const sx = s.bx - s.ax, sz = s.bz - s.az;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const qx = s.ax - ax, qz = s.az - az;
        const t = (qx * sz - qz * sx) / den;
        const u = (qx * rz - qz * rx) / den;
        if (t < 0 || t > best || u < 0 || u > 1) continue;
        const y = ay + (by - ay) * t;
        if (y >= s.bottom - 0.2 && y <= s.top + 0.3) best = t;
      }
    }
    return best;
  }
}

/** Formato binário compacto: Float32 [ax, az, bx, bz, bottom, top] por segmento. */
export function encodeSegments(segs: Seg[]): Float32Array {
  const f = new Float32Array(segs.length * 6);
  segs.forEach((s, i) => f.set([s.ax, s.az, s.bx, s.bz, s.bottom, s.top], i * 6));
  return f;
}
export function decodeSegments(f: Float32Array): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < f.length; i += 6) out.push({ ax: f[i], az: f[i + 1], bx: f[i + 2], bz: f[i + 3], bottom: f[i + 4], top: f[i + 5] });
  return out;
}
