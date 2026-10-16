/**
 * Controlador de animação do personagem humano: Idle ↔ Walk ↔ Jog ↔ Sprint com crossfade contínuo por velocidade,
 * fase sincronizada entre os ciclos e velocidade de reprodução casada com a velocidade real (sem "patinar").
 * A velocidade natural de cada ciclo é MEDIDA no próprio esqueleto (pé em apoio) e guardada por tipo de corpo.
 * Também: ar (pulo), poses montadas (carro, bicicleta, patinete), ações curtas (empurrão) e poses da tela inicial.
 */
import * as THREE from 'three';
import { EMPTY_SOCIAL, type SocialState } from '../../social/types';
import { ACTION_BY_ID, type ActionDefinition } from '../../social/actions';
import { PROP_BY_ID } from '../../social/props';
import { MIRROR_SUFFIX, UPPER_MOVING_WEIGHT, clipFloor, ease, proceduralClip, specFor } from './proceduralClips';

const LOCO = ['idle', 'walk', 'jog', 'sprint'] as const;
type Loco = (typeof LOCO)[number];
export type RidePose = 'sit-pedal' | 'stand' | 'drive' | 'ride';
export type ShowPose = 'parado' | 'andando' | 'acenando' | 'dancando';

/** duração do crossfade de entrada/saída da camada de ação (s) */
const ACT_FADE = 0.32;

