/**
 * Mobiliário urbano e vegetação — modelos procedurais originais, desenhados por instancing
 * (um InstancedMesh por parte de modelo, global para todos os chunks próximos).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropRec } from '../types';
import { CURB_HEIGHT } from '../types';
import { mulberry32 } from '../../renderer/noise';
import { loadVegetation, speciesAt, VegetationSystem, vegetationOptionsFor, type TreeInstance } from '../vegetation';

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; castShadow: boolean };
export interface PropModel { parts: Part[] }

function colorize(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 1): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rnd() - 0.5) * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      arr[(i + k) * 3] = c.r * j; arr[(i + k) * 3 + 1] = c.g * j; arr[(i + k) * 3 + 2] = c.b * j;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

const merge = (gs: THREE.BufferGeometry[]) => {
  const m = mergeGeometries(gs, false)!;
  m.computeBoundingSphere();
  return m;
};

// ------------------------------------------------------------------------------------------
// materiais compartilhados
// ------------------------------------------------------------------------------------------
export interface PropMaterials {
  painted: THREE.MeshStandardMaterial; // vertexColors, fosco
  metal: THREE.MeshStandardMaterial; // vertexColors, metálico
  lampGlow: THREE.MeshStandardMaterial;
  signalLights: THREE.MeshStandardMaterial;
  signalLamp: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
  /** tempo para o vento das folhas (VegetationSystem) */
  windUniform: { value: number };
}

export function createPropMaterials(_noise: THREE.Texture): PropMaterials {
  const windUniform = { value: 0 };
  return {
    painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: 0xffe2b0, emissiveIntensity: 0.15, roughness: 0.3 }),
    signalLights: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.3, metalness: 0 }),
    signalLamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fb4bb, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }),
    windUniform,
  };
}

// ------------------------------------------------------------------------------------------
// mobiliário
// ------------------------------------------------------------------------------------------
function lampModel(mats: PropMaterials): PropModel {
  // poste alto de braço duplo (padrão de avenidas do Centro)
  const grey = 0x6d7276;
  const parts = [
    colorize(at(new THREE.CylinderGeometry(0.07, 0.13, 10.5, 8), 0, 5.25, 0), grey),
    colorize(at(new THREE.CylinderGeometry(0.2, 0.22, 0.6, 8), 0, 0.3, 0), 0x55595c),
  ];
  for (const s of [1, -1]) {
    parts.push(colorize(at(new THREE.CylinderGeometry(0.045, 0.06, 2.2, 6), s * 1.0, 10.55, 0, 0, 0, s * 1.25), grey));
    parts.push(colorize(at(new THREE.BoxGeometry(0.75, 0.16, 0.34), s * 2.0, 10.9, 0), 0x4a4e52));
  }
  const glow: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) glow.push(at(new THREE.BoxGeometry(0.6, 0.04, 0.26), s * 2.0, 10.8, 0));
  return { parts: [{ geo: merge(parts), mat: mats.metal, castShadow: true }, { geo: merge(glow), mat: mats.lampGlow, castShadow: false }] };
}

function signalModel(mats: PropMaterials): PropModel {
  const dark = 0x2b2e30;
  const body = [
    colorize(at(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), 0, 1.7, 0), 0x45494c),
    colorize(at(new THREE.BoxGeometry(0.36, 1.05, 0.3), 0, 3.3, 0.06), dark),
    colorize(at(new THREE.BoxGeometry(0.62, 1.25, 0.03), 0, 3.3, -0.1), 0x111111), // anteparo
  ];
  for (let i = 0; i < 3; i++) body.push(colorize(at(new THREE.BoxGeometry(0.28, 0.06, 0.16), 0, 3.66 - i * 0.32, 0.27), dark));
  // lâmpadas (vermelho, amarelo, verde) — partes separadas, cor por instância conforme o ciclo
  const lamp = (y: number) => at(new THREE.CircleGeometry(0.11, 12), 0, y, 0.215);
  return {
    parts: [
      { geo: merge(body), mat: mats.painted, castShadow: true },
      { geo: lamp(3.6), mat: mats.signalLamp, castShadow: false },
      { geo: lamp(3.3), mat: mats.signalLamp, castShadow: false },
      { geo: lamp(3.0), mat: mats.signalLamp, castShadow: false },
    ],
  };
}

