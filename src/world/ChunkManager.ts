/**
 * Streaming de chunks + LOD.
 *
 *  FULL   (< lod[0]): edifícios completos (volumes de cobertura), chão detalhado, sinalização, mobiliário
 *  MEDIUM (< lod[1]): edifícios completos, chão, árvores simplificadas, sem sinalização/mobiliário
 *  FAR    (< lod[2]): só edifícios ≥ 12 m (silhueta) + chão
 *  fora   (≥ lod[2]): oculto (geometria descartada após margem)
 *
 * Histerese de 12% evita "pipocar" na fronteira. Construção de malhas tem orçamento por frame.
 */
import * as THREE from 'three';
import type { ChunkData, WorldManifest, PropRec, BuildingRec } from './types';
import { buildBuildingsGeometry } from './builders/buildings';
import { buildGroundMeshes } from './builders/ground';
import type { MaterialLibrary } from '../renderer/materials';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { PropSystem } from './builders/props';
import type { QualityPreset } from '../core/settings';

export type LodLevel = 0 | 1 | 2 | 3; // 0 FULL, 1 MEDIUM, 2 FAR, 3 hidden

interface ChunkRuntime {
  meta: WorldManifest['chunks'][number];
  data: ChunkData | null;
  loading: boolean;
  lod: LodLevel;
  center: THREE.Vector2;
  ground?: THREE.Group;
  groundDetailed?: boolean;
  markings?: THREE.Group;
  buildings?: THREE.Mesh;
  buildingsFar?: THREE.Mesh;
}

export class ChunkManager {
  readonly group = new THREE.Group();
  private chunks = new Map<string, ChunkRuntime>();
  private buildQueue: string[] = [];
  private propsDirty = true;
  private lastPropsCenter = new THREE.Vector2(1e9, 1e9);
  stats = { visible: 0, full: 0, medium: 0, far: 0, loaded: 0 };
  /** chamado uma vez por edifício com modelo dedicado quando seu chunk é carregado (após a carga inicial) */
  onModelBuilding: ((b: BuildingRec) => void) | null = null;
  private modelsSeen = new Set<number>();

  constructor(
    private manifest: WorldManifest,
    private baseUrl: string,
    private lib: MaterialLibrary,
    private buildingMat: THREE.Material,
    private collision: CollisionWorld,
    private props: PropSystem,
    private preset: QualityPreset,
  ) {
    this.group.name = 'world_chunks';
    for (const c of manifest.chunks) {
      const s = manifest.chunkSize;
      this.chunks.set(c.key, {
        meta: c, data: null, loading: false, lod: 3,
        center: new THREE.Vector2((c.cx + 0.5) * s, (c.cz + 0.5) * s),
      });
    }
  }

  setPreset(p: QualityPreset) {
    this.preset = p;
    this.propsDirty = true;
  }

