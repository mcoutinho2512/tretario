/**
 * Câmera em terceira pessoa: segue o jogador com suavização, órbita (yaw/pitch), zoom limitado,
 * colisão com edifícios (raycast na grade de segmentos) e com o chão.
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';

export class ThirdPersonCamera {
  yaw = 0; // 0 = câmera atrás olhando para +Z
  pitch = 0.18;
  distance = 5.2;
  private targetDistance = 5.2;
  private currentDist = 5.2;
  private smoothTarget = new THREE.Vector3();
  private initialized = false;
  minDistance = 2.0;
  maxDistance = 16;

  constructor(readonly camera: THREE.PerspectiveCamera, private world: CollisionWorld) {}

  rotate(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.45, 1.25);
  }

  zoom(delta: number) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * Math.exp(delta), this.minDistance, this.maxDistance);
  }

  /** direção "para frente" no plano (para mover o personagem relativo à câmera) */
  forward(): [number, number] {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  update(target: THREE.Vector3, dt: number) {
    const head = target.clone().add(new THREE.Vector3(0, 1.6, 0));
    if (!this.initialized) { this.smoothTarget.copy(head); this.initialized = true; }
    this.smoothTarget.lerp(head, 1 - Math.exp(-14 * dt));
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-10 * dt));

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp); // do alvo para a câmera
    // deslocamento lateral (ombro) leve
    const right = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const pivot = this.smoothTarget.clone().addScaledVector(right, -0.35);
    const desired = pivot.clone().addScaledVector(dir, this.distance);
    // colisão com edifícios
    const t = this.distance > 20 ? 1 : this.world.raycast(pivot.x, pivot.y, pivot.z, desired.x, desired.y, desired.z);
    let dist = this.distance;
    if (t < 1) dist = Math.max(0.6, this.distance * t - 0.35);
    // aproxima rápido quando obstruída, afasta devagar
    const rate = dist < this.currentDist ? 30 : 4;
    this.currentDist += (dist - this.currentDist) * (1 - Math.exp(-rate * dt));
    const pos = pivot.clone().addScaledVector(dir, this.currentDist);
    // chão
    const g = this.world.groundHeight(pos.x, pos.z) + 0.3;
    if (pos.y < g) pos.y = g;
    this.camera.position.copy(pos);
    this.camera.lookAt(pivot.x, pivot.y + 0.1, pivot.z);
  }
}