function benchModel(mats: PropMaterials): PropModel {
  const wood = 0x7a5a3a, iron = 0x2a2a2a;
  const parts = [
    colorize(at(new THREE.BoxGeometry(1.8, 0.05, 0.42), 0, 0.45, 0), wood, 0.1),
    colorize(at(new THREE.BoxGeometry(1.8, 0.35, 0.05), 0, 0.72, -0.2, -0.15), wood, 0.1),
    colorize(at(new THREE.BoxGeometry(0.06, 0.45, 0.42), -0.8, 0.22, 0), iron),
    colorize(at(new THREE.BoxGeometry(0.06, 0.45, 0.42), 0.8, 0.22, 0), iron),
  ];
  return { parts: [{ geo: merge(parts), mat: mats.painted, castShadow: true }] };
}

function busStopModel(mats: PropMaterials): PropModel {
  const frame = 0x3d4246;
  const parts = [
    colorize(at(new THREE.BoxGeometry(4.2, 0.12, 1.7), 0, 2.6, 0), 0x9aa3a8),
    colorize(at(new THREE.BoxGeometry(0.1, 2.6, 0.1), -2.0, 1.3, -0.7), frame),
    colorize(at(new THREE.BoxGeometry(0.1, 2.6, 0.1), 2.0, 1.3, -0.7), frame),
    colorize(at(new THREE.BoxGeometry(0.1, 2.6, 0.1), 0, 1.3, -0.7), frame),
    colorize(at(new THREE.BoxGeometry(3.6, 0.06, 0.35), 0, 0.5, -0.5), 0x8a8f93),
    colorize(at(new THREE.BoxGeometry(1.2, 1.8, 0.08), 2.4, 1.2, -0.65), 0x23415f), // painel informativo
  ];
  const glass = [at(new THREE.BoxGeometry(4.0, 1.8, 0.03), 0, 1.5, -0.75)];
  return { parts: [{ geo: merge(parts), mat: mats.painted, castShadow: true }, { geo: merge(glass.map((g) => { g.deleteAttribute('uv'); return g; })), mat: mats.glass, castShadow: false }] };
}

function busPoleModel(mats: PropMaterials): PropModel {
  // poste de parada de ônibus (sem abrigo): haste + placa
  return {
    parts: [{
      geo: merge([
        colorize(at(new THREE.CylinderGeometry(0.045, 0.05, 2.8, 8), 0, 1.4, 0), 0x4a4f54),
        colorize(at(new THREE.BoxGeometry(0.5, 0.62, 0.04), 0, 2.55, 0), 0x1f4fa8),
        colorize(at(new THREE.BoxGeometry(0.42, 0.18, 0.045), 0, 2.62, 0), 0xf4f4f0),
      ]),
      mat: mats.painted, castShadow: true,
    }],
  };
}

function bollardModel(mats: PropMaterials): PropModel {
  return { parts: [{ geo: merge([colorize(at(new THREE.CylinderGeometry(0.1, 0.12, 0.85, 8), 0, 0.42, 0), 0x2f3336)]), mat: mats.metal, castShadow: true }] };
}

function wasteModel(mats: PropMaterials): PropModel {
  // lixeira laranja da Comlurb ("laranjinha")
  return {
    parts: [{
      geo: merge([
        colorize(at(new THREE.CylinderGeometry(0.24, 0.2, 0.7, 10), 0, 0.75, 0), 0xe0731c),
        colorize(at(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6), 0, 0.4, -0.27), 0x555555),
      ]),
      mat: mats.painted, castShadow: true,
    }],
  };
}

function kioskModel(mats: PropMaterials): PropModel {
  // banca de jornal
  const parts = [
    colorize(at(new THREE.BoxGeometry(3.0, 2.4, 2.0), 0, 1.2, 0), 0x2d5a3a),
    colorize(at(new THREE.BoxGeometry(3.6, 0.1, 2.6), 0, 2.5, 0), 0x244a30),
    colorize(at(new THREE.BoxGeometry(2.6, 1.3, 0.05), 0, 1.4, 1.03), 0xc9c2a8, 0.4),
  ];
  return { parts: [{ geo: merge(parts), mat: mats.painted, castShadow: true }] };
}

// ------------------------------------------------------------------------------------------
// Gerenciador de instâncias
// ------------------------------------------------------------------------------------------
type ModelKey = 'lamp' | 'signal' | 'bench' | 'bus_stop' | 'bus_pole' | 'bollard' | 'waste' | 'kiosk';

interface Inst { p: [number, number]; r: number; s: number; y: number; j?: number; ph?: number }

