/**
 * Itens da multidão INSTANCIADA (tier 1, sem esqueleto): uma `InstancedMesh` por tipo de peça, nunca por agente.
 *
 *  - partes rígidas: uma malha por tipo de item (versão "far" do modelo, material único de corpo)
 *  - tecido de bandeira: UMA malha para todas as bandeiras (pequenas e grandes), design pelo atlas `flag` com a
 *    célula por instância (`aCell`), shader de tecido barato
 *  - faixas e faces de cartaz: idem, com os atlas `banner` e `sign`
 *  - lona do guarda-chuva: cor por instância
 * Draw calls = O(tipos de peça visíveis) (≤ 15), qualquer que seja o número de agentes.
 *
 * Posição: aproximada pela pegada típica (grips.FAR_PLACEMENT) no referencial do agente; ação de erguer sobe o
 * item, de balançar faz oscilar. O tecido aponta a favor do vento relativo (vento − velocidade do agente).
 */
import * as THREE from 'three';
import type { CrowdAgent } from '../../characters/crowd/crowdBudget';
import { ACTION_BY_ID } from '../actions';
import { DESIGN_BY_ID, DESIGNS } from '../designs';
import { DesignAtlas } from '../designPainter';
import { PROP_BY_ID, PROPS, type PropKind } from '../props';
import { assetManager } from '../../core/AssetManager';
import { FAR_PLACEMENT, RAISE_ACTIONS, WAVE_ACTIONS } from './grips';
import { BANNER, clothGeometry, propModel } from './propGeometry';
import { PROP_CATEGORY, patchCloth, patchFace, propBodyMaterial, propWind, tickPropClock } from './propMaterials';

type AtlasSlot = 'flag' | 'banner' | 'sign';
/** largura da faixa carregada por UMA pessoa na multidão distante (m) */
const FAR_BANNER_W = 1.3;

interface DesignBatch {
  slot: AtlasSlot;
  mesh: THREE.InstancedMesh;
  cell: THREE.InstancedBufferAttribute;
  atlas: DesignAtlas | null;
  atlasDesigns: number;
  count: number;
}

const _P = new THREE.Matrix4(), _G = new THREE.Matrix4(), _M = new THREE.Matrix4(), _S = new THREE.Matrix4(), _R = new THREE.Matrix4();
const _col = new THREE.Color();
const _v = new THREE.Vector3();

export class PropInstancer {
  readonly group = new THREE.Group();
  readonly stats = { drawn: 0, calls: 0, instances: 0 };
  private rigid = new Map<PropKind, { mesh: THREE.InstancedMesh; count: number }>();
  private canopy: { mesh: THREE.InstancedMesh; count: number } | null = null;
  private batches = new Map<AtlasSlot, DesignBatch>();
  private unregister: (() => void)[] = [];

  constructor(private capacity: number) {
    this.group.name = 'crowd_props';
  }

