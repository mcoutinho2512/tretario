/**
 * Variação de roupa no SHADER, sem texturas por design:
 *  - camisas de futebol (designs.ts, família 'football', alvo 'shirt'): listras, aros, faixa diagonal, tricolor, gola…
 *    calculados no espaço do corpo em repouso (m, relativo ao peito) a partir da paleta do design → o mesmo padrão
 *    em todas as distâncias (LOD0/1 na camada SHIRT; LOD2/3 e multidão instanciada na malha única)
 *  - variantes de peça nos LODs de malha única (que só têm a roupa base): regata (braço com cor de pele), manga longa,
 *    bermuda (canela com cor de pele), chinelo, cabeça raspada — por ZONAS do corpo (atributo `_zone`, calculado pelos
 *    ossos do próprio esqueleto) e pela aparência empacotada (garments.ts `packLook`)
 * Sem escudos, textos ou marcas. Uniformes licenciados entram como design com `texture` (camiseta base, LOD0/1).
 */
import * as THREE from 'three';
import { DESIGNS, DESIGN_BY_ID, type Design } from '../../social/designs';
import { boundaryVerts } from './hideCovered';

export const PATTERN_CODE: Record<string, number> = { solid: 1, hoops: 2, v_stripes: 3, tricolor_v: 4, sash: 5, border: 6, h_stripes: 7, split_v: 8, split_h: 9 };
const MAX_SLOTS = 16;

/** paletas dos designs de camisa (uniformes compartilhados por TODOS os materiais de personagem) */
export const designUniforms = {
  uDesBg: { value: Array.from({ length: MAX_SLOTS }, () => new THREE.Color()) },
  uDesAcc: { value: Array.from({ length: MAX_SLOTS }, () => new THREE.Color()) },
  uDesThird: { value: Array.from({ length: MAX_SLOTS }, () => new THREE.Color()) },
  uDesPat: { value: new Array<number>(MAX_SLOTS).fill(0) },
};
let slots: Design[] | null = null;
/** designs de camisa em ordem de id (slot = posição + 1; 0 = camisa lisa) */
export function shirtDesigns(): Design[] {
  if (!slots) {
    slots = DESIGNS.filter((d) => d.targets.includes('shirt')).sort((a, b) => a.id - b.id).slice(0, MAX_SLOTS - 1);
    slots.forEach((d, i) => {
      const p = d.palette;
      designUniforms.uDesBg.value[i + 1].set(p.bg);
      designUniforms.uDesAcc.value[i + 1].set(p.accent ?? p.fg);
      designUniforms.uDesThird.value[i + 1].set(p.third ?? p.fg);
      designUniforms.uDesPat.value[i + 1] = PATTERN_CODE[d.pattern] ?? 1;
    });
  }
  return slots;
}
/** slot do shader para um id de design (0 = sem design / não é camisa) */
export function shirtSlot(id: number | undefined): number {
  if (!id) return 0;
  const i = shirtDesigns().findIndex((d) => d.id === id);
  return i < 0 ? 0 : i + 1;
}
/** design de camisa válido (ou undefined) */
export function shirtDesign(id: number | undefined): Design | undefined {
  const d = id ? DESIGN_BY_ID.get(id) : undefined;
  return d && d.targets.includes('shirt') ? d : undefined;
}

/** padrão da camisa: `r` = (x lateral, y relativo ao peito, z, distância à borda da peça) em m */
export const PATTERN_GLSL = /* glsl */ `
uniform vec3 uDesBg[${MAX_SLOTS}];
uniform vec3 uDesAcc[${MAX_SLOTS}];
uniform vec3 uDesThird[${MAX_SLOTS}];
uniform float uDesPat[${MAX_SLOTS}];
vec3 pvPattern(int slot, vec4 r) {
  vec3 bg = uDesBg[slot], ac = uDesAcc[slot];
  int p = int(uDesPat[slot] + 0.5);
  if (p == 2) return mod(floor(r.y / 0.075), 2.0) > 0.5 ? ac : bg;
  if (p == 3) return mod(floor(r.x / 0.07 + 0.5), 2.0) > 0.5 ? ac : bg;
  if (p == 4) { float k = mod(floor(r.x / 0.06 + 0.5), 3.0); return k < 0.5 ? bg : k < 1.5 ? uDesThird[slot] : ac; }
  if (p == 5) return abs(r.x + r.y * 1.1) * 0.67 < 0.05 ? ac : bg;
  if (p == 6) return r.w < 0.028 ? ac : bg;
  if (p == 7) return mod(floor(r.y / 0.12), 2.0) > 0.5 ? ac : bg;
  if (p == 8) return r.x > 0.0 ? ac : bg;
  if (p == 9) return r.y > 0.0 ? ac : bg;
  return bg;
}`;

