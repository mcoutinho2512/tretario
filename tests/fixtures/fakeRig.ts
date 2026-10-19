/** esqueleto "game_engine" de teste (compartilhado: tests/proceduralClips.test.ts, tests/combatAnim.test.ts) */
import * as THREE from 'three';

/** esqueleto "game_engine" aproximado (posições do idle do homem, m): braços caídos, palmas para as coxas */
export function fakeRig() {
  const W: Record<string, [string | null, [number, number, number]]> = {
    Root: [null, [0, 0, 0]], pelvis: ['Root', [0, 0.98, -0.04]], spine_01: ['pelvis', [0.01, 1.06, -0.07]],
    spine_02: ['spine_01', [0.01, 1.13, -0.08]], spine_03: ['spine_02', [0.01, 1.2, -0.08]],
    neck_01: ['spine_03', [-0.02, 1.54, 0.06]], head: ['neck_01', [-0.03, 1.64, 0.1]],
  };
  for (const [s, x] of [['l', 1], ['r', -1]] as const) {
    W[`clavicle_${s}`] = ['spine_03', [x * 0.04, 1.46, 0.05]];
    W[`upperarm_${s}`] = [`clavicle_${s}`, [x * 0.17, 1.47, -0.04]];
    W[`lowerarm_${s}`] = [`upperarm_${s}`, [x * 0.22, 1.22, -0.15]];
    W[`hand_${s}`] = [`lowerarm_${s}`, [x * 0.28, 0.96, -0.1]];
    const fz: Record<string, number> = { index: 0.0, middle: -0.02, ring: -0.04, pinky: -0.06, thumb: 0.03 };
    for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb']) {
      const z = -0.1 + fz[f], x0 = f === 'thumb' ? 0.27 : 0.3;
      W[`${f}_01_${s}`] = [`hand_${s}`, [x * x0, 0.88, z + (f === 'thumb' ? 0.03 : 0)]];
      W[`${f}_02_${s}`] = [`${f}_01_${s}`, [x * x0, 0.84, z + (f === 'thumb' ? 0.05 : 0.01)]];
      W[`${f}_03_${s}`] = [`${f}_02_${s}`, [x * x0, 0.81, z + (f === 'thumb' ? 0.06 : 0.02)]];
    }
    W[`thigh_${s}`] = ['pelvis', [x * 0.11, 0.97, -0.07]];
    W[`calf_${s}`] = [`thigh_${s}`, [x * 0.2, 0.52, -0.1]];
    W[`foot_${s}`] = [`calf_${s}`, [x * 0.19, 0.07, -0.15]];
    W[`ball_${s}`] = [`foot_${s}`, [x * 0.22, -0.01, 0.0]];
  }
  const bones = new Map<string, THREE.Bone>();
  const arm = new THREE.Group();
  for (const [name, [parent, p]] of Object.entries(W)) {
    const b = new THREE.Bone();
    b.name = name;
    const pw = parent ? W[parent][1] : [0, 0, 0];
    b.position.set(p[0] - pw[0], p[1] - pw[1], p[2] - pw[2]);
    bones.set(name, b);
    (parent ? bones.get(parent)! : arm).add(b);
  }
  arm.updateMatrixWorld(true);
  // "idle": uma chave com a pose acima (a base dos clipes procedurais)
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [n, b] of bones) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, [0], b.quaternion.toArray()));
    tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`, [0], b.position.toArray()));
  }
  return { arm, bones, idle: new THREE.AnimationClip('idle', 1, tracks) };
}

