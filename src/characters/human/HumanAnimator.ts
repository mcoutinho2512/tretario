/**
 * Controlador de animação do personagem humano: Idle ↔ Walk ↔ Jog ↔ Sprint com crossfade contínuo por velocidade,
 * fase sincronizada entre os ciclos e velocidade de reprodução casada com a velocidade real (sem "patinar").
 * A velocidade natural de cada ciclo é MEDIDA no próprio esqueleto (pé em apoio) e guardada por tipo de corpo.
 * Também: ar (pulo), poses montadas (carro, bicicleta, patinete), ações curtas (empurrão) e poses da tela inicial.
 */
import * as THREE from 'three';

const LOCO = ['idle', 'walk', 'jog', 'sprint'] as const;
type Loco = (typeof LOCO)[number];
export type RidePose = 'sit-pedal' | 'stand' | 'drive';
export type ShowPose = 'parado' | 'andando' | 'acenando' | 'dancando';

const naturalCache = new Map<string, number>();

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
  for (let i = 0; i <= n; i++) {
    mixer.setTime(i * step);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    [footL, footR].forEach((f, s) => { f.getWorldPosition(v).applyMatrix4(inv); samples[s].push({ y: v.y, z: v.z }); });
  }
  a.stop();
  mixer.uncacheRoot(root);
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

export class HumanAnimator {
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
  private tmpQ = new THREE.Quaternion();
  private axis = new THREE.Vector3();

  constructor(private root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>, bodyKey: string, speedFactor = 1) {
    this.mixer = new THREE.AnimationMixer(root);
    root.traverse((o) => this.bones.set(o.name, o));
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
    const pts: [Loco, number][] = [['idle', 0], ['walk', this.natural.walk], ['jog', this.natural.jog], ['sprint', this.natural.sprint]];
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
      a.timeScale = THREE.MathUtils.clamp(speed / Math.max(0.1, this.natural[l]), 0.35, 2.2);
      if (this.w[l] > mw) { mw = this.w[l]; master = a; }
    }
    this.mixer.update(dt);
    if (master) {
      const ph = master.time / master.getClip().duration;
      for (const l of ['walk', 'jog', 'sprint'] as Loco[]) {
        const a = this.act.get(l);
        if (a && a !== master) a.time = ph * a.getClip().duration;
      }
    }
    this.applyOneShot(dt);
    if (this.detail && ((this.w.idle ?? 0) > 0.01 || this.show === 'acenando')) {
      this.root.updateMatrixWorld(true);
      this.narrowStance();
      if (this.show === 'acenando') this.wave();
    }
  }

  updateRiding(pose: RidePose, speed: number, dt: number) {
    this.t += dt;
    const targets: Record<string, number> = {};
    for (const k of this.act.keys()) targets[k] = 0;
    targets[pose === 'drive' ? 'drive' : pose === 'sit-pedal' ? 'sit' : 'idle'] = 1;
    this.blend(targets, dt, 14);
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    if (pose === 'sit-pedal') this.pedal(speed);
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