  /** desenha os itens dos agentes recebidos (a mesma lista dos instanciados do CrowdDirector) */
  draw(agents: readonly CrowdAgent[]) {
    for (const r of this.rigid.values()) r.count = 0;
    for (const b of this.batches.values()) b.count = 0;
    if (this.canopy) this.canopy.count = 0;
    const now = performance.now() / 1000;
    let drawn = 0;
    const ws = 1.5 + propWind.strength * 4;
    for (const a of agents) {
      if (!a.prop) continue;
      const def = PROP_BY_ID.get(a.prop);
      const pl = def ? FAR_PLACEMENT[def.kind] : null;
      if (!def || !pl) continue;
      const kind = def.kind;
      const actKey = a.act ? ACTION_BY_ID.get(a.act)?.key : undefined;
      const raised = actKey ? RAISE_ACTIONS.has(actKey) : false;
      const waving = actKey ? WAVE_ACTIONS.has(actKey) : false;
      const ph = a.id * 1.37;
      // quadro do agente × pegada (erguida/balançando)
      _P.makeRotationY(a.heading).scale(_v.setScalar(a.scale || 1)).setPosition(a.x, a.y, a.z);
      const lift = (raised || waving ? pl.raise : 0) + (raised ? Math.sin(now * 3 + ph) * 0.04 : 0);
      _G.makeTranslation(pl.at[0], pl.at[1] + lift, pl.at[2]);
      const sway = waving ? Math.sin(now * 4.2 + ph) * 0.45 : 0;
      _R.makeRotationX(pl.tilt);
      _G.multiply(_R);
      if (sway) _G.multiply(_R.makeRotationZ(sway));
      _P.multiply(_G);
      // vento relativo no referencial do item (só o giro em Y do agente importa a esta distância)
      const vx = Math.sin(a.heading) * a.speed, vz = Math.cos(a.heading) * a.speed;
      const yaw = Math.atan2(-(propWind.dirZ * ws - vz), propWind.dirX * ws - vx) - a.heading;
      drawn++;
      if (kind === 'banner') {
        // um mastro em cada mão, pano de um topo ao outro
        const top = BANNER.poleLen - BANNER.poleBelow - 0.04;
        for (const s of [-1, 1]) this.pushRigid(kind, _M.multiplyMatrices(_P, _S.makeTranslation((s * FAR_BANNER_W) / 2, 0, 0)));
        _M.multiplyMatrices(_P, _S.makeTranslation(-FAR_BANNER_W / 2 + BANNER.poleR, top, 0));
        _M.multiply(_S.makeScale(FAR_BANNER_W - BANNER.poleR * 2, BANNER.clothH, 1));
        this.pushDesign('banner', _M, a.design);
        continue;
      }
      this.pushRigid(kind, _P);
      const model = propModel(kind, 'far');
      for (const p of model.parts) {
        _M.multiplyMatrices(_P, p.m);
        if (p.part === 'face') {
          _M.multiply(_S.makeScale(p.w, p.h, 1));
          this.pushDesign('sign', _M, a.design);
        } else {
          _M.multiply(_S.makeRotationY(yaw)).multiply(_R.makeScale(p.w, p.h, p.w));
          this.pushDesign('flag', _M, a.design);
        }
      }
      if (model.canopy) {
        const c = this.canopyMesh();
        if (c.count < this.capacity) {
          const i = c.count++;
          c.mesh.setMatrixAt(i, _P);
          const d = DESIGN_BY_ID.get(a.design);
          c.mesh.setColorAt(i, _col.set(d ? d.palette.bg : '#1b1d22'));
        }
      }
    }
    // envio: só o trecho usado de cada atributo
    let calls = 0, inst = 0;
    const flush = (mesh: THREE.InstancedMesh, count: number, extra: (THREE.BufferAttribute | null | undefined)[] = []) => {
      mesh.count = count;
      mesh.visible = count > 0;
      if (!count) return;
      calls++; inst += count;
      for (const at of [mesh.instanceMatrix, ...extra]) {
        if (!at) continue;
        at.clearUpdateRanges();
        at.addUpdateRange(0, count * at.itemSize);
        at.needsUpdate = true;
      }
    };
    for (const r of this.rigid.values()) flush(r.mesh, r.count);
    for (const b of this.batches.values()) flush(b.mesh, b.count, [b.cell]);
    if (this.canopy) flush(this.canopy.mesh, this.canopy.count, [this.canopy.mesh.instanceColor]);
    this.stats.drawn = drawn; this.stats.calls = calls; this.stats.instances = inst;
  }

  private pushRigid(kind: PropKind, m: THREE.Matrix4) {
    let r = this.rigid.get(kind);
    if (!r) {
      const mesh = new THREE.InstancedMesh(propModel(kind, 'far').rigid, propBodyMaterial(), this.capacity);
      mesh.name = `crowd_prop_${kind}`;
      this.setup(mesh);
      r = { mesh, count: 0 };
      this.rigid.set(kind, r);
    }
    if (r.count < this.capacity) r.mesh.setMatrixAt(r.count++, m);
  }

  private pushDesign(slot: AtlasSlot, m: THREE.Matrix4, design: number) {
    const b = this.batch(slot);
    if (b.count >= this.capacity) return;
    const i = b.count++;
    b.mesh.setMatrixAt(i, m);
    const [u0, v0, du, dv] = b.atlas!.uv(design);
    const arr = b.cell.array as Float32Array;
    arr[i * 4] = u0; arr[i * 4 + 1] = v0; arr[i * 4 + 2] = du; arr[i * 4 + 3] = dv;
  }

