/**
 * Impostores das CÉLULAS agregadas (espectador aéreo, rodada 8.1): cada pessoa de uma célula vira UMA instância de
 * um boneco baixíssimo (cilindro + cabeça, ~20 triângulos) num único InstancedMesh — um draw call para a avenida.
 *
 *  layout      determinístico pela `seed` da célula (mesmo servidor → mesma seed → mesmo lugar para todos os
 *              espectadores); a sequência de lugares é estável (a 1ª pessoa fica no mesmo lugar quando a contagem
 *              muda); lugares dentro de prédio são rejeitados (mesma colisão do mundo, determinística)
 *  cores       jogadores pela distribuição de grupos da célula (cor principal do grupo do evento; sem grupo = roupa
 *              variada); ambiente em tons neutros — nenhuma cor de grupo para NPC
 *  sem duplicar  quem a rede já desenha individualmente (AOI mínimo em FAR) é DESCONTADO da sua célula
 *  transição   crescer/encolher (0,5 s) ao entrar/sair de FAR/AGGREGATE — sem pop, sem transparência
 * Puro three.js; o jogo dá as células (NetworkClient.specCells), o chão e o teste de prédio.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CROWD_CELL, type CrowdCellSnapshot } from './tiers';
import { cellKey } from './cellCodec';

/** roupa variada (jogador sem grupo) e ambiente (tons neutros, iguais para todo NPC) */
const LOOSE = [0x3b5b92, 0xd9d4c7, 0x2f2f33, 0x8a3b2e, 0x4f7d4a, 0xc9a227, 0x6b4f8a, 0xe8e2d6, 0x1f4e5f, 0x9a9a9a];
const AMBIENT = [0x77736b, 0x8d877b, 0x5f6266, 0xa39d90, 0x6e665c, 0x8b8f94];
const FADE_S = 0.5;

/** gerador determinístico (mesmo do resto do jogo: LCG) */
function lcg(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const hash2 = (a: number, b: number) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35); h ^= h >>> 15; return (Math.imul(h, 0x27d4eb2f) ^ (h >>> 13)) >>> 0; };

interface Layout { seed: number; rnd: () => number; pts: number[] }

export class CellImpostors {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private cap = 0;
  private layouts = new Map<number, Layout>();
  private groupColor = new Map<string, number>();
  private version = -1;
  private acc = 0;
  private fade = 0;
  private target = 0;
  private scaleXZ = 1;
  private scaleY = 1;
  /** instâncias atuais (x, y, z, cor) — o minimapa reaproveita (sem amostrar a multidão de novo) */
  private inst: { x: number; y: number; z: number; c: number }[] = [];
  private local = new Map<number, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private col = new THREE.Color();
  stats = { drawn: 0, players: 0, env: 0, subtracted: 0, cells: 0, rebuilds: 0, fade: 0 };

