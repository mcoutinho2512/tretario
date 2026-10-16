/**
 * Materiais dos itens: UM material de "corpo" para todas as partes rígidas (madeira, papelão, plástico, metal —
 * rugosidade/metalicidade por vértice), materiais de design compartilhados por (parte, design) com contagem de
 * referências, e o shader de TECIDO (bandeiras, faixas) sem física por bandeira:
 *
 *  - onda viajante a partir do mastro, amplitude crescendo com a distância ao mastro, ondulação secundária e
 *    rajada lenta; vento global (`setPropWind`) e fase por objeto/instância tirada da posição no mundo
 *  - normais aproximadas pelas derivadas analíticas da onda (a luz acompanha as dobras)
 *  - dupla face com o design legível dos dois lados (o verso espelha o U dentro da célula)
 *  - variante barata (`cheap`: uma onda só) para tecido distante; variante instanciada com célula do atlas por
 *    instância (multidão distante)
 */
import * as THREE from 'three';
import { assetManager } from '../../core/AssetManager';
import { designTexture } from '../designPainter';
import type { DesignTarget } from '../designs';

export const PROP_CATEGORY = 'social/props';

// ------------------------------------------------------------------ relógio e vento (compartilhados)
/** uniforms globais do tecido: um só objeto referenciado por todos os materiais (uma escrita por quadro) */
export const clothUniforms = { uTime: { value: 0 }, uWind: { value: 0.55 } };
/** vento no MUNDO (direção normalizada em XZ e força 0..1) — o tecido gira em torno do mastro para ficar a favor */
export const propWind = { dirX: 0.8, dirZ: 0.6, strength: 0.55 };

export function setPropWind(dirX: number, dirZ: number, strength: number) {
  const l = Math.hypot(dirX, dirZ) || 1;
  propWind.dirX = dirX / l; propWind.dirZ = dirZ / l;
  propWind.strength = THREE.MathUtils.clamp(strength, 0, 1);
  clothUniforms.uWind.value = propWind.strength;
}

/** atualiza o relógio do tecido; chamado no onBeforeRender de cada malha de tecido (idempotente no quadro) */
export function tickPropClock() { clothUniforms.uTime.value = performance.now() / 1000; }

// ------------------------------------------------------------------ textura de desgaste (procedural)
let wearTex: THREE.CanvasTexture | null = null;
/** ruído suave + arranhões + manchas (cinza perto de 1): multiplica a cor das partes rígidas e dos cartazes */
export function wearTexture(): THREE.CanvasTexture {
  if (wearTex) return wearTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // manchas largas (sujeira, mãos)
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 28, g = 200 + rnd() * 50;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${g},${g},${g},0.35)`);
    grd.addColorStop(1, `rgba(${g},${g},${g},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grão fino
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // arranhões finos
  ctx.strokeStyle = 'rgba(160,160,160,0.35)';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 4 + rnd() * 20;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  wearTex = new THREE.CanvasTexture(c);
  wearTex.wrapS = wearTex.wrapT = THREE.RepeatWrapping;
  wearTex.colorSpace = THREE.SRGBColorSpace;
  wearTex.name = 'prop_wear';
  wearTex.userData.category = PROP_CATEGORY;
  assetManager.register({ category: PROP_CATEGORY, texture: wearTex });
  return wearTex;
}

// ------------------------------------------------------------------ material do corpo (partes rígidas)
let bodyMat: THREE.MeshStandardMaterial | null = null;
/**
 * Material ÚNICO das partes rígidas de todos os itens (perto e instanciados): cor por vértice × desgaste;
 * rugosidade e metalicidade vêm do atributo `aPbr` (madeira fosca e alumínio na mesma malha, um draw call).
 */
export function propBodyMaterial(): THREE.MeshStandardMaterial {
  if (bodyMat) return bodyMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, map: wearTexture() });
  m.name = 'prop_body';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPbr;\nvarying vec2 vPbr;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPbr = aPbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
  };
  m.customProgramCacheKey = () => 'pv-prop-body';
  assetManager.register({ category: PROP_CATEGORY, material: m });
  bodyMat = m;
  return m;
}

// ------------------------------------------------------------------ tecido
export interface ClothOptions {
  /** faixa: presa nas duas pontas (envelope seno), sem cair */
  banner?: boolean;
  /** só a onda principal (tecido distante) */
  cheap?: boolean;
  /** design por instância (atributo `aCell` = [u0, v0, du, dv] do atlas) */
  atlas?: boolean;
  /** largura × altura do tecido em unidades da geometria (a amplitude/comprimento de onda escalam com ela) */
  dims: [number, number];
}

