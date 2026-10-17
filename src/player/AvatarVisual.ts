/**
 * Visual de um personagem controlado por PlayerState (jogador local e jogadores remotos).
 * Usa o personagem humano modular (src/characters/human: MakeHuman/MPFB + animações retargetadas, LOD0–3).
 * O personagem procedural antigo (src/characters/CharacterMesh) fica apenas como reserva: falha de carregamento
 * ou `?avatar=classic` (depuração) — nunca aparece para o usuário normal.
 */
import { EMPTY_SOCIAL, type SocialState } from '../social/types';
import * as THREE from 'three';
import type { PlayerState } from './PlayerState';
import { createCharacter, type CharacterRig, type BoneName } from '../characters/CharacterMesh';
import { CharacterAnimator } from '../characters/CharacterAnimator';
import { BODY_TYPES, DEFAULT_PLAYER_APPEARANCE, type CharacterAppearance } from '../characters/bodyTypes';
import { HumanCharacter } from '../characters/human/HumanCharacter';
import type { Lod } from '../characters/human/HumanAssets';
import { PLAYER_CONSTANTS } from './PlayerState';
import { Ragdoll, type RagdollParams } from '../physics/Ragdoll';
import { FX } from '../combat/types';
import { STATUS } from '../net/rules';
import { ProtectedAura } from '../combat/fxVisuals';

/** ossos do ragdoll (nomes do rig antigo) → rig "game_engine" do personagem humano */
const HUMAN_BONES: Record<BoneName, string> = {
  Hips: 'pelvis', Spine: 'spine_01', Chest: 'spine_03', Neck: 'neck_01', Head: 'head',
  LeftUpperArm: 'upperarm_l', LeftLowerArm: 'lowerarm_l', LeftHand: 'hand_l',
  RightUpperArm: 'upperarm_r', RightLowerArm: 'lowerarm_r', RightHand: 'hand_r',
  LeftUpperLeg: 'thigh_l', LeftLowerLeg: 'calf_l', LeftFoot: 'foot_l',
  RightUpperLeg: 'thigh_r', RightLowerLeg: 'calf_r', RightFoot: 'foot_r',
};

const useClassic = typeof location !== 'undefined' && new URLSearchParams(location.search).get('avatar') === 'classic';

export interface AvatarOptions { lod?: Lod; castShadow?: boolean }

export class AvatarVisual {
  /** LOD mais detalhado para jogadores remotos (preset): 0 no HIGH/ULTRA, 1 no MEDIUM, 2 no LOW */
  static maxRemoteDetail: Lod = 0;
  readonly root = new THREE.Group();
  private human: HumanCharacter | null = null;
  private legacy: { rig: CharacterRig; anim: CharacterAnimator } | null = null;
  private smoothY = 0;
  private initialized = false;
  private body: CharacterAppearance['body'];
  // queda: ragdoll (Rapier) → levantar (blend da pose do chão para a pose animada)
  private ragdoll: Ragdoll | null = null;
  private fall: { phase: 'down' | 'getup' | 'none'; t: number; down: number; getup: number; captured: THREE.Quaternion[]; hipsFrom: THREE.Vector3 } =
    { phase: 'none', t: 0, down: 0, getup: 0, captured: [], hipsFrom: new THREE.Vector3() };
  private fallback = { tilt: 0 };
  /** rodada 9: cada queda/reuso/descarte troca a geração — um ragdoll que termina de carregar depois é liberado */
  private fallGen = 0;
  /** rodada 9: efeitos (bits FX) e estado físico aplicados; brilho de proteção (criado no primeiro uso) */
  private fx = 0;
  private phys: number = STATUS.OK;
  private aura: ProtectedAura | null = null;
  /** QA: cambaleios tocados */
  private staggers = 0;
  private animAcc = 0;
  private frame = 0;

  constructor(appearance: CharacterAppearance = DEFAULT_PLAYER_APPEARANCE.homem, opts: AvatarOptions = {}) {
    this.root.name = 'avatar';
    this.body = appearance.body;
    if (useClassic) this.useLegacy(appearance);
    else {
      this.human = new HumanCharacter(appearance, { lod: opts.lod ?? 0, castShadow: opts.castShadow ?? true });
      this.root.add(this.human.root);
      this.human.ready.catch((e) => {
        console.warn('[avatar] personagem humano indisponível, usando reserva', e);
        this.human?.dispose();
        this.human = null;
        this.useLegacy(appearance);
      });
    }
  }

  private useLegacy(app: CharacterAppearance) {
    const rig = createCharacter(app);
    this.root.add(rig.mesh);
    this.legacy = { rig, anim: new CharacterAnimator(rig, PLAYER_CONSTANTS.walkSpeed, PLAYER_CONSTANTS.runSpeed) };
  }