  private batch(slot: AtlasSlot): DesignBatch {
    let b = this.batches.get(slot);
    if (!b) {
      // geometria própria (unitária): o atributo de instância não pode ir para a malha compartilhada dos itens próximos
      const geo = slot === 'sign' ? new THREE.PlaneGeometry(1, 1) : clothGeometry(slot === 'flag' ? 'flag_large' : 'banner', 1, 1, 1).clone();
      const cell = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4);
      cell.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aCell', cell);
      geo.name = `crowd_prop_${slot}`;
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
      if (slot === 'sign') { patchFace(mat, true); mat.side = THREE.DoubleSide; } else patchCloth(mat, { banner: slot === 'banner', cheap: true, atlas: true, dims: [1, 1] });
      mat.name = `crowd_prop_${slot}`;
      const mesh = new THREE.InstancedMesh(geo, mat, this.capacity);
      mesh.name = `crowd_prop_${slot}`;
      if (slot !== 'sign') mesh.onBeforeRender = tickPropClock;
      this.setup(mesh);
      mesh.castShadow = false;
      this.unregister.push(assetManager.register({ category: PROP_CATEGORY, geometry: geo }), assetManager.register({ category: PROP_CATEGORY, material: mat }));
      b = { slot, mesh, cell, atlas: null, atlasDesigns: -1, count: 0 };
      this.batches.set(slot, b);
    }
    // campanhas chegam dos dados depois da carga: refaz o atlas se o registro cresceu
    if (b.atlasDesigns !== DESIGNS.length) {
      const old = b.atlas;
      b.atlas = new DesignAtlas(slot, slot === 'sign' ? 96 : 64);
      b.atlasDesigns = DESIGNS.length;
      (b.mesh.material as THREE.MeshStandardMaterial).map = b.atlas.texture;
      b.atlas.texture.userData.category = PROP_CATEGORY;
      (b.mesh.material as THREE.MeshStandardMaterial).needsUpdate = !old;
      if (old) old.texture.dispose();
      this.unregister.push(assetManager.register({ category: PROP_CATEGORY, texture: b.atlas.texture }));
    }
    return b;
  }

  private canopyMesh() {
    if (!this.canopy) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
      mat.name = 'crowd_prop_canopy';
      const mesh = new THREE.InstancedMesh(propModel('umbrella', 'far').canopy!, mat, this.capacity);
      mesh.name = 'crowd_prop_canopy';
      mesh.setColorAt(0, _col.set(0xffffff));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.setup(mesh);
      this.unregister.push(assetManager.register({ category: PROP_CATEGORY, material: mat }));
      this.canopy = { mesh, count: 0 };
    }
    return this.canopy;
  }

  private setup(mesh: THREE.InstancedMesh) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // culling por agente na CPU (CrowdDirector)
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.visible = false;
    this.group.add(mesh);
  }

  dispose() {
    for (const r of this.rigid.values()) { r.mesh.dispose(); r.mesh.removeFromParent(); }
    for (const b of this.batches.values()) {
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.atlas?.texture.dispose();
      b.mesh.dispose();
      b.mesh.removeFromParent();
    }
    if (this.canopy) { (this.canopy.mesh.material as THREE.Material).dispose(); this.canopy.mesh.dispose(); this.canopy.mesh.removeFromParent(); }
    this.unregister.forEach((u) => u());
    this.rigid.clear(); this.batches.clear(); this.canopy = null;
  }
}

/** tipos de item que a multidão instanciada consegue mostrar (QA) */
export const FAR_PROP_KINDS = PROPS.filter((p) => FAR_PLACEMENT[p.kind]).map((p) => p.kind);

/** QA (`?crowdProps=f`): item e design determinísticos pelo id do agente, pesados por `crowdWeight` */
export function qaCrowdProp(a: CrowdAgent, frac: number) {
  const h = (n: number) => { const x = Math.sin(a.id * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  if (h(1) > frac) return;
  const props = PROPS.filter((p) => p.crowdWeight > 0 && FAR_PLACEMENT[p.kind]);
  const pick = <T,>(list: T[], w: (x: T) => number, r: number) => {
    const tot = list.reduce((s, x) => s + w(x), 0);
    let acc = r * tot;
    for (const x of list) { acc -= w(x); if (acc <= 0) return x; }
    return list[list.length - 1];
  };
  const p = pick(props, (x) => x.crowdWeight, h(2));
  const slot = p.designSlot ?? 'flag';
  const ds = DESIGNS.filter((d) => d.targets.includes(slot) && (d.crowdWeight ?? 0) > 0);
  a.prop = p.id;
  a.design = ds.length ? pick(ds, (d) => d.crowdWeight ?? 0, h(3)).id : 0;
  const acts = ['flag_raise', 'flag_wave', 'sign_raise', 'sign_wave'];
  if (h(4) < 0.4) a.act = [...ACTION_BY_ID.values()].find((x) => x.key === acts[Math.floor(h(5) * acts.length)])?.id ?? 0;
}
