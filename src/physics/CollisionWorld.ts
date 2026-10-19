/**
 * Colisão leve (sem engine de física):
 *  - paredes: segmentos 2D dos footprints com faixa de altura [bottom, top], em grade espacial;
 *  - chão: mapa de alturas rasterizado por chunk (0,5 m), com códigos de superfície.
 * Suficiente para: não atravessar edifícios, subir meio-fio, bloquear plataformas/água,
 * manter o jogador no chão e impedir a câmera de atravessar prédios.
 */
import type { ChunkData, Poly, XZ } from '../world/types';
import { arcadeSpans } from '../world/arcades';
import { WallGrid, buildingWalls, barrierWalls, type Seg } from './walls';
import { CURB_HEIGHT, PLATFORM_HEIGHT } from '../world/types';


export const enum Surface { Void = 0, Road = 1, Walk = 2, Platform = 3, Water = 4, Building = 5 }
const SURFACE_HEIGHT = [0, 0, CURB_HEIGHT, PLATFORM_HEIGHT, -0.4, CURB_HEIGHT];

const HF_RES = 0.5;

interface HeightTile { minX: number; minZ: number; size: number; n: number; data: Uint8Array }

export class CollisionWorld {
  readonly walls = new WallGrid();
  private tiles = new Map<string, HeightTile>();
  private chunkSize: number;
  get segmentCount() { return this.walls.segmentCount; }

  constructor(chunkSize: number, private worldBounds: [number, number, number, number]) {
    this.chunkSize = chunkSize;
  }

  addPolygon(ring: XZ[], bottom: number, top: number) {
    this.walls.addPolygon(ring, bottom, top);
  }

  addSegment(seg: Seg) {
    this.walls.addSegment(seg);
  }

  addChunkBuildings(chunk: ChunkData) {
    for (const b of chunk.buildings) this.walls.addAll(buildingWalls(b));
  }

  /** gradis e muros (linhas OSM barrier=fence/wall) bloqueiam a passagem */
  addChunkBarriers(chunk: ChunkData) {
    this.walls.addAll(barrierWalls(chunk.lines));
  }

  /**
   * Rasteriza as superfícies do chunk num mapa de códigos (canvas 2D, 0,5 m/pixel).
   * Cada classe é uma MÁSCARA num canal separado (limiar 50%) — imune ao antialiasing das bordas
   * (antes, valores intermediários entre "prédio" e "calçada" viravam códigos espúrios).
   */
  addChunkSurfaces(chunk: ChunkData) {
    const [minX, minZ, maxX] = chunk.bounds;
    const size = maxX - minX;
    const n = Math.round(size / HF_RES);
    const k = n / size;
    const mk = () => {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
      const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, n, n);
      ctx.globalCompositeOperation = 'lighter';
      return ctx;
    };
    const fill = (ctx: CanvasRenderingContext2D, polys: Poly[], color: string) => {
      ctx.fillStyle = color;
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
    const S = chunk.surfaces;
    // passada 1: R = pista/brita, G = plataforma, B = água
    const c1 = mk();
    fill(c1, S.road, 'rgb(255,0,0)');
    fill(c1, S.ballast, 'rgb(255,0,0)');
    fill(c1, S.platform, 'rgb(0,255,0)');
    fill(c1, S.water, 'rgb(0,0,255)');
    // passada 2: R = edifício (menos o piso das galerias)
    const c2 = mk();
    fill(c2, chunk.buildings.filter((b) => !b.canopy && b.minHeight < 2.2).map((b) => b.poly), 'rgb(255,0,0)');
    c2.globalCompositeOperation = 'source-over';
    c2.fillStyle = '#000';
    for (const b of chunk.buildings) for (const sp of arcadeSpans(b)) {
      c2.beginPath();
      for (const [i, q] of [sp.a, sp.c, sp.ci, sp.ai].entries()) {
        const x = (q[0] - minX) * k, y = (q[1] - minZ) * k;
        if (i === 0) c2.moveTo(x, y); else c2.lineTo(x, y);
      }
      c2.closePath();
      c2.fill();
    }
    const i1 = c1.getImageData(0, 0, n, n).data, i2 = c2.getImageData(0, 0, n, n).data;
    const data = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const o = i * 4;
      data[i] = i1[o + 2] > 127 ? Surface.Water
        : i1[o + 1] > 127 ? Surface.Platform
        : i2[o] > 127 ? Surface.Building
        : i1[o] > 127 ? Surface.Road
        : Surface.Walk;
    }
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

  /** pedestres NPC: só calçadas, praças, canteiros e gramados (sem pista, prédio, água ou plataforma) */
  isPedestrianWalkable(x: number, z: number): boolean {
    return this.surfaceAt(x, z) === Surface.Walk;
  }

  isRoad(x: number, z: number): boolean {
    return this.surfaceAt(x, z) === Surface.Road;
  }

  isBlockedSurface(x: number, z: number): boolean {
    const s = this.surfaceAt(x, z);
    return s === Surface.Water || s === Surface.Void;
  }

  /** Empurra um círculo (jogador) para fora das paredes cuja faixa de altura intersecta [y, y+h]. */
  resolveCircle(pos: { x: number; y: number; z: number }, radius: number, height: number): boolean {
    return this.walls.resolveCircle(pos, radius, height);
  }

  /** Primeira interseção do segmento 3D a→b com paredes (fração 0–1), ou 1 se livre. `minTop` (rodada 12): ignora
   * paredes mais baixas que isto (gradil/mureta não esconde ninguém — oclusão dos nomes só por prédio) */
  raycast(ax: number, ay: number, az: number, bx: number, by: number, bz: number, minTop?: number): number {
    return this.walls.raycast(ax, ay, az, bx, by, bz, minTop);
  }
}
