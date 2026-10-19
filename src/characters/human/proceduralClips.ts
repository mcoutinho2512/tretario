/**
 * Emotes, poses de carregar itens e danças PROCEDURAIS (código deste projeto — sem licença de terceiros).
 *
 * A biblioteca de animação (UAL) não tem aceno, palmas, braços erguidos etc. Cada clipe aqui é uma função de pose
 * escrita sobre a pose do idle (t = 0) do próprio esqueleto "game_engine": o autor descreve DESLOCAMENTOS
 *  - rotações em torno de eixos no espaço do ESQUELETO (x = esquerda do personagem, y = cima, z = frente), como o
 *    `rot()` do HumanAnimator, aplicadas de pai para filho;
 *  - alvos de mão/pé resolvidos por IK de dois ossos (cotovelo/joelho com vetor polar), relativos a âncoras do
 *    corpo (peito, ombro, cabeça, joelho) — a pegada do item fica igual nos quatro corpos;
 * e o resultado é AMOSTRADO (30 quadros/s) em QuaternionKeyframeTracks comuns (+ posição da pelve nos de corpo
 * inteiro). Movimento natural: senoides em camadas com fases diferentes (ombro conduz, cotovelo atrasa, punho
 * atrasa mais), entrada/saída suavizadas, transferência de peso, respiração e cabeça viva.
 *
 * Lados: as funções de pose são escritas para o lado DIREITO; o esquerdo é espelhado (eixo (x, −y, −z), deslocamento
 * lateral invertido). `mirror` troca os lados do clipe inteiro (variação dos NPCs nos gestos assimétricos).
 * Clipes `loop` usam só frequências inteiras sobre a duração do clipe (emenda perfeita).
 */
import * as THREE from 'three';
import { ACTIONS } from '../../social/actions';
import { HAND_GRIP } from '../../social/props/grips';

type V3 = [number, number, number];
type Side = 'r' | 'l';
type Part = 'clavicle' | 'upperarm' | 'lowerarm' | 'hand' | 'thigh' | 'calf' | 'foot' | 'ball';
type Anchor = 'chest' | 'shoulder' | 'head' | 'knee' | 'pelvis';

export interface ClipSpec {
  dur: number;
  /** crossfade de entrada/saída (s) quando a transição muda muito a pose (sentar no chão) */
  fade?: number;
  /** upper: tronco/braços/cabeça (as pernas seguem a locomoção) · full: corpo inteiro (com a pelve) */
  layer: 'upper' | 'full';
  /** pode ser espelhado (gestos de uma mão sem item) */
  mirror?: boolean;
  /**
   * rodada 10 — golpe: tempos da definição (public/gameplay/combat.json windupMs/activeMs/recoveryMs, em s). A duração
   * é a soma; a entrada/saída do crossfade sai daqui (`clipFades`) e o teste confere contra o JSON
   */
  cbt?: [windup: number, active: number, recovery: number];
  /** crossfades separados (s); sem eles: `cbt` → `clipFades`, senão `fade` */
  fadeIn?: number;
  fadeOut?: number;
  /** rodada 10 — `full` só parado: andando, a locomoção fica com pernas/pelve (máscara superior; HumanAnimator) */
  adaptive?: boolean;
  pose: (c: Poser) => void;
}

/**
 * rodada 10 — crossfade de entrada/saída de um clipe. Golpe: entra em ~55 % da preparação (6–14 cm de folga para a
 * pose da locomoção chegar à guarda antes do estalo) e sai em ~45 % da recuperação (10–22 cm): a animação se adapta
 * aos tempos do combat.json, nunca o contrário.
 */
export function clipFades(spec: ClipSpec): { fadeIn: number; fadeOut: number } {
  const c = spec.cbt;
  const fin = c ? Math.min(0.14, Math.max(0.06, 0.55 * c[0])) : spec.fade ?? 0.32;
  const fout = c ? Math.min(0.22, Math.max(0.1, 0.45 * c[2])) : spec.fade ?? 0.32;
  return { fadeIn: spec.fadeIn ?? fin, fadeOut: spec.fadeOut ?? fout };
}

const TAU = Math.PI * 2;
const sin = Math.sin, cos = Math.cos;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** suavização (smootherstep) de 0..1 */
export const ease = (x: number) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
/** envelope: sobe de a0→a1, desce de b0→b1 (s) */
const env = (t: number, a0: number, a1: number, b0: number, b1: number) => ease((t - a0) / (a1 - a0)) * (1 - ease((t - b0) / (b1 - b0)));
/** senoide periódica no clipe: n ciclos inteiros sobre u ∈ [0, 1] */
const osc = (u: number, n: number, ph = 0) => sin(TAU * (n * u + ph));
/** pulso com ataque rápido e retorno lento (0..1) a cada ciclo — batida, impacto */
const beatPulse = (u: number, n: number, ph = 0) => { const x = ((n * u + ph) % 1 + 1) % 1; return Math.exp(-x * 7) * (1 - Math.exp(-x * 60)); };

const ARM: Part[] = ['clavicle', 'upperarm', 'lowerarm', 'hand'];
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;
type Finger = (typeof FINGERS)[number];
const FINGER_BONES = (s: Side) => FINGERS.flatMap((f) => [1, 2, 3].map((k) => `${f}_0${k}_${s}`));
/** ossos da camada superior (tronco, cabeça, braços, mãos) */
export const UPPER_BONES = [
  'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  ...(['l', 'r'] as Side[]).flatMap((s) => [...ARM.map((p) => `${p}_${s}`), ...FINGER_BONES(s)]),
];
/** peso da camada superior por osso enquanto o personagem se move: a coluna baixa segue mais a passada */
export const UPPER_MOVING_WEIGHT: Record<string, number> = { spine_01: 0.3, spine_02: 0.55, spine_03: 0.8 };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m3 = new THREE.Matrix3();

/** contexto de pose: os métodos agem sobre os ossos vivos (espaço do esqueleto) */
export class Poser {
  t = 0;
  /** t / duração (0..1) */
  u = 0;
  dur = 1;
  private bones: Map<string, THREE.Object3D>;
  private rootQInv = new THREE.Quaternion();
  private rootInv = new THREE.Matrix4();
  /** posições/orientações de referência da pose base (espaço do esqueleto) */
  private baseFoot: Record<Side, THREE.Vector3> = { r: new THREE.Vector3(), l: new THREE.Vector3() };
  private baseFootQ: Record<Side, THREE.Quaternion> = { r: new THREE.Quaternion(), l: new THREE.Quaternion() };
  /** tornozelo → bola do pé (m): levantar o calcanhar gira em torno da bola, não do tornozelo */
  private footLen: Record<Side, number> = { r: 0.1, l: 0.1 };
  private baseChestQInv = new THREE.Quaternion();
  /** chão (bola do pé mais baixa na pose base) */
  floorY = 0;
  /** rodada 10: chão em relação à pelve atual, em metros do corpo de referência (alvos de mão apoiada no chão) */
  floorRel = 0;
  private baseBall: Record<Side, THREE.Vector3> = { r: new THREE.Vector3(), l: new THREE.Vector3() };
  /** direção do joelho na pose base ([fora, cima, frente], lado direito): polo do IK que não muda o plano da perna */
  baseKnee: Record<Side, V3> = { r: [0.12, 0, 1], l: [0.12, 0, 1] };
  /** escala do corpo (comprimento do braço / referência) — alvos em metros do corpo de referência */
  k = 1;
  kLeg = 1;
  /** sinal da palma (calibrado na pose base) */
  private palmSign: Record<Side, number> = { r: 1, l: 1 };

  constructor(private root: THREE.Object3D, bones: Map<string, THREE.Object3D>, public mirror = false) {
    this.bones = bones;
  }

  /** chamado com o esqueleto na pose base */
  calibrate() {
    this.root.updateMatrixWorld(true);
    this.rootInv.copy(this.root.matrixWorld).invert();
    this.root.getWorldQuaternion(this.rootQInv).invert();
    for (const s of ['r', 'l'] as Side[]) {
      this.pos(`foot_${s}`, this.baseFoot[s]);
      this.quat(`foot_${s}`, this.baseFootQ[s]);
      this.footLen[s] = this.pos(`ball_${s}`, this.baseBall[s]).distanceTo(this.baseFoot[s]);
      {
        // joelho fora da linha quadril→tornozelo (plano da perna do idle)
        const hip = this.pos(`thigh_${s}`, new THREE.Vector3()), knee = this.pos(`calf_${s}`, new THREE.Vector3());
        const ax = this.baseFoot[s].clone().sub(hip).normalize();
        const off = knee.sub(hip); off.addScaledVector(ax, -off.dot(ax));
        if (off.lengthSq() > 1e-8) { off.normalize(); this.baseKnee[s] = [s === 'r' ? -off.x : off.x, off.y, off.z]; }
      }
      // palma: lado da mão para onde os dedos dobram — na pose base (braço caído) ela olha para a coxa
      const n = this.palmNormal(s, _v3);
      const toBody = _v.set(s === 'r' ? 1 : -1, 0, 0);
      this.palmSign[s] = n.dot(toBody) >= 0 ? 1 : -1;
    }
    this.quat('spine_03', this.baseChestQInv).invert();
    this.floorY = Math.min(...['ball_l', 'ball_r', 'foot_l', 'foot_r'].map((n) => this.pos(n, _v).y));
    const arm = this.pos('upperarm_r', _v).distanceTo(this.pos('lowerarm_r', _v2)) + _v2.distanceTo(this.pos('hand_r', _v3));
    this.k = arm > 0.1 ? arm / 0.564 : 1;
    const leg = this.pos('thigh_r', _v).distanceTo(this.pos('calf_r', _v2)) + _v2.distanceTo(this.pos('foot_r', _v3));
    this.kLeg = leg > 0.2 ? leg / 0.95 : 1;
  }

  // ------------------------------------------------------------------ utilidades de espaço
  private b(name: string) { return this.bones.get(name); }
  /** lado real (com espelho) */
  side(s: Side): Side { return this.mirror ? (s === 'r' ? 'l' : 'r') : s; }
  pos(name: string, out: THREE.Vector3) {
    const b = this.b(name);
    if (!b) return out.set(0, 0, 0);
    return b.getWorldPosition(out).applyMatrix4(this.rootInv);
  }
  quat(name: string, out: THREE.Quaternion) {
    const b = this.b(name);
    if (!b) return out.identity();
    return b.getWorldQuaternion(out).premultiply(this.rootQInv);
  }
  /** aplica uma rotação dada no espaço do esqueleto a um osso (e filhos) */
  rotateArm(b: THREE.Object3D, q: THREE.Quaternion) {
    if (!b.parent) return;
    b.parent.getWorldQuaternion(_q2).premultiply(this.rootQInv); // pai no espaço do esqueleto
    // local' = pai⁻¹ · q · pai · local
    const p = _q2.clone();
    b.quaternion.premultiply(p.clone().invert().multiply(q).multiply(p));
    b.updateMatrixWorld(true);
  }
  /** orientação absoluta (espaço do esqueleto) */
  setArmQuat(b: THREE.Object3D, q: THREE.Quaternion) {
    if (!b.parent) return;
    b.parent.getWorldQuaternion(_q2).premultiply(this.rootQInv);
    b.quaternion.copy(_q2.invert().multiply(q));
    b.updateMatrixWorld(true);
  }
  private axis(x: number, y: number, z: number, s: Side | null): THREE.Vector3 {
    // eixos escritos para o lado direito/sem espelho; espelhar em x: o eixo (pseudovetor) vira (x, −y, −z)
    const flip = s ? s === 'l' : this.mirror;
    return _v.set(x, flip ? -y : y, flip ? -z : z).normalize();
  }

  // ------------------------------------------------------------------ API das funções de pose
  /** osso central (coluna, pescoço, cabeça, pelve) em torno de um eixo do esqueleto */
  bone(name: string, x: number, y: number, z: number, ang: number) {
    const b = this.b(name);
    if (!b || Math.abs(ang) < 1e-6) return;
    this.rotateArm(b, _q.setFromAxisAngle(this.axis(x, y, z, null), ang));
  }
  /** osso de um lado (eixos escritos para o direito) */
  limb(side: Side, part: Part, x: number, y: number, z: number, ang: number) {
    const s = this.side(side);
    const b = this.b(`${part}_${s}`);
    if (!b || Math.abs(ang) < 1e-6) return;
    this.rotateArm(b, _q.setFromAxisAngle(this.axis(x, y, z, s), ang));
  }
  /** torção em torno do próprio osso (pronação do antebraço etc.; positivo = sentido do direito) */
  twist(side: Side, part: Part, ang: number) {
    const s = this.side(side);
    const b = this.b(`${part}_${s}`);
    const child = part === 'upperarm' ? `lowerarm_${s}` : part === 'lowerarm' ? `hand_${s}` : part === 'thigh' ? `calf_${s}` : part === 'calf' ? `foot_${s}` : `middle_01_${s}`;
    if (!b || Math.abs(ang) < 1e-6) return;
    const ax = this.pos(child, _v2).sub(this.pos(b.name, _v3)).normalize();
    this.rotateArm(b, _q.setFromAxisAngle(ax, s === 'l' ? -ang : ang));
  }
  /** desloca a pelve (m, espaço do esqueleto; x lateral espelhado) — só clipes de corpo inteiro */
  hips(dx: number, dy: number, dz: number) {
    const p = this.b('pelvis');
    if (!p?.parent) return;
    const d = _v.set(this.mirror ? -dx : dx, dy, dz).multiplyScalar(this.kLeg);
    // direção no espaço do pai da pelve (o osso Root é girado −90° em X)
    _m.copy(this.rootInv).multiply(p.parent.matrixWorld).invert();
    d.applyMatrix3(_m3.setFromMatrix4(_m));
    p.position.add(d);
    p.updateMatrixWorld(true);
  }

