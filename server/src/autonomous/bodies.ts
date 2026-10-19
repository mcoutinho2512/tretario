/**
 * Rodada 12 — ADAPTADOR FINO de corpos para os autônomos, escrito contra o CONTRATO src/physics/bodies.ts (BODY,
 * BodyIndex, BodyRef). A COLISÃO é a do agente A: `constrainStep` = constrainMove (src/physics/bodyResolve.ts) e, na
 * sala, room.bodies.grid + resolveAutonomous + sync (server/src/collision/RoomBodies.ts). A grade abaixo é só a
 * PERCEPÇÃO do desvio (vizinhos com velocidade para antecipar), reconstruída pelo próprio sistema.
 */
import { BODY, type BodyIndex, type BodyRef } from '../../../src/physics/bodies';
import { constrainMove } from '../../../src/physics/bodyResolve';

export { BODY };
export type { BodyIndex, BodyRef };

/** índice reconstruído a cada passo de movimento: humanos + autônomos materializados (corpos a pé) */
export interface MutableBodyIndex extends BodyIndex {
  clear(): void;
  add(b: BodyRef): void;
  readonly size: number;
}

export function createBodyIndex(cell = 4): MutableBodyIndex {
  const cells = new Map<number, BodyRef[]>();
  const pool: BodyRef[][] = [];
  let n = 0;
  const key = (cx: number, cz: number) => ((cx + 4096) << 13) | (cz + 4096);
  return {
    get size() { return n; },
    clear() { for (const a of cells.values()) { a.length = 0; pool.push(a); } cells.clear(); n = 0; },
    add(b) {
      const k = key(Math.floor(b.x / cell), Math.floor(b.z / cell));
      let a = cells.get(k);
      if (!a) { a = pool.pop() ?? []; cells.set(k, a); }
      a.push(b); n++;
    },
    near(x, z, r, out) {
      out.length = 0;
      const c0 = Math.floor((x - r) / cell), c1 = Math.floor((x + r) / cell), d0 = Math.floor((z - r) / cell), d1 = Math.floor((z + r) / cell);
      const r2 = r * r;
      for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
        const a = cells.get(key(cx, cz));
        if (a) for (const b of a) { const dx = b.x - x, dz = b.z - z; if (dx * dx + dz * dz <= r2) out.push(b); }
      }
      return out;
    },
  };
}

/**
 * passo de UM autônomo entre os vizinhos: a função PURA do agente A (src/physics/bodyResolve.ts constrainMove) —
 * ninguém termina mais perto de um vizinho que o contato, desliza em volta, sobreposição antiga sai devagar. A sala
 * aplica a mesma função contra a grade autoritativa (room.bodies.grid) e resolve os autônomos com resolveAutonomous.
 */
export function constrainStep(id: string, fromX: number, fromZ: number, toX: number, toZ: number, near: readonly BodyRef[], dt: number): { x: number; z: number; blocked: boolean } {
  const r = constrainMove(id, BODY.radius, fromX, fromZ, toX, toZ, near, dt);
  return { x: r.x, z: r.z, blocked: r.blocked };
}
