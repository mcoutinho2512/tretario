/**
 * Desenho dos grafites: DECALQUES num atlas compartilhado — nunca uma textura grande por grafite.
 *
 *  atlas     páginas de 1024×1024 (CanvasTexture, com mipmaps) divididas em 32 tiles de 256×128 (o vetor é rasterizado
 *            uma vez no tile); páginas criadas sob demanda, até MAX_PAGES
 *  decalque  um quad por grafite no plano da superfície (2 cm à frente + polygonOffset), num InstancedMesh por página:
 *            1 draw call por página. O tile de cada instância vem de um atributo (aGfTile) aplicado ao UV do mapa
 *  orçamento só os `budget` mais próximos a ≤ `drawDistance` ganham tile; os outros ficam só como vetor (bytes) até
 *            chegarem perto — custo de memória limitado (ver docs/GRAFFITI.md: memória por grafite e por 100)
 */
import * as THREE from 'three';
import { CANVAS_H, CANVAS_W, type GraffitiContent } from './codec';
import { drawGraffiti } from './raster';
import { normalOf, solidRing, surfacePoint, type GraffitiSolid, type GraffitiSurface } from './surfaces';

const PAGE = 1024;
const COLS = PAGE / CANVAS_W; // 4
const ROWS = PAGE / CANVAS_H; // 8
const SLOTS = COLS * ROWS; // 32
const MAX_PAGES = 4;
/** bytes de GPU de uma página (RGBA8 + cadeia de mipmaps ≈ 4/3) */
export const PAGE_GPU_BYTES = Math.round(PAGE * PAGE * 4 * (4 / 3));
export const TILE_GPU_BYTES = Math.round(PAGE_GPU_BYTES / SLOTS);

interface Page { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mesh: THREE.InstancedMesh; tile: THREE.InstancedBufferAttribute; owner: (number | null)[]; dirty: boolean }

export interface DecalEntry { id: number; sf: GraffitiSurface; content: GraffitiContent; hidden: boolean }

export class GraffitiRenderer {
  readonly group = new THREE.Group();
  private pages: Page[] = [];
  /** id → [página, tile] */
  private slotOf = new Map<number, [number, number]>();
  private geo = new THREE.PlaneGeometry(1, 1);
  private m4 = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  drawDistance = 90;
  budget = 96;
  /** rasterizações por quadro (espalha o custo quando chegam muitos de uma vez) */
  rasterPerFrame = 4;
  stats = { tiles: 0, pages: 0, visible: 0, rasterized: 0, gpuBytes: 0 };

  constructor(private anisotropy = 4) {
    this.group.name = 'graffiti';
  }