  /** Baixa dados dos chunks em ordem de distância (com progresso). */
  async preload(from: THREE.Vector2, maxDist: number, onProgress: (done: number, total: number) => void) {
    const list = [...this.chunks.values()]
      .map((c) => ({ c, d: this.chunkDistance(c, from) }))
      .filter((x) => x.d <= maxDist)
      .sort((a, b) => a.d - b.d);
    let done = 0;
    const total = list.length;
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        const { c } = queue.shift()!;
        await this.load(c);
        done++;
        onProgress(done, total);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  private async load(c: ChunkRuntime) {
    if (c.data || c.loading) return;
    c.loading = true;
    const res = await fetch(`${this.baseUrl}${c.meta.file}`);
    if (!res.ok) throw new Error(`falha ao carregar chunk ${c.meta.key}: ${res.status}`);
    c.data = (await res.json()) as ChunkData;
    c.loading = false;
    this.collision.addChunkBuildings(c.data);
    this.collision.addChunkSurfaces(c.data);
    this.collision.addChunkBarriers(c.data);
    this.stats.loaded++;
    if (this.onModelBuilding) for (const b of c.data.buildings) if (b.model && !this.modelsSeen.has(b.id)) { this.modelsSeen.add(b.id); this.onModelBuilding(b); }
  }

  chunkDistance(c: ChunkRuntime, p: THREE.Vector2): number {
    const s = this.manifest.chunkSize;
    const minX = c.meta.cx * s, minZ = c.meta.cz * s;
    const dx = Math.max(minX - p.x, 0, p.x - (minX + s));
    const dz = Math.max(minZ - p.y, 0, p.y - (minZ + s));
    return Math.hypot(dx, dz);
  }

  chunkKeyAt(x: number, z: number): string {
    const s = this.manifest.chunkSize;
    return `${Math.floor(x / s)}_${Math.floor(z / s)}`;
  }

  /** Atualiza níveis de LOD e constrói/descarta malhas dentro do orçamento (ms). */
  update(cameraXZ: THREE.Vector2, budgetMs = 6) {
    const [d0, d1, d2] = this.preset.lodDistances;
    const hyst = 1.12;
    for (const c of this.chunks.values()) {
      const d = this.chunkDistance(c, cameraXZ);
      let target: LodLevel = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : 3;
      // histerese: só piora o LOD se passou da fronteira com margem
      if (target > c.lod) {
        const bounds = [d0, d1, d2];
        if (d < bounds[c.lod] * hyst) target = c.lod;
      }
      if (target !== c.lod) {
        c.lod = target;
        if (!this.buildQueue.includes(c.meta.key)) this.buildQueue.push(c.meta.key);
        this.propsDirty = true;
      }
      if (!c.data && !c.loading && target < 3) void this.load(c);
    }
    // ordenar fila por distância
    this.buildQueue.sort((a, b) => this.chunkDistance(this.chunks.get(a)!, cameraXZ) - this.chunkDistance(this.chunks.get(b)!, cameraXZ));
    const t0 = performance.now();
    while (this.buildQueue.length && performance.now() - t0 < budgetMs) {
      const key = this.buildQueue[0];
      const c = this.chunks.get(key)!;
      if (!c.data) {
        // ainda baixando: tenta depois
        this.buildQueue.push(this.buildQueue.shift()!);
        if (this.buildQueue.every((k) => !this.chunks.get(k)!.data)) break;
        continue;
      }
      this.buildQueue.shift();
      this.applyLod(c);
    }
    if (this.propsDirty || cameraXZ.distanceTo(this.lastPropsCenter) > 60) this.rebuildProps(cameraXZ);
    this.computeStats();
  }

  /** Constrói tudo até que a fila esteja vazia (usado no carregamento inicial). */
  flush(cameraXZ: THREE.Vector2) {
    this.update(cameraXZ, 1e9);
  }

  get pending() {
    return this.buildQueue.length;
  }

  private applyLod(c: ChunkRuntime) {
    const data = c.data!;
    const lod = c.lod;
    // chão
    if (lod <= 2) {
      const wantDetailed = lod === 0;
      if (!c.ground || c.groundDetailed !== wantDetailed) {
        if (c.ground) this.disposeGroup(c.ground);
        if (c.markings) this.disposeGroup(c.markings);
        const g = buildGroundMeshes(data, this.lib, wantDetailed);
        c.ground = g.group;
        c.markings = g.markings;
        c.groundDetailed = wantDetailed;
        this.group.add(c.ground, c.markings);
      }
      c.ground.visible = true;
      c.markings!.visible = lod === 0;
    } else if (c.ground) {
      c.ground.visible = false;
      c.markings!.visible = false;
    }
    // edifícios
    if (lod <= 1) {
      if (!c.buildings) {
        const geo = buildBuildingsGeometry(data.buildings.filter((b) => !b.model), { roofDetails: true });
        if (geo) {
          c.buildings = new THREE.Mesh(geo, this.buildingMat);
          c.buildings.castShadow = true;
          c.buildings.receiveShadow = true;
          c.buildings.matrixAutoUpdate = false;
          c.buildings.name = `buildings_${data.key}`;
          this.group.add(c.buildings);
        }
      }
      if (c.buildings) c.buildings.visible = true;
      if (c.buildingsFar) c.buildingsFar.visible = false;
    } else if (lod === 2) {
      if (!c.buildingsFar) {
        const geo = buildBuildingsGeometry(data.buildings.filter((b) => !b.model), { roofDetails: false, minHeight: 12 });
        if (geo) {
          c.buildingsFar = new THREE.Mesh(geo, this.buildingMat);
          c.buildingsFar.castShadow = false;
          c.buildingsFar.receiveShadow = true;
          c.buildingsFar.matrixAutoUpdate = false;
          c.buildingsFar.name = `buildingsFar_${data.key}`;
          this.group.add(c.buildingsFar);
        }
      }
      if (c.buildingsFar) c.buildingsFar.visible = true;
      if (c.buildings) c.buildings.visible = false;
    } else {
      if (c.buildings) c.buildings.visible = false;
      if (c.buildingsFar) c.buildingsFar.visible = false;
    }
    // descartar geometria de chunks muito distantes para liberar memória
    if (lod === 3) {
      if (c.ground) { this.disposeGroup(c.ground); c.ground = undefined; }
      if (c.markings) { this.disposeGroup(c.markings); c.markings = undefined; }
    }
    if (lod >= 2 && c.buildings) { this.disposeMesh(c.buildings); c.buildings = undefined; }
  }

  private rebuildProps(cameraXZ: THREE.Vector2) {
    this.propsDirty = false;
    this.lastPropsCenter.copy(cameraXZ);
    const near: PropRec[] = [], far: PropRec[] = [];
    const pd = this.preset.propsDistance;
    for (const c of this.chunks.values()) {
      if (!c.data || c.lod > 1) continue;
      for (const p of c.data.props) {
        const d = Math.hypot(p.p[0] - cameraXZ.x, p.p[1] - cameraXZ.y);
        if (c.lod === 0 && d < pd) near.push(p);
        else if (p.k === 'tree' || p.k === 'palm') far.push(p);
      }
    }
    this.props.rebuild(near, far, this.preset.vegetationDensity, (x, z) => this.collision.groundHeight(x, z));
  }

  private computeStats() {
    let v = 0, f = 0, m = 0, r = 0;
    for (const c of this.chunks.values()) {
      if (c.lod < 3) v++;
      if (c.lod === 0) f++; else if (c.lod === 1) m++; else if (c.lod === 2) r++;
    }
    this.stats.visible = v; this.stats.full = f; this.stats.medium = m; this.stats.far = r;
  }

  private disposeMesh(m: THREE.Mesh) {
    m.geometry.dispose();
    m.removeFromParent();
  }

  private disposeGroup(g: THREE.Group) {
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    g.removeFromParent();
  }

  /** edifícios com modelo dedicado ainda não entregues (construídos uma vez pelo jogo) */
  modelBuildings(): BuildingRec[] {
    const out: BuildingRec[] = [];
    for (const c of this.chunks.values()) if (c.data) for (const b of c.data.buildings) if (b.model && !this.modelsSeen.has(b.id)) { this.modelsSeen.add(b.id); out.push(b); }
    return out;
  }

  /** percorre os props de todos os chunks baixados (ex.: postes para decoração de eventos) */
  forEachProp(cb: (p: PropRec) => void) {
    for (const c of this.chunks.values()) if (c.data) for (const p of c.data.props) cb(p);
  }

  lodAt(x: number, z: number): LodLevel | null {
    return this.chunks.get(this.chunkKeyAt(x, z))?.lod ?? null;
  }
}
