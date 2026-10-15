/**
 * Mobiliário urbano e vegetação — modelos procedurais originais, desenhados por instancing
 * (um InstancedMesh por parte de modelo, global para todos os chunks próximos).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropKind, PropRec } from '../types';
import { CURB_HEIGHT } from '../types';
import { mulberry32 } from '../../renderer/noise';

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
  foliage: THREE.MeshStandardMaterial; // vertexColors + vento
  bark: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshStandardMaterial;
  signalLights: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  windUniform: { value: number };
}

export function createPropMaterials(noise: THREE.Texture): PropMaterials {
  const windUniform = { value: 0 };
  const foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  foliage.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.uniforms.uNoise = { value: noise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 0.37 + ip.z * 0.21;
        #else
          float ph = 0.0;
        #endif
        float sway = max(0.0, transformed.y - 2.0) * 0.012;
        transformed.x += sin(uTime * 1.3 + ph) * sway + sin(uTime * 3.1 + ph * 2.0 + transformed.y) * sway * 0.35;
        transformed.z += cos(uTime * 1.1 + ph) * sway * 0.7;`);
  };
  foliage.customProgramCacheKey = () => 'pv-foliage-wind';
  return {
    painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }),
    foliage,
    bark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: 0xffe2b0, emissiveIntensity: 0.15, roughness: 0.3 }),
    signalLights: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.3, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fb4bb, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }),
    windUniform,
  };
}

// ------------------------------------------------------------------------------------------
// árvores (copas de esferas deformadas com sombreamento falso de oclusão)
// ------------------------------------------------------------------------------------------
function crownBlob(radius: number, seed: number, color: THREE.Color, detail: number): THREE.BufferGeometry {
  // icosfera indexada → deslocamento contínuo (sem frestas) e normais suaves
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rnd = mulberry32(seed);
  const bumps = Array.from({ length: 9 }, () => new THREE.Vector3(rnd() - 0.5, rnd() - 0.5 + 0.15, rnd() - 0.5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.clone().normalize();
    let k = 1;
    for (const b of bumps) k += Math.max(0, d.dot(b)) ** 4 * 0.28;
    // ruído determinístico pela direção (mesmo vértice compartilhado → mesmo deslocamento)
    k += (Math.sin(d.x * 9.1 + seed) * Math.sin(d.y * 7.3) * Math.sin(d.z * 8.7 + seed * 0.5)) * 0.1;
    v.multiplyScalar(k);
    v.y *= d.y < 0 ? 0.62 : 0.85; // base mais achatada
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // cor: mais escura embaixo/dentro (oclusão), variação suave
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const shade = 0.5 + 0.5 * THREE.MathUtils.clamp((y / radius) * 0.6 + 0.5, 0, 1);
    const j = 0.88 + rnd() * 0.24;
    col[i * 3] = color.r * shade * j;
    col[i * 3 + 1] = color.g * shade * (0.95 + rnd() * 0.1);
    col[i * 3 + 2] = color.b * shade * j;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g.toNonIndexed();
}

function treeModel(variant: number, lod: 0 | 1, mats: PropMaterials): PropModel {
  const rnd = mulberry32(100 + variant);
  const greens = [new THREE.Color(0.16, 0.30, 0.10), new THREE.Color(0.20, 0.33, 0.12), new THREE.Color(0.13, 0.26, 0.11)];
  const green = greens[variant % greens.length];
  const detail = lod === 0 ? 2 : 1;
  const blobs: THREE.BufferGeometry[] = [];
  const trunkParts: THREE.BufferGeometry[] = [];
  const barkC = new THREE.Color(0.30, 0.25, 0.20);
  if (variant === 0) {
    // oiti: copa densa e arredondada (muito comum nas ruas do Rio)
    const h = 3.2;
    trunkParts.push(colorize(at(new THREE.CylinderGeometry(0.16, 0.24, h + 1, 7), 0, (h + 1) / 2, 0), barkC, 0.1));
    blobs.push(at(crownBlob(2.9, 1, green, detail), 0, h + 2.4, 0));
    if (lod === 0) {
      blobs.push(at(crownBlob(2.0, 2, green, detail), 1.6, h + 1.6, 0.6));
      blobs.push(at(crownBlob(2.1, 3, green, detail), -1.4, h + 1.8, -0.8));
      blobs.push(at(crownBlob(1.8, 4, green, detail), 0.2, h + 3.8, -0.4));
    }
  } else if (variant === 1) {
    // amendoeira: copa em camadas horizontais
    const h = 4.0;
    trunkParts.push(colorize(at(new THREE.CylinderGeometry(0.18, 0.28, h + 2, 7), 0, (h + 2) / 2, 0), barkC, 0.1));
    for (let i = 0; i < (lod === 0 ? 3 : 2); i++) {
      const b = crownBlob(3.4 - i * 0.7, 10 + i, green.clone().offsetHSL(0.01, 0, 0.02 * i), detail);
      b.scale(1, 0.45, 1);
      blobs.push(at(b, (rnd() - 0.5) * 0.8, h + 0.6 + i * 1.5, (rnd() - 0.5) * 0.8));
    }
  } else {
    // árvore grande (ficus/sibipiruna)
    const h = 4.5;
    trunkParts.push(colorize(at(new THREE.CylinderGeometry(0.25, 0.4, h + 2, 8), 0, (h + 2) / 2, 0), barkC, 0.1));
    if (lod === 0) {
      trunkParts.push(colorize(at(new THREE.CylinderGeometry(0.1, 0.16, 3, 5), 0.8, h + 1.2, 0, 0, 0, -0.6), barkC));
      trunkParts.push(colorize(at(new THREE.CylinderGeometry(0.1, 0.16, 3, 5), -0.8, h + 1.2, 0.3, 0.2, 0, 0.6), barkC));
    }
    blobs.push(at(crownBlob(3.6, 20, green, detail), 0, h + 3.4, 0));
    if (lod === 0) {
      blobs.push(at(crownBlob(2.6, 21, green, detail), 2.4, h + 2.6, 1));
      blobs.push(at(crownBlob(2.7, 22, green, detail), -2.3, h + 2.8, -0.9));
      blobs.push(at(crownBlob(2.2, 23, green, detail), 0.4, h + 5.2, 1.2));
    }
  }
  return {
    parts: [
      { geo: merge(trunkParts), mat: mats.bark, castShadow: true },
      { geo: merge(blobs), mat: mats.foliage, castShadow: true },
    ],
  };
}

function palmModel(mats: PropMaterials): PropModel {
  const trunk = colorize(at(new THREE.CylinderGeometry(0.17, 0.24, 12, 8), 0, 6, 0), 0x8a8478, 0.1);
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.PlaneGeometry(0.9, 4.2, 1, 4);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + 2.1;
      p.setZ(k, -0.05 * y * y);
      p.setY(k, y);
    }
    g.computeVertexNormals();
    const c = colorize(g, 0x3c5a24, 0.2, i);
    fronds.push(at(c, 0, 12, 0, -1.0, (i / 9) * Math.PI * 2, 0));
  }
  return { parts: [{ geo: trunk, mat: mats.bark, castShadow: true }, { geo: merge(fronds), mat: mats.foliage, castShadow: true }] };
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
  // luzes: vermelho (aceso), amarelo, verde — cores via vertex color, emissão leve
  const lights = [
    colorize(at(new THREE.CircleGeometry(0.11, 12), 0, 3.6, 0.215), 0xff2a1a),
    colorize(at(new THREE.CircleGeometry(0.11, 12), 0, 3.3, 0.215), 0x3a2a08),
    colorize(at(new THREE.CircleGeometry(0.11, 12), 0, 3.0, 0.215), 0x083a18),
  ];
  return { parts: [{ geo: merge(body), mat: mats.painted, castShadow: true }, { geo: merge(lights), mat: mats.signalLights, castShadow: false }] };
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
type ModelKey = 'tree0' | 'tree1' | 'tree2' | 'treeFar0' | 'treeFar1' | 'treeFar2' | 'palm' | 'lamp' | 'signal' | 'bench' | 'bus_stop' | 'bollard' | 'waste' | 'kiosk';

interface Inst { p: [number, number]; r: number; s: number; y: number }

export class PropSystem {
  readonly group = new THREE.Group();
  private models = new Map<ModelKey, PropModel>();
  private meshes = new Map<ModelKey, THREE.InstancedMesh[]>();
  readonly mats: PropMaterials;
  private dummy = new THREE.Object3D();
  /** posições das luminárias ativas (para luzes reais próximas à noite) */
  private lampHeads: THREE.Vector3[] = [];
  private nightLights: THREE.PointLight[] = [];

  constructor(noise: THREE.Texture) {
    this.group.name = 'props';
    this.mats = createPropMaterials(noise);
    for (let v = 0; v < 3; v++) {
      this.models.set(`tree${v}` as ModelKey, treeModel(v, 0, this.mats));
      this.models.set(`treeFar${v}` as ModelKey, treeModel(v, 1, this.mats));
    }
    this.models.set('palm', palmModel(this.mats));
    this.models.set('lamp', lampModel(this.mats));
    this.models.set('signal', signalModel(this.mats));
    this.models.set('bench', benchModel(this.mats));
    this.models.set('bus_stop', busStopModel(this.mats));
    this.models.set('bollard', bollardModel(this.mats));
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

  static modelFor(k: PropKind, rec: PropRec, far: boolean): ModelKey {
    if (k === 'tree') {
      const v = Math.floor(Math.abs(Math.sin(rec.p[0] * 12.9898 + rec.p[1] * 78.233) * 43758.5453) % 1 * 3) as 0 | 1 | 2;
      return (far ? `treeFar${v}` : `tree${v}`) as ModelKey;
    }
    return k as ModelKey;
  }

  /**
   * Reconstrói as instâncias a partir dos props dos chunks ativos.
   * near: props em detalhe; far: somente árvores simplificadas.
   */
  rebuild(near: PropRec[], far: PropRec[], vegetationDensity: number, heightAt: (x: number, z: number) => number) {
    const buckets = new Map<ModelKey, Inst[]>();
    const push = (key: ModelKey, rec: PropRec) => {
      const arr = buckets.get(key) ?? [];
      const y = rec.k === 'tree' || rec.k === 'palm' ? heightAt(rec.p[0], rec.p[1]) : heightAt(rec.p[0], rec.p[1]);
      arr.push({ p: rec.p, r: rec.r ?? 0, s: rec.s ?? 1, y });
      buckets.set(key, arr);
    };
    for (const rec of near) {
      if ((rec.k === 'tree' || rec.k === 'palm') && vegetationDensity < 1) {
        const h = Math.abs(Math.sin(rec.p[0] * 3.1 + rec.p[1] * 7.7) * 1e4) % 1;
        if (h > vegetationDensity) { push(PropSystem.modelFor(rec.k, rec, true), rec); continue; }
      }
      push(PropSystem.modelFor(rec.k, rec, false), rec);
    }
    for (const rec of far) if (rec.k === 'tree' || rec.k === 'palm') push(PropSystem.modelFor('tree', rec, true), rec);

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

  update(time: number) {
    this.mats.windUniform.value = time;
  }

  get instanceCount() {
    let n = 0;
    for (const ms of this.meshes.values()) n += ms[0]?.count ?? 0;
    return n;
  }
}

export const PROP_BASE_Y = CURB_HEIGHT;