  private newPage(): Page | null {
    if (this.pages.length >= MAX_PAGES) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PAGE;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.04, depthWrite: false, roughness: 0.82, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    // UV do mapa → tile da instância (xy = canto, zw = tamanho, no espaço UV da página)
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aGfTile;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = aGfTile.xy + uv * aGfTile.zw;\n#endif');
    };
    mat.customProgramCacheKey = () => 'graffiti-decal';
    const geo = this.geo.clone();
    const tile = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 4), 4);
    geo.setAttribute('aGfTile', tile);
    const mesh = new THREE.InstancedMesh(geo, mat, SLOTS);
    mesh.name = `graffiti_page${this.pages.length}`;
    mesh.frustumCulled = false; // poucas páginas; a esfera envolvente das instâncias mudaria a cada grafite
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 2;
    for (let i = 0; i < SLOTS; i++) {
      mesh.setMatrixAt(i, this.zero);
      const c = i % COLS, r = Math.floor(i / COLS);
      tile.setXYZW(i, c / COLS, 1 - (r + 1) / ROWS, 1 / COLS, 1 / ROWS);
    }
    this.group.add(mesh);
    const p: Page = { canvas, ctx, tex, mesh, tile, owner: new Array(SLOTS).fill(null), dirty: false };
    this.pages.push(p);
    return p;
  }

  private alloc(): [number, number] | null {
    for (let pi = 0; pi < this.pages.length; pi++) {
      const k = this.pages[pi].owner.indexOf(null);
      if (k >= 0) return [pi, k];
    }
    return this.newPage() ? [this.pages.length - 1, 0] : null;
  }

  release(id: number) {
    const s = this.slotOf.get(id);
    if (!s) return;
    const p = this.pages[s[0]];
    p.owner[s[1]] = null;
    p.ctx.clearRect((s[1] % COLS) * CANVAS_W, Math.floor(s[1] / COLS) * CANVAS_H, CANVAS_W, CANVAS_H);
    p.dirty = true;
    p.mesh.setMatrixAt(s[1], this.zero);
    p.mesh.instanceMatrix.needsUpdate = true;
    this.slotOf.delete(id);
  }

  /** matriz do decalque: colunas u·w, v·h, n e o centro do retângulo (2 cm à frente da superfície) */
  private placeMatrix(e: DecalEntry) {
    const { sf } = e, r = e.content.rect;
    const n = normalOf(sf);
    const c = surfacePoint(sf, r.s + r.w / 2, r.t + r.h / 2, 0.02 + (e.id % 7) * 0.001); // id → desempate de z-fighting
    this.m4.set(
      sf.u[0] * r.w, sf.v[0] * r.h, n[0], c[0],
      sf.u[1] * r.w, sf.v[1] * r.h, n[1], c[1],
      sf.u[2] * r.w, sf.v[2] * r.h, n[2], c[2],
      0, 0, 0, 1,
    );
    return this.m4;
  }

  /**
   * Por quadro (barato): escolhe quem ganha tile (os `budget` mais próximos a ≤ drawDistance), libera os que saíram,
   * rasteriza poucos novos por quadro e sobe as páginas alteradas.
   */
  update(entries: Iterable<DecalEntry>, cam: THREE.Vector3) {
    const want: { e: DecalEntry; d: number }[] = [];
    for (const e of entries) {
      if (e.hidden) continue;
      const c = surfacePoint(e.sf, e.content.rect.s + e.content.rect.w / 2, e.content.rect.t + e.content.rect.h / 2);
      const d = Math.hypot(c[0] - cam.x, c[1] - cam.y, c[2] - cam.z);
      if (d <= this.drawDistance) want.push({ e, d });
    }
    want.sort((a, b) => a.d - b.d);
    if (want.length > this.budget) want.length = this.budget;
    const keep = new Set(want.map((w) => w.e.id));
    for (const id of [...this.slotOf.keys()]) if (!keep.has(id)) this.release(id);
    let budget = this.rasterPerFrame;
    for (const { e } of want) {
      if (this.slotOf.has(e.id)) continue;
      if (budget-- <= 0) break;
      const s = this.alloc();
      if (!s) break;
      const p = this.pages[s[0]];
      p.owner[s[1]] = e.id;
      const x = (s[1] % COLS) * CANVAS_W, y = Math.floor(s[1] / COLS) * CANVAS_H;
      p.ctx.clearRect(x, y, CANVAS_W, CANVAS_H);
      // 2 px de margem transparente: os mipmaps não "sangram" o tile vizinho
      drawGraffiti(p.ctx, e.content, x + 2, y + 1, (CANVAS_W - 4) / CANVAS_W);
      p.dirty = true;
      p.mesh.setMatrixAt(s[1], this.placeMatrix(e));
      p.mesh.instanceMatrix.needsUpdate = true;
      this.slotOf.set(e.id, s);
      this.stats.rasterized++;
    }
    for (const p of this.pages) if (p.dirty) { p.tex.needsUpdate = true; p.dirty = false; }
    this.stats.tiles = this.slotOf.size;
    this.stats.pages = this.pages.length;
    this.stats.visible = this.slotOf.size;
    this.stats.gpuBytes = this.pages.length * PAGE_GPU_BYTES;
  }

  has(id: number) { return this.slotOf.has(id); }

  dispose() {
    for (const p of this.pages) { p.tex.dispose(); (p.mesh.material as THREE.Material).dispose(); p.mesh.geometry.dispose(); }
    this.pages = [];
    this.slotOf.clear();
  }
}

/** tapumes (painéis de obra): uma caixa instanciada, com colisão adicionada pelo GraffitiSystem */
export function buildTapumes(solids: GraffitiSolid[], groundAt: (x: number, z: number) => number): THREE.InstancedMesh | null {
  if (!solids.length) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  // compensado pintado (verde-obra) com textura de placas — canvas pequeno, sem asset externo
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#5f7f5a'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
    g.fillRect(i * 64, 0, 64, 128);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(i * 64, 0, 2, 128);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 256, 4); g.fillRect(0, 124, 256, 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, solids.length);
  mesh.name = 'tapumes';
  mesh.castShadow = mesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  solids.forEach((b, i) => {
    const ring = solidRing(b);
    const y = Math.min(...ring.map(([x, z]) => groundAt(x, z)));
    // eixo longo (heading) → x local da caixa
    q.setFromAxisAngle(up, b.heading - Math.PI / 2);
    m.compose(new THREE.Vector3(b.x, y, b.z), q, new THREE.Vector3(b.len, b.height, b.thick));
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  return mesh;
}
