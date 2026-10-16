/**
 * Multidão INSTANCIADA com animação assada em textura (VAT — vertex animation texture).
 *
 * Para cada corpo (homem, mulher, idoso, idosa) e para as malhas únicas LOD2 (~2,5 k tri) e LOD3 (~600 tri):
 *  - na carga, o próprio esqueleto do personagem toca idle/walk/jog e a posição SKINNED de cada vértice é gravada
 *    numa textura (half float) — um quadro por linha-bloco; nenhuma CPU por personagem depois disso
 *  - uma `InstancedMesh` por (corpo, LOD): 8 draw calls no máximo para a multidão inteira, qualquer que seja N
 *  - por instância: matriz (posição, rumo, escala), quadro A/B + mistura (interpola entre quadros assados) e as
 *    cores pele/cabelo/camisa/calça como multiplicadores da cor de vértice (mesma regra das malhas únicas)
 * O vertex shader troca `position` pela leitura da textura por `gl_VertexID` (WebGL2).
 * Normais: as do repouso (a esta distância a diferença de iluminação dos membros não é perceptível).
 */
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BODY_TYPES, type BodyType } from '../bodyTypes';
import { loadLod, LAYER_INDEX } from '../human/HumanAssets';
import { clipsFor, tint } from '../human/HumanCharacter';
import { measureNatural } from '../human/HumanAnimator';
import type { CrowdAgent } from './crowdBudget';

export const CROWD_BODIES: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];
/** quadros assados por ciclo (interpolados no shader) */
const CLIP_FRAMES: Record<'idle' | 'walk' | 'jog', number> = { idle: 8, walk: 16, jog: 12 };
const TEX_W = 1024;

interface ClipRows { row0: number; n: number; dur: number }
interface VatSet {
  body: number;
  lod: 2 | 3;
  mesh: THREE.InstancedMesh;
  clips: Record<'idle' | 'walk' | 'jog', ClipRows>;
  natural: { walk: number; jog: number };
  layerAvg: THREE.Color[];
  aAnim: THREE.InstancedBufferAttribute;
  aSkin: THREE.InstancedBufferAttribute;
  aHair: THREE.InstancedBufferAttribute;
  aTop: THREE.InstancedBufferAttribute;
  aBottom: THREE.InstancedBufferAttribute;
  tex: THREE.DataTexture;
  count: number;
}

const _target = new THREE.Color();

export class CrowdRenderer {
  readonly group = new THREE.Group();
  /** [corpo][0 = LOD2, 1 = LOD3] */
  private sets: (VatSet | null)[][] = CROWD_BODIES.map(() => [null, null]);
  ready = false;
  readonly stats = { drawn: 0, lod2: 0, lod3: 0, calls: 0, bakeMs: 0 };

  constructor(private capacity: number, private withLod2: boolean) {
    this.group.name = 'crowd_instanced';
  }

  /** assa as texturas de animação (uma vez); não bloqueia o jogo — até ficar pronto, nada é desenhado aqui */
  async init(): Promise<void> {
    const t0 = performance.now();
    const lods: (2 | 3)[] = this.withLod2 ? [2, 3] : [3];
    await Promise.all(CROWD_BODIES.flatMap((b, bi) => lods.map(async (l) => {
      try {
        this.sets[bi][l === 2 ? 0 : 1] = await this.bake(b, bi, l);
      } catch (e) { console.warn(`[multidão] falha ao assar ${b} LOD${l}`, e); }
    })));
    for (const row of this.sets) for (const s of row) if (s) this.group.add(s.mesh);
    this.ready = true;
    this.stats.bakeMs = Math.round(performance.now() - t0);
  }

