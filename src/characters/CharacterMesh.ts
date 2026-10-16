/**
 * Personagem humanoide procedural com ESQUELETO REAL: uma única SkinnedMesh (1 draw call),
 * 17 ossos com nomes no estilo humanoide (Hips, Spine, Chest, Neck, Head, Left/Right UpperArm…).
 * Partes do corpo são presas rigidamente a um osso (skinning rígido) — leve e estável.
 * Cores por região (pele, cabelo, roupa…) via uniforms → um material por personagem, mesmo programa de shader.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY_TYPES, type BodyType, type CharacterAppearance } from './bodyTypes';

export const BONE_NAMES = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftUpperArm', 'LeftLowerArm', 'LeftHand', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'RightUpperLeg', 'RightLowerLeg', 'RightFoot',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];
const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

// regiões de cor
const R_SKIN = 0, R_HAIR = 1, R_TOP = 2, R_BOTTOM = 3, R_SHOES = 4, R_DARK = 5;

interface Rig {
  /** posição do osso em espaço de bind (mundo do personagem) */
  joints: Record<BoneName, THREE.Vector3>;
  parent: Partial<Record<BoneName, BoneName>>;
}

function buildRig(body: BodyType): Rig {
  const p = BODY_TYPES[body];
  const k = p.height / 1.76;
  const j: Record<string, THREE.Vector3> = {};
  j.Hips = new THREE.Vector3(0, 0.96 * k, 0);
  j.Spine = j.Hips.clone().add(new THREE.Vector3(0, 0.1 * k, 0));
  j.Chest = j.Spine.clone().add(new THREE.Vector3(0, 0.2 * k, 0));
  j.Neck = j.Chest.clone().add(new THREE.Vector3(0, 0.24 * k, 0));
  j.Head = j.Neck.clone().add(new THREE.Vector3(0, 0.09 * k, 0));
  for (const [side, s] of [['Left', 1], ['Right', -1]] as const) {
    j[`${side}UpperArm`] = j.Chest.clone().add(new THREE.Vector3(s * p.shoulder, 0.2 * k, 0));
    j[`${side}LowerArm`] = j[`${side}UpperArm`].clone().add(new THREE.Vector3(0, -0.29 * k, 0));
    j[`${side}Hand`] = j[`${side}LowerArm`].clone().add(new THREE.Vector3(0, -0.27 * k, 0));
    j[`${side}UpperLeg`] = j.Hips.clone().add(new THREE.Vector3(s * p.hip, -0.04 * k, 0));
    j[`${side}LowerLeg`] = j[`${side}UpperLeg`].clone().add(new THREE.Vector3(0, -0.43 * k, 0));
    j[`${side}Foot`] = j[`${side}LowerLeg`].clone().add(new THREE.Vector3(0, -0.44 * k, 0));
  }
  const parent: Rig['parent'] = {
    Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck',
    LeftUpperArm: 'Chest', LeftLowerArm: 'LeftUpperArm', LeftHand: 'LeftLowerArm',
    RightUpperArm: 'Chest', RightLowerArm: 'RightUpperArm', RightHand: 'RightLowerArm',
    LeftUpperLeg: 'Hips', LeftLowerLeg: 'LeftUpperLeg', LeftFoot: 'LeftLowerLeg',
    RightUpperLeg: 'Hips', RightLowerLeg: 'RightUpperLeg', RightFoot: 'RightLowerLeg',
  };
  return { joints: j as Rig['joints'], parent };
}

/** prepara uma parte: atributos de skinning rígido + região de cor */
function part(g: THREE.BufferGeometry, bone: number, region: number): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), rg = new Float32Array(n);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; rg[i] = region; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setAttribute('aRegion', new THREE.Float32BufferAttribute(rg, 1));
  return g;
}

