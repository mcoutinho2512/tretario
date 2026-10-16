/**
 * SÓ PARA A PÁGINA DE DESENVOLVIMENTO: pose de segurar improvisada (IK de dois ossos) para conferir a pegada dos
 * itens enquanto as poses de carregar do animador não existem. No jogo, quem posiciona as mãos é o animador
 * (clipes carry_* / prop_*); `?hold=0` desliga esta pose.
 */
import * as THREE from 'three';
import type { HumanCharacter } from '../src/characters/human/HumanCharacter';
import type { PropKind } from '../src/social/props';
import { HAND_GRIP, type Hand } from '../src/social/props/grips';

interface HandTarget { at: [number, number, number]; /** eixo do cabo desejado */ axis: [number, number, number]; /** dedos */ fingers: [number, number, number] }
type Pose = Partial<Record<Hand, HandTarget>>;

// referencial do personagem: +Z frente, +Y cima, mão direita em −X
const POSES: Record<PropKind, Pose> = {
  flag_small: { hand_r: { at: [-0.2, 1.24, 0.3], axis: [0, 1, 0.12], fingers: [0.8, 0, 0.3] } },
  flag_large: { hand_r: { at: [-0.04, 1.02, 0.27], axis: [0, 1, 0.1], fingers: [0.8, 0, 0.4] }, hand_l: { at: [0.0, 1.42, 0.29], axis: [0, 1, 0.1], fingers: [-0.8, 0, 0.4] } },
  sign_small: { hand_r: { at: [-0.2, 1.1, 0.3], axis: [1, 0.2, 0], fingers: [0, 0.3, -1] }, hand_l: { at: [0.2, 1.1, 0.3], axis: [-1, 0.2, 0], fingers: [0, 0.3, -1] } },
  sign_large: { hand_r: { at: [-0.01, 1.0, 0.24], axis: [0, 1, 0], fingers: [0.8, 0, 0.3] }, hand_l: { at: [0.01, 1.22, 0.24], axis: [0, 1, 0], fingers: [-0.8, 0, 0.3] } },
  sign_double: { hand_r: { at: [-0.01, 1.0, 0.24], axis: [0, 1, 0], fingers: [0.8, 0, 0.3] }, hand_l: { at: [0.01, 1.22, 0.24], axis: [0, 1, 0], fingers: [-0.8, 0, 0.3] } },
  banner: { hand_r: { at: [-0.52, 1.22, 0.24], axis: [0, 1, 0], fingers: [0.6, 0, 0.8] }, hand_l: { at: [0.52, 1.22, 0.24], axis: [0, 1, 0], fingers: [-0.6, 0, 0.8] } },
  megaphone: { hand_r: { at: [-0.06, 1.47, 0.24], axis: [0, 1, 0], fingers: [0.05, 0, 1] } },
  whistle: { hand_r: { at: [-0.04, 1.5, 0.2], axis: [0.3, 1, 0], fingers: [0.6, 0, 0.6] } },
  umbrella: { hand_r: { at: [-0.18, 1.3, 0.26], axis: [0, 1, 0], fingers: [0.8, 0, 0.4] } },
  drum: { hand_r: { at: [-0.16, 1.06, 0.36], axis: [0.2, 0.5, 1], fingers: [0.8, 0.2, 0] }, hand_l: { at: [0.2, 1.0, 0.32], axis: [0, 0, 1], fingers: [-0.5, -0.3, 0] } },
  bat: { hand_r: { at: [-0.25, 1.0, 0.18], axis: [0, 1, 0.5], fingers: [0.8, 0, 0.2] } },
};

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const v = () => new THREE.Vector3();

function rotateBoneTo(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  const s = bone.getWorldPosition(v()), c = child.getWorldPosition(v());
  _q.setFromUnitVectors(c.sub(s).normalize(), target.clone().sub(s).normalize());
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(_q);
  const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(pq.multiply(_q2));
  bone.updateMatrixWorld(true);
}

export function applyHoldPose(c: HumanCharacter, kind: PropKind) {
  const pose = POSES[kind];
  c.root.updateMatrixWorld(true);
  for (const hand of ['hand_r', 'hand_l'] as Hand[]) {
    const t = pose[hand];
    if (!t) continue;
    const s = hand === 'hand_r' ? 'r' : 'l';
    const up = c.bones.get(`upperarm_${s}`)!, lo = c.bones.get(`lowerarm_${s}`)!, hb = c.bones.get(hand)!;
    const toW = (x: number[], dir = false) => (dir ? v().set(x[0], x[1], x[2]).transformDirection(c.root.matrixWorld) : c.root.localToWorld(v().set(x[0], x[1], x[2])));
    const axis = toW(t.axis, true).normalize();
    const fingers = toW(t.fingers, true);
    fingers.addScaledVector(axis, -fingers.dot(axis)).normalize();
    // rotação desejada do punho (eixo do cabo e dedos) → onde o osso da mão precisa estar para o punho cair no alvo
    const g = HAND_GRIP[hand];
    const aL = v().set(...g.axis).normalize(), yL = v().set(0, 1, 0);
    _m.makeBasis(aL, yL, v().crossVectors(aL, yL));
    _m2.makeBasis(axis, fingers, v().crossVectors(axis, fingers));
    _m2.multiply(_m.transpose());
    const wq = new THREE.Quaternion().setFromRotationMatrix(_m2);
    const wrist = toW(t.at).sub(v().set(...g.center).applyQuaternion(wq));
    const S = up.getWorldPosition(v()), E = lo.getWorldPosition(v()), H = hb.getWorldPosition(v());
    const l1 = E.distanceTo(S), l2 = H.distanceTo(E);
    const dv = wrist.clone().sub(S);
    const d = Math.min(dv.length(), l1 + l2 - 1e-3);
    dv.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    // cotovelo para baixo, um pouco para fora e para trás
    const hint = toW([s === 'r' ? -0.5 : 0.5, -1, -0.4], true);
    const perp = hint.addScaledVector(dv, -hint.dot(dv)).normalize();
    const elbow = S.clone().addScaledVector(dv, l1 * cosA).addScaledVector(perp, l1 * Math.sqrt(1 - cosA * cosA));
    rotateBoneTo(up, lo, elbow);
    rotateBoneTo(lo, hb, S.clone().addScaledVector(dv, d));
    const pq = hb.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    hb.quaternion.copy(pq.multiply(wq));
    hb.updateMatrixWorld(true);
  }
}