  private anchorPos(s: Side, a: Anchor, off: V3, out: THREE.Vector3) {
    const sx = s === 'r' ? -1 : 1;
    _v2.set(sx * off[0], off[1], off[2]).multiplyScalar(this.k);
    if (a === 'knee' || a === 'pelvis') {
      this.pos(a === 'knee' ? `calf_${s}` : 'pelvis', out);
      return out.add(_v2);
    }
    // âncoras do tronco: o deslocamento acompanha a rotação do peito (balanço, inclinação)
    this.quat('spine_03', _q).multiply(this.baseChestQInv);
    _v2.applyQuaternion(_q);
    if (a === 'chest') this.pos('upperarm_l', out).add(this.pos('upperarm_r', _v3)).multiplyScalar(0.5);
    else if (a === 'shoulder') this.pos(`upperarm_${s}`, out);
    else this.pos('head', out);
    return out.add(_v2);
  }

  /**
   * IK do braço: punho (osso hand) vai a `off` = [para fora, cima, frente] (m) a partir da âncora; `pole` é a direção
   * do cotovelo ([fora, cima, frente]). `w` mistura com a pose atual (envelopes de entrada/saída).
   */
  reach(side: Side, anchor: Anchor, off: V3, pole: V3, w = 1) {
    if (w <= 1e-4) return;
    const s = this.side(side);
    const target = this.anchorPos(s, anchor, off, new THREE.Vector3());
    const sx = s === 'r' ? -1 : 1;
    const poleV = new THREE.Vector3(sx * pole[0], pole[1], pole[2]);
    this.ik(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, target, poleV, w);
  }

  /**
   * IK da perna: pé (osso foot) no ponto da pose base + `off` ([fora, cima, frente], m); a sola volta à orientação da
   * pose base (plana no chão) e `pitch` levanta o calcanhar (+) ou a ponta (−).
   */
  plant(side: Side, off: V3 = [0, 0, 0], pitch = 0, pole: V3 = [0.12, 0, 1], ballPivot = false) {
    const s = this.side(side);
    const sx = s === 'r' ? -1 : 1;
    const target = _v.set(sx * off[0], off[1], off[2]).multiplyScalar(this.kLeg).add(this.baseFoot[s]).clone();
    // calcanhar para cima: o pivô é a bola do pé (sobe o tornozelo para a ponta não entrar no chão)
    if (pitch > 0 && ballPivot) {
      // rodada 10 (golpes): giro EXATO em torno da bola — a bola não sai do lugar (sem deslizar no chão)
      const ball = this.baseBall[s].clone().add(target).sub(this.baseFoot[s]);
      target.sub(ball).applyAxisAngle(_v2.set(1, 0, 0), pitch).add(ball);
    } else if (pitch > 0) target.y += this.footLen[s] * Math.sin(pitch);
    this.ik(`thigh_${s}`, `calf_${s}`, `foot_${s}`, target, new THREE.Vector3(sx * pole[0], pole[1], pole[2]), 1);
    const foot = this.b(`foot_${s}`);
    if (foot) {
      this.setArmQuat(foot, this.baseFootQ[s]);
      if (pitch) this.rotateArm(foot, _q.setFromAxisAngle(_v.set(1, 0, 0), pitch));
    }
  }

