/**
 * Regras autoritativas do servidor que dependem do mundo (puras e testáveis).
 * O cliente nunca atravessa paredes legitimamente (colide com a MESMA geometria — src/physics/walls.ts),
 * então qualquer trajeto que cruze uma parede é tratado como inválido.
 */
import type { WallGrid } from '../physics/walls';
import { validateMove, type MoveMsg } from './protocol';

export interface PathCheck { x: number; z: number; blocked: boolean }

/** Verifica o trajeto from→to contra paredes; veículos usam 3 raios paralelos (largura). */
export function checkPath(walls: WallGrid, from: { x: number; z: number }, to: { x: number; z: number }, mode: string, y = 0.6): PathCheck {
  const dx = to.x - from.x, dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return { x: to.x, z: to.z, blocked: false };
  const offsets = mode === 'car' ? [-0.75, 0, 0.75] : [0];
  const nx = -dz / len, nz = dx / len;
  let tMin = 1;
  for (const o of offsets) {
    const t = walls.raycast(from.x + nx * o, y, from.z + nz * o, to.x + nx * o, y, to.z + nz * o);
    tMin = Math.min(tMin, t);
  }
  if (tMin >= 1) return { x: to.x, z: to.z, blocked: false };
  // para 0,4 m antes da parede
  const k = Math.max(0, tMin - 0.4 / len);
  return { x: from.x + dx * k, z: from.z + dz * k, blocked: true };
}

/** validação completa de um movimento: velocidade/limites (protocolo) + paredes do mundo */
export function validateMoveInWorld(
  walls: WallGrid,
  prev: { x: number; y: number; z: number; t: number },
  msg: MoveMsg,
  now: number,
): { x: number; y: number; z: number; ok: boolean; reason?: string } {
  const r = validateMove(prev, msg, now);
  if (r.reason === 'invalid' || r.reason === 'out_of_bounds') return r;
  const pc = checkPath(walls, prev, r, msg.mode, msg.mode === 'car' ? 0.5 : 0.6);
  if (pc.blocked) return { x: pc.x, y: r.y, z: pc.z, ok: false, reason: 'collision' };
  return r;
}
