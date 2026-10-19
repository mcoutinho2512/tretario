/**
 * Rodada 10 — corpo FISICAMENTE no veículo (docs/VEHICLE_MOUNTING.md). Código deste projeto, sem biblioteca externa.
 *
 * Sobre o clipe-base da biblioteca (drive/sit/idle, por `MountRig.baseClip`) o solver, a cada quadro e só para quem
 * está perto (LOD ≤ 1, `HumanAnimator.detail`):
 *   1. põe a PELVE na âncora `hip` do banco (o corpo inteiro vai junto: raiz do avatar = matriz do veículo, com a
 *      inclinação nas curvas); de longe só este passo roda (pose do clipe, sem IK);
 *   2. inclina o tronco para as mãos alcançarem o guidão/volante (resolve o ângulo, limitado por `torso`);
 *   3. IK analítico de 2 ossos (braço e perna, com vetor polar e preservando o plano da articulação) para as mãos no
 *      guidão/volante (que giram com o esterço em torno de `steerPivot`) e os pés nos pedais/pedaleiras/plataforma;
 *   4. dinâmica por tipo: pedivela da bicicleta (cadência pela velocidade, para quando desliza), impulso do patinete
 *      (pé de trás rema no chão quando acelera devagar, joelho de apoio dobra), pé no chão da moto parada, cabeça
 *      olhando para a curva, punho reto na pegada.
 * Nada disso vai para a rede: remotos derivam tudo do estado do veículo (posição, rumo, velocidade) e da fase.
 * Os ossos ajustados são devolvidos à pose do clipe no quadro seguinte pelo HumanAnimator (`save`).
 */
import * as THREE from 'three';
import { mountProfile, type MountProfileFull } from '../../vehicles/seats';

/** dinâmica visual do veículo (RideableSystem.sync calcula para todos; ninguém sincroniza isto) */
export interface RideDyn {
  /** inclinação (rad, + = para a esquerda do motorista) */
  lean: number;
  /** esterço normalizado −1..1 (+ = esquerda) */
  steer: number;
  /** ângulo do pedivela (bicicleta) */
  crank: number;
  /** velocidade (m/s) e aceleração (m/s²) estimadas pelo deslocamento (iguais para local e remotos) */
  speed: number;
  accel: number;
}

/** o que o solver precisa do veículo (RideableInstance satisfaz) */
export interface MountSource {
  state: { id: string; x: number; y: number; z: number; heading: number };
  def: { kind: string };
  dyn?: RideDyn;
}

type Bones = Map<string, THREE.Object3D>;
type Save = (b: THREE.Object3D) => void;

const _e = new THREE.Euler();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _vq = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _T = new THREE.Vector3();
const _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _n0 = new THREE.Vector3(), _n1 = new THREE.Vector3(), _E = new THREE.Vector3(), _p = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _ax = new THREE.Vector3();
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4();
const _M = new THREE.Matrix4();

/** matriz de mundo do veículo (posição, rumo e inclinação) — a mesma que RideableSystem.sync aplica no modelo */
export function vehicleMatrix(src: MountSource, out: THREE.Matrix4): THREE.Matrix4 {
  _e.set(0, src.state.heading, -(src.dyn?.lean ?? 0), 'XYZ');
  return out.makeRotationFromEuler(_e).setPosition(src.state.x, src.state.y, src.state.z);
}

/** ponto local → mundo */
const toWorld = (M: THREE.Matrix4, l: readonly number[], out: THREE.Vector3) => out.set(l[0], l[1], l[2]).applyMatrix4(M);

/** gira um osso por uma rotação dada no espaço do MUNDO (e atualiza os filhos) */
function rotWorld(b: THREE.Object3D, q: THREE.Quaternion, save: Save) {
  if (!b.parent) return;
  save(b);
  b.parent.getWorldQuaternion(_pq);
  _q2.copy(_pq).invert().multiply(q).multiply(_pq);
  b.quaternion.premultiply(_q2);
  b.updateMatrixWorld(true);
}

