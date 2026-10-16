/**
 * Modelos de veículos (Rodada 5 — overhaul visual, docs/VEHICLES_VISUAL.md).
 *
 * Os modelos são gerados proceduralmente no Blender (tools/vehicles/build_vehicles.py) e publicados em
 * public/vehicles/vehicles.glb (meshopt + quantização). Cada modelo tem dois níveis de detalhe
 * (<nome>_LOD0 / <nome>_LOD1) e vários materiais identificados pelo nome (paint, glass, trim, rubber…).
 *
 * Para desenhar dezenas de veículos com poucos draw calls, cada modelo/LOD vira UMA geometria: o material
 * de cada primitiva é "assado" em atributos por vértice — cor base (color) e aPbr = (rugosidade,
 * metalicidade, máscara de pintura, classe de emissão). Um único MeshPhysicalMaterial (com verniz/clearcoat
 * só na pintura) lê esses atributos; a cor da pintura vem do instanceColor de cada veículo.
 * Sem o GLB (testes, falha de rede) usa os modelos de caixas antigos como reserva.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type VehicleModelName = 'sedan' | 'hatch' | 'suv' | 'taxi' | 'bus';
export const VEHICLE_MODELS: VehicleModelName[] = ['sedan', 'hatch', 'suv', 'taxi', 'bus'];

/** classes de emissão (aPbr.w): 0 nenhuma, 1 farol, 2 lanterna, 3 letreiro de ônibus, 4 luminoso do táxi */
interface MatDef { rough: number; metal: number; paint: number; emit: number; color?: number }
/** propriedades por nome de material do GLB (cores vêm do próprio GLB, exceto quando indicado) */
export const VEHICLE_MATS: Record<string, MatDef> = {
  paint: { rough: 0.34, metal: 0.45, paint: 1, emit: 0 },
  glass: { rough: 0.05, metal: 0.3, paint: 0, emit: 0 },
  trim: { rough: 0.6, metal: 0, paint: 0, emit: 0 },
  rubber: { rough: 0.92, metal: 0, paint: 0, emit: 0 },
  alloy: { rough: 0.32, metal: 0.9, paint: 0, emit: 0 },
  chrome: { rough: 0.14, metal: 1, paint: 0, emit: 0 },
  lamp_front: { rough: 0.08, metal: 0.85, paint: 0, emit: 1 },
  lamp_rear: { rough: 0.12, metal: 0.1, paint: 0, emit: 2 },
  lamp_amber: { rough: 0.15, metal: 0.1, paint: 0, emit: 0 },
  stripe: { rough: 0.32, metal: 0.3, paint: 0, emit: 0 },
  plate: { rough: 0.45, metal: 0, paint: 0, emit: 0 },
  sign: { rough: 0.35, metal: 0, paint: 0, emit: 3 },
  sign_taxi: { rough: 0.35, metal: 0, paint: 0, emit: 4 },
};

const cache = new Map<string, THREE.BufferGeometry>();
let loaded = false;

/** carrega o GLB dos veículos (uma vez). Resolve false se indisponível (usa os modelos de reserva). */
export async function loadVehicleModels(url = `${import.meta.env?.BASE_URL ?? '/'}vehicles/vehicles.glb`): Promise<boolean> {
  if (loaded) return true;
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    for (const name of VEHICLE_MODELS) {
      for (const lod of [0, 1]) {
        const node = gltf.scene.getObjectByName(`${name}_LOD${lod}`);
        if (!node) continue;
        const parts: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = [];
        node.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const geo = toFloat(m.geometry, m.matrixWorld);
          parts.push({ geo, mat: m.material as THREE.MeshStandardMaterial });
        });
        const g = bake(parts.map((p) => ({ geo: p.geo, name: p.mat.name.replace(/\.\d+$/, ''), color: p.mat.color })));
        if (g) cache.set(`${name}:${lod}`, g);
      }
    }
    loaded = cache.size > 0;
    return loaded;
  } catch (e) {
    console.warn('veículos: GLB indisponível, usando modelos de reserva', e);
    return false;
  }
}

export function vehicleModelsLoaded() { return loaded; }