  /** ação social / item (ver HumanCharacter.setSocial) */
  setSocial(s: SocialState) { this.human?.setSocial(s); }
  get social(): SocialState { return this.human?.social ?? EMPTY_SOCIAL; }

  /** fator de velocidade do tipo de corpo (idosos andam mais devagar) */
  get speedFactor() { return BODY_TYPES[this.body].speedFactor; }

  get isDown() { return this.fall.phase !== 'none'; }

  /** nível de detalhe pela distância à câmera (remotos); o jogador local fica no LOD0 */
  setDistance(d: number) {
    if (!this.human) return;
    const lod = Math.max(AvatarVisual.maxRemoteDetail, d < 10 ? 0 : d < 32 ? 1 : d < 90 ? 2 : 3) as Lod;
    this.human.setLod(lod);
    this.human.setShadow(d < 45);
  }

  /** LOD decidido pelo orçamento da multidão (CrowdDirector); sombra só de perto */
  applyLod(l: Lod, dist: number) {
    if (!this.human) return;
    this.human.setLod(l);
    this.human.setShadow(dist < 45);
  }

  /** já há malha visível (o personagem humano carrega de forma assíncrona) */
  get ready(): boolean { return !!this.legacy || !!this.human?.showing; }

  /** devolve ao estado inicial para ser reaproveitado por outro jogador do mesmo corpo (pool) */
  resetForReuse() {
    this.fallGen++;
    this.ragdoll?.dispose();
    this.ragdoll = null;
    this.human?.propAttachment?.setVisible(true);
    this.fx = 0; this.phys = STATUS.OK; this.aura?.set(false); this.human?.animator?.stopClip();
    this.fall = { phase: 'none', t: 0, down: 0, getup: 0, captured: [], hipsFrom: new THREE.Vector3() };
    const pivot = this.human?.armature ?? this.legacy?.rig.mesh;
    if (pivot) pivot.rotation.x = 0;
    this.human?.resetPose();
    this.initialized = false;
    this.animAcc = 0;
    this.pushT = 0;
  }

  /** nível de detalhe fixo (jogador local) */
  setDetail(lod: Lod) { this.human?.setLod(lod); }

  /** QA: alturas de mundo do personagem (raiz, esqueleto, pelve, pés) */
  probe() {
    const h = this.human;
    if (!h?.armature) return null;
    const v = new THREE.Vector3();
    const y = (n: string) => { const b = h.bones.get(n); return b ? +b.getWorldPosition(v).y.toFixed(4) : null; };
    return {
      root: +this.root.position.y.toFixed(4), armY: +h.armature.position.y.toFixed(4), lod: h.lod,
      pelvis: y('pelvis'), head: y('head'), pelvisXZ: (() => { const b = h.bones.get('pelvis'); if (!b) return null; b.getWorldPosition(v); return [+(v.x - this.root.position.x).toFixed(3), +(v.z - this.root.position.z).toFixed(3)]; })(), ballL: y('ball_l'), ballR: y('ball_r'), footL: y('foot_l'), footR: y('foot_r'),
      pelvisLocal: h.bones.get('pelvis')?.position.toArray().map((x) => +x.toFixed(3)),
      w: Object.fromEntries(Object.entries((h.animator as any)?.w ?? {}).filter(([, x]) => (x as number) > 0.001).map(([k, x]) => [k, +(x as number).toFixed(3)])),
      clipGround: (h.animator as any)?.ground,
    };
  }

  setAppearance(app: CharacterAppearance) {
    this.human?.setAppearance(app);
    this.legacy?.rig.setAppearance(app);
  }

  // ------------------------------------------------------------------ ossos (para o ragdoll)
  private rigForRagdoll(): CharacterRig | null {
    if (this.legacy) return this.legacy.rig;
    const h = this.human;
    if (!h?.armature || !h.bones.size) return null;
    const bones = {} as Record<BoneName, THREE.Bone>;
    for (const [k, v] of Object.entries(HUMAN_BONES)) bones[k as BoneName] = h.bones.get(v)!;
    return { mesh: h.armature as unknown as THREE.SkinnedMesh, bones, body: h.body, setAppearance() {}, dispose() {} };
  }
  private allBones(): THREE.Object3D[] {
    if (this.legacy) return Object.values(this.legacy.rig.bones);
    return this.human ? [...this.human.bones.values()] : [];
  }
  private hips(): THREE.Object3D | null {
    if (this.legacy) return this.legacy.rig.bones.Hips;
    return this.human?.bones.get('pelvis') ?? null;
  }
  private animate(speed: number, grounded: boolean, dt: number) {
    if (this.legacy) this.legacy.anim.update(speed, grounded, dt);
    else { this.human?.animator?.update(speed, grounded, dt); this.human?.updateProps(dt); }
  }