  constructor(private ground: (x: number, z: number) => number, private blocked: (x: number, z: number) => boolean, private size: number = CROWD_CELL.sizeM) {
    this.group.name = 'spec_cell_impostors';
    this.group.userData.category = 'spectator/cells';
    const body = new THREE.CylinderGeometry(0.22, 0.27, 1.42, 6, 1, true).translate(0, 0.71, 0);
    const head = new THREE.IcosahedronGeometry(0.17, 0).translate(0, 1.6, 0);
    const geo = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()])!;
    geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 1);
    this.mesh.name = 'cell_people';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  /** cores principais dos grupos do evento (chave do grupo → #rrggbb) */
  setGroupColors(groups: readonly { id: string; colors?: string[] }[] | undefined) {
    this.groupColor.clear();
    for (const g of groups ?? []) { const c = g.colors?.[0]; if (c) this.groupColor.set(g.id, parseInt(c.replace('#', ''), 16)); }
    this.version = -1;
  }

  /** lugar i da célula (sequência estável pela seed; fora de prédios quando possível) */
  private spot(c: CrowdCellSnapshot, i: number): number {
    const k = cellKey(c.cx, c.cz);
    let L = this.layouts.get(k);
    if (!L || L.seed !== c.seed) { L = { seed: c.seed, rnd: lcg(c.seed), pts: [] }; this.layouts.set(k, L); }
    const x0 = c.cx * this.size, z0 = c.cz * this.size;
    while (L.pts.length / 3 <= i) {
      let x = 0, z = 0;
      for (let t = 0; t < 6; t++) { x = x0 + L.rnd() * this.size; z = z0 + L.rnd() * this.size; if (!this.blocked(x, z)) break; }
      L.pts.push(x, this.ground(x, z), z);
    }
    return i * 3;
  }

  /**
   * por quadro: `aerial` = camada FAR/AGGREGATE do servidor. Refaz as instâncias quando as células mudam (1 Hz) ou a
   * cada 0,5 s (quem a rede desenha anda); durante a transição só reescala.
   */
  update(dt: number, cells: ReadonlyMap<number, CrowdCellSnapshot>, version: number, aerial: boolean, altitude: number, forEachLocal: (fn: (x: number, z: number) => void) => void) {
    this.target = aerial && cells.size ? 1 : 0;
    const prev = this.fade;
    this.fade = this.target > this.fade ? Math.min(1, this.fade + dt / FADE_S) : Math.max(0, this.fade - dt / FADE_S);
    // de muito alto, maior que o real (símbolo legível de mapa: com 0,5 m de largura cada pessoa sumiria em 1 px)
    const sxz = THREE.MathUtils.clamp(altitude / 70, 1, 3.2), sy = THREE.MathUtils.clamp(altitude / 120, 1, 2);
    this.acc += dt;
    const rebuild = this.target === 1 && (version !== this.version || this.acc > 0.5);
    if (rebuild) { this.version = version; this.acc = 0; this.build(cells, forEachLocal); }
    if (rebuild || prev !== this.fade || sxz !== this.scaleXZ || sy !== this.scaleY) { this.scaleXZ = sxz; this.scaleY = sy; this.write(); }
    this.stats.fade = +this.fade.toFixed(2);
  }

  private build(cells: ReadonlyMap<number, CrowdCellSnapshot>, forEachLocal: (fn: (x: number, z: number) => void) => void) {
    // quem já é desenhado individualmente, por célula
    const local = this.local;
    local.clear();
    forEachLocal((x, z) => { const k = cellKey(Math.floor(x / this.size), Math.floor(z / this.size)); local.set(k, (local.get(k) ?? 0) + 1); });
    const out = this.inst;
    out.length = 0;
    let players = 0, env = 0, sub = 0;
    for (const [k, c] of cells) {
      const own = Math.min(c.players, local.get(k) ?? 0);
      sub += own;
      // jogadores: blocos de cor por grupo (ordem das chaves), descontando os desenhados individualmente do início
      let i = 0, skip = own;
      for (const g of Object.keys(c.groups)) {
        const gc = this.groupColor.get(g);
        for (let n = 0; n < c.groups[g]; n++, i++) {
          if (skip > 0) { skip--; continue; }
          const o = this.spot(c, i), L = this.layouts.get(k)!.pts;
          const color = gc ?? LOOSE[hash2(c.seed, i) % LOOSE.length];
          out.push({ x: L[o], y: L[o + 1], z: L[o + 2], c: color });
          players++;
        }
      }
      for (let n = 0; n < c.env; n++, i++) {
        const o = this.spot(c, i), L = this.layouts.get(k)!.pts;
        out.push({ x: L[o], y: L[o + 1], z: L[o + 2], c: AMBIENT[hash2(c.seed, i) % AMBIENT.length] });
        env++;
      }
    }
    // células que sumiram: libera o layout (guarda no máximo as atuais)
    if (this.layouts.size > cells.size * 2 + 64) for (const k of this.layouts.keys()) if (!cells.has(k)) this.layouts.delete(k);
    if (out.length > this.cap) this.grow(out.length);
    for (let j = 0; j < out.length; j++) this.mesh.setColorAt(j, this.col.setHex(out[j].c));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    Object.assign(this.stats, { players, env, subtracted: sub, cells: cells.size });
    this.stats.rebuilds++;
  }

  private grow(n: number) {
    const cap = Math.max(256, Math.ceil(n * 1.5));
    const old = this.mesh;
    this.mesh = new THREE.InstancedMesh(old.geometry, old.material, cap);
    this.mesh.name = old.name;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.remove(old);
    old.dispose();
    this.group.add(this.mesh);
    this.cap = cap;
    this.mesh.setColorAt(0, this.col.setHex(0xffffff)); // cria instanceColor
  }

  private write() {
    const f = this.fade, list = this.inst;
    const n = f > 0 ? list.length : 0;
    const s = new THREE.Vector3(0.0001 + this.scaleXZ * f, 0.0001 + this.scaleY * f, 0.0001 + this.scaleXZ * f);
    const p = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      const e = list[j];
      this.m.compose(p.set(e.x, e.y, e.z), this.q, s);
      this.mesh.setMatrixAt(j, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.stats.drawn = n;
  }

  /** pessoas desenhadas como impostores agora (x, z) — minimapa no modo aéreo */
  forEachPoint(fn: (x: number, z: number) => void) { if (this.fade > 0) for (const e of this.inst) fn(e.x, e.z); }
  /** QA: há impostores visíveis? */
  get visible() { return this.fade > 0 && this.inst.length > 0; }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}