/** cápsula entre dois pontos (eixo vertical no bind) */
function capsuleY(r: number, y0: number, y1: number, x = 0, z = 0, sx = 1, sz = 1): THREE.BufferGeometry {
  const len = Math.max(0.001, Math.abs(y1 - y0) - 2 * r);
  const g = new THREE.CapsuleGeometry(r, len, 3, 10);
  g.scale(sx, 1, sz);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

const geometryCache = new Map<BodyType, THREE.BufferGeometry>();

function buildGeometry(body: BodyType): THREE.BufferGeometry {
  const cached = geometryCache.get(body);
  if (cached) return cached;
  const p = BODY_TYPES[body];
  const { joints: J } = buildRig(body);
  const k = p.height / 1.76;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, bone: BoneName, region: number) => parts.push(part(g, B[bone], region));
  const female = body === 'mulher' || body === 'idosa';

  // pelve
  {
    const g = new THREE.CapsuleGeometry(0.135 * k * (p.hip / 0.1), 0.1 * k, 3, 10);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 1, 0.72);
    g.translate(0, J.Hips.y, 0);
    add(g, 'Hips', R_BOTTOM);
  }
  // abdômen (barriga)
  {
    const g = new THREE.CylinderGeometry(0.15 * k, 0.15 * k * (p.hip / 0.1) * 0.95, 0.22 * k, 12);
    g.scale(1, 1, 0.7 + p.belly * 0.25);
    g.translate(0, J.Spine.y + 0.08 * k, p.belly * 0.02);
    add(g, 'Spine', R_TOP);
  }
  // tórax
  {
    const g = new THREE.CapsuleGeometry(p.chest * k, 0.12 * k, 4, 12);
    g.scale((p.shoulder / 0.2) * 1.05, 1, 0.66);
    g.translate(0, J.Chest.y + 0.12 * k, 0);
    add(g, 'Chest', R_TOP);
  }
  // pescoço e cabeça
  add(capsuleY(0.05 * k, J.Neck.y - 0.03 * k, J.Head.y + 0.03 * k), 'Neck', R_SKIN);
  {
    const g = new THREE.SphereGeometry(0.108 * k, 16, 12);
    g.scale(0.92, 1.12, 1.0);
    g.translate(0, J.Head.y + 0.1 * k, 0.005);
    add(g, 'Head', R_SKIN);
    const nose = new THREE.ConeGeometry(0.017 * k, 0.04 * k, 6);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, J.Head.y + 0.09 * k, 0.105 * k);
    add(nose, 'Head', R_SKIN);
    for (const s of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.012 * k, 6, 4);
      eye.translate(s * 0.036 * k, J.Head.y + 0.125 * k, 0.093 * k);
      add(eye, 'Head', R_DARK);
    }
    // cabelo
    const hy = J.Head.y + 0.1 * k;
    if (p.hair !== 'calvo') {
      const cap = new THREE.SphereGeometry(0.115 * k, 16, 10, 0, Math.PI * 2, 0, Math.PI * (p.hair === 'longo' ? 0.6 : 0.5));
      cap.rotateX(-0.55); // inclina para trás: linha do cabelo alta na testa, nuca coberta
      cap.scale(0.96, 1.12, 1.05);
      cap.translate(0, hy + 0.012 * k, -0.01 * k);
      add(cap, 'Head', R_HAIR);
    } else {
      // calvície com coroa lateral
      const ring = new THREE.TorusGeometry(0.098 * k, 0.025 * k, 6, 16, Math.PI * 1.3);
      ring.rotateX(Math.PI / 2);
      ring.rotateY(-Math.PI * 0.15 + Math.PI);
      ring.translate(0, hy - 0.005 * k, -0.005 * k);
      add(ring, 'Head', R_HAIR);
    }
    if (p.hair === 'longo') {
      const back = new THREE.CapsuleGeometry(0.085 * k, 0.16 * k, 3, 10);
      back.scale(1.15, 1, 0.55);
      back.translate(0, hy - 0.1 * k, -0.07 * k);
      add(back, 'Head', R_HAIR);
    }
    if (p.hair === 'coque') {
      const bun = new THREE.SphereGeometry(0.05 * k, 10, 8);
      bun.translate(0, hy + 0.06 * k, -0.09 * k);
      add(bun, 'Head', R_HAIR);
    }
  }
  // braços
  for (const side of ['Left', 'Right'] as const) {
    const ua = J[`${side}UpperArm`], la = J[`${side}LowerArm`], h = J[`${side}Hand`];
    const armR = (female ? 0.045 : 0.052) * k;
    add(capsuleY(armR + 0.006, la.y - 0.02, ua.y + 0.03, ua.x, ua.z), `${side}UpperArm`, R_TOP); // manga
    add(capsuleY(armR * 0.82, h.y, la.y + 0.02, la.x, la.z), `${side}LowerArm`, R_SKIN);
    const hand = new THREE.SphereGeometry(0.046 * k, 10, 8);
    hand.scale(0.8, 1.25, 0.6);
    hand.translate(h.x, h.y - 0.045 * k, h.z);
    add(hand, `${side}Hand`, R_SKIN);
  }
  // pernas
  for (const side of ['Left', 'Right'] as const) {
    const ul = J[`${side}UpperLeg`], ll = J[`${side}LowerLeg`], f = J[`${side}Foot`];
    const legR = (female ? 0.07 : 0.075) * k * (0.9 + p.belly * 0.15);
    const thighRegion = p.lowerWear === 'saia' ? R_SKIN : R_BOTTOM;
    const shinRegion = p.lowerWear === 'calca' ? R_BOTTOM : R_SKIN;
    add(capsuleY(legR, ll.y - 0.02, ul.y + 0.04, ul.x, ul.z), `${side}UpperLeg`, thighRegion);
    add(capsuleY(legR * 0.8, f.y + 0.02, ll.y + 0.02, ll.x, ll.z), `${side}LowerLeg`, shinRegion);
    const foot = new THREE.BoxGeometry(0.1 * k, 0.07 * k, 0.25 * k, 1, 1, 2);
    foot.translate(f.x, f.y - 0.015 * k, f.z + 0.05 * k);
    add(foot, `${side}Foot`, R_SHOES);
  }
  // saia (presa ao quadril)
  if (p.lowerWear === 'saia') {
    const g = new THREE.CylinderGeometry(0.15 * k * (p.hip / 0.1), 0.22 * k, 0.5 * k, 14, 1, true);
    g.translate(0, J.Hips.y - 0.2 * k, 0);
    add(g, 'Hips', R_BOTTOM);
  }
  const merged = mergeGeometries(parts, false)!;
  merged.computeBoundingSphere();
  geometryCache.set(body, merged);
  return merged;
}