  /**
   * Queda (empurrão/impacto). A posição de repouso vem do servidor; aqui só o visual.
   * Usa ragdoll Rapier quando disponível; senão uma queda procedural simples (mesmo tempo no chão).
   */
  async knockdown(p: RagdollParams & { downMs: number; getupMs: number }) {
    const gen = ++this.fallGen;
    this.ragdoll?.dispose();
    this.ragdoll = null;
    this.fall = { phase: 'down', t: 0, down: p.downMs / 1000, getup: p.getupMs / 1000, captured: [], hipsFrom: new THREE.Vector3() };
    this.fallback = { tilt: 0 };
    // item na mão: some durante a queda (o servidor larga o de confronto; o social volta ao levantar)
    this.human?.propAttachment?.setVisible(false);
    this.human?.animator?.stopClip('stagger');
    const rig = this.rigForRagdoll();
    if (!rig) return;
    try {
      this.root.updateMatrixWorld(true);
      const rd = await Ragdoll.create(rig, p);
      // outra queda, reuso ou descarte enquanto o Rapier carregava, ou a queda já acabou: libera na hora (sem vazamento)
      if (gen !== this.fallGen || this.fall.phase !== 'down') { rd.dispose(); return; }
      this.ragdoll = rd;
    } catch (e) {
      console.warn('[ragdoll] indisponível, usando queda procedural', e);
    }
  }

  // ------------------------------------------------------------------ rodada 9: estados físicos e efeitos
  /** golpe/uso de item (clipes procedurais swing_bat, swing_bar, spray_use…) por cima da locomoção */
  playCombatClip(name: string, holdAt?: number) { return this.human?.animator?.playClip(name, false, holdAt) ?? false; }
  /** encerra um clipe de confronto (ou todos) */
  stopCombatClip(name?: string) { this.human?.animator?.stopClip(name); }

  /** estado físico do servidor (NetPlayer.status): cambaleio toca `stagger` (a queda entra por FallSync/knockdown) */
  setPhys(status: number) {
    if (status === this.phys) return;
    const prev = this.phys;
    this.phys = status;
    if (status === STATUS.STAGGER && prev !== STATUS.STAGGER && !this.isDown) { this.human?.animator?.playClip('stagger'); this.staggers++; }
  }

  /** efeitos (NetPlayer.fx): proteção = brilho sutil; desorientado = mãos no rosto (loop até o bit sair) */
  setFx(fx: number) {
    if (fx === this.fx) return;
    const was = this.fx;
    this.fx = fx;
    const prot = !!(fx & FX.PROTECTED);
    if (prot && !this.aura) this.aura = new ProtectedAura(this.root);
    this.aura?.set(prot);
    const dis = !!(fx & FX.DISORIENTED), wasDis = !!(was & FX.DISORIENTED);
    if (dis && !wasDis) this.human?.animator?.playClip('disoriented', true);
    else if (!dis && wasDis) this.human?.animator?.stopClip('disoriented');
  }

  /** QA: estado físico/efeitos aplicados e clipes avulsos ativos */
  get fxDebug() { return { fx: this.fx, phys: this.phys, aura: !!this.aura?.on, clips: this.human?.animator?.fxClips ?? [], staggers: this.staggers, ragdoll: !!this.ragdoll, fall: this.fall.phase }; }

  /** atualiza queda; retorna true enquanto controla a pose */
  private updateFall(x: number, y: number, z: number, heading: number, dt: number): boolean {
    const f = this.fall;
    if (f.phase === 'none') return false;
    f.t += dt;
    const hips = this.hips();
    if (f.phase === 'down') {
      this.root.position.set(x, y, z);
      this.root.rotation.y = heading;
      if (this.ragdoll) this.ragdoll.update(dt);
      else {
        // queda procedural: tomba para trás em 0,4 s
        this.fallback.tilt = Math.min(1, this.fallback.tilt + dt * 2.5);
        this.animate(0, true, dt);
        const pivot = this.human?.armature ?? this.legacy?.rig.mesh;
        if (pivot) pivot.rotation.x = -this.fallback.tilt * 1.35;
      }
      if (f.t >= f.down && hips) {
        // início do levantar: captura a pose do chão, já re-expressa no novo referencial (posição do servidor)
        const pivot = this.human?.armature ?? this.legacy?.rig.mesh;
        this.root.updateMatrixWorld(true);
        const hipsWorld = hips.getWorldPosition(new THREE.Vector3());
        if (pivot) pivot.rotation.x = 0;
        this.root.position.set(x, y, z);
        this.root.updateMatrixWorld(true);
        f.hipsFrom = hipsWorld.applyMatrix4(hips.parent!.matrixWorld.clone().invert());
        f.captured = this.allBones().map((b) => b.quaternion.clone());
        this.fallGen++; // um Ragdoll.create ainda pendente será descartado
        this.ragdoll?.dispose();
        this.ragdoll = null;
        f.phase = 'getup';
        f.t = 0;
      }
      return true;
    }
    // levantar: anima idle (a partir do repouso: ossos sem trilha não podem herdar a pose do ragdoll)
    // e mistura a partir da pose capturada
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    this.human?.resetPose();
    this.animate(0, true, dt);
    const k = Math.min(1, f.t / f.getup);
    const e = k * k * (3 - 2 * k);
    this.allBones().forEach((bone, i) => { if (f.captured[i]) bone.quaternion.copy(f.captured[i].clone().slerp(bone.quaternion, e)); });
    if (hips) hips.position.lerpVectors(f.hipsFrom, hips.position.clone(), e);
    if (f.t >= f.getup) { f.phase = 'none'; this.human?.propAttachment?.setVisible(true); }
    return true;
  }

