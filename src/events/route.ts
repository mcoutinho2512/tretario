/**
 * Geometria de rotas de eventos (rodada 9) — pura. WorldPoint ({x,z} ou fração do eixo da avenida) → mundo; rota da
 * caminhada como polilinha que SEGUE o eixo entre checkpoints dados em fração (a avenida faz curvas: uma reta entre
 * checkpoints distantes atravessaria quarteirões); cruzamento de checkpoint por segmento (corrida).
 */
import { pointOnAxis } from '../world/zones';
import type { WorldPoint } from './schedule';

type XZ = [number, number];
export interface P2 { x: number; z: number }

export function resolvePoint(axis: readonly XZ[], p: WorldPoint): P2 {
  if ('x' in p) return { x: p.x, z: p.z };
  const q = pointOnAxis(axis as XZ[], p.t, p.side ?? 0);
  return { x: q.x, z: q.z };
}

/** polilinha da rota: entre dois pontos de eixo, amostra o eixo a cada `stepT`; senão, reta */
export function routePolyline(axis: readonly XZ[], pts: readonly WorldPoint[], stepT = 0.004): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (i === 0) { out.push(resolvePoint(axis, a)); continue; }
    const b = pts[i - 1];
    if (!('x' in a) && !('x' in b)) {
      const n = Math.max(1, Math.ceil(Math.abs(a.t - b.t) / stepT));
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        const q = pointOnAxis(axis as XZ[], b.t + (a.t - b.t) * u, (b.side ?? 0) + ((a.side ?? 0) - (b.side ?? 0)) * u);
        out.push({ x: q.x, z: q.z });
      }
    } else out.push(resolvePoint(axis, a));
  }
  return out;
}

/** comprimentos acumulados da polilinha */
export function cumulative(poly: readonly P2[]): number[] {
  const c = [0];
  for (let i = 1; i < poly.length; i++) c.push(c[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].z - poly[i - 1].z));
  return c;
}

/** ponto a `d` metros do início da polilinha */
export function alongPolyline(poly: readonly P2[], cum: readonly number[], d: number): P2 {
  if (poly.length < 2) return poly[0] ?? { x: 0, z: 0 };
  const L = cum[cum.length - 1];
  const dd = Math.max(0, Math.min(L, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < dd) i++;
  const seg = cum[i] - cum[i - 1] || 1, u = (dd - cum[i - 1]) / seg;
  return { x: poly[i - 1].x + (poly[i].x - poly[i - 1].x) * u, z: poly[i - 1].z + (poly[i].z - poly[i - 1].z) * u };
}

/** o segmento a→b passa a ≤ r do centro c? (checkpoint atravessado entre dois movimentos aceitos) */
export function segmentHitsCircle(a: P2, b: P2, c: P2, r: number): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const u = l2 > 1e-9 ? Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(a.x + dx * u - c.x, a.z + dz * u - c.z) <= r;
}