  private async bake(body: BodyType, bi: number, lod: 2 | 3): Promise<VatSet> {
    const gltf = await loadLod(body, lod);
    const scene = cloneSkeleton(gltf.scene);
    let skinned: THREE.SkinnedMesh | null = null;
    let arm: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
      if ((o as THREE.Bone).isBone && o.name === 'Root') arm = o.parent;
    });
    if (!skinned || !arm) throw new Error('malha única/esqueleto não encontrados');
    const sm = skinned as THREE.SkinnedMesh;
    const armature = arm as THREE.Object3D;
    const pelvis = scene.getObjectByName('pelvis');
    const clips = await clipsFor(body, pelvis ? pelvis.position.clone() : new THREE.Vector3(0, 1, 0));
    const speedF = BODY_TYPES[body].speedFactor;
    const natural = {
      walk: clips.get('walk') ? measureNatural(`${body}:walk`, armature, clips.get('walk')!, 1.2 * speedF) : 1.2 * speedF,
      jog: clips.get('jog') ? measureNatural(`${body}:jog`, armature, clips.get('jog')!, 3.2 * speedF) : 3.2 * speedF,
    };
    const V = sm.geometry.getAttribute('position').count;
    const rowsPerFrame = Math.ceil(V / TEX_W);
    const names = ['idle', 'walk', 'jog'] as const;
    const totalFrames = names.reduce((s, n) => s + CLIP_FRAMES[n], 0);
    const data = new Uint16Array(TEX_W * rowsPerFrame * totalFrames * 4);
    const mixer = new THREE.AnimationMixer(armature);
    const v = new THREE.Vector3();
    const clipRows = {} as Record<'idle' | 'walk' | 'jog', ClipRows>;
    let frame = 0;
    for (const name of names) {
      const clip = clips.get(name) ?? clips.get('idle')!;
      const n = CLIP_FRAMES[name];
      clipRows[name] = { row0: frame, n, dur: clip.duration };
      const act = mixer.clipAction(clip);
      act.play();
      for (let f = 0; f < n; f++, frame++) {
        mixer.setTime((f / n) * clip.duration);
        scene.updateMatrixWorld(true);
        for (let i = 0; i < V; i++) {
          sm.getVertexPosition(i, v);
          v.applyMatrix4(sm.matrixWorld);
          const o = ((frame * rowsPerFrame + Math.floor(i / TEX_W)) * TEX_W + (i % TEX_W)) * 4;
          data[o] = THREE.DataUtils.toHalfFloat(v.x);
          data[o + 1] = THREE.DataUtils.toHalfFloat(v.y);
          data[o + 2] = THREE.DataUtils.toHalfFloat(v.z);
          data[o + 3] = THREE.DataUtils.toHalfFloat(1);
        }
      }
      act.stop();
    }
    mixer.uncacheRoot(armature);
    const tex = new THREE.DataTexture(data, TEX_W, rowsPerFrame * totalFrames, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    // geometria estática (sem pesos de osso): posição de repouso só para bounding; a real vem da textura
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'color', '_layer'] as const) {
      const a = sm.geometry.getAttribute(k);
      if (a) g.setAttribute(k, a.clone()); // cópia: o GLB em cache continua sendo usado pelos personagens com esqueleto
    }
    if (sm.geometry.index) g.setIndex(sm.geometry.index.clone());
    // cor média por camada (multiplicadores iguais aos das malhas únicas de HumanCharacter)
    const col = g.getAttribute('color'), lay = g.getAttribute('_layer');
    const sum = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0]);
    if (col && lay) for (let i = 0; i < col.count; i++) {
      const li = Math.round(lay.getX(i));
      if (li < 0 || li > 4) continue;
      sum[li][0] += col.getX(i); sum[li][1] += col.getY(i); sum[li][2] += col.getZ(i); sum[li][3]++;
    }
    const layerAvg = sum.map((s) => (s[3] ? new THREE.Color(s[0] / s[3], s[1] / s[3], s[2] / s[3]) : new THREE.Color(1, 1, 1)));

    const cap = this.capacity;
    const mk = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const aAnim = mk(3), aSkin = mk(3), aHair = mk(3), aTop = mk(3), aBottom = mk(3);
    g.setAttribute('aAnim', aAnim); g.setAttribute('aSkin', aSkin); g.setAttribute('aHair', aHair); g.setAttribute('aTop', aTop); g.setAttribute('aBottom', aBottom);

    const src = sm.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: src.roughness ?? 0.8, metalness: 0, color: 0xffffff });
    const uniforms = { uVat: { value: tex }, uVatW: { value: TEX_W }, uRowsPerFrame: { value: rowsPerFrame } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform highp sampler2D uVat;
uniform int uVatW;
uniform int uRowsPerFrame;
attribute vec3 aAnim;
attribute float _layer;
attribute vec3 aSkin;
attribute vec3 aHair;
attribute vec3 aTop;
attribute vec3 aBottom;
varying vec3 vTint;
vec3 vatFetch(int frame) {
  int vid = gl_VertexID;
  return texelFetch(uVat, ivec2(vid % uVatW, frame * uRowsPerFrame + vid / uVatW), 0).xyz;
}`)
        .replace('#include <begin_vertex>', `vec3 transformed = mix(vatFetch(int(aAnim.x)), vatFetch(int(aAnim.y)), aAnim.z);
int li = int(clamp(_layer + 0.5, 0.0, 4.0));
vTint = li == 0 ? aSkin : li == 1 ? aHair : li == 2 ? aTop : li == 3 ? aBottom : vec3(1.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTint;');
    };
    mat.customProgramCacheKey = () => 'pv-crowd-vat';
    const mesh = new THREE.InstancedMesh(g, mat, cap);
    mesh.name = `crowd_${body}_lod${lod}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // culling por instância na CPU (CrowdDirector)
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    void bi;
    return { body: bi, lod, mesh, clips: clipRows, natural, layerAvg, aAnim, aSkin, aHair, aTop, aBottom, tex, count: 0 };
  }

  private setFor(a: CrowdAgent): VatSet | null {
    const row = this.sets[a.body] ?? this.sets[0];
    return (a.lod === 2 ? row[0] : null) ?? row[1] ?? row[0];
  }

  /** desenha os agentes recebidos (já filtrados por tier/visibilidade); `dt` avança a animação de cada um */
  draw(agents: readonly CrowdAgent[], dt: number) {
    for (const row of this.sets) for (const s of row) if (s) s.count = 0;
    let lod2 = 0, lod3 = 0;
    if (this.ready) {
      for (const a of agents) {
        const s = this.setFor(a);
        if (!s || s.count >= this.capacity) continue;
        const i = s.count++;
        if (s.lod === 2) lod2++; else lod3++;
        // matriz: rotação Y (rumo) × escala, translação
        const m = s.mesh.instanceMatrix.array as Float32Array;
        const c = Math.cos(a.heading) * a.scale, sn = Math.sin(a.heading) * a.scale, o = i * 16;
        m[o] = c; m[o + 1] = 0; m[o + 2] = -sn; m[o + 3] = 0;
        m[o + 4] = 0; m[o + 5] = a.scale; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = sn; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0;
        m[o + 12] = a.x; m[o + 13] = a.y; m[o + 14] = a.z; m[o + 15] = 1;
        // animação: ciclo pela velocidade, cadência casada com o deslocamento (como o HumanAnimator)
        const clip = a.speed < 0.15 ? s.clips.idle : a.speed < 2.2 ? s.clips.walk : s.clips.jog;
        const nat = clip === s.clips.walk ? s.natural.walk : clip === s.clips.jog ? s.natural.jog : 0;
        const rate = nat > 0 ? Math.min(2.2, Math.max(0.35, a.speed / nat)) / clip.dur : 1 / clip.dur;
        a.phase = (a.phase + dt * rate) % 1;
        const f = a.phase * clip.n, f0 = Math.floor(f);
        const an = s.aAnim.array as Float32Array;
        an[i * 3] = clip.row0 + (f0 % clip.n);
        an[i * 3 + 1] = clip.row0 + ((f0 + 1) % clip.n);
        an[i * 3 + 2] = f - f0;
        this.writeTint(s.aSkin, i, a.skin, s.layerAvg[LAYER_INDEX.BODY], 'BODY');
        this.writeTint(s.aHair, i, a.hair, s.layerAvg[LAYER_INDEX.HAIR], 'HAIR');
        this.writeTint(s.aTop, i, a.top, s.layerAvg[LAYER_INDEX.SHIRT], 'SHIRT');
        this.writeTint(s.aBottom, i, a.bottom, s.layerAvg[LAYER_INDEX.PANTS], 'PANTS');
      }
    }
    let calls = 0;
    for (const row of this.sets) for (const s of row) {
      if (!s) continue;
      s.mesh.count = s.count;
      s.mesh.visible = s.count > 0;
      if (!s.count) continue;
      calls++;
      for (const at of [s.mesh.instanceMatrix, s.aAnim, s.aSkin, s.aHair, s.aTop, s.aBottom]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, s.count * at.itemSize);
        at.needsUpdate = true;
      }
    }
    this.stats.drawn = lod2 + lod3; this.stats.lod2 = lod2; this.stats.lod3 = lod3; this.stats.calls = calls;
  }

  private writeTint(attr: THREE.InstancedBufferAttribute, i: number, hex: number, avg: THREE.Color, layer: string) {
    _target.setHex(hex);
    const t = tint(_target, avg, layer);
    const arr = attr.array as Float32Array;
    arr[i * 3] = t[0]; arr[i * 3 + 1] = t[1]; arr[i * 3 + 2] = t[2];
  }

  dispose() {
    for (const row of this.sets) for (const s of row) {
      if (!s) continue;
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      s.tex.dispose();
      s.mesh.removeFromParent();
    }
  }
}