/** converte atributos quantizados (int16 normalizado) em float32 e aplica a transformação do nó */
function toFloat(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const arr = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { arr[i * 3] = a.getX(i); arr[i * 3 + 1] = a.getY(i); arr[i * 3 + 2] = a.getZ(i); }
    g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  g.applyMatrix4(m);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** junta primitivas (uma por material) numa geometria com atributos color + aPbr */
export function bake(parts: { geo: THREE.BufferGeometry; name: string; color?: THREE.Color }[]): THREE.BufferGeometry | null {
  const out: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const def = VEHICLE_MATS[p.name] ?? VEHICLE_MATS.trim;
    let g = p.geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.index) {
      const idx = new Uint32Array(g.getAttribute('position').count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      g = g.clone();
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3), pbr = new Float32Array(n * 4);
    const c = def.paint ? new THREE.Color(1, 1, 1) : def.color !== undefined ? new THREE.Color(def.color) : (p.color ?? new THREE.Color(0.02, 0.02, 0.02));
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      pbr[i * 4] = def.rough; pbr[i * 4 + 1] = def.metal; pbr[i * 4 + 2] = def.paint; pbr[i * 4 + 3] = def.emit;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 4));
    out.push(g);
  }
  if (!out.length) return null;
  const merged = mergeGeometries(out);
  if (!merged) return null;
  merged.computeBoundingSphere();
  return merged;
}

/** geometria de um modelo/LOD (GLB carregado ou reserva procedural de caixas) */
export function getVehicleGeometry(name: VehicleModelName, lod: 0 | 1, fallback: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const key = `${name}:${lod}`;
  let g = cache.get(key) ?? cache.get(`${name}:0`);
  if (!g) {
    g = fallback();
    cache.set(key, g);
  }
  return g;
}

// ------------------------------------------------------------------------------- material
/** intensidades de emissão: x faróis, y lanternas, z letreiros de ônibus, w luminoso do táxi */
export const vehicleEmit = { value: new THREE.Vector4(0, 0.25, 0.9, 0) };
let sharedMat: THREE.MeshPhysicalMaterial | null = null;

/** material único dos veículos: lê aPbr/color por vértice; verniz (clearcoat) só na pintura */
export function vehicleMaterial(): THREE.MeshPhysicalMaterial {
  if (sharedMat) return sharedMat;
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 });
  mat.name = 'vehicle';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uEmit = vehicleEmit;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPbr;\nvarying vec4 vPbr;')
      .replace('#include <color_vertex>', `#include <color_vertex>
  vPbr = aPbr;
#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
  vColor.rgb = color.rgb * mix( vec3( 1.0 ), instanceColor.rgb, aPbr.z );
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPbr;\nuniform vec4 uEmit;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = vPbr.y;')
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= vPbr.z;
#endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float ec = vPbr.w;
    vec3 et = ec < 0.5 ? vec3( 0.0 ) : ec < 1.5 ? vec3( 1.0, 0.94, 0.82 ) * uEmit.x : ec < 2.5 ? vec3( 1.0, 0.06, 0.03 ) * uEmit.y
      : ec < 3.5 ? vec3( 1.0, 0.55, 0.08 ) * uEmit.z : vec3( 1.0, 0.95, 0.8 ) * uEmit.w;
    totalEmissiveRadiance += et;
  }`);
  };
  mat.customProgramCacheKey = () => 'vehicle-v1';
  sharedMat = mat;
  return mat;
}

/** atualiza as luzes conforme a noite (0 dia … 1 noite) */
export function setVehicleNight(night: number) {
  const v = vehicleEmit.value;
  v.x = night * 3.2; // faróis
  v.y = 0.15 + night * 1.6; // lanternas (sempre um pouco acesas: leitura de "luz")
  v.z = 0.7 + night * 1.2; // letreiro LED de destino
  v.w = night * 1.4; // luminoso do táxi
}

/** escolha determinística do modelo de passeio pelo id do veículo (todos os clientes concordam) */
export function carModelFor(id: number): VehicleModelName {
  const h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const r = (h >>> 8) % 100;
  return r < 45 ? 'sedan' : r < 78 ? 'hatch' : 'suv';
}
