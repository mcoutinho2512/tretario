/**
 * Rodada 12 — chão do mundo NO SERVIDOR (veículo pessoal): pista × calçada × bloqueado, e objetos do chão, a partir
 * dos MESMOS chunks do cliente (public/world/chunk_*.json). O cliente rasteriza as superfícies (CollisionWorld); aqui
 * é ponto-em-polígono (par-ímpar, com furos) sobre uma grade de baldes — só é consultado ao pedir um veículo, então
 * nada por tick. Mesma precedência do cliente: água/plataforma/brita > prédio (base < 2,2 m, sem marquise) > pista >
 * calçada. Galerias (piso sob arcada) contam como prédio aqui — conservador para surgir veículo.
 * Carregado sob demanda (1ª chamada; a sala aquece logo depois de criada) e cacheado no processo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ChunkData, Poly, PropKind, WorldManifest } from '../../../src/world/types';
import type { SpawnSurface } from '../../../src/vehicles/personalSpawn';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');
const CELL = 16;
const enum K { Road = 1, Blocked = 2 }
interface Entry { poly: Poly; k: K; minX: number; minZ: number; maxX: number; maxZ: number }

/** raio (m) dos objetos do chão por tipo (postes finos, banco, ponto de ônibus, banca) */
const PROP_R: Record<PropKind, number> = { tree: 0.5, palm: 0.4, lamp: 0.25, bench: 0.9, bus_stop: 1.6, bus_pole: 0.2, bollard: 0.2, waste: 0.3, kiosk: 1.6, signal: 0.25 };

function inRing(ring: readonly [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const inPoly = (p: Poly, x: number, z: number) => {
  let c = inRing(p.outer as [number, number][], x, z);
  for (const h of p.holes ?? []) if (inRing(h as [number, number][], x, z)) c = !c;
  return c;
};

export class SurfaceIndex {
  private cells = new Map<number, Entry[]>();
  private objCells = new Map<number, { x: number; z: number; r: number }[]>();
  readonly stats = { polys: 0, objects: 0, loadMs: 0 };
  private key(cx: number, cz: number) { return (cx + 4096) * 8192 + (cz + 4096); }

  add(poly: Poly, k: K) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of poly.outer) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    if (!Number.isFinite(minX)) return;
    const e: Entry = { poly, k, minX, minZ, maxX, maxZ };
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      const kk = this.key(cx, cz);
      let l = this.cells.get(kk);
      if (!l) this.cells.set(kk, (l = []));
      l.push(e);
    }
    this.stats.polys++;
  }

  addObject(x: number, z: number, r: number) {
    const kk = this.key(Math.floor(x / CELL), Math.floor(z / CELL));
    let l = this.objCells.get(kk);
    if (!l) this.objCells.set(kk, (l = []));
    l.push({ x, z, r });
    this.stats.objects++;
  }

  addChunk(c: ChunkData) {
    const S = c.surfaces;
    for (const p of [...(S.water ?? []), ...(S.platform ?? []), ...(S.ballast ?? [])]) this.add(p, K.Blocked);
    for (const b of c.buildings ?? []) if (!b.canopy && b.minHeight < 2.2) this.add(b.poly, K.Blocked);
    for (const p of S.road ?? []) this.add(p, K.Road);
    for (const pr of c.props ?? []) this.addObject(pr.p[0], pr.p[1], (PROP_R[pr.k] ?? 0.3) * (pr.s ?? 1));
  }

  /** pista, calçada (qualquer outro chão dentro do mapa) ou bloqueado */
  surface(x: number, z: number): SpawnSurface {
    const l = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return 'walk';
    let road = false;
    for (const e of l) {
      if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
      if (e.k === K.Blocked) { if (inPoly(e.poly, x, z)) return 'blocked'; }
      else if (!road && inPoly(e.poly, x, z)) road = true;
    }
    return road ? 'road' : 'walk';
  }

  /** objetos do chão a ≤ r de (x, z) */
  objectsNear(x: number, z: number, r: number, out: { x: number; z: number; r: number }[] = []) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
      for (const o of this.objCells.get(this.key(cx, cz)) ?? []) if (Math.hypot(o.x - x, o.z - z) <= r + o.r) out.push(o);
    }
    return out;
  }
}

let CACHE: SurfaceIndex | null = null;
/** índice do processo (carrega os chunks do manifest na 1ª chamada) */
export function surfaceIndex(manifest: WorldManifest): SurfaceIndex {
  if (CACHE) return CACHE;
  const t0 = Date.now();
  const idx = new SurfaceIndex();
  for (const ch of manifest.chunks ?? []) {
    try { idx.addChunk(JSON.parse(readFileSync(`${PUBLIC}/world/${ch.file}`, 'utf8')) as ChunkData); } catch { /* chunk ausente: fica "calçada" (conservador para carro/moto) */ }
  }
  idx.stats.loadMs = Date.now() - t0;
  return (CACHE = idx);
}