  /** IK analítico de dois ossos preservando o plano da articulação (sem torção espúria do braço) */
  private ik(an: string, bn: string, cn: string, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
    const A = this.b(an), B = this.b(bn), C = this.b(cn);
    if (!A || !B || !C) return;
    const a = this.pos(an, new THREE.Vector3()), b = this.pos(bn, new THREE.Vector3()), c = this.pos(cn, new THREE.Vector3());
    if (w < 1) target = c.clone().lerp(target, w);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    const toT = target.clone().sub(a);
    let d = toT.length();
    d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
    const dir = toT.normalize();
    const T = a.clone().addScaledVector(dir, d);
    const ax = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - ax * ax));
    const pdir = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (pdir.lengthSq() < 1e-8) pdir.set(0, 0, 1).addScaledVector(dir, -dir.z);
    pdir.normalize();
    const E = a.clone().addScaledVector(dir, ax).addScaledVector(pdir, h);
    // osso de cima: leva (direção, normal da articulação) da pose atual para a desejada
    const d0 = b.clone().sub(a).normalize(), n0 = d0.clone().cross(c.clone().sub(b)).normalize();
    const d1 = E.clone().sub(a).normalize(), n1 = d1.clone().cross(T.clone().sub(E)).normalize();
    if (n0.lengthSq() > 0.5 && n1.lengthSq() > 0.5) {
      const m0 = new THREE.Matrix4().makeBasis(d0, n0, d0.clone().cross(n0));
      const m1 = new THREE.Matrix4().makeBasis(d1, n1, d1.clone().cross(n1));
      this.rotateArm(A, new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose())));
    } else this.rotateArm(A, new THREE.Quaternion().setFromUnitVectors(d0, d1));
    // osso de baixo: aponta para o alvo
    const b2 = this.pos(bn, new THREE.Vector3()), c2 = this.pos(cn, new THREE.Vector3());
    this.rotateArm(B, new THREE.Quaternion().setFromUnitVectors(c2.sub(b2).normalize(), T.sub(b2).normalize()));
  }

  /** normal da palma (espaço do esqueleto, sem calibrar o sinal) */
  private palmNormal(s: Side, out: THREE.Vector3) {
    // direção da mão (punho → base do dedo médio): não depende de quanto os dedos estão dobrados
    const dir = this.pos(`middle_01_${s}`, _v).sub(this.pos(`hand_${s}`, _v2)).normalize();
    const width = this.pos(`index_01_${s}`, _v2).sub(this.pos(`pinky_01_${s}`, out));
    return out.copy(width).cross(dir).normalize();
  }

  /**
   * dedos: `curl` ABSOLUTO — 0 = mão aberta (dedos retos), 1 = punho fechado (o idle da biblioteca fica em ~0,6);
   * cada dedo pode ser sobrescrito. Polegar: deslocamento relativo ao idle (−0,5 abre, +0,5 fecha sobre os dedos).
   * `w` mistura com a pose atual (envelopes). Flexão em torno do eixo (mão × normal da palma): vale nos dois lados.
   */
  fingers(side: Side, curl: number, over: Partial<Record<Finger, number>> = {}, w = 1) {
    if (w <= 1e-4) return;
    const s = this.side(side);
    const palm = this.palmNormal(s, new THREE.Vector3()).multiplyScalar(this.palmSign[s]);
    const hand = this.pos(`middle_01_${s}`, new THREE.Vector3()).sub(this.pos(`hand_${s}`, _v3)).normalize();
    const ax = hand.clone().cross(palm).normalize();
    const ref = new THREE.Vector3(), dir = new THREE.Vector3(), cr = new THREE.Vector3();
    for (const f of FINGERS) {
      if (f === 'thumb') {
        const tc = (over.thumb ?? (curl - 0.6) * 0.8) * w;
        if (Math.abs(tc) < 1e-3) continue;
        for (let k = 1; k <= 3; k++) {
          const b = this.b(`thumb_0${k}_${s}`);
          if (!b) continue;
          const nx = k < 3 ? `thumb_0${k + 1}_${s}` : null;
          if (nx) dir.copy(this.pos(nx, dir)).sub(this.pos(b.name, _v3)).normalize();
          const tax = dir.clone().cross(palm).normalize();
          if (tax.lengthSq() > 0.5) this.rotateArm(b, _q.setFromAxisAngle(tax, [0.35, 0.5, 0.45][k - 1] * tc));
        }
        continue;
      }
      const c = over[f] ?? curl;
      let last = 0;
      for (let k = 1; k <= 3; k++) {
        const b = this.b(`${f}_0${k}_${s}`);
        if (!b) continue;
        if (k === 3) { this.rotateArm(b, _q.setFromAxisAngle(ax, last * 0.7)); continue; }
        // ângulo atual da articulação (sinalizado, + = para a palma) → alvo
        if (k === 1) ref.copy(hand); else ref.copy(dir);
        dir.copy(this.pos(`${f}_0${k + 1}_${s}`, dir)).sub(this.pos(b.name, _v3)).normalize();
        const cur = Math.atan2(cr.copy(ref).cross(dir).dot(ax), ref.dot(dir));
        last = (c * (k === 1 ? 1.45 : 1.6) - cur) * w;
        this.rotateArm(b, _q.setFromAxisAngle(ax, last));
        dir.applyQuaternion(_q);
      }
    }
  }

  /** polegar esticado para o lado radial da mão (sinal positivo): alinha as falanges a essa direção */
  thumbUp(side: Side, w = 1) {
    if (w <= 1e-4) return;
    const s = this.side(side);
    const radial = this.pos(`index_01_${s}`, new THREE.Vector3()).sub(this.pos(`pinky_01_${s}`, _v3)).normalize();
    const hand = this.pos(`middle_01_${s}`, new THREE.Vector3()).sub(this.pos(`hand_${s}`, _v3)).normalize();
    const target = radial.multiplyScalar(0.92).addScaledVector(hand, 0.3).normalize();
    for (let k = 1; k <= 2; k++) {
      const b = this.b(`thumb_0${k}_${s}`);
      if (!b) continue;
      const cur = this.pos(`thumb_0${k + 1}_${s}`, new THREE.Vector3()).sub(this.pos(b.name, _v3)).normalize();
      this.rotateArm(b, _q.setFromUnitVectors(cur, cur.clone().lerp(target, w).normalize()));
    }
  }

  // ---------------------------------------------------------------- rodada 10: pegada do item e pés com giro
  /** eixo do item na mão (o cabo sai pelo lado do polegar; HAND_GRIP de grips.ts) no espaço do esqueleto */
  gripAxis(side: Side, out: THREE.Vector3) {
    const s = this.side(side), b = this.b(`hand_${s}`);
    if (!b) return out.set(0, 1, 0);
    const a = HAND_GRIP[`hand_${s}`].axis;
    return out.set(a[0], a[1], a[2]).transformDirection(b.matrixWorld).transformDirection(this.rootInv);
  }
  /** centro do punho fechado (por onde passa o cabo) no espaço do esqueleto */
  gripCenter(side: Side, out: THREE.Vector3) {
    const s = this.side(side), b = this.b(`hand_${s}`);
    if (!b) return out.set(0, 0, 0);
    const c = HAND_GRIP[`hand_${s}`].center;
    return out.set(c[0], c[1], c[2]).applyMatrix4(b.matrixWorld).applyMatrix4(this.rootInv);
  }
  /** gira a mão para o item apontar em `dir` (espaço do esqueleto; x espelhado); `w` mistura */
  aimHand(side: Side, dir: V3, w = 1) {
    const s = this.side(side), b = this.b(`hand_${s}`);
    if (!b || w <= 1e-4) return;
    const cur = this.gripAxis(side, new THREE.Vector3());
    const want = new THREE.Vector3(this.mirror ? -dir[0] : dir[0], dir[1], dir[2]).normalize();
    const tgt = cur.clone().lerp(want, w);
    if (tgt.lengthSq() < 1e-6) return;
    this.rotateArm(b, _q.setFromUnitVectors(cur, tgt.normalize()));
  }
  /**
   * segunda mão no MESMO cabo (taco a duas mãos): centro do punho de `side` a `along` m do centro do punho de `from`
   * ao longo do eixo do item (negativo = para o lado da ponta do cabo), mesma direção do item
   */
  secondGrip(side: Side, from: Side, along: number, pole: V3, w = 1) {
    if (w <= 1e-4) return;
    const s = this.side(side), sx = s === 'r' ? -1 : 1;
    const axis = this.gripAxis(from, new THREE.Vector3());
    const want = this.gripCenter(from, new THREE.Vector3()).addScaledVector(axis, along);
    const dir: V3 = [this.mirror ? -axis.x : axis.x, axis.y, axis.z];
    const poleV = new THREE.Vector3(sx * pole[0], pole[1], pole[2]);
    for (let k = 0; k < 2; k++) {
      // o alvo do IK é o punho (osso hand): desconta o centro da pegada na orientação atual
      const off = this.gripCenter(side, new THREE.Vector3()).sub(this.pos(`hand_${s}`, _v3));
      this.ik(`upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, want.clone().sub(off), poleV, w);
      this.aimHand(side, dir, w);
    }
  }
  /** pé plantado girando no chão em torno da BOLA do pé (pivô do chute circular): `yaw` rad em torno de y */
  plantTurn(side: Side, off: V3, pitch: number, yaw: number, pole: V3) {
    const s = this.side(side), sx = s === 'r' ? -1 : 1;
    if (Math.abs(yaw) > 1e-5) {
      // o tornozelo gira em volta da bola (fixa no chão): desloca o alvo do pé
      const ax = this.axis(0, 1, 0, s).clone();
      const rel = this.baseFoot[s].clone().sub(this.baseBall[s]).applyAxisAngle(ax, yaw).add(this.baseBall[s]).sub(this.baseFoot[s]);
      off = [off[0] + (rel.x / this.kLeg) * sx, off[1] + rel.y / this.kLeg, off[2] + rel.z / this.kLeg];
    }
    this.plant(side, off, pitch, pole);
    const f = this.b(`foot_${s}`);
    if (f && Math.abs(yaw) > 1e-5) this.rotateArm(f, _q.setFromAxisAngle(this.axis(0, 1, 0, s), yaw));
  }
  updateFloorRel() { this.floorRel = (this.floorY - this.pos('pelvis', _v).y) / this.k; }

  /** respiração e microvida da cabeça (todas as poses) */
  life(amp = 1) {
    const u = this.u, n = Math.max(1, Math.round(this.dur / 3.6));
    this.bone('spine_03', 1, 0, 0, -0.012 * amp * osc(u, n));
    this.bone('neck_01', 0, 1, 0, 0.025 * amp * osc(u, Math.max(1, n - 1), 0.3));
    this.bone('head', 1, 0, 0, 0.015 * amp * osc(u, n + 1, 0.6));
  }
}

// ======================================================================== poses
// Convenções: reach(lado, âncora, [fora, cima, frente], polo [fora, cima, frente]); limb(lado, parte, eixo, ângulo)
// com eixos do lado direito: z (frente) negativo abre o braço para fora/cima; x positivo leva para trás.

const ELBOW_OUT: V3 = [0.8, -0.5, -0.35];
const ELBOW_DOWN: V3 = [0.35, -1, -0.2];

// ------------------------------------------------------------------ confronto: poses base dos golpes (rodada 9;
// refeitas na rodada 10 — antecipação → estalo → acompanhamento → recuperação, peso nas pernas, pés plantados)
/** punho fechado: dedos dobrados, polegar por cima (soco; segurar cabo) */
function fist(c: Poser, side: Side, w = 1) { c.fingers(side, 1.0, { thumb: 0.45 }, w); }

/** guarda: punhos à frente do queixo, cotovelos junto às costelas */
function guard(c: Poser, w: number) {
  c.reach('r', 'chest', [0.14, 0.03, 0.29], ELBOW_DOWN, w);
  c.reach('l', 'chest', [0.13, 0.07, 0.33], ELBOW_DOWN, w);
  fist(c, 'r', w);
  fist(c, 'l', w);
}

/**
 * chaves interpoladas (rodada 9.1): [tempo, valor] com transição suave entre chaves vizinhas — golpes escritos como
 * poses-chave (preparação → impacto → acompanhamento → recuperação), não como uma senoide só
 */
function keyed(t: number, keys: [number, number][]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i], [t0, v0] = keys[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / Math.max(1e-4, t1 - t0));
  }
  return keys[keys.length - 1][1];
}
function keyed3(t: number, keys: [number, V3][]): V3 {
  return [0, 1, 2].map((k) => keyed(t, keys.map(([tt, v]) => [tt, v[k]] as [number, number]))) as V3;
}
/** torção do tronco distribuída na coluna (a pelve fica com as pernas): + = ombro direito para a frente */
function twistTorso(c: Poser, ang: number, lean = 0, head = 0.6) {
  c.bone('spine_01', 0, 1, 0, 0.3 * ang);
  c.bone('spine_02', 0, 1, 0, 0.35 * ang);
  c.bone('spine_03', 0, 1, 0, 0.35 * ang);
  c.bone('spine_01', 1, 0, 0, lean);
  // a cabeça compensa parte da torção: os olhos ficam no alvo
  c.bone('neck_01', 0, 1, 0, -head * ang);
}

/**
 * rodada 10 — corpo girando como um todo: `total` = giro do peito (+ = ombro direito à frente), dos quais `yaw` vem
 * da PELVE (só parado: camada adaptativa) e o resto da coluna; a cabeça devolve `keep` do giro (olhos no alvo).
 * Pés plantados no lugar da pose base (IK): o joelho acompanha o quadril, o pé não escorrega.
 */
function turnBody(c: Poser, total: number, yaw: number, lean: number, keep = 0.65) {
  c.bone('pelvis', 0, 1, 0, yaw);
  twistTorso(c, total - yaw, lean, 0);
  c.bone('neck_01', 0, 1, 0, -keep * total);
}
/** pés plantados na pose base; calcanhar (pivô na bola do pé) por lado */
function feet(c: Poser, heelR = 0, heelL = 0) {
  // polo = joelho do idle: a mistura de entrada/saída (rotações osso a osso) não tira o pé do lugar
  c.plant('r', [0, 0, 0], heelR, c.baseKnee.r, true);
  c.plant('l', [0, 0, 0], heelL, c.baseKnee.l, true);
}

/**
 * soco reto (rodada 10): antecipação (tronco e quadril giram para trás, punho recua ao queixo, joelhos dobram, peso
 * atrás) → estalo em ~65 ms (quadril, tronco e ombro giram para a frente, peso vai ao pé da frente, calcanhar de trás
 * gira, punho fechado chega com leve sobre-extensão) → segura → recolhe para a guarda. Parado: corpo inteiro;
 * andando: só o tronco (camada adaptativa).
 */
function punchPose(c: Poser, side: 'r' | 'l', hit: number) {
  const t = c.t, d = c.dur, sgn = side === 'r' ? 1 : -1, other = side === 'r' ? 'l' : 'r';
  const a = hit - 0.05; // fim da antecipação
  const ext = keyed(t, [[0, 0], [a, 0], [hit + 0.015, 1.05], [hit + 0.05, 1], [hit + 0.1, 1], [hit + 0.25, 0.04], [d, 0]]);
  const coil = keyed(t, [[0, 0], [a, 1], [hit + 0.01, 0], [d, 0]]);
  const total = keyed(t, [[0, 0], [a, -0.24], [hit + 0.02, 0.52], [hit + 0.11, 0.44], [hit + 0.26, 0.08], [d, 0]]);
  const yaw = keyed(t, [[0, 0], [a, -0.07], [hit + 0.02, 0.17], [hit + 0.11, 0.14], [hit + 0.26, 0.03], [d, 0]]);
  const lean = keyed(t, [[0, 0], [a, -0.01], [hit + 0.03, 0.14], [hit + 0.12, 0.1], [d, 0]]);
  const sink = keyed(t, [[0, 0], [a, -0.045], [hit + 0.02, -0.035], [d - 0.1, -0.015], [d, 0]]);
  const fwd = keyed(t, [[0, 0], [a, -0.02], [hit + 0.03, 0.035], [hit + 0.14, 0.025], [d, 0]]);
  const heel = keyed(t, [[0, 0], [a, 0], [hit + 0.03, 0.38], [hit + 0.14, 0.3], [hit + 0.3, 0], [d, 0]]);
  // pernas (parado): peso para o pé do lado oposto ao braço, quadril gira, calcanhar do lado do soco gira
  c.hips(0.025 * sgn * ext, sink, fwd);
  turnBody(c, sgn * total, sgn * yaw, lean);
  c.bone('head', 1, 0, 0, 0.05); // queixo baixo
  if (side === 'r') feet(c, heel, 0); else feet(c, 0, heel);
  c.limb(side, 'clavicle', 0, 1, 0, 0.2 * ext); // o ombro acompanha o braço
  guard(c, 1);
  // antecipação: o punho recua junto ao rosto; disparo: braço estende até o alcance com o punho fechado
  c.reach(side, 'chest', [0.12, 0.1, 0.2], ELBOW_DOWN, 0.6 * coil);
  c.reach(side, 'shoulder', [-0.06, -0.03, 0.57], [0.6, -0.6, -0.2], Math.min(1, ext));
  // o braço de trás fecha junto ao rosto (proteção)
  c.reach(other, 'chest', [0.08, 0.1, 0.25], ELBOW_DOWN, 0.6 * Math.min(1, ext));
  fist(c, side);
  fist(c, other);
}

/**
 * chute frontal (rodada 10): peso passa ao pé de apoio e o corpo afunda (antecipação) → joelho sobe (engatilha) →
 * canela estende num estalo com a sola à frente → recolhe → o pé volta EXATAMENTE ao ponto de partida. Tronco e pelve
 * inclinam para trás no impacto (contrapeso), braço do lado do chute desce para trás, cabeça fica no alvo.
 */
function kickPose(c: Poser, hit: number) {
  const t = c.t, d = c.dur;
  const foot = keyed3(t, [[0, [0, 0, 0]], [hit * 0.4, [0, 0.015, 0]], [hit - 0.03, [0.02, 0.42, 0.2]], [hit + 0.035, [0.02, 0.78, 0.95]], [hit + 0.1, [0.02, 0.74, 0.9]], [hit + 0.24, [0.02, 0.38, 0.22]], [d - 0.13, [0, 0.03, 0.01]], [d - 0.06, [0, 0, 0]], [d, [0, 0, 0]]]);
  const pitch = keyed(t, [[0, 0], [hit * 0.4, 0.15], [hit - 0.03, 0.35], [hit + 0.035, -0.55], [hit + 0.12, -0.45], [hit + 0.26, 0.25], [d - 0.13, 0], [d, 0]]);
  const back = keyed(t, [[0, 0], [hit - 0.05, 0.07], [hit + 0.035, -0.27], [hit + 0.13, -0.21], [hit + 0.3, -0.03], [d, 0]]);
  const shift = keyed(t, [[0, 0], [hit * 0.6, 1], [d - 0.15, 1], [d, 0]]);
  const sink = keyed(t, [[0, 0], [hit * 0.5, -0.05], [hit + 0.03, -0.012], [hit + 0.28, -0.04], [d - 0.1, -0.01], [d, 0]]);
  const bal = Math.max(0, -back) / 0.27;
  c.hips(0.055 * shift, sink, -0.07 * bal);
  c.bone('pelvis', 1, 0, 0, 0.35 * back);
  c.bone('spine_01', 1, 0, 0, 0.65 * back);
  c.bone('spine_02', 0, 0, 1, -0.05 * shift); // tronco sobre o apoio
  c.bone('head', 1, 0, 0, -0.75 * back); // olhos no alvo
  c.plant('r', foot, pitch, [0.1, 0.7, 1]);
  c.plant('l', [0, 0, 0], 0.1 * bal, c.baseKnee.l, true);
  guard(c, 1);
  c.reach('r', 'shoulder', [0.14, -0.4, -0.14], ELBOW_OUT, 0.75 * bal);
}

/**
 * chute final da sequência (rodada 10): chute CIRCULAR — engatilha o joelho para o lado, a pelve gira com o pé de
 * apoio pivotando na bola do pé, a canela varre na altura do peito, atravessa, recolhe e o pé volta ao lugar
 */
function roundhousePose(c: Poser, hit: number) {
  const t = c.t, d = c.dur;
  const foot = keyed3(t, [[0, [0, 0, 0]], [hit * 0.4, [0.03, 0.04, 0]], [hit - 0.02, [0.32, 0.6, 0.25]], [hit + 0.05, [0.0, 0.85, 0.95]], [hit + 0.13, [-0.22, 0.78, 0.8]], [hit + 0.3, [0.12, 0.4, 0.18]], [d - 0.14, [0, 0.03, 0.01]], [d - 0.07, [0, 0, 0]], [d, [0, 0, 0]]]);
  const pole = keyed3(t, [[0, [0.12, 0, 1]], [hit - 0.02, [1, 0.35, 0.3]], [hit + 0.05, [0.45, 1, 0.1]], [hit + 0.3, [0.6, 0.3, 0.6]], [d, [0.12, 0, 1]]]);
  const pitch = keyed(t, [[0, 0], [hit - 0.02, 0.35], [hit + 0.05, 0.55], [hit + 0.3, 0.2], [d - 0.14, 0], [d, 0]]);
  const yaw = keyed(t, [[0, 0], [hit * 0.5, -0.08], [hit + 0.02, 0.5], [hit + 0.13, 0.62], [hit + 0.32, 0.25], [d - 0.1, 0], [d, 0]]);
  const back = keyed(t, [[0, 0], [hit - 0.02, -0.08], [hit + 0.05, -0.26], [hit + 0.15, -0.22], [hit + 0.35, -0.04], [d, 0]]);
  const tilt = keyed(t, [[0, 0], [hit - 0.02, -0.08], [hit + 0.05, -0.22], [hit + 0.15, -0.18], [hit + 0.35, -0.03], [d, 0]]);
  const shift = keyed(t, [[0, 0], [hit * 0.6, 1], [d - 0.15, 1], [d, 0]]);
  const sink = keyed(t, [[0, 0], [hit * 0.5, -0.06], [hit + 0.05, -0.02], [hit + 0.3, -0.04], [d - 0.1, -0.01], [d, 0]]);
  c.hips(0.06 * shift, sink, 0);
  c.bone('pelvis', 0, 1, 0, yaw);
  c.bone('pelvis', 0, 0, 1, 0.45 * tilt); // quadril do chute sobe
  c.bone('pelvis', 1, 0, 0, 0.3 * back);
  c.bone('spine_01', 1, 0, 0, 0.6 * back);
  c.bone('spine_01', 0, 0, 1, 0.5 * tilt); // tronco se afasta do chute
  c.bone('spine_03', 0, 0, 1, -0.45 * tilt);
  // o peito e a cabeça continuam virados para o alvo enquanto a pelve gira
  c.bone('spine_02', 0, 1, 0, -0.35 * yaw);
  c.bone('spine_03', 0, 1, 0, -0.25 * yaw);
  c.bone('neck_01', 0, 1, 0, -0.25 * yaw);
  c.bone('head', 1, 0, 0, -0.6 * back);
  c.plant('r', foot, pitch, pole);
  c.plantTurn('l', [0, 0, 0], 0.08 * shift, 0.85 * yaw, [0.12, 0, 1]);
  guard(c, 1);
  const bal = Math.max(0, -back) / 0.26;
  c.reach('r', 'shoulder', [0.18, -0.36, -0.12], ELBOW_OUT, 0.8 * bal);
  c.reach('l', 'chest', [0.18, 0.06, 0.28], ELBOW_DOWN, 0.4 * bal);
}

/**
 * esquiva (rodada 10): o deslocamento (2,2 m a 11 m/s ≈ 0,2 s) é da posição — o corpo faz um SALTO baixo nesse tempo
 * (agacha → pés saem do chão → pousa agachado → volta à guarda), para não "patinar" com os pés plantados.
 * `back` (parado: para trás), `fwd` (abaixa e passa por baixo), `side` (para a direita; espelhado = esquerda).
 */
function dodgePose(c: Poser, dir: 'back' | 'fwd' | 'side') {
  const t = c.t, d = c.dur;
  const air = t > 0.04 && t < 0.23 ? sin(Math.PI * (t - 0.04) / 0.19) : 0;
  const crouch = keyed(t, [[0, 0], [0.04, 1], [0.1, 0.4], [0.2, 0.45], [0.27, 1.1], [0.35, 0.85], [d, 0]]);
  const k = keyed(t, [[0, 0], [0.05, 1], [0.32, 1], [d, 0.15]]);
  const deep = dir === 'fwd' ? 1.35 : 1;
  const tuck = 0.05 * air * air;
  c.hips(dir === 'side' ? -0.07 * k : 0, (-0.12 * crouch + 0.07 * air) * deep, dir === 'back' ? 0.03 * k : dir === 'fwd' ? -0.03 * k : 0);
  for (const s of ['r', 'l'] as Side[]) c.plant(s, [dir === 'side' ? 0.02 * air * air : 0, 0.11 * air, -tuck], -0.25 * air, [0.12, 0.2, 1]);
  if (dir === 'side') {
    c.bone('spine_01', 0, 0, 1, 0.28 * k); // tronco tomba para o lado da esquiva
    c.bone('spine_01', 1, 0, 0, 0.12 * k);
    c.bone('neck_01', 0, 0, 1, -0.18 * k);
  } else c.bone('spine_01', 1, 0, 0, (dir === 'fwd' ? 0.5 : 0.3) * k);
  c.bone('spine_03', 1, 0, 0, 0.06 * k);
  c.bone('head', 1, 0, 0, -(dir === 'fwd' ? 0.35 : 0.22) * k); // olhos à frente
  guard(c, 1);
  c.reach('r', 'chest', [0.12, 0.12, 0.24], ELBOW_DOWN, 0.6 * k); // guarda alta
  c.reach('l', 'chest', [0.11, 0.14, 0.27], ELBOW_DOWN, 0.6 * k);
}

/**
 * taco a DUAS mãos (rodada 10): a mão direita guia (alvo + direção do taco pela pegada real — HAND_GRIP), a
 * esquerda segura o MESMO cabo 9,5 cm abaixo (para o lado da ponta do cabo). Pronto (taco sobre o ombro direito) →
 * carrega (tronco e quadril enrolam, taco aponta para trás) → varre plano pela direita até a frente na altura do peito
 * → acompanha até o lado esquerdo e enrola sobre o ombro esquerdo → volta. O taco nunca atravessa o tronco/cabeça.
 */
function batPose(c: Poser) {
  const t = c.t;
  const R = keyed3(t, [[0, [0.2, 0.04, 0.12]], [0.2, [0.27, 0.16, -0.02]], [0.26, [0.25, 0.1, 0.06]], [0.32, [0.02, -0.02, 0.42]], [0.4, [-0.22, 0.0, 0.32]], [0.52, [-0.28, 0.1, 0.12]], [0.62, [-0.26, 0.06, 0.12]], [0.8, [0.2, 0.04, 0.12]]]);
  const D = keyed3(t, [[0, [-0.35, 0.75, -0.5]], [0.2, [-0.2, 0.42, -0.9]], [0.28, [-0.95, 0.25, 0.1]], [0.32, [-0.15, 0.06, 1]], [0.4, [0.9, 0.1, 0.35]], [0.52, [0.6, 0.45, -0.65]], [0.62, [0.55, 0.5, -0.65]], [0.8, [-0.35, 0.75, -0.5]]]);
  const total = keyed(t, [[0, -0.15], [0.2, -0.6], [0.26, -0.5], [0.32, 0.3], [0.4, 0.75], [0.52, 0.8], [0.62, 0.7], [0.8, -0.15]]);
  const dx = keyed(t, [[0, 0], [0.2, -0.03], [0.32, 0.03], [0.45, 0.045], [0.8, 0]]);
  const heel = keyed(t, [[0, 0], [0.3, 0], [0.4, 0.4], [0.6, 0.35], [0.8, 0]]);
  c.hips(dx, keyed(t, [[0, 0], [0.2, -0.04], [0.34, -0.03], [0.6, -0.03], [0.8, 0]]), 0);
  turnBody(c, total, 0.35 * total, keyed(t, [[0, 0.02], [0.2, -0.03], [0.34, 0.12], [0.5, 0.08], [0.8, 0.02]]), 0.5);
  feet(c, heel, 0);
  c.reach('r', 'chest', R, [0.8, -0.5, -0.2]);
  c.aimHand('r', D);
  fist(c, 'r');
  fist(c, 'l');
  c.secondGrip('l', 'r', -0.095, [0.8, -0.5, -0.2]);
}

/**
 * barra de cima para baixo (rodada 10): pronta (barra em pé à frente) → sobe acima do ombro direito apontando para trás
 * (tronco arqueia) → passa pela vertical → desce num estalo à frente com o tronco dobrando e o peso indo ao pé da frente
 * → acompanha até a cintura → volta. Direção da barra pela pegada (HAND_GRIP); mão esquerda equilibra.
 */
function barPose(c: Poser) {
  const t = c.t;
  const R = keyed3(t, [[0, [0.16, -0.12, 0.24]], [0.24, [0.2, 0.5, -0.06]], [0.3, [0.14, 0.44, 0.1]], [0.36, [-0.02, 0.04, 0.5]], [0.46, [-0.06, -0.28, 0.38]], [0.62, [-0.05, -0.27, 0.34]], [0.9, [0.16, -0.12, 0.24]]]);
  const D = keyed3(t, [[0, [-0.05, 0.85, 0.5]], [0.24, [-0.08, 0.4, -0.9]], [0.3, [-0.04, 1, 0.1]], [0.36, [0, -0.2, 1]], [0.46, [0.05, -0.85, 0.5]], [0.62, [0.05, -0.8, 0.55]], [0.9, [-0.05, 0.85, 0.5]]]);
  const pitch = keyed(t, [[0, 0], [0.24, -0.14], [0.3, -0.08], [0.38, 0.27], [0.48, 0.32], [0.65, 0.28], [0.9, 0]]);
  const fw = Math.max(0, pitch) / 0.32;
  c.hips(0, keyed(t, [[0, 0], [0.24, -0.02], [0.7, -0.02], [0.9, 0]]) - 0.04 * fw, 0.04 * fw);
  c.bone('pelvis', 1, 0, 0, 0.2 * pitch);
  turnBody(c, keyed(t, [[0, 0], [0.24, -0.16], [0.36, 0.2], [0.9, 0]]), keyed(t, [[0, 0], [0.24, -0.06], [0.36, 0.08], [0.9, 0]]), 0.45 * pitch, 0.4);
  c.bone('spine_02', 1, 0, 0, 0.3 * pitch);
  c.bone('neck_01', 1, 0, 0, -0.4 * pitch);
  feet(c, keyed(t, [[0, 0], [0.34, 0], [0.44, 0.3], [0.65, 0.25], [0.9, 0]]), 0);
  c.reach('r', 'chest', R, [1, -0.3, -0.3]);
  c.aimHand('r', D);
  fist(c, 'r');
  // braço livre: sobe à frente na carga, desce para trás no golpe (equilíbrio)
  c.reach('l', 'chest', keyed3(t, [[0, [0.1, -0.2, 0.15]], [0.24, [0.2, 0.05, 0.3]], [0.4, [0.24, -0.25, -0.05]], [0.9, [0.1, -0.2, 0.15]]]), ELBOW_DOWN, 0.8);
  c.fingers('l', 0.7, {}, 1);
}

/** spray (rodada 10): estende o braço com a lata EM PÉ (bico para a frente), dedo no bico, varre; mão livre no peito */
function sprayPose(c: Poser) {
  const t = c.t, d = c.dur;
  const k = keyed(t, [[0, 0], [0.11, 1], [0.62, 1], [0.8, 0.25], [d, 0]]);
  const sweep = Math.sin(TAU * 1.6 * Math.max(0, t - 0.12)) * env(t, 0.12, 0.2, 0.55, 0.62);
  c.hips(0, -0.02 * k, 0.02 * k);
  turnBody(c, 0.16 * k + 0.12 * sweep, 0.06 * k, 0.04 * k, 0.5);
  feet(c);
  c.reach('r', 'shoulder', [-0.04 - 0.06 * sweep, 0.02, 0.5], [0.7, -0.6, -0.1], k);
  c.aimHand('r', [0, 1, 0.15], k);
  c.fingers('r', 0.85, { index: 0.35, thumb: 0.3 }, 1);
  c.reach('l', 'chest', [0.04, -0.08, 0.2], ELBOW_DOWN, 0.6 * k);
  fist(c, 'l', 0.7);
}

/**
 * cambaleio direcional (rodada 10; estado STAGGERED e NPC atingido): o golpe chega (tronco dá o tranco no sentido do
 * empurrão, cabeça atrasa), um passo de equilíbrio (o pé sai do chão e pousa — não desliza), braços abrem, recupera.
 * `front` = empurrado para trás (golpe de frente) · `back` = para a frente · `side` = para a direita (espelhado: esquerda)
 */
function staggerPose(c: Poser, dir: 'front' | 'back' | 'side') {
  const t = c.t, d = c.dur;
  const hk = keyed(t, [[0, 0], [0.06, 1], [0.22, 0.85], [0.5, 0.3], [d, 0]]);
  const wob = Math.exp(-t * 5) * sin(TAU * 2.2 * t);
  // passo: sobe, pousa mais longe, volta com outro pequeno passo
  const st = keyed(t, [[0, 0], [0.05, 0], [0.17, 1], [0.58, 1], [0.72, 0], [d, 0]]);
  const lift = 0.07 * env(t, 0.02, 0.07, 0.15, 0.21) + 0.05 * env(t, 0.55, 0.6, 0.7, 0.76);
  if (dir === 'front') {
    c.hips(0, -0.05 * hk, -0.06 * hk);
    c.bone('spine_01', 1, 0, 0, -0.14 * hk);
    c.bone('spine_02', 1, 0, 0, -0.12 * hk);
    c.bone('head', 1, 0, 0, 0.16 * hk); // cabeça atrasa: queixo vem ao peito
    c.plant('r', [0, lift, -0.16 * st], 0.3 * lift / 0.07, [0.12, 0, 1]);
    c.plant('l', [0, 0, 0], 0, c.baseKnee.l, true);
    c.limb('r', 'upperarm', 0, 0, 1, -0.45 * hk);
    c.limb('l', 'upperarm', 0, 0, 1, -0.45 * hk);
    c.limb('r', 'upperarm', 1, 0, 0, -0.35 * hk); // braços vêm à frente (equilíbrio)
    c.limb('l', 'upperarm', 1, 0, 0, -0.35 * hk);
  } else if (dir === 'back') {
    c.hips(0, -0.05 * hk, 0.05 * hk);
    c.bone('spine_01', 1, 0, 0, 0.2 * hk);
    c.bone('spine_02', 1, 0, 0, 0.08 * hk);
    c.bone('head', 1, 0, 0, -0.2 * hk); // cabeça atrasa: vai para trás
    c.plant('l', [0, lift, 0.18 * st], 0.3 * lift / 0.07, [0.12, 0, 1]);
    c.plant('r', [0, 0, 0], 0, c.baseKnee.r, true);
    c.limb('r', 'upperarm', 1, 0, 0, 0.5 * hk); // braços vão para trás
    c.limb('l', 'upperarm', 1, 0, 0, 0.5 * hk);
    c.limb('r', 'upperarm', 0, 0, 1, -0.25 * hk);
    c.limb('l', 'upperarm', 0, 0, 1, -0.25 * hk);
  } else {
    c.hips(-0.06 * hk, -0.05 * hk, 0);
    c.bone('spine_01', 0, 0, 1, 0.2 * hk); // tronco tomba para a direita
    c.bone('spine_03', 0, 0, 1, 0.08 * hk);
    c.bone('neck_01', 0, 0, 1, -0.18 * hk); // cabeça atrasa
    c.plant('r', [0.15 * st, lift, 0], 0.3 * lift / 0.07, [0.12, 0, 1]);
    c.plant('l', [0, 0, 0], 0, c.baseKnee.l, true);
    c.limb('l', 'upperarm', 0, 0, 1, -0.9 * hk); // braço do outro lado abre para cima (equilíbrio)
    c.limb('l', 'lowerarm', 0, 0, 1, -0.3 * hk);
    c.limb('r', 'upperarm', 0, 0, 1, -0.35 * hk);
  }
  c.bone('spine_03', 0, 0, 1, 0.1 * wob);
  c.bone('head', 0, 0, 1, -0.08 * wob);
  c.limb('r', 'lowerarm', 0, 0, 1, -0.3 * hk);
  c.limb('l', 'lowerarm', 0, 0, 1, -0.3 * hk);
  c.fingers('r', 0.25, {}, hk);
  c.fingers('l', 0.25, {}, hk);
}

/** duração das ações `once` (registro de ações = fonte única) */
const onceDur = (clip: string, fallback: number) => ACTIONS.find((a) => a.clip === clip)?.duration ?? fallback;

/** braço levantado acima da cabeça (mão aberta ou punho), com envelope e pequeno balanço */
function armOverhead(c: Poser, side: 'r' | 'l', w: number, sway: number, fist: number, outward = 0.12) {
  c.limb(side, 'clavicle', 0, 0, 1, -0.12 * w);
  c.reach(side, 'shoulder', [outward + 0.04 * sway, 0.52, 0.06 + 0.02 * sway], [1, -0.2, -0.3], w);
  c.twist(side, 'lowerarm', 0.5 * w);
  c.limb(side, 'hand', 1, 0, 0, (0.15 + 0.12 * sway) * w);
  c.fingers(side, 0.15 + 0.85 * fist, {}, w);
}

/** cartaz com as duas mãos: centro da pegada, inclinação (rad, em torno da frente) e largura entre as mãos */
function signGrip(c: Poser, center: V3, tilt: number, half = 0.23, pole: V3 = ELBOW_OUT, w = 1) {
  for (const s of ['r', 'l'] as Side[]) {
    // mão direita no lado −x do cartaz; a inclinação gira o par de mãos em torno do centro
    const sx = s === 'r' ? 1 : -1;
    const along = half * cos(tilt), up = half * sin(tilt) * sx;
    // [fora, cima, frente] a partir do peito; "fora" do lado esquerdo é +x, então o centro lateral muda de sinal
    c.reach(s, 'chest', [along + center[0] * -sx, center[1] + up, center[2]], pole, w);
    c.twist(s, 'lowerarm', 0.9 * w);
    c.fingers(s, 0.85, { thumb: 0.3 }, w);
  }
}

/** mastro vertical segurado pelas duas mãos: mão direita em cima */
function poleGrip(c: Poser, base: V3, span: number, lean: number, w = 1) {
  // a mão esquerda cruza para o lado do mastro: "fora" negativo
  const topX = base[0] + span * sin(lean), topY = base[1] + span * cos(lean);
  c.reach('r', 'chest', [topX, topY, base[2]], [0.9, -0.6, -0.2], w);
  c.reach('l', 'chest', [-base[0], base[1], base[2] + 0.02], [0.7, -0.8, -0.1], w);
  c.twist('r', 'lowerarm', 0.6 * w);
  c.twist('l', 'lowerarm', 0.6 * w);
  c.fingers('r', 0.9, { thumb: 0.45 }, w);
  c.fingers('l', 0.9, { thumb: 0.45 }, w);
}

/** passos de dança: pés plantados com transferência de peso; `shift` −1..1 (direita..esquerda) */
function danceLegs(c: Poser, shift: number, bounce: number, liftR = 0, liftL = 0, fwdR = 0, fwdL = 0) {
  // base um pouco mais estreita que a do idle (prontidão); a pelve vai para o lado do apoio e inclina
  c.hips(0.075 * shift, -0.04 - 0.055 * bounce, 0.0);
  c.bone('pelvis', 0, 0, 1, -0.08 * shift);
  c.plant('r', [-0.04, liftR, fwdR], liftR * 3);
  c.plant('l', [-0.04, liftL, fwdL], liftL * 3);
}

/**
 * levantar DE COSTAS (rodada 10; era 9.1): começa DEITADO (pelve no chão, tronco quase na horizontal, pernas
 * estendidas — perto da pose real do ragdoll) → senta apoiando as mãos atrás → recolhe os pés → passa o peso aos pés
 * (agachado, mãos nos joelhos) → endireita. Pés sempre no chão: nada de "pernas para o ar".
 */
function getupPose(c: Poser) {
  const t = c.t;
  const pel = c.pos('pelvis', new THREE.Vector3());
  const seat = (c.floorY + 0.13 * c.kLeg - pel.y) / c.kLeg; // pelve no chão (negativo)
  const up = keyed(t, [[0, 1], [0.5, 1], [0.86, 0.45], [1.2, 0.05], [1.4, 0]]);
  // deitado: a pelve fica ATRÁS dos pés (quem cai para trás senta atrás dos pés; os pés não escorregam na queda)
  const back = keyed(t, [[0, -0.62], [0.3, -0.5], [0.55, -0.3], [0.9, -0.05], [1.4, 0]]);
  c.hips(0, seat * up, back);
  c.bone('pelvis', 1, 0, 0, keyed(t, [[0, -1.2], [0.32, -0.5], [0.55, -0.22], [0.86, 0.15], [1.4, 0]]));
  const fwd = keyed(t, [[0, 0.16], [0.28, 0.14], [0.52, 0.08], [0.75, 0.02], [1.4, 0]]);
  c.plant('r', [0.06, 0, fwd], keyed(t, [[0, -0.25], [0.4, 0], [1.4, 0]]), [0.25, 0.5, 1]);
  c.plant('l', [0.04, 0, fwd * 0.8], keyed(t, [[0, -0.25], [0.4, 0], [0.6, 0.25], [0.95, 0], [1.4, 0]]), [0.25, 0.5, 1]);
  // tronco: deitado (cabeça um pouco erguida) → à frente (peso sobre os pés) → ereto
  c.bone('spine_01', 1, 0, 0, keyed(t, [[0, 0.02], [0.32, 0.3], [0.62, 0.55], [0.95, 0.42], [1.2, 0.1], [1.4, 0]]));
  c.bone('spine_02', 1, 0, 0, keyed(t, [[0, 0.06], [0.5, 0.2], [1.15, 0.05], [1.4, 0]]));
  c.bone('neck_01', 1, 0, 0, keyed(t, [[0, 0.32], [0.3, 0.12], [0.78, -0.32], [1.4, 0]]));
  // mãos: no chão ao lado do quadril → apoiadas atrás (sentado) → nos joelhos (empurrando) → soltas
  const hw = keyed(t, [[0, 1], [1.08, 1], [1.4, 0]]);
  const hand = keyed3(t, [[0, [0.24, -0.06, -0.12]], [0.3, [0.17, -0.09, -0.3]], [0.52, [0.18, -0.1, -0.12]], [0.75, [0.02, 0.0, 0.0]], [1.08, [-0.02, 0.04, 0.02]]]);
  const onKnee = keyed(t, [[0, 0], [0.5, 0], [0.78, 1]]);
  c.reach('r', 'pelvis', hand, [1, 0.3, -0.6], hw);
  c.reach('l', 'pelvis', [hand[0] - 0.02, hand[1], hand[2]], [1, 0.3, -0.6], hw);
  c.reach('r', 'knee', [-0.04, 0.06, 0.1], [0.7, 0.1, -0.7], hw * onKnee);
  c.reach('l', 'knee', [-0.02, 0.06, 0.1], [0.7, 0.1, -0.7], hw * onKnee);
  c.fingers('r', 0.35, {}, hw);
  c.fingers('l', 0.35, {}, hw);
}

/**
 * levantar DE BRUÇOS (rodada 10): deitado de bruços (mãos sob os ombros) → empurra o chão e traz os joelhos para
 * baixo do quadril (de quatro) → planta o pé direito à frente (ajoelhado) → agacha com as mãos nos joelhos → endireita.
 * Antes o levantar de bruços passava pela pose sentada de costas: o corpo virava com as pernas a 1 m do chão.
 */
function getupPronePose(c: Poser) {
  const t = c.t;
  const drop = keyed(t, [[0, -0.8], [0.35, -0.52], [0.7, -0.44], [1.0, -0.33], [1.25, -0.06], [1.4, 0]]);
  c.hips(0, drop, keyed(t, [[0, 0.12], [0.35, -0.02], [0.7, -0.1], [1.0, -0.08], [1.4, 0]]));
  c.bone('pelvis', 1, 0, 0, keyed(t, [[0, 1.3], [0.35, 0.95], [0.7, 0.6], [1.0, 0.42], [1.25, 0.1], [1.4, 0]]));
  c.bone('spine_01', 1, 0, 0, keyed(t, [[0, 0.04], [0.35, 0.16], [0.7, 0.3], [1.0, 0.36], [1.25, 0.08], [1.4, 0]]));
  c.bone('neck_01', 1, 0, 0, keyed(t, [[0, -0.55], [0.35, -0.4], [0.8, -0.22], [1.4, 0]])); // olha à frente, não o chão
  // pés: estendidos para trás (peito do pé no chão) → joelhos sob o quadril → pé direito à frente → agachado → em pé
  // peito do pé no chão: o tornozelo fica baixo (o `plant` sobe o alvo pelo calcanhar; −0,09 devolve ao chão)
  const fr = keyed3(t, [[0, [0.05, -0.09, -0.7]], [0.35, [0.05, -0.08, -0.42]], [0.6, [0.06, 0.0, 0.06]], [1.25, [0.0, 0, 0]], [1.4, [0, 0, 0]]]);
  const fl = keyed3(t, [[0, [0.04, -0.09, -0.72]], [0.35, [0.04, -0.08, -0.44]], [0.7, [0.04, -0.06, -0.38]], [0.95, [0.02, 0.0, -0.06]], [1.25, [0, 0, 0]], [1.4, [0, 0, 0]]]);
  c.plant('r', fr, keyed(t, [[0, 1.35], [0.35, 1.25], [0.6, 0], [1.4, 0]]), [0.12, -0.2, 1]);
  c.plant('l', fl, keyed(t, [[0, 1.35], [0.35, 1.25], [0.7, 1.0], [0.95, 0.35], [1.25, 0], [1.4, 0]]), [0.12, -0.2, 1]);
  // mãos: no chão sob os ombros (empurram) → na coxa/joelho → soltas
  c.updateFloorRel();
  const hy = c.floorRel + 0.05;
  const hw = keyed(t, [[0, 1], [1.08, 1], [1.4, 0]]);
  const onFloor = keyed(t, [[0, 1], [0.62, 1], [0.8, 0]]);
  const hand = keyed3(t, [[0, [0.24, hy, 0.5]], [0.35, [0.22, hy, 0.42]], [0.62, [0.2, hy, 0.4]]]);
  c.reach('r', 'pelvis', hand, [1, 0.2, -0.4], hw * onFloor);
  c.reach('l', 'pelvis', [hand[0] - 0.02, hand[1], hand[2]], [1, 0.2, -0.4], hw * onFloor);
  const onKnee = keyed(t, [[0, 0], [0.62, 0], [0.82, 1]]);
  c.reach('r', 'knee', [-0.04, 0.06, 0.1], [0.7, 0.1, -0.7], hw * onKnee);
  c.reach('l', 'knee', [-0.02, 0.06, 0.1], [0.7, 0.1, -0.7], hw * onKnee);
  c.limb('r', 'hand', 1, 0, 0, -0.9 * onFloor * hw); // punho dobrado, palma no chão
  c.limb('l', 'hand', 1, 0, 0, -0.9 * onFloor * hw);
  c.fingers('r', 0.2, {}, hw);
  c.fingers('l', 0.2, {}, hw);
}

export const SPECS: Record<string, ClipSpec> = {
  // ------------------------------------------------------------------ gestos
  emote_wave: {
    dur: onceDur('emote_wave', 2.4), layer: 'upper', mirror: true,
    pose: (c) => {
      const t = c.t, e = env(t, 0.05, 0.55, c.dur - 0.6, c.dur - 0.05), h = env(t, 0.4, 0.75, c.dur - 0.75, c.dur - 0.4);
      const f = TAU * 2.3 * t;
      c.life();
      c.bone('spine_02', 0, 0, 1, -0.05 * e);
      c.bone('spine_03', 0, 1, 0, -0.06 * e);
      c.bone('head', 0, 1, 0, -0.1 * e);
      c.bone('head', 0, 0, 1, 0.05 * e * sin(f * 0.5));
      c.limb('r', 'clavicle', 0, 0, 1, -0.16 * e);
      // o antebraço balança no cotovelo; a mão atrasa (fase) e exagera um pouco
      c.reach('r', 'shoulder', [0.24 + 0.075 * h * sin(f), 0.3 - 0.015 * h * Math.abs(sin(f)), 0.1], [1, -0.7, -0.25], e);
      c.twist('r', 'lowerarm', 1.2 * e);
      c.limb('r', 'hand', 0, 0, 1, -0.32 * h * sin(f - 0.9));
      c.fingers('r', 0.08, { thumb: -0.3 }, e);
    },
  },
  emote_clap: {
    dur: 2.4, layer: 'upper',
    pose: (c) => {
      const u = c.u, n = 5;
      // separação: impacto rápido, abertura mais lenta
      const open = Math.pow(0.5 - 0.5 * cos(TAU * n * u), 0.75);
      const hit = beatPulse(u, n, 0.5);
      c.life();
      c.bone('spine_03', 1, 0, 0, 0.05 + 0.025 * hit);
      c.bone('head', 1, 0, 0, 0.04 * hit);
      c.reach('r', 'chest', [0.04 + 0.11 * open, -0.12 + 0.03 * open, 0.3], ELBOW_OUT);
      c.reach('l', 'chest', [0.04 + 0.07 * open, -0.13 + 0.02 * open, 0.31], ELBOW_OUT);
      c.limb('r', 'hand', 0, 1, 0, -0.25 * open);
      c.limb('l', 'hand', 0, 1, 0, -0.18 * open);
      c.fingers('r', 0.12, { thumb: -0.2 });
      c.fingers('l', 0.12, { thumb: -0.2 });
    },
  },
  emote_point: {
    dur: onceDur('emote_point', 2.0), layer: 'upper', mirror: true,
    pose: (c) => {
      const t = c.t, e = env(t, 0.0, 0.4, c.dur - 0.55, c.dur - 0.05);
      const jab = env(t, 0.45, 0.6, 0.6, 0.85) + 0.6 * env(t, 0.95, 1.1, 1.1, 1.35);
      c.life();
      c.bone('spine_03', 0, 1, 0, -0.14 * e);
      c.bone('spine_02', 1, 0, 0, 0.04 * e);
      c.bone('head', 0, 1, 0, -0.1 * e);
      c.limb('r', 'clavicle', 0, 0, 1, -0.08 * e);
      c.reach('r', 'shoulder', [0.08, 0.06 + 0.03 * jab, 0.5 + 0.03 * jab], [1, -0.4, -0.2], e);
      c.twist('r', 'lowerarm', 0.4 * e);
      c.fingers('r', 1.0, { index: 0.05, thumb: 0.5 }, e);
    },
  },
  emote_cheer: {
    dur: onceDur('emote_cheer', 2.6), layer: 'upper', mirror: true,
    pose: (c) => {
      const t = c.t, e = env(t, 0.0, 0.35, c.dur - 0.6, c.dur - 0.05);
      const pump = sin(TAU * 2 * t) * env(t, 0.35, 0.55, c.dur - 0.8, c.dur - 0.5);
      c.life();
      c.bone('spine_03', 1, 0, 0, -0.08 * e - 0.03 * pump);
      c.bone('head', 1, 0, 0, -0.18 * e);
      armOverhead(c, 'r', e, pump, 1, 0.14);
      armOverhead(c, 'l', ease((t - 0.08) / 0.35) * (1 - ease((t - c.dur + 0.6) / 0.55)), sin(TAU * 2 * t - 0.6) * env(t, 0.4, 0.6, c.dur - 0.8, c.dur - 0.5), 1, 0.14);
    },
  },
  emote_arm_up: {
    dur: 3.2, layer: 'upper', mirror: true,
    pose: (c) => {
      const u = c.u;
      c.life();
      c.bone('spine_02', 0, 0, 1, -0.04);
      c.bone('head', 1, 0, 0, -0.06);
      armOverhead(c, 'r', 1, osc(u, 1), 0, 0.06);
      c.limb('r', 'hand', 0, 0, 1, 0.08 * osc(u, 2, 0.2));
    },
  },
  emote_arms_up: {
    dur: 3.2, layer: 'upper',
    pose: (c) => {
      const u = c.u, sw = osc(u, 1);
      c.life();
      c.bone('spine_03', 0, 0, 1, 0.05 * sw);
      c.bone('spine_03', 1, 0, 0, -0.05);
      c.bone('head', 1, 0, 0, -0.1);
      c.bone('head', 0, 0, 1, 0.04 * osc(u, 1, 0.1));
      armOverhead(c, 'r', 1, sw, 0, 0.2);
      armOverhead(c, 'l', 1, -osc(u, 1, 0.08), 0, 0.2);
    },
  },
  emote_thumbs_up: {
    dur: onceDur('emote_thumbs_up', 1.8), layer: 'upper', mirror: true,
    pose: (c) => {
      const t = c.t, e = env(t, 0.0, 0.4, c.dur - 0.5, c.dur - 0.05);
      const nod = env(t, 0.45, 0.6, 0.6, 0.85);
      c.life();
      c.bone('head', 1, 0, 0, 0.1 * nod);
      c.bone('spine_03', 0, 1, 0, -0.05 * e);
      c.reach('r', 'shoulder', [0.02, -0.21 + 0.03 * nod, 0.32], ELBOW_DOWN, e);
      c.twist('r', 'lowerarm', 0.1 * e);
      c.limb('r', 'hand', 1, 0, 0, -0.25 * e);
      c.fingers('r', 1.0, { thumb: 0 }, e);
      c.thumbUp('r', e);
    },
  },
  emote_talk: {
    dur: 6.0, layer: 'upper', mirror: true,
    pose: (c) => {
      const u = c.u;
      // gestos de conversa: duas mãos em alturas e ritmos diferentes, ênfases esparsas
      const r1 = 0.5 + 0.5 * osc(u, 3), r2 = osc(u, 5, 0.3), l1 = 0.5 + 0.5 * osc(u, 2, 0.55), emph = Math.max(0, osc(u, 4, 0.15)) ** 3;
      c.life(1.4);
      c.bone('spine_03', 0, 1, 0, 0.06 * osc(u, 2, 0.1));
      c.bone('head', 1, 0, 0, 0.06 * emph + 0.03 * osc(u, 7));
      c.bone('head', 0, 0, 1, 0.05 * osc(u, 3, 0.4));
      c.reach('r', 'chest', [0.17 + 0.05 * r2, -0.36 + 0.13 * r1 + 0.04 * emph, 0.24 + 0.06 * r1], ELBOW_DOWN, 0.95);
      c.reach('l', 'chest', [0.2 + 0.03 * osc(u, 4), -0.44 + 0.1 * l1, 0.16 + 0.05 * l1], ELBOW_DOWN, 0.7 + 0.25 * l1);
      c.twist('r', 'lowerarm', 0.9 + 0.3 * r1);
      c.twist('l', 'lowerarm', 0.6 + 0.4 * l1);
      c.limb('r', 'hand', 1, 0, 0, -0.2 * emph);
      c.fingers('r', 0.2 + 0.25 * r1);
      c.fingers('l', 0.45 - 0.15 * l1);
    },
  },
  emote_photo: {
    dur: 3.6, layer: 'full', mirror: true,
    pose: (c) => {
      const u = c.u, br = osc(u, 1);
      // peso na perna esquerda, quadril para o lado, sinal de "paz" perto do rosto e mão na cintura
      c.hips(0.045, -0.015, 0);
      c.bone('pelvis', 0, 0, 1, -0.06);
      c.plant('l', [0, 0, 0]);
      c.plant('r', [0.02, 0.02, 0.07], 0.25, [0.4, 0, 1]);
      c.bone('spine_02', 0, 0, 1, 0.07);
      c.bone('spine_03', 1, 0, 0, -0.012 * br);
      c.bone('head', 0, 0, 1, -0.12 + 0.015 * br);
      c.bone('head', 0, 1, 0, -0.05);
      c.reach('r', 'head', [0.21, -0.08, 0.13], [1, -0.6, -0.4]);
      c.twist('r', 'lowerarm', 1.5);
      c.fingers('r', 1.0, { index: 0.03, middle: 0.03, thumb: 0.5 });
      c.reach('l', 'pelvis', [0.2, 0.1, 0.03], [1, 0.1, -0.8]);
      c.twist('l', 'lowerarm', -0.4);
      c.fingers('l', 0.35);
    },
  },
  emote_sit_ground: {
    dur: 4.8, layer: 'full', fade: 0.8,
    pose: (c) => {
      const u = c.u;
      // sentado no chão, joelhos para cima, antebraços apoiados nos joelhos; olha em volta devagar
      const pel = c.pos('pelvis', new THREE.Vector3());
      c.hips(0, (c.floorY + 0.13 * c.kLeg - pel.y) / c.kLeg, -0.08);
      c.bone('pelvis', 1, 0, 0, -0.25);
      c.plant('r', [0.06, 0, 0.45], 0, [0.25, 0.5, 1]);
      c.plant('l', [0.04, 0, 0.48], 0, [0.25, 0.5, 1]);
      c.bone('spine_01', 1, 0, 0, 0.32);
      c.bone('spine_02', 1, 0, 0, 0.14);
      c.bone('spine_03', 1, 0, 0, 0.06 - 0.015 * osc(u, 1));
      c.bone('neck_01', 1, 0, 0, -0.18);
      c.bone('head', 0, 1, 0, 0.3 * osc(u, 1, 0.2) * (0.6 + 0.4 * osc(u, 2)));
      c.bone('head', 1, 0, 0, -0.06 + 0.03 * osc(u, 2, 0.35));
      c.reach('r', 'knee', [-0.04, 0.03, 0.14], [0.7, 0.1, -0.7]);
      c.reach('l', 'knee', [-0.02, 0.0, 0.16], [0.7, 0.1, -0.7]);
      c.limb('r', 'hand', 1, 0, 0, 0.3);
      c.limb('l', 'hand', 1, 0, 0, 0.35);
      c.fingers('r', 0.5);
      c.fingers('l', 0.55);
    },
  },
  emote_jump_cheer: {
    dur: onceDur('emote_jump_cheer', 2.2), layer: 'full',
    pose: (c) => {
      const t = c.t;
      // antecipação (agacha) → impulso → voo (braços para cima) → aterrissagem (amortece) → volta
      const crouch = env(t, 0.0, 0.32, 0.32, 0.5) + 0.8 * env(t, 0.82, 0.95, 1.0, 1.35);
      const air = t > 0.42 && t < 0.86 ? sin(Math.PI * (t - 0.42) / 0.44) : 0;
      const arms = env(t, 0.3, 0.55, 1.5, 2.05);
      c.hips(0, -0.16 * crouch + 0.24 * air, 0.02 * crouch);
      c.bone('spine_01', 1, 0, 0, 0.22 * crouch - 0.06 * air);
      c.bone('spine_03', 1, 0, 0, -0.06 * arms);
      c.bone('head', 1, 0, 0, -0.16 * arms + 0.08 * crouch);
      const tuck = 0.08 * air;
      c.plant('r', [0, 0.24 * air - tuck * 0.2, -tuck], -0.4 * air, [0.12, 0, 1]);
      c.plant('l', [0, 0.24 * air - tuck * 0.2, -tuck * 0.6], -0.35 * air, [0.12, 0, 1]);
      const pump = sin(TAU * 2.2 * (t - 0.9)) * env(t, 1.0, 1.15, 1.45, 1.7);
      // antecipação: braços para trás antes de subir
      c.limb('r', 'upperarm', 1, 0, 0, 0.5 * env(t, 0.0, 0.3, 0.3, 0.45));
      c.limb('l', 'upperarm', 1, 0, 0, 0.5 * env(t, 0.0, 0.3, 0.3, 0.45));
      armOverhead(c, 'r', arms, pump, 1, 0.16);
      armOverhead(c, 'l', arms, -pump, 1, 0.16);
    },
  },
  emote_phone: {
    dur: 5.0, layer: 'upper', mirror: true,
    pose: (c) => {
      const u = c.u, pan = osc(u, 1) * 0.6 + 0.4 * osc(u, 2, 0.3);
      c.life(0.6);
      c.bone('spine_03', 0, 1, 0, 0.12 * pan);
      c.bone('head', 0, 1, 0, 0.06 * pan);
      c.bone('head', 1, 0, 0, 0.14);
      // celular à frente do peito/queixo, tela para o rosto (cabeça olha para baixo); a outra mão relaxada à frente
      c.reach('r', 'head', [0.04, -0.24 + 0.01 * osc(u, 3), 0.36], ELBOW_DOWN);
      c.twist('r', 'lowerarm', 1.25);
      c.limb('r', 'hand', 1, 0, 0, -0.35);
      c.fingers('r', 0.75, { thumb: 0.1 });
      c.reach('l', 'chest', [-0.02, -0.3, 0.2], ELBOW_DOWN, 0.85);
      c.twist('l', 'lowerarm', 0.8);
      c.fingers('l', 0.5);
    },
  },
  emote_rhythm_clap: {
    dur: 2.0, layer: 'upper',
    pose: (c) => {
      const u = c.u, n = 4;
      // 120 BPM: palma em cada tempo, mãos na altura do rosto, corpo balança a cada dois tempos
      const open = Math.pow(0.5 - 0.5 * cos(TAU * n * u), 0.7);
      const hit = beatPulse(u, n, 0.5), sw = osc(u, 1);
      c.life(0.5);
      c.bone('spine_03', 0, 0, 1, 0.06 * sw);
      c.bone('spine_03', 1, 0, 0, 0.03 * hit);
      c.bone('head', 1, 0, 0, 0.06 * hit - 0.05);
      c.bone('head', 0, 0, 1, -0.05 * sw);
      c.reach('r', 'chest', [0.04 + 0.12 * open, 0.36 + 0.03 * open, 0.2], ELBOW_OUT);
      c.reach('l', 'chest', [0.04 + 0.09 * open, 0.35 + 0.02 * open, 0.21], ELBOW_OUT);
      c.limb('r', 'hand', 0, 1, 0, -0.25 * open);
      c.limb('l', 'hand', 0, 1, 0, -0.2 * open);
      c.fingers('r', 0.12, { thumb: -0.2 });
      c.fingers('l', 0.12, { thumb: -0.2 });
    },
  },
  emote_fist_up: {
    dur: 2.0, layer: 'upper', mirror: true,
    pose: (c) => {
      const u = c.u, pump = beatPulse(u, 2, 0);
      c.life(0.6);
      c.bone('spine_03', 1, 0, 0, -0.04 - 0.03 * pump);
      c.bone('head', 1, 0, 0, -0.08 - 0.04 * pump);
      c.limb('r', 'clavicle', 0, 0, 1, -0.2);
      c.reach('r', 'shoulder', [0.06, 0.44 + 0.07 * pump, 0.1], [1, -0.3, -0.3]);
      c.twist('r', 'lowerarm', 0.3);
      c.limb('r', 'hand', 1, 0, 0, 0.2 - 0.15 * pump);
      c.fingers('r', 1.0, { thumb: 0.3 });
    },
  },

  // ------------------------------------------------------------------ manifestação (itens)
  // Pegadas (combinadas com src/social/props.ts): cartaz pelas bordas laterais, mãos a ~0,46 m (placa de 0,5 m);
  // mastro da bandeira na mão direita (mão esquerda abaixo no mesmo mastro quando usa as duas).
  prop_sign_raise: {
    dur: 2.4, layer: 'upper',
    pose: (c) => {
      const u = c.u, bob = osc(u, 2);
      c.life(0.6);
      c.bone('spine_03', 1, 0, 0, -0.08);
      c.bone('head', 1, 0, 0, -0.12);
      c.limb('r', 'clavicle', 0, 0, 1, -0.12);
      c.limb('l', 'clavicle', 0, 0, 1, -0.12);
      signGrip(c, [0, 0.4 + 0.03 * bob, 0.16], 0.03 * osc(u, 1, 0.2), 0.23, [0.9, -0.4, -0.3]);
    },
  },
  prop_sign_wave: {
    dur: 2.4, layer: 'upper',
    pose: (c) => {
      const u = c.u, sw = osc(u, 2);
      c.life(0.6);
      c.bone('spine_03', 0, 0, 1, 0.07 * osc(u, 2, -0.08));
      c.bone('spine_03', 1, 0, 0, -0.07);
      c.bone('head', 1, 0, 0, -0.1);
      c.limb('r', 'clavicle', 0, 0, 1, -0.12);
      c.limb('l', 'clavicle', 0, 0, 1, -0.12);
      signGrip(c, [0.06 * sw, 0.33 + 0.03 * Math.abs(sw), 0.18], 0.26 * sw, 0.23, [0.9, -0.4, -0.3]);
    },
  },
  prop_flag_raise: {
    dur: 3.0, layer: 'upper',
    pose: (c) => {
      const u = c.u, sw = osc(u, 1);
      c.life(0.6);
      c.bone('spine_03', 1, 0, 0, -0.06);
      c.bone('head', 1, 0, 0, -0.1);
      c.limb('r', 'clavicle', 0, 0, 1, -0.18);
      poleGrip(c, [0.2, -0.18, 0.3], 0.56, 0.06 * sw);
    },
  },
  prop_flag_wave: {
    dur: 2.4, layer: 'upper',
    pose: (c) => {
      const u = c.u, sw = osc(u, 2), sw2 = osc(u, 2, -0.12);
      // o mastro descreve um arco sobre a cabeça pivotando na mão de baixo; tronco acompanha com atraso
      c.life(0.5);
      c.bone('spine_03', 0, 0, 1, 0.08 * sw2);
      c.bone('spine_02', 0, 1, 0, 0.06 * sw2);
      c.bone('head', 1, 0, 0, -0.1);
      c.limb('r', 'clavicle', 0, 0, 1, -0.18);
      poleGrip(c, [0.2 + 0.04 * sw, -0.16 + 0.03 * Math.abs(sw), 0.3 + 0.03 * osc(u, 4)], 0.46, 0.5 * sw);
    },
  },
  prop_megaphone: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      // fala em frases: ênfases irregulares (somas de harmônicos) no tronco, cabeça e mão livre
      const emph = Math.max(0, 0.6 * osc(u, 3) + 0.4 * osc(u, 5, 0.2)) ** 2;
      c.life(0.5);
      c.bone('spine_03', 1, 0, 0, 0.06 + 0.06 * emph);
      c.bone('head', 1, 0, 0, 0.03 * emph);
      c.limb('r', 'clavicle', 0, 0, 1, -0.1);
      c.reach('r', 'head', [0.03, -0.13, 0.17], [0.6, -1, -0.1]);
      c.twist('r', 'lowerarm', 1.0);
      c.fingers('r', 0.9, { thumb: 0.4 });
      c.reach('l', 'chest', [0.24, -0.25 + 0.2 * emph, 0.22 + 0.08 * emph], ELBOW_DOWN, 0.4 + 0.6 * emph);
      c.fingers('l', 0.5 + 0.5 * emph);
    },
  },
  prop_banner_hold: {
    dur: 3.2, layer: 'upper',
    pose: (c) => {
      const u = c.u, bob = osc(u, 2);
      c.life(0.6);
      c.bone('spine_03', 1, 0, 0, -0.05);
      c.limb('r', 'clavicle', 0, 0, 1, -0.1);
      c.limb('l', 'clavicle', 0, 0, 1, -0.1);
      signGrip(c, [0, -0.1 + 0.02 * bob, 0.28], 0.02 * osc(u, 1), 0.42, [0.8, -0.7, -0.2]);
    },
  },
  prop_drum: {
    dur: 2.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      // percussão a 120 BPM: baquetas alternadas em colcheias, acento no 1 e no 3
      const hr = beatPulse(u, 8, 0), hl = beatPulse(u, 8, 0.5), acc = beatPulse(u, 2, 0);
      const upR = 1 - Math.min(1, hr * 2.5), upL = 1 - Math.min(1, hl * 2.5);
      c.life(0.5);
      c.bone('spine_03', 1, 0, 0, 0.12 + 0.03 * acc);
      c.bone('head', 1, 0, 0, 0.12 + 0.05 * acc);
      c.reach('r', 'chest', [0.1, -0.5 + 0.12 * upR, 0.3], ELBOW_DOWN);
      c.reach('l', 'chest', [0.1, -0.5 + 0.12 * upL, 0.3], ELBOW_DOWN);
      c.limb('r', 'hand', 0, 0, 1, 0.3 * upR);
      c.limb('l', 'hand', 0, 0, 1, 0.3 * upL);
      c.fingers('r', 0.9, { thumb: 0.45 });
      c.fingers('l', 0.9, { thumb: 0.45 });
    },
  },
  prop_whistle: {
    dur: onceDur('prop_whistle', 1.6), layer: 'upper',
    pose: (c) => {
      const t = c.t, e = env(t, 0.0, 0.35, c.dur - 0.4, c.dur - 0.02);
      const blow = env(t, 0.4, 0.48, 0.62, 0.7) + env(t, 0.82, 0.9, 1.04, 1.12);
      c.life(0.5);
      c.bone('spine_03', 1, 0, 0, 0.03 * blow - 0.02 * e);
      c.bone('head', 1, 0, 0, -0.05 * e + 0.05 * blow);
      c.reach('r', 'head', [0.03, -0.1, 0.1], ELBOW_DOWN, e);
      c.twist('r', 'lowerarm', 1.1 * e);
      c.fingers('r', 0.85, { index: 0.6, thumb: 0.4 }, e);
    },
  },

  // ------------------------------------------------------------------ poses de carregar (sem ação ativa)
  carry_flag_small: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.4);
      // antebraço à frente, mastro de pé na mão direita
      c.reach('r', 'shoulder', [0.05, -0.3 + 0.01 * osc(u, 1), 0.27], ELBOW_DOWN);
      c.twist('r', 'lowerarm', 0.8);
      c.limb('r', 'hand', 1, 0, 0, -0.15);
      c.fingers('r', 0.9, { thumb: 0.45 });
    },
  },
  carry_flag_large: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.4);
      poleGrip(c, [0.18, -0.4 + 0.01 * osc(u, 1), 0.28], 0.34, 0.02 * osc(u, 1, 0.2));
    },
  },
  carry_sign: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.4);
      signGrip(c, [0, -0.45 + 0.01 * osc(u, 1), 0.3], 0.015 * osc(u, 1, 0.3), 0.23, [0.6, -1, -0.2]);
    },
  },
  carry_banner: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.4);
      signGrip(c, [0, -0.3 + 0.01 * osc(u, 1), 0.26], 0.01 * osc(u, 1), 0.38, [0.6, -1, -0.2]);
    },
  },
  carry_megaphone: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      c.life(0.4);
      // megafone pendurado na mão, braço relaxado um pouco à frente (peso)
      c.reach('r', 'shoulder', [0.07, -0.5, 0.1], ELBOW_DOWN, 0.7);
      c.fingers('r', 0.92, { thumb: 0.45 });
    },
  },
  carry_small: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      c.life(0.4);
      c.fingers('r', 0.75, { thumb: 0.3 });
    },
  },
  carry_umbrella: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.4);
      // cabo à frente do peito: a cobertura fica sobre a cabeça
      c.reach('r', 'chest', [0.16, -0.06 + 0.01 * osc(u, 1), 0.3], ELBOW_DOWN);
      c.twist('r', 'lowerarm', 0.9);
      c.limb('r', 'hand', 1, 0, 0, -0.2);
      c.fingers('r', 0.95, { thumb: 0.5 });
    },
  },
  carry_drum: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.4);
      c.bone('spine_03', 1, 0, 0, 0.05);
      c.reach('r', 'chest', [0.12, -0.46 + 0.01 * osc(u, 1), 0.3], ELBOW_DOWN);
      c.reach('l', 'chest', [0.12, -0.46 + 0.01 * osc(u, 1, 0.3), 0.3], ELBOW_DOWN);
      c.fingers('r', 0.9, { thumb: 0.45 });
      c.fingers('l', 0.9, { thumb: 0.45 });
    },
  },
  carry_bat: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      c.life(0.4);
      // taco pendurado ao lado do corpo, ponta para baixo
      c.reach('r', 'shoulder', [0.08, -0.52, 0.06], ELBOW_DOWN, 0.6);
      c.fingers('r', 0.95, { thumb: 0.5 });
    },
  },
  carry_bar: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      c.life(0.4);
      // barra junto da perna, ponta para baixo (mais leve que o taco: braço menos esticado)
      c.reach('r', 'shoulder', [0.07, -0.5, 0.08], ELBOW_DOWN, 0.55);
      c.fingers('r', 0.97, { thumb: 0.5 });
    },
  },
  carry_spray: {
    dur: 4.0, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.4);
      // lata na mão, antebraço um pouco à frente da cintura (bico para a frente/baixo)
      c.reach('r', 'shoulder', [0.06, -0.44 + 0.008 * osc(u, 1), 0.2], ELBOW_DOWN, 0.75);
      c.twist('r', 'lowerarm', 0.5);
      c.fingers('r', 0.85, { index: 0.7, thumb: 0.4 });
    },
  },

  // ------------------------------------------------------------------ confronto (rodada 9) — golpes e reações
  // Clipes AVULSOS (HumanAnimator.playClip), nomes referenciados pelas CombatActionDefinitions (public/gameplay/
  // combat.json `animation`). Estilo arcade: gesto amplo e legível, sem contato/lesão representados.
  /** cambaleio (estado STAGGERED; NPC atingido): direcional — `stagger` = golpe de frente (AvatarVisual escolhe) */
  stagger: { dur: 0.8, layer: 'full', adaptive: true, fadeIn: 0.06, fadeOut: 0.2, pose: (c) => staggerPose(c, 'front') },
  stagger_back: { dur: 0.8, layer: 'full', adaptive: true, fadeIn: 0.06, fadeOut: 0.2, pose: (c) => staggerPose(c, 'back') },
  stagger_side: { dur: 0.8, layer: 'full', adaptive: true, mirror: true, fadeIn: 0.06, fadeOut: 0.2, pose: (c) => staggerPose(c, 'side') },
  /** desorientado (spray): mãos diante dos olhos, cabeça baixa e balançando devagar — sem lesão representada */
  disoriented: {
    dur: 2.4, layer: 'upper',
    pose: (c) => {
      const u = c.u;
      c.life(0.5);
      c.bone('spine_03', 1, 0, 0, 0.12);
      c.bone('head', 1, 0, 0, 0.22 + 0.03 * osc(u, 2));
      c.bone('head', 0, 1, 0, 0.08 * osc(u, 1, 0.25));
      for (const s of ['r', 'l'] as Side[]) {
        const ph = s === 'r' ? 0 : 0.5;
        c.reach(s, 'head', [0.035, -0.05 + 0.012 * osc(u, 3, ph), 0.13], ELBOW_DOWN);
        c.twist(s, 'lowerarm', 1.1);
        c.limb(s, 'hand', 1, 0, 0, -0.3);
        c.fingers(s, 0.25, { thumb: -0.2 });
      }
    },
  },

  // ------------------------------------------------------------------ confronto (rodada 10; public/gameplay/combat.json)
  // Estilo arcade: golpes legíveis, sem impacto realista. `cbt` = [preparação, janela ativa, recuperação] da definição
  // (s; o servidor decide o acerto — isto é só a animação prevista/remota): dur = soma, e o estalo cai no fim da
  // preparação. Adaptativos: corpo inteiro parado, só tronco andando (HumanAnimator).
  /** levantar de costas (AvatarVisual depois da queda; NPC depois de `npc_down`) */
  getup: { dur: 1.4, layer: 'full', fadeIn: 0.05, fadeOut: 0.25, pose: (c) => getupPose(c) },
  /** levantar de bruços (AvatarVisual escolhe pela pose real do ragdoll) */
  getup_prone: { dur: 1.4, layer: 'full', fadeIn: 0.05, fadeOut: 0.25, pose: (c) => getupPronePose(c) },
  // NPC derrubado: cai (crossfade 0,35 s = NPC_HIT.fallS) na pose inicial do `getup` (deitado de costas) e fica;
  // depois o `getup` toca inteiro a partir dessa mesma pose (emenda sem salto). Nada de girar o corpo rígido.
  npc_down: { dur: 1.0, layer: 'full', fadeIn: 0.35, fadeOut: 0.1, pose: (c) => { const t = c.t; c.t = 0; getupPose(c); c.t = t; } },
  cbt_punch: { dur: 0.45, cbt: [0.12, 0.1, 0.23], layer: 'full', adaptive: true, pose: (c) => punchPose(c, 'r', 0.12) },
  cbt_punch2: { dur: 0.46, cbt: [0.1, 0.1, 0.26], layer: 'full', adaptive: true, pose: (c) => punchPose(c, 'l', 0.1) },
  cbt_kick: { dur: 0.72, cbt: [0.22, 0.12, 0.38], layer: 'full', pose: (c) => kickPose(c, 0.22) },
  cbt_kick_final: { dur: 0.79, cbt: [0.2, 0.14, 0.45], layer: 'full', pose: (c) => roundhousePose(c, 0.2) },
  cbt_dodge: { dur: 0.5, cbt: [0, 0.32, 0.18], layer: 'full', pose: (c) => dodgePose(c, 'back') },
  /** variantes da esquiva pela direção do deslocamento (AvatarVisual.playCombat) — mesmos tempos */
  cbt_dodge_fwd: { dur: 0.5, cbt: [0, 0.32, 0.18], layer: 'full', pose: (c) => dodgePose(c, 'fwd') },
  cbt_dodge_side: { dur: 0.5, cbt: [0, 0.32, 0.18], layer: 'full', mirror: true, pose: (c) => dodgePose(c, 'side') },
  cbt_bat: { dur: 0.8, cbt: [0.26, 0.12, 0.42], layer: 'full', adaptive: true, pose: (c) => batPose(c) },
  cbt_bar: { dur: 0.9, cbt: [0.3, 0.12, 0.48], layer: 'full', adaptive: true, pose: (c) => barPose(c) },
  cbt_spray: { dur: 0.92, cbt: [0.12, 0.5, 0.3], layer: 'full', adaptive: true, pose: (c) => sprayPose(c) },

  // ------------------------------------------------------------------ danças (genéricas, sem coreografia de terceiros)
  /** 108 BPM, 8 tempos: passo-toque de lado a lado, braços soltos em oposição */
  dance_simple: {
    dur: 8 * 60 / 108, layer: 'full',
    pose: (c) => {
      const u = c.u;
      const shift = osc(u, 2, 0.25) * 0.9; // peso: direita ↔ esquerda a cada 2 tempos
      const bounce = 0.5 - 0.5 * cos(TAU * 8 * u); // joelhos em cada tempo
      // a perna sem peso desencosta o calcanhar (passo-toque)
      const liftR = Math.max(0, -osc(u, 2, 0.25)) ** 2 * 0.05, liftL = Math.max(0, osc(u, 2, 0.25)) ** 2 * 0.05;
      danceLegs(c, shift, bounce, liftR, liftL);
      c.bone('spine_01', 0, 0, 1, 0.07 * shift);
      c.bone('spine_03', 0, 1, 0, 0.12 * osc(u, 2, 0.15));
      c.bone('spine_03', 0, 0, 1, -0.09 * shift);
      c.bone('head', 0, 0, 1, 0.08 * shift);
      c.bone('head', 1, 0, 0, 0.05 * bounce);
      // ombros sobem alternados no tempo; braços dobrados balançam em oposição ao quadril (cotovelo atrasa)
      c.limb('r', 'clavicle', 0, 0, 1, -0.07 * Math.max(0, osc(u, 4, 0.1)));
      c.limb('l', 'clavicle', 0, 0, 1, -0.07 * Math.max(0, -osc(u, 4, 0.1)));
      const ar = osc(u, 2, 0.1), ag = osc(u, 4, 0.2);
      c.reach('r', 'chest', [0.2 + 0.03 * ar, -0.27 + 0.08 * ar, 0.24 + 0.1 * ar], ELBOW_DOWN);
      c.reach('l', 'chest', [0.2 - 0.03 * ar, -0.27 - 0.08 * ar, 0.24 - 0.1 * ar], ELBOW_DOWN);
      c.limb('r', 'hand', 1, 0, 0, -0.2 * ag);
      c.limb('l', 'hand', 1, 0, 0, 0.2 * ag);
      c.fingers('r', 0.55);
      c.fingers('l', 0.55);
    },
  },
  /** 124 BPM, 8 tempos: quique em cada tempo, toques de calcanhar à frente alternados, braços "socando" */
  dance_lively: {
    dur: 8 * 60 / 124, layer: 'full',
    pose: (c) => {
      const u = c.u;
      const bounce = Math.pow(0.5 - 0.5 * cos(TAU * 8 * u), 1.5);
      const side = osc(u, 4, 0.25); // perna da vez (2 tempos cada)
      const tapR = Math.max(0, side), tapL = Math.max(0, -side);
      c.hips(-0.05 * side, -0.06 - 0.08 * bounce, 0);
      c.bone('pelvis', 0, 1, 0, 0.16 * side);
      c.plant('r', [-0.03 + 0.03 * tapR, 0.06 * tapR * tapR, 0.26 * tapR], -0.5 * tapR);
      c.plant('l', [-0.03 + 0.03 * tapL, 0.06 * tapL * tapL, 0.26 * tapL], -0.5 * tapL);
      c.bone('spine_01', 1, 0, 0, 0.12 + 0.05 * bounce);
      c.bone('spine_03', 0, 1, 0, -0.26 * side);
      c.bone('head', 1, 0, 0, 0.1 * bounce);
      c.bone('head', 0, 1, 0, 0.14 * side);
      // socos alternados para cima/frente em cada tempo (ataque rápido, volta lenta)
      const pr = beatPulse(u, 4, 0.0), pl = beatPulse(u, 4, 0.5);
      c.reach('r', 'chest', [0.2 - 0.06 * pr, -0.24 + 0.36 * pr, 0.22 + 0.2 * pr], ELBOW_DOWN);
      c.reach('l', 'chest', [0.2 - 0.06 * pl, -0.24 + 0.36 * pl, 0.22 + 0.2 * pl], ELBOW_DOWN);
      c.twist('r', 'lowerarm', 0.6);
      c.twist('l', 'lowerarm', 0.6);
      c.fingers('r', 1.0);
      c.fingers('l', 1.0);
    },
  },
  /** 100 BPM, 8 tempos: braços no alto descrevendo arcos, quadril balançando ao contrário */
  dance_arms: {
    dur: 8 * 60 / 100, layer: 'full',
    pose: (c) => {
      const u = c.u;
      const sw = osc(u, 2), sw2 = osc(u, 2, -0.1); // braços atrasam um pouco o quadril
      const bounce = 0.5 - 0.5 * cos(TAU * 8 * u);
      danceLegs(c, -sw * 0.9, bounce * 0.6);
      c.bone('spine_01', 0, 0, 1, -0.06 * sw);
      c.bone('spine_03', 0, 0, 1, 0.12 * sw2);
      c.bone('spine_03', 1, 0, 0, -0.06);
      c.bone('head', 0, 0, 1, -0.06 * sw2);
      c.bone('head', 1, 0, 0, -0.1);
      for (const s of ['r', 'l'] as Side[]) {
        const sx = s === 'r' ? -1 : 1; // arco para o lado do balanço (em espaço do esqueleto)
        const lat = 0.16 + 0.14 * sw2 * sx;
        c.limb(s, 'clavicle', 0, 0, 1, -0.2);
        c.reach(s, 'shoulder', [lat, 0.46 - 0.05 * Math.abs(sw2), 0.08], [1, -0.3, -0.2]);
        c.twist(s, 'lowerarm', 0.6);
        c.limb(s, 'hand', 0, 0, 1, 0.25 * sw2 * sx);
        c.fingers(s, 0.15);
      }
    },
  },
  /** 118 BPM, 8 tempos: pulinhos em cada tempo, punho subindo alternado, tronco inclinado */
  dance_party: {
    dur: 8 * 60 / 118, layer: 'full',
    pose: (c) => {
      const u = c.u;
      const hop = Math.max(0, osc(u, 8, 0.0)); // voo curto em cada tempo
      const land = Math.max(0, -osc(u, 8, 0.0));
      const side = osc(u, 2, 0.25);
      c.hips(0.03 * side, -0.05 - 0.07 * land + 0.05 * hop, 0.02);
      c.bone('pelvis', 0, 0, 1, -0.05 * side);
      c.plant('r', [0, 0.045 * hop, 0], -0.3 * hop);
      c.plant('l', [0, 0.045 * hop, 0], -0.3 * hop);
      c.bone('spine_01', 1, 0, 0, 0.12 + 0.05 * land);
      c.bone('spine_03', 0, 0, 1, 0.07 * side);
      c.bone('head', 1, 0, 0, 0.1 * land - 0.04);
      // punho para cima: direita nos tempos 1–4, esquerda nos 5–8, socando em cada tempo
      const half = osc(u, 1);
      const wr = ease(half * 2 + 0.5), wl = ease(-half * 2 + 0.5);
      const pump = beatPulse(u, 8, 0.05);
      armOverhead(c, 'r', wr, -pump, 1, 0.1);
      armOverhead(c, 'l', wl, -pump, 1, 0.1);
      c.reach('r', 'chest', [0.24, -0.25, 0.22], ELBOW_DOWN, 1 - wr);
      c.reach('l', 'chest', [0.24, -0.25, 0.22], ELBOW_DOWN, 1 - wl);
      c.fingers('r', 0.95);
      c.fingers('l', 0.95);
    },
  },
};

/** nomes de todos os clipes procedurais */
export const PROCEDURAL_CLIPS = Object.keys(SPECS);
/** sufixo do clipe espelhado */
export const MIRROR_SUFFIX = '~m';

export function specFor(name: string): ClipSpec | undefined {
  return SPECS[name.endsWith(MIRROR_SUFFIX) ? name.slice(0, -MIRROR_SUFFIX.length) : name];
}

const FPS = 30;
/** clipes por pose base (idle do corpo): gerados sob demanda e reaproveitados por todos os personagens do corpo */
const cache = new WeakMap<THREE.AnimationClip, Map<string, THREE.AnimationClip>>();

/** aplica o primeiro quadro de um clipe (pose base) diretamente nos ossos */
function applyFirstFrame(clip: THREE.AnimationClip, bones: Map<string, THREE.Object3D>) {
  for (const tr of clip.tracks) {
    const dot = tr.name.lastIndexOf('.');
    const b = bones.get(tr.name.slice(0, dot));
    if (!b) continue;
    const prop = tr.name.slice(dot + 1), v = tr.values;
    if (prop === 'quaternion') b.quaternion.set(v[0], v[1], v[2], v[3]);
    else if (prop === 'position') b.position.set(v[0], v[1], v[2]);
    else if (prop === 'scale') b.scale.set(v[0], v[1], v[2]);
  }
}

/**
 * Gera (ou devolve do cache) o clipe procedural `name` para o esqueleto `root`, partindo da pose de `base` (idle).
 * `name` com sufixo `~m` = versão espelhada. Os ossos voltam exatamente ao estado anterior no fim.
 */
export function proceduralClip(name: string, root: THREE.Object3D, base: THREE.AnimationClip): THREE.AnimationClip | null {
  const spec = specFor(name);
  if (!spec) return null;
  let m = cache.get(base);
  if (!m) cache.set(base, (m = new Map()));
  const hit = m.get(name);
  if (hit) return hit;
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o); });
  const saved = [...bones.values()].map((o) => ({ o, q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone() }));
  applyFirstFrame(base, bones);
  const baseQ = new Map([...bones].map(([n, o]) => [n, o.quaternion.clone()]));
  const baseP = new Map([...bones].map(([n, o]) => [n, o.position.clone()]));
  const poser = new Poser(root, bones, name.endsWith(MIRROR_SUFFIX));
  poser.calibrate();
  const full = spec.layer === 'full';
  const names = (full ? [...bones.keys()].filter((n) => n !== 'Root') : UPPER_BONES).filter((n) => bones.has(n));
  const n = Math.max(2, Math.round(spec.dur * FPS));
  const times: number[] = [];
  const qv = names.map(() => [] as number[]);
  const pelvisV: number[] = [];
  const prev = names.map(() => new THREE.Quaternion());
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * spec.dur;
    for (const [nm, o] of bones) { o.quaternion.copy(baseQ.get(nm)!); o.position.copy(baseP.get(nm)!); }
    root.updateMatrixWorld(true);
    poser.t = t; poser.u = t / spec.dur; poser.dur = spec.dur;
    spec.pose(poser);
    times.push(t);
    names.forEach((nm, k) => {
      const q = bones.get(nm)!.quaternion;
      // continuidade do sinal (interpolação pelo caminho curto)
      if (i > 0 && prev[k].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev[k].copy(q);
      qv[k].push(q.x, q.y, q.z, q.w);
    });
    if (full) { const p = bones.get('pelvis')!.position; pelvisV.push(p.x, p.y, p.z); }
  }
  const tracks: THREE.KeyframeTrack[] = [];
  names.forEach((nm, k) => {
    const v = qv[k];
    // trilha constante (dedos parados etc.) vira uma chave só
    let still = true;
    for (let i = 4; i < v.length && still; i++) if (Math.abs(v[i] - v[i % 4]) > 1e-5) still = false;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${nm}.quaternion`, still ? [0] : times, still ? v.slice(0, 4) : v));
    // posições constantes (comprimentos dos ossos da biblioteca): mantêm medições/assados fiéis ao jogo
    const p = baseP.get(nm)!;
    if (!(full && nm === 'pelvis')) tracks.push(new THREE.VectorKeyframeTrack(`${nm}.position`, [0], [p.x, p.y, p.z]));
  });
  if (full) tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pelvisV));
  for (const s of saved) { s.o.quaternion.copy(s.q); s.o.position.copy(s.p); s.o.scale.copy(s.s); }
  root.updateMatrixWorld(true);
  const clip = new THREE.AnimationClip(name, spec.dur, tracks);
  m.set(name, clip);
  return clip;
}