const CLOTH_VERTEX_HEAD = /* glsl */`
uniform float uTime;
uniform float uWind;
uniform vec2 uDims;
#ifdef DESIGN_ATLAS
attribute vec4 aCell;
varying vec4 vCell;
#endif
float clothPhase() {
#ifdef USE_INSTANCING
  vec3 o = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
  vec3 o = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
  // fase pela posição no mundo: bandeiras vizinhas não ondulam em sincronia
  return dot(o.xz, vec2(0.73, 0.41)) + o.y * 0.37;
}`;

/** substitui beginnormal_vertex: desloca o tecido e calcula a normal analítica (x = 0 no mastro, y = 0 no topo) */
const CLOTH_DISPLACE = /* glsl */`
vec3 clothPos = position;
float W = uDims.x, H = uDims.y;
float cs = clamp(position.x / W, 0.0, 1.0);
float w = clamp(uWind, 0.0, 1.0);
float ph = clothPhase();
#ifdef CLOTH_BANNER
  float env = sin(3.14159 * cs);
  float amp = H * (0.035 + 0.05 * w) * env;
  float k = 6.2832 / (W * 0.55);
#else
  float env = pow(cs, 1.15);
  // bandeiras grandes ondulam com mais ondas (comprimento de onda cresce mais devagar que o pano)
  float amp = W * (0.024 + 0.05 * w) * env;
  float k = 6.2832 / (pow(W, 0.75) * 0.75);
#endif
float om = 4.5 + 5.0 * w;
float a1 = k * position.x - om * uTime + ph;
float dz = amp * sin(a1);
float dzdx = amp * k * cos(a1);
float dzdy = 0.0;
#ifndef CLOTH_CHEAP
  // ondulação secundária (diagonal, mais rápida) e rajada lenta
  float k2 = k * 2.3, ky = 3.0 / H;
  float a2 = k2 * position.x + ky * position.y - om * 1.7 * uTime + ph * 1.37;
  float amp2 = amp * 0.3;
  dz += amp2 * sin(a2);
  dzdx += amp2 * k2 * cos(a2);
  dzdy += amp2 * ky * cos(a2);
  float gust = 0.8 + 0.4 * (0.5 + 0.5 * sin(uTime * 0.7 + ph * 0.5));
  dz *= gust; dzdx *= gust; dzdy *= gust;
#endif
clothPos.z += dz;
#ifdef CLOTH_BANNER
  // faixa: barriga leve no meio
  clothPos.y -= H * 0.05 * env;
#else
  // o tecido recolhe ao ondular e cai quando o vento é fraco
  clothPos.x -= W * cs * (0.02 + 0.03 * w);
  clothPos.y -= (1.0 - w) * H * 0.4 * cs * cs;
#endif
vec3 objectNormal = normalize(vec3(-dzdx, -dzdy, 1.0));
`;

/** amostragem do design: o verso espelha U (texto legível dos dois lados) */
const DESIGN_MAP_FRAGMENT = /* glsl */`
#ifdef USE_MAP
  vec2 muv = vMapUv;
#ifdef DESIGN_ATLAS
  if (!gl_FrontFacing) muv.x = vCell.x + vCell.z - (muv.x - vCell.x);
#else
  if (!gl_FrontFacing) muv.x = 1.0 - muv.x;
#endif
  diffuseColor *= texture2D(map, muv);
#endif
`;

/** aplica o shader de tecido num MeshStandardMaterial (map = textura do design ou atlas) */
export function patchCloth(m: THREE.MeshStandardMaterial, o: ClothOptions) {
  const dims = { value: new THREE.Vector2(o.dims[0], o.dims[1]) };
  m.side = THREE.DoubleSide;
  m.defines = { ...(m.defines ?? {}), ...(o.banner ? { CLOTH_BANNER: '' } : {}), ...(o.cheap ? { CLOTH_CHEAP: '' } : {}), ...(o.atlas ? { DESIGN_ATLAS: '' } : {}) };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, clothUniforms, { uDims: dims });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${CLOTH_VERTEX_HEAD}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef DESIGN_ATLAS
  vMapUv = aCell.xy + uv * aCell.zw;
  vCell = aCell;
#endif`)
      .replace('#include <beginnormal_vertex>', CLOTH_DISPLACE)
      .replace('#include <begin_vertex>', 'vec3 transformed = clothPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n#ifdef DESIGN_ATLAS\nvarying vec4 vCell;\n#endif')
      .replace('#include <map_fragment>', DESIGN_MAP_FRAGMENT);
  };
  m.customProgramCacheKey = () => `pv-cloth${o.banner ? '-b' : ''}${o.cheap ? '-c' : ''}${o.atlas ? '-a' : ''}`;
  m.userData.clothDims = dims;
}