  /** animação curta do empurrão — sobreposta à animação normal */
  private pushT = 0;
  playPush() {
    if (this.human?.animator) this.human.animator.playOnce('push', 0.55);
    else this.pushT = 0.45;
  }

  /** montado num veículo: posiciona sobre ele e aplica a pose */
  updateRiding(x: number, y: number, z: number, heading: number, pose: 'sit-pedal' | 'stand' | 'drive' | 'ride', speed: number, seatHeight: number, dt: number) {
    this.smoothY = y;
    this.root.rotation.y = heading;
    if (this.legacy) {
      this.root.position.set(x, y, z);
      this.legacy.anim.updateRiding(pose === 'ride' ? 'sit-pedal' : pose, speed, seatHeight, dt);
      return;
    }
    const a = this.human?.animator;
    if (!a) { this.root.position.set(x, y, z); return; }
    a.updateRiding(pose, speed, dt);
    // sentado: a pelve do clipe vai para a altura do assento; em pé (patinete): pés sobre a plataforma
    const hips = this.hips();
    let lift = seatHeight;
    if (pose !== 'stand' && hips && this.human?.armature) {
      this.human.armature.updateMatrixWorld(true);
      const local = hips.getWorldPosition(new THREE.Vector3()).sub(this.root.getWorldPosition(new THREE.Vector3())).y;
      lift = seatHeight + (pose === 'drive' ? 0.1 : 0.06) - local;
    }
    this.root.position.set(x, y + lift, z);
  }

  /**
   * `animate` (opcional): decisão externa de atualizar a animação neste quadro (orçamento da multidão, escalonado);
   * sem ela, a frequência sai do LOD (perto: todo quadro; LOD2: 1/2; LOD3: 1/4). O tempo acumulado nunca se perde.
   */
  update(s: PlayerState, dt: number, animate?: boolean) {
    if (this.updateFall(s.x, s.y, s.z, s.heading, dt)) { this.smoothY = s.y; return; }
    if (!this.initialized) { this.smoothY = s.y; this.initialized = true; }
    this.smoothY += (s.y - this.smoothY) * (1 - Math.exp(-18 * dt));
    if (Math.abs(s.y - this.smoothY) > 0.6) this.smoothY = s.y;
    this.root.position.set(s.x, this.smoothY, s.z);
    this.root.rotation.y = s.heading;
    // LOD de atualização: personagens distantes animam com menos frequência
    const lod = this.human?.lod ?? 0;
    const every = lod <= 1 ? 1 : lod === 2 ? 2 : 4;
    this.animAcc += dt;
    ++this.frame;
    if (animate === false || (animate === undefined && this.frame % every !== 0)) return;
    this.animate(s.speed, s.grounded, this.animAcc);
    this.animAcc = 0;
    if (this.legacy && this.pushT > 0) {
      this.pushT -= dt;
      const k = Math.sin(Math.min(1, (0.45 - this.pushT) / 0.45) * Math.PI);
      const b = this.legacy.rig.bones;
      b.LeftUpperArm.rotation.x = -1.5 * k; b.RightUpperArm.rotation.x = -1.5 * k;
      b.LeftLowerArm.rotation.x = -0.2 * k; b.RightLowerArm.rotation.x = -0.2 * k;
      b.Spine.rotation.x += 0.25 * k;
    }
  }

  dispose() {
    this.fallGen++;
    this.aura?.dispose();
    this.ragdoll?.dispose();
    this.human?.dispose();
    this.legacy?.rig.dispose();
    this.root.removeFromParent();
  }
}
