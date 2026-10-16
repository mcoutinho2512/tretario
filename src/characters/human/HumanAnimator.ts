/**
 * Controlador de animação do personagem humano: Idle ↔ Walk ↔ Jog ↔ Sprint com crossfade contínuo por velocidade,
 * fase sincronizada entre os ciclos e velocidade de reprodução casada com a velocidade real (sem "patinar").
 * A velocidade natural de cada ciclo é MEDIDA no próprio esqueleto (pé em apoio) e guardada por tipo de corpo.
 * Também: ar (pulo), poses montadas (carro, bicicleta, patinete), ações curtas (empurrão) e poses da tela inicial.
 */
import * as THREE from 'three';

const LOCO = ['idle', 'walk', 'jog', 'sprint'] as const;
type Loco = (typeof LOCO)[number];
export type RidePose = 'sit-pedal' | 'stand' | 'drive' | 'ride';
export type ShowPose = 'parado' | 'andando' | 'acenando' | 'dancando';

/** pose de repouso de todos os ossos (o mixer não reescreve ossos sem trilha: medições e jogo partem do repouso) */
function snapshotRest(root: THREE.Object3D) {
  const rest: { o: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) rest.push({ o, q: o.quaternion.clone(), p: o.position.clone() }); });
  return () => { for (const r of rest) { r.o.quaternion.copy(r.q); r.o.position.copy(r.p); } };
}

const naturalCache = new Map<string, number>();
const groundCache = new Map<string, number>();

/**
 * altura mínima da bola do pé (no espaço do esqueleto) ao longo do clipe: comparada à pose de repouso (pés no chão)
 * dá quanto o clipe deixa o personagem flutuando (>0) ou afundado (<0) neste corpo.
 */
