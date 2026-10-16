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

export class AvatarVisual {
  readonly root = new THREE.Group();
  readonly rig: CharacterRig;
  private anim: CharacterAnimator;
  private smoothY = 0;
  private initialized = false;

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

  /** montado num veículo: posiciona sobre ele e aplica a pose */
  updateRiding(x: number, y: number, z: number, heading: number, pose: 'sit-pedal' | 'stand' | 'drive', speed: number, seatHeight: number, dt: number) {
    this.smoothY = y;
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    this.anim.updateRiding(pose, speed, seatHeight, dt);
  }

  update(s: PlayerState, dt: number) {
    if (!this.initialized) { this.smoothY = s.y; this.initialized = true; }
    this.smoothY += (s.y - this.smoothY) * (1 - Math.exp(-18 * dt));
    if (Math.abs(s.y - this.smoothY) > 0.6) this.smoothY = s.y;
    this.root.position.set(s.x, this.smoothY, s.z);
    this.root.rotation.y = s.heading;
    this.anim.update(s.speed, s.grounded, dt);
  }
}