/** cartaz: design × desgaste leve; instanciado lê a célula do atlas por instância */
export function patchFace(m: THREE.MeshStandardMaterial, atlas: boolean) {
  const wear = { value: wearTexture() };
  if (atlas) m.defines = { ...(m.defines ?? {}), DESIGN_ATLAS: '' };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWear = wear;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWearUv;\n#ifdef DESIGN_ATLAS\nattribute vec4 aCell;\nvarying vec4 vCell;\n#endif')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vWearUv = uv * 1.7;
#ifdef DESIGN_ATLAS
  vMapUv = aCell.xy + uv * aCell.zw;
  vCell = aCell;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uWear;\nvarying vec2 vWearUv;\n#ifdef DESIGN_ATLAS\nvarying vec4 vCell;\n#endif')
      .replace('#include <map_fragment>', `${DESIGN_MAP_FRAGMENT}\ndiffuseColor.rgb *= mix(1.0, texture2D(uWear, vWearUv).r, 0.55);`);
  };
  m.customProgramCacheKey = () => `pv-prop-face${atlas ? '-a' : ''}`;
}

// ------------------------------------------------------------------ materiais de design (contagem de referências)
export type DesignPartKind = 'flag_small' | 'flag_large' | 'banner' | 'big' | 'face';

interface MatEntry { mat: THREE.MeshStandardMaterial; refs: number; tex: THREE.Texture; unregister: () => void }
const designMats = new Map<string, MatEntry>();
const texRefs = new Map<THREE.Texture, number>();
const PART_TARGET: Record<DesignPartKind, DesignTarget> = { flag_small: 'flag', flag_large: 'flag', big: 'flag', banner: 'banner', face: 'sign' };
/** altura (px) da textura do design por parte: legível de perto sem desperdiçar memória */
const PART_RES: Record<DesignPartKind, number> = { flag_small: 256, flag_large: 512, big: 512, banner: 256, face: 512 };

/**
 * Material de design compartilhado: mesmo (parte, design, LOD) ⇒ mesma instância para todos os personagens.
 * Devolver com `releaseDesignMaterial` (com 0 referências o material e — se ninguém mais usa — a textura saem da GPU).
 */
export function acquireDesignMaterial(part: DesignPartKind, design: number, dims: [number, number], cheap = false): THREE.MeshStandardMaterial {
  const key = `${part}:${design}:${cheap ? 1 : 0}:${dims[0]}x${dims[1]}`;
  const e = designMats.get(key);
  if (e) { e.refs++; return e.mat; }
  const tex = designTexture(design, PART_TARGET[part], PART_RES[part]);
  texRefs.set(tex, (texRefs.get(tex) ?? 0) + 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: part === 'face' ? 0.82 : 0.78, metalness: 0 });
  mat.name = `prop_${key}`;
  if (part === 'face') patchFace(mat, false);
  else patchCloth(mat, { banner: part === 'banner', cheap, dims });
  mat.userData.designKey = key;
  const unregister = assetManager.register({ category: PROP_CATEGORY, material: mat });
  designMats.set(key, { mat, refs: 1, tex, unregister });
  return mat;
}

export function releaseDesignMaterial(mat: THREE.Material) {
  const key = mat.userData.designKey as string | undefined;
  const e = key ? designMats.get(key) : undefined;
  if (!e || --e.refs > 0) return;
  designMats.delete(key!);
  e.unregister();
  e.mat.dispose();
  const n = (texRefs.get(e.tex) ?? 1) - 1;
  // a textura fica no cache do pintor: dispose só libera a GPU (ela é reenviada se voltar a ser usada)
  if (n <= 0) { texRefs.delete(e.tex); e.tex.dispose(); } else texRefs.set(e.tex, n);
}

/** materiais de design vivos (QA/testes de vazamento) */
export function designMaterialStats() {
  return { materials: designMats.size, refs: [...designMats.values()].reduce((s, e) => s + e.refs, 0), textures: texRefs.size };
}

// ------------------------------------------------------------------ cor sólida (lona do guarda-chuva)
const solidMats = new Map<number, { mat: THREE.MeshStandardMaterial; refs: number }>();
export function acquireSolidMaterial(hex: number): THREE.MeshStandardMaterial {
  const e = solidMats.get(hex);
  if (e) { e.refs++; return e.mat; }
  const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  mat.name = `prop_solid_${hex.toString(16)}`;
  mat.userData.solidKey = hex;
  solidMats.set(hex, { mat, refs: 1 });
  return mat;
}
export function releaseSolidMaterial(mat: THREE.Material) {
  const hex = mat.userData.solidKey as number | undefined;
  const e = hex !== undefined ? solidMats.get(hex) : undefined;
  if (!e || --e.refs > 0) return;
  solidMats.delete(hex!);
  e.mat.dispose();
}
