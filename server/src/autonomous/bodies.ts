/**
 * Rodada 12 — ADAPTADOR FINO de corpos para os autônomos, escrito contra o CONTRATO src/physics/bodies.ts (BODY,
 * BodyIndex, BodyRef). A grade e a resolução abaixo são provisórias:
 * // rodada 12 — trocar pela API do AGENTE A (src/physics/bodyResolve.ts: grade + resolução progressiva)
 * Na integração, `createBodyIndex`/`resolvePenetration` passam a delegar para a implementação do agente A; o resto do
 * sistema de autônomos só conhece a interface.
 */
import { BODY, type BodyIndex, type BodyRef } from '../../../src/physics/bodies';

export { BODY };
export type { BodyIndex, BodyRef };

/** índice reconstruído a cada passo de movimento: humanos + autônomos materializados (corpos a pé) */
export interface MutableBodyIndex extends BodyIndex {
  clear(): void;
  add(b: BodyRef): void;
  readonly size: number;
}

// rodada 12 — trocar pela API do AGENTE A
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
 * penetração entre o corpo `self` e os vizinhos: devolve o deslocamento PROGRESSIVO (≤ BODY.maxPushPerStep) para sair.
 * Só o próprio autônomo se move (humanos são autoridade do próprio movimento validado; corpos `fixed` não cedem).
 */
// rodada 12 — trocar pela API do AGENTE A
export function resolvePenetration(self: BodyRef, near: readonly BodyRef[], out: { x: number; z: number }) {
  let px = 0, pz = 0;
  for (const o of near) {
    if (o.id === self.id) continue;
    const dx = self.x - o.x, dz = self.z - o.z, d = Math.hypot(dx, dz), min = self.r + o.r;
    if (d >= min) continue;
    const pen = min - d;
    if (d < 1e-4) { px += pen; continue; } // empilhados: sai para um lado fixo
    px += (dx / d) * pen; pz += (dz / d) * pen;
  }
  const l = Math.hypot(px, pz);
  const k = l > BODY.maxPushPerStep ? BODY.maxPushPerStep / l : 1;
  out.x = px * k; out.z = pz * k;
  return out;
}