/** uma camada de ação/pose de carregar: trilhas amostradas direto (sem mixer) e misturadas osso a osso */
interface ActLayer {
  kind: 'act' | 'carry';
  /** id da ação (ACTIONS) ou do item (PROPS) */
  id: number;
  variation: number;
  full: boolean;
  loop: boolean;
  dur: number;
  /** segundos desde o início (fase comum entre clientes) */
  phase: number;
  offset: number;
  rate: number;
  /** peso linear 0..1 (aplicado suavizado) */
  w: number;
  target: number;
  /** correção vertical (corpo inteiro) */
  ground: number;
  /** duração do crossfade (s) */
  fade: number;
  tracks: { b: THREE.Object3D; pos: boolean; it: THREE.Interpolant; spine: number }[];
}

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
  static sprintShare = 0.35;
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

  /**
   * `library`: todos os clipes da biblioteca deste corpo (os NPCs tocam só um subconjunto no mixer, mas uma ação
   * como a dança da biblioteca precisa do clipe completo)
   */
  constructor(private root: THREE.Object3D, clips: Map<string, THREE.AnimationClip>, private bodyKey: string, speedFactor = 1, library: Map<string, THREE.AnimationClip> = clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.library = library;
    this.baseClip = clips.get('idle') ?? library.get('idle') ?? null;
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
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), v = new THREE.Vector3();
    for (const n of ['ball_l', 'ball_r', 'foot_l', 'foot_r']) {
      const b = root.getObjectByName(n);
      if (b) this.restFootMin = Math.min(this.restFootMin, b.getWorldPosition(v).applyMatrix4(inv).y);
    }
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

  private library: Map<string, THREE.AnimationClip>;
  /** pose base dos clipes procedurais (idle deste corpo) */
  private baseClip: THREE.AnimationClip | null;
  private restFootMin = Infinity;
  private layers: ActLayer[] = [];
  private layerGround = new Map<string, number>();

  /** ação social / item (ver src/social) */
  social: SocialState = EMPTY_SOCIAL;
  /**
   * Ação social + item na mão. Pode ser chamado a cada quadro ou só quando muda: `phase` (s desde o início da ação,
   * relógio comum) só ressincroniza quando chega um valor novo; entre chamadas a fase avança com o `dt` do update.
   * A camada entra/sai com crossfade (ACT_FADE); `upper` mistura só tronco/braços/cabeça sobre a locomoção,
   * `full` substitui o corpo inteiro. Sem ação e com item: pose de carregar do item (PROPS[].carryClip).
   */
  setSocial(s: SocialState) {
    this.social = s;
    const def = s.act ? ACTION_BY_ID.get(s.act) : undefined;
    const rec = this.actRec;
    if (def && rec && rec.id === def.id && rec.variation === s.variation) {
      // mesma ação: reenvio do mesmo estado não faz nada (uma ação `once` que já terminou não recomeça)
      if (s.phase !== rec.phaseIn) {
        const cur = this.layers.find((l) => l.kind === 'act' && l.target > 0);
        // fase voltou ao começo → a ação foi disparada de novo; senão só acerta a fase
        if (s.phase < 0.5 && this.t - rec.t0 > s.phase + 0.5) this.startAct(def, s);
        else { rec.t0 = this.t - s.phase; rec.phaseIn = s.phase; if (cur) cur.phase = s.phase; }
      }
    } else if (def) this.startAct(def, s);
    else {
      this.actRec = null;
      for (const l of this.layers) if (l.kind === 'act') l.target = 0;
    }
    // pose de carregar do item
    const carry = this.layers.find((l) => l.kind === 'carry' && l.target > 0);
    if (!carry || carry.id !== s.prop) {
      if (carry) carry.target = 0;
      const p = s.prop ? PROP_BY_ID.get(s.prop) : undefined;
      const l = p ? this.makeLayer('carry', p.id, p.carryClip, false, s.variation) : null;
      if (l) { l.phase = this.t; this.layers.unshift(l); }
    }
  }

  /** ação recebida por último: id, variação, último `phase` recebido e início estimado no relógio local */
  private actRec: { id: number; variation: number; phaseIn: number; t0: number } | null = null;

  private startAct(def: ActionDefinition, s: SocialState) {
    for (const l of this.layers) if (l.kind === 'act') l.target = 0;
    this.actRec = { id: def.id, variation: s.variation, phaseIn: s.phase, t0: this.t - s.phase };
    const l = this.makeLayer('act', def.id, def.clip, def.layer === 'full', s.variation, def.mode === 'once' ? def.duration ?? 2 : undefined);
    if (!l) return;
    l.phase = s.phase;
    this.layers.push(l);
  }

  /** clipe da ação: biblioteca (ex.: dança) ou procedural (gerado sob demanda para este esqueleto) */
  private clipFor(name: string): THREE.AnimationClip | null {
    const lib = this.library.get(name);
    if (lib) return lib;
    return this.baseClip ? proceduralClip(name, this.root, this.baseClip) : null;
  }

  private makeLayer(kind: 'act' | 'carry', id: number, name: string, full: boolean, variation: number, onceDur?: number): ActLayer | null {
    const spec = specFor(name);
    // variação (NPCs): espelho nos gestos assimétricos, deslocamento de fase e andamento ±3 % nos loops
    const clip = this.clipFor(spec?.mirror && variation & 1 ? name + MIRROR_SUFFIX : name);
    if (!clip) return null;
    full = full || spec?.layer === 'full';
    const loop = onceDur === undefined;
    const tracks: ActLayer['tracks'] = [];
    for (const tr of clip.tracks) {
      const dot = tr.name.lastIndexOf('.');
      const bn = tr.name.slice(0, dot), prop = tr.name.slice(dot + 1);
      if (bn === 'Root' || prop === 'scale' || (prop === 'position' && !(full && bn === 'pelvis'))) continue;
      const b = this.bones.get(bn);
      if (!b) continue;
      tracks.push({ b, pos: prop === 'position', it: tr.createInterpolant(), spine: full ? 1 : UPPER_MOVING_WEIGHT[bn] ?? 1 });
    }
    let ground = 0;
    if (full) {
      const key = `${this.bodyKey}:${clip.name}`;
      if (!this.layerGround.has(key)) {
        const m = Number.isFinite(this.restFootMin) ? clipFloor(this.root, clip) : null;
        this.layerGround.set(key, m === null ? 0 : this.restFootMin - m);
      }
      ground = this.layerGround.get(key)!;
    }
    const v = variation & 7;
    return {
      kind, id, variation, full, loop, dur: onceDur ?? clip.duration, phase: 0,
      offset: loop && v ? ((v * 0.381966) % 1) * clip.duration : 0,
      rate: loop && v ? 1 + (((v * 5) % 8) - 3.5) * 0.008 : 1,
      w: 0, target: 1, ground, tracks, fade: spec?.fade ?? ACT_FADE,
    };
  }

  /** peso atual (suavizado) das camadas de corpo inteiro e superior */
  private actWeights() {
    let full = 0, upper = 0;
    for (const l of this.layers) { const e = ease(l.w); if (l.full) full = Math.max(full, e); else upper = Math.max(upper, e); }
    return { full, upper };
  }

  /** avança fases/pesos e mistura as camadas sobre a pose da locomoção (depois do mixer) */
  private applyLayers(dt: number) {
    if (!this.layers.length) return;
    const busy = this.layers.some((l) => l.kind === 'act' && l.target > 0);
    for (const l of this.layers) {
      l.phase += dt;
      // pose de carregar só sem ação ativa; ação `once` sai sozinha no fim da duração
      const want = l.target > 0 && (l.kind === 'carry' ? !busy : l.loop || l.phase < l.dur - l.fade);
      l.w = want ? Math.min(1, l.w + dt / l.fade) : Math.max(0, l.w - dt / l.fade);
      if (l.kind === 'act' && !l.loop && l.phase >= l.dur) l.target = 0;
    }
    this.layers = this.layers.filter((l) => l.w > 0 || l.target > 0);
    // parado: a camada superior controla a coluna inteira; andando, a coluna baixa segue a passada
    const moving = THREE.MathUtils.clamp(1 - (this.w.idle ?? 0), 0, 1);
    for (const l of this.layers) {
      const ew = ease(l.w);
      if (ew <= 0) continue;
      const time = l.loop ? (((l.phase * l.rate + l.offset) % l.dur) + l.dur) % l.dur : Math.min(l.phase, l.dur);
      for (const tr of l.tracks) {
        const v = tr.it.evaluate(time);
        const w = ew * (1 + (tr.spine - 1) * moving);
        if (tr.pos) {
          this.adjustedP ??= { o: tr.b, p: tr.b.position.clone() };
          tr.b.position.lerp(this.tmpV.set(v[0], v[1], v[2]), w);
        } else {
          if (!this.adjusted.some((r) => r.o === tr.b)) this.adjusted.push({ o: tr.b, q: tr.b.quaternion.clone() });
          tr.b.quaternion.slerp(this.tmpQ.set(v[0], v[1], v[2], v[3]), w);
        }
      }
    }
  }
  /** posição da pelve antes da camada de corpo inteiro (restaurada no próximo quadro) */
  private adjustedP: { o: THREE.Object3D; p: THREE.Vector3 } | null = null;

  /** QA (folha de contato): congela as camadas no instante `t` com peso cheio */
  seekSocial(t: number) {
    for (const l of this.layers) { l.phase = t; l.w = l.target > 0 ? 1 : 0; }
  }

  /** camadas ativas (QA) */
  get socialDebug() {
    return this.layers.map((l) => ({ kind: l.kind, id: l.id, full: l.full, w: +l.w.toFixed(2), phase: +l.phase.toFixed(2), ground: +l.ground.toFixed(3) }));
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
    // cadência ÚNICA: média ponderada da frequência de passo que cada clipe teria nesta velocidade; cada clipe toca
    // nessa frequência (as fases ficam alinhadas). Misturar o sprint alonga a passada sem acelerar demais o trote.
    let master: THREE.AnimationAction | null = null, mw = 0, fsum = 0, wsum = 0;
    for (const l of ['walk', 'jog', 'sprint'] as Loco[]) {
      const a = this.act.get(l);
      if (!a) continue;
      const ts = THREE.MathUtils.clamp(speed / Math.max(0.1, this.natural[l]), 0.35, 2.0);
      a.timeScale = ts;
      if (this.w[l] > 0) { fsum += this.w[l] * ts / a.getClip().duration; wsum += this.w[l]; }
      if (this.w[l] > mw) { mw = this.w[l]; master = a; }
    }
    if (wsum > 0.01) {
      const f = fsum / wsum;
      for (const l of ['walk', 'jog', 'sprint'] as Loco[]) { const a = this.act.get(l); if (a) a.timeScale = f * a.getClip().duration; }
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
    this.applyLayers(dt);
    const aw = this.actWeights();
    this.applyGround(dt, aw.full);
    // os ajustes procedurais da locomoção cedem à camada de ação (a dança tem pernas próprias; o tronco da ação já é ereto)
    const runW = ((this.w.jog ?? 0) + (this.w.sprint ?? 0)) * (1 - aw.full) * (1 - 0.7 * aw.upper);
    if (this.detail && ((this.w.idle ?? 0) > 0.01 || runW > 0.01 || this.show === 'acenando')) {
      this.root.updateMatrixWorld(true);
      this.narrowStance(1 - aw.full);
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
    // desfaz os ajustes aditivos do quadro anterior: o mixer NÃO reescreve todo osso em todo quadro (ex.: trilha
    // com chaves constantes num trecho), e o ajuste se acumulava — o tronco girava até dar "cambalhota" na corrida
    for (let i = this.adjusted.length - 1; i >= 0; i--) this.adjusted[i].o.quaternion.copy(this.adjusted[i].q);
    this.adjusted.length = 0;
    if (this.adjustedP) { this.adjustedP.o.position.copy(this.adjustedP.p); this.adjustedP = null; }
  }
  /** ossos ajustados neste quadro, com a pose ANTES do ajuste (restaurada no início do próximo quadro) */
  private adjusted: { o: THREE.Object3D; q: THREE.Quaternion }[] = [];

  /** sola acima do osso do pé (bola/tornozelo): o osso fica dentro do calçado */
  private static readonly SOLE = 0.012;
  private lift = 0;
  private feet: THREE.Object3D[] | null = null;
  private tmpV = new THREE.Vector3();

  /**
   * contato com o chão: base = soma ponderada das correções medidas por clipe; de perto, uma TRAVA por quadro
   * mede o pé mais baixo depois da animação e levanta o corpo se ele estiver abaixo do chão (nunca atravessa).
   */
  private applyGround(dt = 1 / 60, full = 0) {
    let off = 0, wsum = 0;
    for (const [name, d] of Object.entries(this.ground)) {
      const w = this.w[name] ?? 0;
      if (w > 0) { off += d * w; wsum += w; }
    }
    let corr = wsum > 0 ? off / Math.max(1, wsum) : 0;
    // camada de corpo inteiro (dança, sentar, pulo): a correção dela substitui a da locomoção na proporção do peso
    if (full > 0) {
      let g = 0, gw = 0;
      for (const l of this.layers) if (l.full) { const e = ease(l.w); g += l.ground * e; gw += e; }
      if (gw > 0) corr = corr * (1 - full) + (g / gw) * full;
    }
    const base = this.baseY + corr;
    this.root.position.y = base;
    // de longe a trava só vale durante uma ação de corpo inteiro (a transição para sentar/dançar afundava os pés)
    if ((!this.detail && full <= 0) || !this.root.parent) { this.lift = 0; return; }
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
    if (!this.adjusted.some((r) => r.o === b)) this.adjusted.push({ o: b, q: b.quaternion.clone() });
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

  private narrowStance(scale = 1) {
    const k = (this.w.idle ?? 0) * scale;
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