export class PropSystem {
  readonly group = new THREE.Group();
  private models = new Map<ModelKey, PropModel>();
  private meshes = new Map<ModelKey, THREE.InstancedMesh[]>();
  readonly mats: PropMaterials;
  private dummy = new THREE.Object3D();
  /** posições das luminárias ativas (para luzes reais próximas à noite) */
  private lampHeads: THREE.Vector3[] = [];
  /** semáforos instanciados: cruzamento e fase de cada instância */
  private signalInfo: { j: number; ph: number }[] = [];
  private nightLights: THREE.PointLight[] = [];
  /** árvores/palmeiras (sistema próprio com LOD e impostores) */
  veg?: VegetationSystem;
  private pendingTrees: { rec: PropRec; y: number }[] | null = null;

  constructor(noise: THREE.Texture) {
    this.group.name = 'props';
    this.mats = createPropMaterials(noise);
    this.models.set('lamp', lampModel(this.mats));
    this.models.set('signal', signalModel(this.mats));
    this.models.set('bench', benchModel(this.mats));
    this.models.set('bus_stop', busStopModel(this.mats));
    this.models.set('bollard', bollardModel(this.mats));
    this.models.set('bus_pole', busPoleModel(this.mats));
    this.models.set('waste', wasteModel(this.mats));
    this.models.set('kiosk', kioskModel(this.mats));
    // pool fixo de luzes pontuais (sempre presentes → sem recompilar shaders ao anoitecer)
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 30, 1.6);
      l.castShadow = false;
      this.nightLights.push(l);
      this.group.add(l);
    }
  }

  /** Atualiza as lâmpadas dos semáforos conforme o estado de cada cruzamento. */
  updateSignals(stateOf: (j: number, ph: number) => 'G' | 'Y' | 'R') {
    const meshes = this.meshes.get('signal');
    if (!meshes || meshes.length < 4) return;
    const [, red, yellow, green] = meshes;
    for (const m of [red, yellow, green]) if (!m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
    const on = { R: [1, 0.06, 0.03], Y: [1, 0.62, 0.02], G: [0.1, 1, 0.5] } as const;
    const off = [0.035, 0.03, 0.028];
    for (let i = 0; i < this.signalInfo.length; i++) {
      const si = this.signalInfo[i];
      const st = si.j < 0 ? 'G' : stateOf(si.j, si.ph);
      const set = (m: THREE.InstancedMesh, active: boolean, c: readonly number[]) => {
        const v = active ? c : off;
        m.instanceColor!.setXYZ(i, v[0], v[1], v[2]);
      };
      set(red, st === 'R', on.R);
      set(yellow, st === 'Y', on.Y);
      set(green, st === 'G', on.G);
    }
    for (const m of [red, yellow, green]) m.instanceColor!.needsUpdate = true;
  }

  /** À noite: acende as luminárias (emissivo) e posiciona luzes reais nos postes mais próximos. */
  updateNightLights(cam: THREE.Vector3, night: number) {
    this.mats.lampGlow.emissiveIntensity = 0.15 + night * 9;
    this.mats.signalLights.emissiveIntensity = 0.15 + night * 2.5;
    if (night < 0.05) {
      for (const l of this.nightLights) l.intensity = 0;
      return;
    }
    const sorted = this.lampHeads
      .map((p) => ({ p, d: p.distanceToSquared(cam) }))
      .sort((a, b) => a.d - b.d);
    this.nightLights.forEach((l, i) => {
      const it = sorted[i];
      if (!it) { l.intensity = 0; return; }
      l.position.copy(it.p);
      l.intensity = 260 * night;
    });
  }

  /**
   * Carrega a vegetação pré-gerada (public/vegetation/) e renderiza os impostores.
   * Falha de rede não derruba o jogo: o mundo segue sem árvores (aviso no console).
   */
  async loadVegetation(renderer: THREE.WebGLRenderer, vegetationDensity: number, baseUrl = `${import.meta.env.BASE_URL}vegetation/`) {
    try {
      const assets = await loadVegetation(baseUrl);
      this.veg = new VegetationSystem(renderer, assets, this.mats.windUniform, vegetationOptionsFor(vegetationDensity));
      this.group.add(this.veg.group);
      if (this.pendingTrees) this.veg.setTrees(this.treeInstances(this.pendingTrees));
    } catch (e) {
      console.warn('vegetação indisponível:', e);
    }
  }

  private treeInstances(list: { rec: PropRec; y: number }[]): TreeInstance[] {
    const veg = this.veg!;
    return list.map(({ rec, y }) => {
      const [x, z] = rec.p;
      const species = rec.k === 'palm' ? 'palmeira' : speciesAt(x, z);
      const h = Math.abs(Math.sin(x * 4.231 + z * 9.137) * 43758.5453) % 1;
      return {
        x, y, z,
        rot: h * Math.PI * 2,
        scale: (rec.s ?? 1) * (0.88 + 0.24 * ((h * 7.31) % 1)),
        variant: veg.variantFor(species, x, z),
      };
    });
  }

  /**
   * Reconstrói as instâncias a partir dos props dos chunks ativos.
   * near: mobiliário em detalhe + árvores; far: somente árvores (o LOD das árvores é por distância,
   * decidido a cada passo da câmera em VegetationSystem — perto/médio/impostor).
   */
  rebuild(near: PropRec[], far: PropRec[], _vegetationDensity: number, heightAt: (x: number, z: number) => number) {
    const buckets = new Map<ModelKey, Inst[]>();
    const trees: { rec: PropRec; y: number }[] = [];
    const push = (key: ModelKey, rec: PropRec) => {
      const arr = buckets.get(key) ?? [];
      arr.push({ p: rec.p, r: rec.r ?? 0, s: rec.s ?? 1, y: heightAt(rec.p[0], rec.p[1]), j: rec.j, ph: rec.ph });
      buckets.set(key, arr);
    };
    for (const rec of near) {
      if (rec.k === 'tree' || rec.k === 'palm') trees.push({ rec, y: heightAt(rec.p[0], rec.p[1]) });
      else push(rec.k as ModelKey, rec);
    }
    for (const rec of far) if (rec.k === 'tree' || rec.k === 'palm') trees.push({ rec, y: heightAt(rec.p[0], rec.p[1]) });
    this.pendingTrees = trees;
    if (this.veg) this.veg.setTrees(this.treeInstances(trees));

    for (const [key, model] of this.models) {
      const list = buckets.get(key) ?? [];
      let meshes = this.meshes.get(key);
      const cap = meshes?.[0]?.instanceMatrix.count ?? 0;
      if (!meshes || cap < list.length) {
        meshes?.forEach((m) => { this.group.remove(m); m.dispose(); });
        const capacity = Math.max(16, Math.ceil(list.length * 1.3));
        meshes = model.parts.map((p) => {
          const m = new THREE.InstancedMesh(p.geo, p.mat, capacity);
          m.castShadow = p.castShadow;
          m.receiveShadow = true;
          m.frustumCulled = false; // instâncias espalhadas; bounding recalculado abaixo
          m.name = `props_${key}`;
          this.group.add(m);
          return m;
        });
        this.meshes.set(key, meshes);
      }
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        this.dummy.position.set(it.p[0], it.y, it.p[1]);
        // r = direção (no plano XZ) para onde o +Z do modelo aponta
        this.dummy.rotation.set(0, Math.atan2(Math.cos(it.r), Math.sin(it.r)), 0);
        this.dummy.scale.setScalar(it.s);
        this.dummy.updateMatrix();
        for (const m of meshes) m.setMatrixAt(i, this.dummy.matrix);
      }
      if (key === 'signal') this.signalInfo = list.map((it) => ({ j: it.j ?? -1, ph: it.ph ?? 0 }));
      if (key === 'lamp') {
        this.lampHeads = [];
        for (const it of list) {
          // as duas cabeças ficam a ±2 m no eixo X local do modelo, a ~10.6 m de altura
          const ang = Math.atan2(Math.cos(it.r), Math.sin(it.r));
          for (const sgn of [1, -1]) {
            this.lampHeads.push(new THREE.Vector3(it.p[0] + Math.cos(ang) * 2 * sgn, it.y + 10.4, it.p[1] - Math.sin(ang) * 2 * sgn));
          }
        }
      }
      for (const m of meshes) {
        m.count = list.length;
        m.instanceMatrix.needsUpdate = true;
        m.visible = list.length > 0;
        if (list.length) { m.computeBoundingSphere(); m.frustumCulled = true; }
      }
    }
  }

  update(time: number, camera?: THREE.Vector3) {
    this.mats.windUniform.value = time;
    if (camera && this.veg) this.veg.update(camera);
  }

  get instanceCount() {
    let n = 0;
    for (const ms of this.meshes.values()) n += ms[0]?.count ?? 0;
    return n + (this.pendingTrees?.length ?? 0);
  }
}

export const PROP_BASE_Y = CURB_HEIGHT;
