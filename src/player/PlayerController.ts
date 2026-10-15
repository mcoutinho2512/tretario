/**
 * Simulação de movimento (determinística dado intent + dt + mundo de colisão).
 * Não conhece câmera, input ou renderização — reutilizável para NPCs e previsão de rede.
 */
import type { PlayerState, MoveIntent } from './PlayerState';
import { PLAYER_CONSTANTS as C } from './PlayerState';
import type { CollisionWorld } from '../physics/CollisionWorld';

export function stepPlayer(s: PlayerState, intent: MoveIntent, dt: number, world: CollisionWorld) {
  const len = Math.hypot(intent.dirX, intent.dirZ);
  const dx = len > 1e-3 ? intent.dirX / Math.max(1, len) : 0;
  const dz = len > 1e-3 ? intent.dirZ / Math.max(1, len) : 0;
  const target = intent.run ? C.runSpeed : C.walkSpeed;
  const tvx = dx * target, tvz = dz * target;
  const control = s.grounded ? 1 : C.airControl;
  const k = 1 - Math.exp(-C.accel * control * dt);
  s.vx += (tvx - s.vx) * k;
  s.vz += (tvz - s.vz) * k;

  // pulo
  if (intent.jump && s.grounded) {
    s.vy = C.jumpVelocity;
    s.grounded = false;
  }
  s.vy -= C.gravity * dt;

  // movimento horizontal por eixo, respeitando degraus e superfícies bloqueadas
  const tryMove = (nx: number, nz: number): boolean => {
    if (world.isBlockedSurface(nx, nz)) return false;
    const g = world.groundHeight(nx, nz);
    if (g - s.y > C.maxStep) return false;
    s.x = nx;
    s.z = nz;
    return true;
  };
  const mx = s.vx * dt, mz = s.vz * dt;
  if (!tryMove(s.x + mx, s.z + mz)) {
    if (!tryMove(s.x + mx, s.z)) s.vx = 0;
    if (!tryMove(s.x, s.z + mz)) s.vz = 0;
  }
  // paredes
  const p = { x: s.x, y: s.y, z: s.z };
  world.resolveCircle(p, C.radius, C.height);
  if (!world.isBlockedSurface(p.x, p.z) && world.groundHeight(p.x, p.z) - s.y <= C.maxStep) {
    s.x = p.x;
    s.z = p.z;
  }

  // vertical
  const ground = world.groundHeight(s.x, s.z);
  s.y += s.vy * dt;
  if (s.y <= ground) {
    s.y = ground;
    s.vy = 0;
    s.grounded = true;
  } else if (s.grounded && s.y - ground < C.maxStep && s.vy <= 0) {
    // descer meio-fio colado ao chão
    s.y = ground;
    s.vy = 0;
  } else {
    s.grounded = s.y - ground < 0.02;
  }

  // direção do corpo segue o movimento
  const speed = Math.hypot(s.vx, s.vz);
  s.speed = speed;
  if (speed > 0.2 && len > 1e-3) {
    const desired = Math.atan2(s.vx, s.vz);
    let d = desired - s.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    s.heading += d * (1 - Math.exp(-C.turnRate * dt));
  }
  s.locomotion = !s.grounded ? 'air' : speed < 0.25 ? 'idle' : speed < (C.walkSpeed + C.runSpeed) / 2 ? 'walk' : 'run';
}