/** IK analítico de dois ossos no mundo (A→B→C até `target`, cotovelo/joelho para `pole`), misturado por `w` */
function ik2(A: THREE.Object3D, B: THREE.Object3D, C: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, w: number, save: Save) {
  const a = A.getWorldPosition(_a), b = B.getWorldPosition(_b), c = C.getWorldPosition(_c);
  _t.copy(target);
  if (w < 1) _t.lerpVectors(c, target, w);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const dir = _v.subVectors(_t, a);
  const d = THREE.MathUtils.clamp(dir.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  dir.normalize();
  _T.copy(a).addScaledVector(dir, d);
  const ax = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - ax * ax));
  const pdir = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (pdir.lengthSq() < 1e-8) pdir.set(0, 1, 0).addScaledVector(dir, -dir.y);
  pdir.normalize();
  _E.copy(a).addScaledVector(dir, ax).addScaledVector(pdir, h);
  _d0.subVectors(b, a).normalize(); _n0.crossVectors(_d0, _v3.subVectors(c, b)).normalize();
  _d1.subVectors(_E, a).normalize(); _n1.crossVectors(_d1, _v3.subVectors(_T, _E)).normalize();
  if (_n0.lengthSq() > 0.5 && _n1.lengthSq() > 0.5) {
    _m0.makeBasis(_d0, _n0, _v3.crossVectors(_d0, _n0));
    _m1.makeBasis(_d1, _n1, _v3.crossVectors(_d1, _n1));
    rotWorld(A, _q.setFromRotationMatrix(_m1.multiply(_m0.transpose())), save);
  } else rotWorld(A, _q.setFromUnitVectors(_d0, _d1), save);
  const b2 = B.getWorldPosition(_b), c2 = C.getWorldPosition(_c);
  rotWorld(B, _q.setFromUnitVectors(_d0.subVectors(c2, b2).normalize(), _d1.subVectors(_T, b2).normalize()), save);
}

/** alinha a direção osso→filho a `dir` (mundo), misturado por `w` */
function aim(b: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3, w: number, save: Save) {
  const from = _d0.subVectors(child.getWorldPosition(_a), b.getWorldPosition(_b)).normalize();
  _d1.copy(from).lerp(dir, w).normalize();
  rotWorld(b, _q.setFromUnitVectors(from, _d1), save);
}

const ease = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** um por avatar: guarda o estado do impulso/pé no chão entre quadros */
export class MountRigSolver {
  private kickT = 0;
  private kickW = 0;
  private footDownW = 0;
  private torsoD = 0;
  /** QA: alvos e erro (m) do último quadro */
  readonly qa = { err: { handL: 0, handR: 0, footL: 0, footR: 0, hip: 0 }, kickW: 0, footDownW: 0, torso: 0, ik: false };

  constructor(private bones: Bones) {}

  private bone(n: string) { return this.bones.get(n); }