/** camada SHIRT dos LODs 0/1: textura (detalhe/dobras) × padrão. `mat.color` deve levar a média da textura a branco */
export function patchShirtShader(sh: THREE.WebGLProgramParametersWithUniforms, slot: { value: number }) {
  Object.assign(sh.uniforms, designUniforms, { uShirtSlot: slot });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 _rest;\nvarying vec4 vRest;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = _rest;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec4 vRest;\nuniform int uShirtSlot;\n${PATTERN_GLSL}`)
    .replace('#include <map_fragment>', '#include <map_fragment>\nif (uShirtSlot > 0) diffuseColor.rgb *= pvPattern(uShirtSlot, vRest);');
}

/**
 * Malha única (LOD2/3 com esqueleto, ou multidão VAT): variantes e padrão por zona. Requer, antes deste patch, o
 * código de tinta por camada (`_layer`, `vTint`, linha `diffuseColor.rgb *= vTint;`).
 *  - instanced: aparência por instância (`aLook` = [look empacotado, slot do design]; cores aSkin/aTop)
 *  - senão: uniformes do personagem (`uLook`, `uTints`)
 */
export function patchLookShader(sh: THREE.WebGLProgramParametersWithUniforms, o: { instanced: boolean; layerAvg: { value: THREE.Color[] }; look?: { value: THREE.Vector2 }; inflate?: number }) {
  Object.assign(sh.uniforms, designUniforms, { uLayerAvg: o.layerAvg }, o.look ? { uLook: o.look } : {});
  // rodada 9.1: a pele decimada atravessava camisa/calça em manchas ("buracos" de perto): roupa afastada pela normal
  // (como a camiseta do LOD0), depois do skinning/VAT; camisa mais que a calça (fica por cima na cintura) e presa na
  // gola (`_rest.w` = distância à borda, `_rest.y` = altura sobre o peito) para não abrir fresta escura no pescoço
  const k = (o.inflate ?? 0).toFixed(4);
  const inflate = o.inflate ? `{ int il = int(_layer + 0.5); if (il == 2 || il == 3) transformed += normalize(objectNormal) * ${k} * (il == 2 ? (_rest.y > 0.1 ? smoothstep(0.0, 0.03, _rest.w) : 1.0) : 0.45); }\n` : '';
  const src = o.instanced
    ? 'vLook = aLook; vSkinAbs = aSkin * uLayerAvg[0]; vTopAbs = aTop * uLayerAvg[2];'
    : 'vLook = uLook; vSkinAbs = uTints[0] * uLayerAvg[0]; vTopAbs = uTints[2] * uLayerAvg[2];';
  const vary = 'varying vec4 vRest;\nvarying vec2 vZone;\nvarying float vLayer;\nvarying vec2 vLook;\nvarying vec3 vSkinAbs;\nvarying vec3 vTopAbs;\nuniform vec3 uLayerAvg[5];';
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec4 _rest;\nattribute vec2 _zone;\n${o.instanced ? 'attribute vec2 aLook;' : 'uniform vec2 uLook;'}\n${vary}`)
    .replace('#include <project_vertex>', `${inflate}vRest = _rest; vZone = _zone; vLayer = _layer; ${src}\n#include <project_vertex>`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\n${vary}\n${PATTERN_GLSL}`)
    .replace('diffuseColor.rgb *= vTint;', `diffuseColor.rgb *= vTint;
{
  float lk = vLook.x;
  int slot = int(vLook.y + 0.5), top = int(mod(lk, 8.0)), bot = int(mod(floor(lk / 8.0), 4.0)), sho = int(mod(floor(lk / 32.0), 4.0));
  int layer = int(vLayer + 0.5), zone = int(vZone.x + 0.5);
  vec3 shirtCol = slot > 0 ? pvPattern(slot, vRest) : vTopAbs;
  if (layer == 2) {
    float lum = dot(vColor.rgb, vec3(0.333)) / max(0.04, dot(uLayerAvg[2], vec3(0.333)));
    if (top == 1 && (zone & 6) != 0) diffuseColor.rgb = vSkinAbs;
    else if (slot > 0) diffuseColor.rgb = shirtCol * clamp(lum, 0.6, 1.3);
  } else if (layer == 0) {
    if (top == 3 && (zone & 4) != 0) diffuseColor.rgb = shirtCol;
  } else if (layer == 3) {
    if (bot == 2 && vZone.y < 0.0) diffuseColor.rgb = vSkinAbs;
  } else if (layer == 4) {
    if (sho == 2) diffuseColor.rgb = mix(vSkinAbs, diffuseColor.rgb, 0.3);
  } else if (layer == 1) {
    // cabelo: a cor de vértice foi assada da textura com alfa (cartões) e trazia os texels transparentes (manchas
    // verdes/marrons): só a luminância, perto da média, sobre a cor do cabelo
    float hl = dot(vColor.rgb, vec3(0.333)) / max(0.04, dot(uLayerAvg[1], vec3(0.333)));
    diffuseColor.rgb = uLayerAvg[1] * vTint * clamp(hl, 0.8, 1.15);
    if (mod(floor(lk / 128.0), 2.0) > 0.5) diffuseColor.rgb = vSkinAbs;
  }
}`);
}

/** bits de `_zone.x` (`_zone.y` = altura em relação ao joelho, m: corte reto da bermuda por fragmento) */
export const ZONE = { UPPER_ARM: 2, FOREARM: 4 } as const;

/**
 * Atributos de repouso de uma malha com esqueleto (cache por geometria): `_rest` (x, y relativo ao peito, z, distância
 * à borda da peça) e `_zone` (braço / antebraço pelos ossos; altura em relação ao joelho). `shirtLayer`: só os vértices com `_layer` igual
 * a ele contam como peça para a distância à borda (malha única); sem ele, a malha inteira é a peça.
 * A malha precisa estar na pose de repouso com as matrizes atualizadas.
 */
const restDone = new WeakSet<THREE.BufferGeometry>();
export function addRestAttributes(sm: THREE.SkinnedMesh, pos: Float32Array, shirtLayer?: number) {
  const g = sm.geometry;
  if (restDone.has(g)) return;
  restDone.add(g);
  const n = pos.length / 3;
  const inv = sm.bindMatrixInverse;
  const bone = (name: string) => {
    const b = sm.skeleton.bones.find((x) => x.name === name);
    return b ? b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null;
  };
  const chest = bone('spine_03')?.y ?? 1.3;
  const knee = bone('calf_l')?.y ?? 0.5;
  const arms = (['l', 'r'] as const).map((s) => [bone(`upperarm_${s}`), bone(`lowerarm_${s}`), bone(`hand_${s}`)]).filter((a) => a.every(Boolean)) as THREE.Vector3[][];
  // borda da peça (gola, mangas, barra): distância de cada vértice ao vértice de borda mais próximo (até 10 cm)
  const lay = shirtLayer !== undefined ? g.getAttribute('_layer') : null;
  const inPiece = (i: number) => !lay || Math.round(lay.getX(i)) === shirtLayer;
  const idx = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
  const tri: number[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) if (inPiece(idx[t]) && inPiece(idx[t + 1]) && inPiece(idx[t + 2])) tri.push(idx[t], idx[t + 1], idx[t + 2]);
  const C = 0.05, grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / C)},${Math.floor(y / C)},${Math.floor(z / C)}`;
  for (const i of tri.length ? boundaryVerts(pos, tri) : []) { const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); }
  const rest = new Float32Array(n * 4), zone = new Float32Array(n * 2);
  const p = new THREE.Vector3(), seg = new THREE.Vector3(), d = new THREE.Vector3();
  const along = (a: THREE.Vector3, b: THREE.Vector3) => {
    seg.subVectors(b, a);
    const t = d.subVectors(p, a).dot(seg) / seg.lengthSq();
    const dist = d.subVectors(p, a).addScaledVector(seg, -THREE.MathUtils.clamp(t, 0, 1)).length();
    return { t, dist };
  };
  for (let i = 0; i < n; i++) {
    p.fromArray(pos, i * 3);
    let e = 0.1;
    if (inPiece(i)) {
      const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C), cz = Math.floor(p.z / C);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (const j of grid.get(`${cx + a},${cy + b},${cz + c}`) ?? []) e = Math.min(e, Math.hypot(pos[j * 3] - p.x, pos[j * 3 + 1] - p.y, pos[j * 3 + 2] - p.z));
      }
    }
    rest[i * 4] = p.x; rest[i * 4 + 1] = p.y - chest; rest[i * 4 + 2] = p.z; rest[i * 4 + 3] = e;
    let z = 0;
    for (const [sh, el, wr] of arms) {
      const up = along(sh, el), fo = along(el, wr);
      // mesmo corte da regata derivada da camiseta no Blender (build_character.py derive_sleeveless)
      if ((Math.abs(p.x) > Math.abs(sh.x) - 0.035 && p.y > sh.y - 0.11 && p.x * sh.x > 0) || (up.t > 0.25 && up.t <= 1 && up.dist < 0.11)) z |= ZONE.UPPER_ARM;
      if (fo.t > 0 && fo.t < 0.97 && fo.dist < 0.08) z |= ZONE.FOREARM;
    }
    zone[i * 2] = z;
    zone[i * 2 + 1] = p.y - (knee - 0.03);
  }
  g.setAttribute('_rest', new THREE.BufferAttribute(rest, 4));
  g.setAttribute('_zone', new THREE.BufferAttribute(zone, 2));
}