export function measureGroundY(key: string, root: THREE.Object3D, clip: THREE.AnimationClip): number | null {
  const hit = groundCache.get(key);
  if (hit !== undefined) return hit;
  const feet = ['ball_l', 'ball_r', 'foot_l', 'foot_r'].map((n) => root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
  if (feet.length < 4) return null;
  const mixer = new THREE.AnimationMixer(root);
  const a = mixer.clipAction(clip);
  a.play();
  const step = 1 / 30, n = Math.max(1, Math.ceil(clip.duration / step));
  const inv = new THREE.Matrix4(), v = new THREE.Vector3();
  let min = Infinity;
  const restore = snapshotRest(root);
  for (let i = 0; i <= n; i++) {
    restore();
    mixer.setTime(i * step);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    for (const f of feet) min = Math.min(min, f.getWorldPosition(v).applyMatrix4(inv).y);
  }
  a.stop();
  mixer.uncacheRoot(root);
  restore();
  groundCache.set(key, min);
  return min;
}

/** velocidade do pé em apoio (m/s) ao tocar o clipe no lugar: velocidade de deslocamento que não patina */
export function measureNatural(key: string, root: THREE.Object3D, clip: THREE.AnimationClip, fallback: number): number {
  const hit = naturalCache.get(key);
  if (hit) return hit;
  // bola do pé: fica apoiada também na corrida (o tornozelo sobe no rolamento)
  const footL = root.getObjectByName('ball_l'), footR = root.getObjectByName('ball_r');
  if (!footL || !footR) return fallback;
  const mixer = new THREE.AnimationMixer(root);
  const a = mixer.clipAction(clip);
  a.play();
  const step = 1 / 60, n = Math.ceil(clip.duration / step);
  const inv = new THREE.Matrix4();
  const samples: { y: number; z: number }[][] = [[], []];
  const v = new THREE.Vector3();
  const restore = snapshotRest(root);
  for (let i = 0; i <= n; i++) {
    restore();
    mixer.setTime(i * step);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    [footL, footR].forEach((f, s) => { f.getWorldPosition(v).applyMatrix4(inv); samples[s].push({ y: v.y, z: v.z }); });
  }
  a.stop();
  mixer.uncacheRoot(root);
  restore();
  const speeds: number[] = [];
  for (const s of samples) {
    const minY = Math.min(...s.map((p) => p.y));
    for (let i = 1; i < s.length; i++) {
      if (s[i].y < minY + 0.03 && s[i - 1].y < minY + 0.03) speeds.push(Math.abs(s[i].z - s[i - 1].z) / step);
    }
  }
  speeds.sort((x, y) => x - y);
  const med = speeds.length > 3 ? speeds[Math.floor(speeds.length * 0.5)] : fallback;
  // método 2: amplitude da passada (frente↔trás do pé) × 2 passos por ciclo / duração
  const exc = samples.map((s) => Math.max(...s.map((p) => p.z)) - Math.min(...s.map((p) => p.z)));
  const stride = ((exc[0] + exc[1]) / 2) * 2 / clip.duration;
  (globalThis as any).__pvGait = { ...(globalThis as any).__pvGait, [key]: { stance: +med.toFixed(2), stride: +stride.toFixed(2) } };
  // clipes "no lugar" de corrida escorregam no apoio: a passada é o estimador estável; calibrada pela caminhada
  // (onde os dois métodos concordam: apoio 1,15 m/s × passada 1,26 m/s → fator 0,91)
  void med;
  const r = Number.isFinite(stride) && stride > 0.3 && stride < 10 ? stride * 0.91 : fallback;
  naturalCache.set(key, r);
  return r;
}

/**
 * correção vertical por clipe (m) para este corpo: pés da pose de repouso (no chão) − pés mais baixos do clipe.
 * Positivo = o clipe afundaria o personagem; negativo = flutuaria. Usada pelo animador e pela multidão instanciada.
 */
export function groundOffsets(bodyKey: string, root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>, names: string[]): Record<string, number> {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  let restMin = Infinity;
  for (const n of ['ball_l', 'ball_r', 'foot_l', 'foot_r']) {
    const b = root.getObjectByName(n);
    if (b) restMin = Math.min(restMin, b.getWorldPosition(v).applyMatrix4(inv).y);
  }
  const out: Record<string, number> = {};
  if (!Number.isFinite(restMin)) return out;
  for (const name of names) {
    const c = clips.get(name);
    const m = c ? measureGroundY(`${bodyKey}:${name}`, root, c) : null;
    if (m !== null) out[name] = restMin - m;
  }
  return out;
}

export class HumanAnimator {
  /** fração do sprint na corrida do jogo (0 = só trote) */
  static sprintShare = 0;
  readonly mixer: THREE.AnimationMixer;
  private act = new Map<string, THREE.AnimationAction>();
  private w: Record<string, number> = {};
  private natural: Record<Loco, number> = { idle: 0, walk: 1.2, jog: 3.2, sprint: 5.5 };
  private air = 0;
  private show: ShowPose | null = null;
  private oneShot: { name: string; t: number; dur: number } | null = null;
  private t = 0;
  /** ajustes procedurais (base do idle, aceno, pedal) só valem a pena de perto */
  detail = true;
  private bones = new Map<string, THREE.Object3D>();
  /** pose de repouso de todos os ossos: restaurada antes do mixer a cada quadro, porque ossos SEM trilha nos clipes
   * (o exportador remove canais constantes) não são reescritos pelo mixer e acumulariam os ajustes aditivos */
  private rest: { o: THREE.Object3D; q: THREE.Quaternion | null; p: THREE.Vector3 | null }[] = [];
  private tmpQ = new THREE.Quaternion();
  private axis = new THREE.Vector3();

  /** correção vertical por clipe (m): leva o pé de volta ao chão neste corpo (proporções diferentes da origem) */
  private ground: Record<string, number> = {};
  private baseY: number;

  constructor(private root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>, bodyKey: string, speedFactor = 1) {
    this.mixer = new THREE.AnimationMixer(root);
    // ossos que NENHUM clipe anima (canais constantes removidos no export): só esses voltam ao repouso por quadro
    const animated = new Set<string>();
    for (const c of clips.values()) for (const t of c.tracks) animated.add(`${t.name.split('.')[0]}.${t.name.split('.').pop()}`);
    root.traverse((o) => {
      this.bones.set(o.name, o);
      if (!(o as THREE.Bone).isBone) return;
      const q = animated.has(`${o.name}.quaternion`), p = animated.has(`${o.name}.position`);
      if (!q || !p) this.rest.push({ o, q: q ? null : o.quaternion.clone(), p: p ? null : o.position.clone() });
    });
    this.baseY = root.position.y;
    // pés na pose de repouso = chão (o MakeHuman exporta com os pés no chão)
    this.ground = groundOffsets(bodyKey, root, clips, ['idle', 'walk', 'jog', 'sprint', 'dance', 'talk']);
    const fallback = { idle: 0, walk: 1.2 * speedFactor, jog: 3.2 * speedFactor, sprint: 5.5 * speedFactor };
    for (const [name, clip] of clips) {
      const a = this.mixer.clipAction(clip);
      const loop = !['jump_start', 'jump_land', 'hit', 'interact'].includes(name);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.act.set(name, a);
      this.w[name] = 0;
    }
    for (const l of ['walk', 'jog', 'sprint'] as Loco[]) {
      const c = clips.get(l);
      if (c) this.natural[l] = measureNatural(`${bodyKey}:${l}`, root, c, fallback[l]);
    }
    this.mixer.setTime(0);
    this.w.idle = 1;
    this.act.get('idle')?.setEffectiveWeight(1);
  }

  get naturalSpeeds() { return { ...this.natural }; }

  /** pose de exibição (tela inicial) */
  setShow(p: ShowPose | null) { this.show = p; this.t = 0; }

  /** ação curta sobreposta (empurrão, impacto) */
  playOnce(name: 'push' | 'hit', dur = 0.6) {
    if (!this.act.has(name)) return;
    const a = this.act.get(name)!;
    a.reset();
    a.time = name === 'push' ? 0.35 : 0;
    this.oneShot = { name, t: 0, dur };
  }

  /** pesos-alvo de locomoção pela velocidade (interpolação linear entre as velocidades naturais) */
  private locoTargets(speed: number): Record<Loco, number> {
    // a caminhada cobre de sua velocidade natural até ~1,65× (passo mais rápido); só acima disso mistura o trote,
    // que tem fase de voo — misturá-lo numa caminhada fazia o personagem "quicar"
    const walkTop = Math.min(this.natural.walk * 1.65, this.natural.jog * 0.85);
    if (speed > 0.05 && speed <= walkTop) {
      const out: Record<Loco, number> = { idle: 0, walk: 0, jog: 0, sprint: 0 };
      const t = THREE.MathUtils.clamp(speed / Math.max(0.01, this.natural.walk * 0.6), 0, 1);
      out.idle = 1 - t; out.walk = t;
      return out;
    }
    // corrida do jogo (~5 m/s): o trote com cadência maior; o sprint da biblioteca inclina o tronco quase na
    // horizontal e só entra acima de ~1,9× a velocidade natural do trote
    const jogTop = this.natural.jog * 1.9;
    if (speed >= this.natural.jog && speed <= jogTop) {
      // a partir de ~1,2× o trote, mistura parte do sprint (passada mais longa, cadência menos frenética)
      const t = THREE.MathUtils.clamp((speed - this.natural.jog * 1.2) / Math.max(0.01, this.natural.jog * 0.45), 0, 1);
      const sp = HumanAnimator.sprintShare * t;
      const out: Record<Loco, number> = { idle: 0, walk: 0, jog: 1 - sp, sprint: sp };
      return out;
    }
    const pts: [Loco, number][] = [['idle', 0], ['walk', walkTop], ['jog', speed > jogTop ? jogTop : this.natural.jog], ['sprint', Math.max(this.natural.sprint, jogTop * 1.25)]];
    const out: Record<Loco, number> = { idle: 0, walk: 0, jog: 0, sprint: 0 };
    if (speed <= 0.05) { out.idle = 1; return out; }
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, va] = pts[i], [b, vb] = pts[i + 1];
      if (speed <= vb || i === pts.length - 2) {
        const t = THREE.MathUtils.clamp((speed - va) / Math.max(0.01, vb - va), 0, 1);
        out[a] = 1 - t; out[b] = t;
        return out;
      }
    }
    return out;
  }

  update(speed: number, grounded: boolean, dt: number) {
    this.t += dt;
    const targets: Record<string, number> = {};
    for (const k of this.act.keys()) targets[k] = 0;
    if (this.show) {
      targets[this.show === 'andando' ? 'walk' : this.show === 'dancando' ? 'dance' : 'idle'] = 1;
      if (this.show === 'andando') speed = this.natural.walk;
    } else {
      this.air += ((grounded ? 0 : 1) - this.air) * (1 - Math.exp(-10 * dt));
      const lt = this.locoTargets(speed);
      for (const l of LOCO) targets[l] = lt[l] * (1 - this.air);
      targets.jump_loop = this.air;
    }
    this.blend(targets, dt, 12);
    // velocidade de reprodução casada com o deslocamento + fase comum entre walk/jog/sprint
    let master: THREE.AnimationAction | null = null, mw = 0;
    for (const l of ['walk', 'jog', 'sprint'] as Loco[]) {
      const a = this.act.get(l);
      if (!a) continue;
      a.timeScale = THREE.MathUtils.clamp(speed / Math.max(0.1, this.natural[l]), 0.35, 2.0);
      if (this.w[l] > mw) { mw = this.w[l]; master = a; }
    }
    this.restorePose();
    this.mixer.update(dt);
    if (master) {
      const ph = master.time / master.getClip().duration;
      for (const l of ['walk', 'jog', 'sprint'] as Loco[]) {
        const a = this.act.get(l);
        if (a && a !== master) a.time = ph * a.getClip().duration;
      }
    }
    this.applyOneShot(dt);
    this.applyGround(dt);
    const runW = (this.w.jog ?? 0) + (this.w.sprint ?? 0);
    if (this.detail && ((this.w.idle ?? 0) > 0.01 || runW > 0.01 || this.show === 'acenando')) {
      this.root.updateMatrixWorld(true);
      this.narrowStance();
      this.uprightRun(runW);
      if (this.show === 'acenando') this.wave();
    }
  }

  updateRiding(pose: RidePose, speed: number, dt: number) {
    this.t += dt;
    const targets: Record<string, number> = {};
    for (const k of this.act.keys()) targets[k] = 0;
    targets[pose === 'drive' ? 'drive' : pose === 'sit-pedal' || pose === 'ride' ? 'sit' : 'idle'] = 1;
    this.blend(targets, dt, 14);
    this.restorePose();
    this.mixer.update(dt);
    this.root.position.y = this.baseY;
    this.root.updateMatrixWorld(true);
    if (pose === 'sit-pedal') this.pedal(speed);
  }

  private restorePose() {
    for (const r of this.rest) { if (r.q) r.o.quaternion.copy(r.q); if (r.p) r.o.position.copy(r.p); }
  }

  /** sola acima do osso do pé (bola/tornozelo): o osso fica dentro do calçado */
  private static readonly SOLE = 0.012;
  private lift = 0;
  private feet: THREE.Object3D[] | null = null;
  private tmpV = new THREE.Vector3();

  /**
   * contato com o chão: base = soma ponderada das correções medidas por clipe; de perto, uma TRAVA por quadro
   * mede o pé mais baixo depois da animação e levanta o corpo se ele estiver abaixo do chão (nunca atravessa).
   */
  private applyGround(dt = 1 / 60) {
    let off = 0, wsum = 0;
    for (const [name, d] of Object.entries(this.ground)) {
      const w = this.w[name] ?? 0;
      if (w > 0) { off += d * w; wsum += w; }
    }
    const base = this.baseY + (wsum > 0 ? off / Math.max(1, wsum) : 0);
    this.root.position.y = base;
    if (!this.detail || !this.root.parent) { this.lift = 0; return; }
    this.feet ??= ['ball_l', 'ball_r', 'foot_l', 'foot_r'].map((n) => this.bones.get(n)).filter(Boolean) as THREE.Object3D[];
    this.root.updateMatrixWorld(true);
    let min = Infinity;
    for (const f of this.feet) min = Math.min(min, this.root.parent.worldToLocal(f.getWorldPosition(this.tmpV)).y);
    const target = Number.isFinite(min) ? Math.max(0, HumanAnimator.SOLE - min) : 0;
    // sobe rápido (não deixa afundar), desce devagar (sem tremer)
    this.lift += (target - this.lift) * (target > this.lift ? 1 : 1 - Math.exp(-10 * dt));
    this.root.position.y = base + this.lift;
  }

  private blend(targets: Record<string, number>, dt: number, rate: number) {
    const k = 1 - Math.exp(-rate * dt);
    for (const [name, a] of this.act) {
      const tgt = targets[name] ?? 0;
      const cur = this.w[name] + (tgt - this.w[name]) * k;
      this.w[name] = cur < 0.002 && tgt === 0 ? 0 : cur;
      a.setEffectiveWeight(this.w[name]);
    }
  }

  private applyOneShot(dt: number) {
    const o = this.oneShot;
    if (!o) return;
    o.t += dt;
    const a = this.act.get(o.name)!;
    const env = Math.sin(Math.min(1, o.t / o.dur) * Math.PI);
    a.setEffectiveWeight(env);
    if (o.t >= o.dur) { a.setEffectiveWeight(0); this.oneShot = null; }
  }

  private pq = new THREE.Quaternion();
  private aq = new THREE.Quaternion();
  /**
   * gira um osso em torno de um eixo no espaço do ESQUELETO (x = esquerda do personagem, y = cima, z = frente),
   * somado à pose animada. Converte o eixo para o espaço do pai do osso.
   */
  private rot(name: string, x: number, y: number, z: number, ang: number) {
    const b = this.bones.get(name);
    if (!b || !b.parent || Math.abs(ang) < 1e-5) return;
    this.root.getWorldQuaternion(this.aq);
    b.parent.getWorldQuaternion(this.pq);
    this.axis.set(x, y, z).normalize().applyQuaternion(this.aq).applyQuaternion(this.pq.invert());
    this.tmpQ.setFromAxisAngle(this.axis, ang);
    b.quaternion.premultiply(this.tmpQ);
    b.updateMatrixWorld(false);
  }

  /** o idle da biblioteca tem base larga ("prontidão"): aproxima os pés, proporcional ao peso do idle */
  /** o ciclo de corrida da biblioteca é encurvado (tronco e cabeça projetados): endireita, proporcional ao peso */
  private uprightRun(k: number) {
    if (k < 0.01) return;
    this.rot('spine_01', 1, 0, 0, -0.16 * k);
    this.rot('spine_03', 1, 0, 0, -0.1 * k);
    this.rot('neck_01', 1, 0, 0, -0.12 * k);
    this.rot('head', 1, 0, 0, -0.08 * k);
  }

  private narrowStance() {
    const k = this.w.idle ?? 0;
    if (k < 0.01) return;
    this.rot('thigh_l', 0, 0, 1, -0.085 * k);
    this.rot('thigh_r', 0, 0, 1, 0.085 * k);
    this.rot('calf_l', 0, 0, 1, 0.03 * k);
    this.rot('calf_r', 0, 0, 1, -0.03 * k);
  }

  /** aceno: braço direito levantado ao lado da cabeça, antebraço balançando (sobre o idle) */
  private wave() {
    const k = Math.min(1, this.t * 3);
    const s = Math.sin(this.t * 9);
    this.rot('upperarm_r', 0, 0, 1, -2.1 * k);
    this.rot('lowerarm_r', 0, 0, 1, (-0.5 + s * 0.45) * k);
  }

  /** pedalar (bicicleta) sobre a pose sentada */
  private pedal(speed: number) {
    const ph = this.t * (1.2 + speed * 1.4);
    this.rot('thigh_l', 1, 0, 0, -0.35 * Math.sin(ph));
    this.rot('thigh_r', 1, 0, 0, -0.35 * Math.sin(ph + Math.PI));
    this.rot('calf_l', 1, 0, 0, 0.4 * Math.cos(ph));
    this.rot('calf_r', 1, 0, 0, 0.4 * Math.cos(ph + Math.PI));
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
