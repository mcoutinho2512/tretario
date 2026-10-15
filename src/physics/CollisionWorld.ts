/**
 * Colisão leve (sem engine de física):
 *  - paredes: segmentos 2D dos footprints com faixa de altura [bottom, top], em grade espacial;
 *  - chão: mapa de alturas rasterizado por chunk (0,5 m), com códigos de superfície.
 * Suficiente para: não atravessar edifícios, subir meio-fio, bloquear plataformas/água,
 * manter o jogador no chão e impedir a câmera de atravessar prédios.
 */
import type { ChunkData, Poly, XZ } from '../world/types';
import { CURB_HEIGHT, PLATFORM_HEIGHT } from '../world/types';

interface Seg { ax: number; az: number; bx: number; bz: number; bottom: number; top: number }

export const enum Surface { Void = 0, Road = 1, Walk = 2, Platform = 3, Water = 4 }
const SURFACE_HEIGHT = [0, 0, CURB_HEIGHT, PLATFORM_HEIGHT, -0.4];

const CELL = 16;
const HF_RES = 0.5;

interface HeightTile { minX: number; minZ: number; size: number; n: number; data: Uint8Array }

export class CollisionWorld {
  private grid = new Map<number, Seg[]>();
  private tiles = new Map<string, HeightTile>();
  private chunkSize: number;
  segmentCount = 0;

  constructor(chunkSize: number, private worldBounds: [number, number, number, number]) {
    this.chunkSize = chunkSize;
  }

  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  addPolygon(ring: XZ[], bottom: number, top: number) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      this.addSegment({ ax: a[0], az: a[1], bx: b[0], bz: b[1], bottom, top });
    }
  }

  private addSegment(s: Seg) {
    const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL), x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
    const z0 = Math.floor(Math.min(s.az, s.bz) / CELL), z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      const arr = this.grid.get(k);
      if (arr) arr.push(s); else this.grid.set(k, [s]);
    }
    this.segmentCount++;
  }

  addChunkBuildings(chunk: ChunkData) {
    for (const b of chunk.buildings) {
      if (b.canopy || b.minHeight > 2.2) continue; // marquises: passa por baixo
      this.addPolygon(b.poly.outer, b.minHeight, b.height);
      for (const h of b.poly.holes ?? []) this.addPolygon(h, b.minHeight, b.height);
    }
  }

  /** Rasteriza as superfícies do chunk num mapa de códigos (canvas 2D, 0,5 m/pixel). */
  addChunkSurfaces(chunk: ChunkData) {
    const [minX, minZ, maxX] = chunk.bounds;
    const size = maxX - minX;
    const n = Math.round(size / HF_RES);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
    const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = false;
    const k = n / size;
    const fill = (polys: Poly[], code: number) => {
      ctx.fillStyle = `rgb(${code * 50},0,0)`;
      for (const p of polys) {
        ctx.beginPath();
        for (const ring of [p.outer, ...(p.holes ?? [])]) {
          ring.forEach((q, i) => {
            const x = (q[0] - minX) * k, y = (q[1] - minZ) * k;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }
    };
    ctx.fillStyle = `rgb(${Surface.Walk * 50},0,0)`;
    ctx.fillRect(0, 0, n, n);
    const S = chunk.surfaces;
    fill(S.road, Surface.Road);
    fill(S.ballast, Surface.Road);
    fill(S.platform, Surface.Platform);
    fill(S.water, Surface.Water);
    const img = ctx.getImageData(0, 0, n, n).data;
    const data = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) data[i] = Math.round(img[i * 4] / 50);
    this.tiles.set(chunk.key, { minX, minZ, size, n, data });
  }

  hasSurfaceTile(key: string) {
    return this.tiles.has(key);
  }

  surfaceAt(x: number, z: number): Surface {
    const cx = Math.floor(x / this.chunkSize), cz = Math.floor(z / this.chunkSize);
    const t = this.tiles.get(`${cx}_${cz}`);
    if (!t) {
      const [x0, z0, x1, z1] = this.worldBounds;
      return x < x0 || x > x1 || z < z0 || z > z1 ? Surface.Void : Surface.Walk;
    }
    const ix = Math.min(t.n - 1, Math.max(0, Math.floor((x - t.minX) / HF_RES)));
    const iz = Math.min(t.n - 1, Math.max(0, Math.floor((z - t.minZ) / HF_RES)));
    return t.data[iz * t.n + ix] as Surface;
  }

  groundHeight(x: number, z: number): number {
    return SURFACE_HEIGHT[this.surfaceAt(x, z)];
  }

  isBlockedSurface(x: number, z: number): boolean {
    const s = this.surfaceAt(x, z);
    return s === Surface.Water || s === Surface.Void;
  }

  /** Empurra um círculo (jogador) para fora das paredes cuja faixa de altura intersecta [y, y+h]. */
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
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    let best = 1;
    const ix0 = Math.floor(Math.min(ax, bx) / CELL), ix1 = Math.floor(Math.max(ax, bx) / CELL);
    const iz0 = Math.floor(Math.min(az, bz) / CELL), iz1 = Math.floor(Math.max(az, bz) / CELL);
    const rx = bx - ax, rz = bz - az;
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const arr = this.grid.get(this.key(ix, iz));
      if (!arr) continue;
      for (const s of arr) {
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