/** material com cores por região (uniforms) — compartilha o programa entre personagens */
function makeMaterial(app: CharacterAppearance): THREE.MeshStandardMaterial {
  const colors = [app.skin, app.hair, app.top, app.bottom, app.shoes, 0x111111].map((c) => new THREE.Color(c));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
  mat.userData.regionColors = { value: colors };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRegionColors = mat.userData.regionColors;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRegion;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRegionColors[6];\nvarying float vRegion;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        int ri = int(vRegion + 0.5);
        vec3 rc = uRegionColors[0];
        for (int i = 1; i < 6; i++) if (i == ri) rc = uRegionColors[i];
        diffuseColor.rgb *= rc;`);
  };
  mat.customProgramCacheKey = () => 'pv-character-regions';
  return mat;
}

export interface CharacterRig {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  body: BodyType;
  setAppearance(a: CharacterAppearance): void;
  dispose(): void;
}

export function createCharacter(app: CharacterAppearance): CharacterRig {
  const rig = buildRig(app.body);
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONE_NAMES) {
    const parentName = rig.parent[name];
    const pos = rig.joints[name].clone();
    if (parentName) {
      pos.sub(rig.joints[parentName]);
      bones[parentName].add(bones[name]);
    }
    bones[name].position.copy(pos);
  }
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  const geo = buildGeometry(app.body);
  const mat = makeMaterial(app);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(bones.Hips);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // bounding sphere do bind não acompanha a animação; o sistema de NPC faz culling por distância
  mesh.name = `character_${app.body}`;
  mesh.scale.setScalar(app.scale);
  return {
    mesh, bones, body: app.body,
    setAppearance(a) {
      const cols = mat.userData.regionColors.value as THREE.Color[];
      [a.skin, a.hair, a.top, a.bottom, a.shoes].forEach((c, i) => cols[i].setHex(c));
      mesh.scale.setScalar(a.scale);
    },
    dispose() {
      mat.dispose();
      skeleton.dispose();
    },
  };
}