/**
 * altura mínima dos pés (espaço do esqueleto) ao longo do clipe, aplicando as trilhas DIRETO nos ossos.
 * Sem AnimationMixer: o mixer só reescreve um osso quando o valor muda desde a última aplicação, e um clipe quase
 * constante (sentado) medido depois de restaurar a pose voltava com metade dos ossos na pose anterior.
 */
export function clipFloor(root: THREE.Object3D, clip: THREE.AnimationClip): number | null {
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o); });
  const feet = ['ball_l', 'ball_r', 'foot_l', 'foot_r'].map((n) => bones.get(n)).filter(Boolean) as THREE.Object3D[];
  if (feet.length < 4) return null;
  const saved = [...bones.values()].map((o) => ({ o, q: o.quaternion.clone(), p: o.position.clone() }));
  const tr = clip.tracks.map((t) => {
    const dot = t.name.lastIndexOf('.');
    return { b: bones.get(t.name.slice(0, dot)), prop: t.name.slice(dot + 1), it: t.createInterpolant() };
  }).filter((x) => x.b && (x.prop === 'quaternion' || x.prop === 'position'));
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  const n = Math.max(1, Math.ceil(clip.duration * 30));
  let min = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = Math.min(clip.duration, i / 30);
    for (const x of tr) {
      const r = x.it.evaluate(t);
      if (x.prop === 'quaternion') x.b!.quaternion.set(r[0], r[1], r[2], r[3]);
      else x.b!.position.set(r[0], r[1], r[2]);
    }
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    for (const f of feet) min = Math.min(min, f.getWorldPosition(v).applyMatrix4(inv).y);
  }
  for (const s of saved) { s.o.quaternion.copy(s.q); s.o.position.copy(s.p); }
  root.updateMatrixWorld(true);
  return Number.isFinite(min) ? min : null;
}

/**
 * clipe de corpo inteiro a partir de um clipe da camada superior: completa os ossos que faltam com a pose base
 * (assar a multidão instanciada, medir o contato com o chão)
 */
export function withBase(clip: THREE.AnimationClip, base: THREE.AnimationClip): THREE.AnimationClip {
  const have = new Set(clip.tracks.map((t) => t.name));
  const extra = base.tracks.filter((t) => !have.has(t.name) && !t.name.startsWith('Root.')).map((t) => {
    const k = t.getValueSize();
    const Ctor = t.constructor as new (n: string, times: number[], values: number[]) => THREE.KeyframeTrack;
    return new Ctor(t.name, [0], Array.from(t.values.slice(0, k)));
  });
  return new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks, ...extra]);
}
