/**
 * Visual de um personagem controlado por PlayerState (jogador local hoje; RemotePlayer no futuro).
 * Usa o personagem esqueletal procedural (src/characters) — 1 draw call, 4 tipos de corpo.
 * Placeholder de arte: substituível por GLB rigado com o mesmo esqueleto (ver docs/DECISIONS.md, ADR-002).
 */
import * as THREE from 'three';
import type { PlayerState } from './PlayerState';
import { createCharacter, type CharacterRig } from '../characters/CharacterMesh';
import { CharacterAnimator } from '../characters/CharacterAnimator';
import { BODY_TYPES, DEFAULT_PLAYER_APPEARANCE, type CharacterAppearance } from '../characters/bodyTypes';
import { PLAYER_CONSTANTS } from './PlayerState';
import { Ragdoll, type RagdollParams } from '../physics/Ragdoll';
import { BONE_NAMES } from '../characters/CharacterMesh';

export class AvatarVisual {
  readonly root = new THREE.Group();
  readonly rig: CharacterRig;
  private anim: CharacterAnimator;
  private smoothY = 0;
  private initialized = false;
  // queda: ragdoll (Rapier) → levantar (blend da pose do chão para a pose animada)
  private ragdoll: Ragdoll | null = null;
  private fall: { phase: 'down' | 'getup' | 'none'; t: number; down: number; getup: number; captured: THREE.Quaternion[]; hipsFrom: THREE.Vector3 } =
    { phase: 'none', t: 0, down: 0, getup: 0, captured: [], hipsFrom: new THREE.Vector3() };
  private fallback = { tilt: 0, dirX: 0, dirZ: 0 };

  constructor(appearance: CharacterAppearance = DEFAULT_PLAYER_APPEARANCE.homem) {
    this.root.name = 'avatar';
    this.rig = createCharacter(appearance);
    this.root.add(this.rig.mesh);
    this.anim = new CharacterAnimator(this.rig, PLAYER_CONSTANTS.walkSpeed, PLAYER_CONSTANTS.runSpeed);
  }

  /** fator de velocidade do tipo de corpo (idosos andam mais devagar) */
  get speedFactor() {
    return BODY_TYPES[this.rig.body].speedFactor;
  }

  get isDown() { return this.fall.phase !== 'none'; }

  /**
   * Queda (empurrão/impacto). `restX/restZ` = posição de repouso decidida pelo servidor.
   * Usa ragdoll Rapier quando disponível; senão uma queda procedural simples (mesmo tempo no chão).
   */
  async knockdown(p: RagdollParams & { downMs: number; getupMs: number }) {
    this.ragdoll?.dispose();
    this.ragdoll = null;
    this.fall = { phase: 'down', t: 0, down: p.downMs / 1000, getup: p.getupMs / 1000, captured: [], hipsFrom: new THREE.Vector3() };
    this.fallback = { tilt: 0, dirX: p.dirX, dirZ: p.dirZ };
    try {
      this.ragdoll = await Ragdoll.create(this.rig, p);
    } catch (e) {
      console.warn('[ragdoll] indisponível, usando queda procedural', e);
    }
  }

  /** atualiza queda; retorna true enquanto controla a pose */
  private updateFall(x: number, y: number, z: number, heading: number, dt: number): boolean {
    const f = this.fall;
    if (f.phase === 'none') return false;
    f.t += dt;
    if (f.phase === 'down') {
      this.root.position.set(x, y, z);
      this.root.rotation.y = heading;
      if (this.ragdoll) this.ragdoll.update(dt);
      else {
        // queda procedural: tomba para trás em 0,4 s
        this.fallback.tilt = Math.min(1, this.fallback.tilt + dt * 2.5);
        this.anim.update(0, true, dt);
        this.rig.bones.Hips.rotation.x = -this.fallback.tilt * 1.45;
        this.rig.bones.Hips.position.y *= 1 - this.fallback.tilt * 0.82;
      }
      if (f.t >= f.down) {
        // início do levantar: captura a pose do chão, já re-expressa no novo referencial (posição do servidor)
        this.root.updateMatrixWorld(true);
        const hipsWorld = this.rig.bones.Hips.getWorldPosition(new THREE.Vector3());
        this.root.position.set(x, y, z);
        this.root.updateMatrixWorld(true);
        this.rig.mesh.updateMatrixWorld(true);
        f.hipsFrom = hipsWorld.applyMatrix4(this.rig.mesh.matrixWorld.clone().invert());
        f.captured = BONE_NAMES.map((n) => this.rig.bones[n].quaternion.clone());
        this.ragdoll?.dispose();
        this.ragdoll = null;
        f.phase = 'getup';
        f.t = 0;
      }
      return true;
    }
    // levantar: anima idle e mistura a partir da pose capturada
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    this.anim.update(0, true, dt);
    const k = Math.min(1, f.t / f.getup);
    const e = k * k * (3 - 2 * k);
    BONE_NAMES.forEach((n, i) => { const bone = this.rig.bones[n]; bone.quaternion.copy(f.captured[i].clone().slerp(bone.quaternion, e)); });
    this.rig.bones.Hips.position.lerpVectors(f.hipsFrom, this.rig.bones.Hips.position.clone(), e);
    if (f.t >= f.getup) f.phase = 'none';
    return true;
  }

  /** montado num veículo: posiciona sobre ele e aplica a pose */
  /** animação curta do empurrão (braços à frente) — sobreposta à animação normal */
  private pushT = 0;
  playPush() { this.pushT = 0.45; }

  updateRiding(x: number, y: number, z: number, heading: number, pose: 'sit-pedal' | 'stand' | 'drive', speed: number, seatHeight: number, dt: number) {
    this.smoothY = y;
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    this.anim.updateRiding(pose, speed, seatHeight, dt);
  }

  update(s: PlayerState, dt: number) {
    if (this.updateFall(s.x, s.y, s.z, s.heading, dt)) { this.smoothY = s.y; return; }
    if (!this.initialized) { this.smoothY = s.y; this.initialized = true; }
    this.smoothY += (s.y - this.smoothY) * (1 - Math.exp(-18 * dt));
    if (Math.abs(s.y - this.smoothY) > 0.6) this.smoothY = s.y;
    this.root.position.set(s.x, this.smoothY, s.z);
    this.root.rotation.y = s.heading;
    this.anim.update(s.speed, s.grounded, dt);
    if (this.pushT > 0) {
      this.pushT -= dt;
      const k = Math.sin(Math.min(1, (0.45 - this.pushT) / 0.45) * Math.PI);
      const b = this.rig.bones;
      b.LeftUpperArm.rotation.x = -1.5 * k; b.RightUpperArm.rotation.x = -1.5 * k;
      b.LeftLowerArm.rotation.x = -0.2 * k; b.RightLowerArm.rotation.x = -0.2 * k;
      b.Spine.rotation.x += 0.25 * k;
    }
  }
}