  /**
   * Coloca a raiz e aplica a pose. `root` = raiz do avatar (mundo). `w` (0..1) = quanto está montado (transições);
   * `from` = posição/rumo da raiz a pé (início da entrada ou fim da saída) — a raiz vai de lá até o banco com `w`.
   * `ik` = aplicar IK/dinâmica (perto); sem ele, só a raiz.
   */
  solve(o: { root: THREE.Object3D; src: MountSource; w: number; from: { x: number; y: number; z: number; yaw: number } | null; ik: boolean; save: Save; dt: number }) {
    const prof = mountProfile(o.src.def.kind);
    const seat = prof.seats[0];
    const rig = prof.rig;
    const dyn = o.src.dyn;
    const M = vehicleMatrix(o.src, _M);
    _vq.setFromRotationMatrix(M);
    const w = o.w;
    const speed = Math.abs(dyn?.speed ?? 0), accel = dyn?.accel ?? 0;
    const stand = seat.pose === 'scooter_stand';
    // ---- impulso do patinete (estado entre quadros; precisa antes da raiz: o apoio abaixa a pelve)
    if (rig.kick) {
      const kicking = speed > 0.12 && speed < rig.kick.maxSpeed && accel > 0.05 && w > 0.95;
      this.kickW += ((kicking ? 1 : 0) - this.kickW) * (1 - Math.exp(-(kicking ? 6 : 3) * o.dt));
      const T = THREE.MathUtils.clamp(rig.kick.stroke / (Math.max(speed, 0.7) * 0.45), 0.55, 1.15);
      if (this.kickW > 0.01) this.kickT = (this.kickT + o.dt / T) % 1; else this.kickT = 0;
    }
    // ---- 1. raiz: pelve na âncora (ou pés na plataforma, em pé), rumo do veículo com a inclinação; nas transições
    // o caminho tem duas metades (mountWeights): carro senta na soleira de costas para fora e depois gira para dentro;
    // duas rodas: passa a perna (fica de pé sobre o banco) e depois senta/sobe
    const root = o.root;
    const tw = mountWeights(o.src.def.kind, w);
    const car = seat.pose === 'car_seat' || seat.pose === 'cab_seat';
    const hipW = toWorld(M, seat.hip, _p);
    const F = o.from && w < 1 ? o.from : null;
    const outYaw = F ? Math.atan2(F.x - hipW.x, F.z - hipW.z) : 0;
    if (F) {
      const q0 = _q.setFromEuler(_e.set(0, F.yaw, 0)).clone();
      if (car) {
        const qOut = new THREE.Quaternion().setFromEuler(_e.set(0, outYaw, 0));
        root.quaternion.copy(q0).slerp(qOut, tw.a).slerp(_vq, tw.b);
      } else root.quaternion.copy(q0).slerp(_vq, tw.a);
    } else root.quaternion.copy(_vq);
    root.updateMatrixWorld(true);
    const pelvis = this.bone('pelvis');
    let px = 0, py = 0, pz = 0;
    if (pelvis) {
      pelvis.getWorldPosition(_v);
      px = _v.x - root.position.x; py = _v.y - root.position.y; pz = _v.z - root.position.z;
    }
    let sx: number, sy: number, sz: number;
    if (stand) {
      // de pé na plataforma: raiz na altura do piso (pés do clipe no "chão"), pelve sobre a âncora em x/z; o apoio dobra
      // o joelho no impulso
      const kickDrop = rig.kick ? 0.13 * this.kickW * (0.6 + 0.4 * Math.sin(this.kickT * Math.PI * 2 - 0.6)) : 0;
      sx = hipW.x - px; sz = hipW.z - pz; sy = hipW.y - 0.02 - kickDrop;
    } else { sx = hipW.x - px; sy = hipW.y - py; sz = hipW.z - pz; }
    if (F) {
      // ponto do meio: soleira da porta (carro) ou de pé sobre o banco (duas rodas)
      let mx: number, my: number, mz: number;
      if (car) { mx = sx + (F.x - hipW.x) * 0.4; mz = sz + (F.z - hipW.z) * 0.4; my = sy; }
      else { mx = sx; mz = sz; my = F.y + (stand ? sy - F.y : 0); }
      const ax = F.x + (mx - F.x) * tw.a, ay = F.y + (my - F.y) * tw.a, az = F.z + (mz - F.z) * tw.a;
      root.position.set(ax + (sx - mx) * tw.b, ay + (sy - my) * tw.b, az + (sz - mz) * tw.b);
    } else root.position.set(sx, sy, sz);
    root.updateMatrixWorld(true);
    this.qa.ik = o.ik;
    if (!o.ik || w < 0.02) return;
    const wH = F ? (car ? Math.max(tw.a, tw.b) : tw.hands) : 1, wF = F ? tw.feet : 1, wT = F ? tw.b : 1;
    const save = o.save;
    // eixos do veículo no mundo
    const left = _ax.set(1, 0, 0).applyQuaternion(_vq).clone();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_vq);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_vq);
    // ---- alvos das mãos (guidão/volante girado pelo esterço)
    const steerAng = THREE.MathUtils.clamp((dyn?.steer ?? 0) * rig.steerMax, -rig.handFollow, rig.handFollow);
    const pivot = toWorld(M, rig.steerPivot, new THREE.Vector3());
    const axis = new THREE.Vector3(...rig.steerAxis).applyQuaternion(_vq).normalize();
    const sq = new THREE.Quaternion().setFromAxisAngle(axis, steerAng);
    const hand = (l: readonly number[]) => toWorld(M, l, new THREE.Vector3()).sub(pivot).applyQuaternion(sq).add(pivot);
    const hL = hand(seat.handL), hR = hand(seat.handR);
    // ---- 2. tronco: inclina para a frente até as mãos alcançarem (resolve o ângulo no círculo do peito)
    const sp = this.bone('spine_01'), uaL = this.bone('upperarm_l'), uaR = this.bone('upperarm_r');
    const laL = this.bone('lowerarm_l'), hdL = this.bone('hand_l');
    if (sp && uaL && uaR && laL && hdL) {
      const P = sp.getWorldPosition(new THREE.Vector3());
      const chest = uaL.getWorldPosition(new THREE.Vector3()).add(uaR.getWorldPosition(_v)).multiplyScalar(0.5);
      const mid = _v2.addVectors(hL, hR).multiplyScalar(0.5);
      const arm = uaL.getWorldPosition(_a).distanceTo(laL.getWorldPosition(_b)) + _b.distanceTo(hdL.getWorldPosition(_c));
      const D = arm * 0.9 + 0.04; // ombro → pegada com o cotovelo levemente dobrado
      const R = chest.distanceTo(P), H = mid.distanceTo(P);
      const cosA = _v3.subVectors(chest, P).normalize().dot(_t.subVectors(mid, P).normalize());
      const alpha = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
      const phi = Math.acos(THREE.MathUtils.clamp((R * R + H * H - D * D) / (2 * R * H), -1, 1));
      // frear joga o tronco para trás, acelerar para a frente (pouco)
      const target = THREE.MathUtils.clamp(alpha - phi - THREE.MathUtils.clamp(accel * 0.02, -0.06, 0.06), rig.torso[0], rig.torso[1]);
      this.torsoD += (target - this.torsoD) * (1 - Math.exp(-10 * o.dt));
      const a = this.torsoD * wT;
      if (Math.abs(a) > 1e-4) {
        rotWorld(sp, _q.setFromAxisAngle(left, a), save);
        const neck = this.bone('neck_01');
        if (neck) rotWorld(neck, _q.setFromAxisAngle(left, -a * 0.65), save); // olhar continua na via
      }
      this.qa.torso = +this.torsoD.toFixed(3);
    }
    // cabeça olha para a curva
    const neck = this.bone('neck_01');
    if (neck && Math.abs(steerAng) > 0.01) rotWorld(neck, _q.setFromAxisAngle(up, steerAng * 0.22 * wT), save);
    // ---- 3. braços
    for (const s of ['l', 'r'] as const) {
      const A = this.bone(`upperarm_${s}`), B = this.bone(`lowerarm_${s}`), C = this.bone(`hand_${s}`);
      if (!A || !B || !C) continue;
      let tgt = s === 'l' ? hL : hR;
      if (F && car) {
        // sentado na soleira: mãos apoiadas nos joelhos; depois vão ao volante
        const knee = this.bone(`calf_${s}`);
        if (knee) tgt = knee.getWorldPosition(new THREE.Vector3()).addScaledVector(up, 0.1).lerp(tgt, tw.b);
      }
      const pole = new THREE.Vector3(s === 'l' ? rig.elbowPole[0] : -rig.elbowPole[0], rig.elbowPole[1], rig.elbowPole[2]).applyQuaternion(_vq);
      if (wH > 0.01) ik2(A, B, C, tgt, pole, wH, save);
      // punho reto (continua o antebraço) — pegada firme no guidão/volante
      const mid1 = this.bone(`middle_01_${s}`);
      if (mid1) aim(C, mid1, _v.subVectors(C.getWorldPosition(_a), B.getWorldPosition(_b)).normalize(), 0.8 * wH, save);
      this.qa.err[s === 'l' ? 'handL' : 'handR'] = +C.getWorldPosition(_a).distanceTo(tgt).toFixed(3);
    }
    // ---- 4. pés
    const ankle = (l: readonly number[]) => toWorld(M, l, new THREE.Vector3());
    let fL = ankle(seat.footL), fR = ankle(seat.footR);
    let pitchL = 0, pitchR = 0;
    if (rig.crank) {
      // pedivela: o pedal (no eixo) gira; o tornozelo fica 7,5 cm acima e 7 cm atrás do eixo do pedal
      const c = rig.crank, th = dyn?.crank ?? 0;
      const lp = [c.center[0] + c.footX, c.center[1] - c.radius * Math.sin(th) + 0.075, c.center[2] + c.radius * Math.cos(th) - 0.07];
      const rp = [c.center[0] - c.footX, c.center[1] + c.radius * Math.sin(th) + 0.075, c.center[2] - c.radius * Math.cos(th) - 0.07];
      fL = ankle(lp); fR = ankle(rp);
      // tornozelo: calcanhar desce na frente do giro, ponta desce atrás (pedalada "redonda")
      pitchL = -0.15 + 0.22 * Math.sin(th + 0.4); pitchR = -0.15 + 0.22 * Math.sin(th + Math.PI + 0.4);
    }
    if (rig.kick && this.kickW > 0.01) {
      // pé de trás: desce na frente do apoio → empurra o chão para trás → sobe e volta (ciclo kickT)
      const k = rig.kick, u = this.kickT, half = k.stroke / 2;
      let lz: number, ly: number;
      if (u < 0.15) { const e = ease(u / 0.15); lz = THREE.MathUtils.lerp(seat.footR[2], k.ground[2] + half, e); ly = THREE.MathUtils.lerp(seat.footR[1], k.ground[1], e); }
      else if (u < 0.6) { const e = (u - 0.15) / 0.45; lz = k.ground[2] + half - k.stroke * e; ly = k.ground[1]; }
      else { const e = ease((u - 0.6) / 0.4); lz = THREE.MathUtils.lerp(k.ground[2] - half, seat.footR[2], e); ly = k.ground[1] + Math.sin(e * Math.PI) * 0.16 + (seat.footR[1] - k.ground[1]) * e; }
      const kp = ankle([k.ground[0], ly, lz]);
      fR.lerp(kp, this.kickW);
      pitchR = 0.25 * this.kickW * (u > 0.15 && u < 0.6 ? 1 : 0);
    }
    this.qa.kickW = +this.kickW.toFixed(3);
    if (rig.footDown) {
      // moto parada: pé esquerdo no chão
      const down = speed < 0.35 && w > 0.95;
      this.footDownW += ((down ? 1 : 0) - this.footDownW) * (1 - Math.exp(-5 * o.dt));
      if (this.footDownW > 0.01) fL.lerp(ankle(rig.footDown), this.footDownW);
      this.qa.footDownW = +this.footDownW.toFixed(3);
    }
    if (F && car) {
      // transição do carro: pés no chão do lado de fora (sentado na soleira) → pedais na segunda metade
      const sideX = Math.cos(outYaw), sideZ = -Math.sin(outYaw);
      const gL = new THREE.Vector3(F.x + (hipW.x - F.x) * 0.25 + sideX * 0.12, F.y + 0.08, F.z + (hipW.z - F.z) * 0.25 + sideZ * 0.12);
      const gR = new THREE.Vector3(F.x + (hipW.x - F.x) * 0.25 - sideX * 0.12, F.y + 0.08, F.z + (hipW.z - F.z) * 0.25 - sideZ * 0.12);
      fL = gL.lerp(fL, tw.b); fR = gR.lerp(fR, tw.b);
    }
    // carro/cabine: pé direito "pisa" no acelerador ao acelerar
    if (seat.pose === 'car_seat' || seat.pose === 'cab_seat') { pitchL = 0.5; pitchR = 0.5 - THREE.MathUtils.clamp(accel * 0.12, -0.15, 0.25); }
    for (const s of ['l', 'r'] as const) {
      const A = this.bone(`thigh_${s}`), B = this.bone(`calf_${s}`), C = this.bone(`foot_${s}`);
      if (!A || !B || !C) continue;
      const tgt = s === 'l' ? fL : fR;
      const pole = new THREE.Vector3(s === 'l' ? rig.kneePole[0] : -rig.kneePole[0], rig.kneePole[1], rig.kneePole[2]).applyQuaternion(_vq);
      if (wF < 0.01) continue;
      ik2(A, B, C, tgt, pole, wF, save);
      // sola: ponta para a frente do veículo, com o ângulo do pedal/pedaleira
      const ball = this.bone(`ball_${s}`);
      const pitch = s === 'l' ? pitchL : pitchR;
      if (ball) aim(C, ball, _v.copy(fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize(), 0.85 * wF * (F && car ? tw.b : 1), save);
      this.qa.err[s === 'l' ? 'footL' : 'footR'] = +C.getWorldPosition(_a).distanceTo(tgt).toFixed(3);
    }
    if (pelvis) this.qa.err.hip = stand ? 0 : +pelvis.getWorldPosition(_a).distanceTo(hipW).toFixed(3);
  }
}

/**
 * pesos das transições (u = 0 a pé no ponto de entrada/saída … 1 sentado/montado), em duas metades `a` e `b`:
 *  carro/cabine: senta na soleira (clipe sentado entra em `a`, pés no chão de fora) → gira e desliza para o banco (`b`:
 *  pés vão aos pedais, mãos ao volante);
 *  duas rodas: passa a perna e fica sobre o banco (`a`: mãos já no guidão) → senta/sobe (`b`: clipe, pés nos pedais).
 */
export function mountWeights(kind: string, u: number): { a: number; b: number; clip: number; hands: number; feet: number } {
  const a = ease(u / 0.5), b = ease((u - 0.5) / 0.5);
  const pose = mountProfile(kind).seats[0].pose;
  if (pose === 'car_seat' || pose === 'cab_seat') return { a, b, clip: a, hands: b, feet: Math.max(a, b) };
  return { a, b, clip: b, hands: a, feet: b };
}

/** QA/doc: perfil usado por um tipo */
export function rigFor(kind: string): MountProfileFull { return mountProfile(kind); }
