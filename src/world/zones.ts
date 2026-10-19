/**
 * Zonas / trechos da Presidente Vargas (rodada 8): regiões do MESMO mundo (não instâncias). Definidas por DADOS
 * (`public/world/zones.json`): faixas ao longo do eixo da avenida (fração 0 = Central → 1 = Candelária) e
 * largura lateral. Usadas pelo aviso discreto "CAMPO DE SANTANA", pelo minimapa e, na rodada 9, por missões.
 */
export type ZoneId = 'CENTRAL' | 'CAMPO_DE_SANTANA' | 'CENTRO' | 'RIO_BRANCO' | 'CANDELARIA' | (string & {});

export interface ZoneDefinition {
  id: ZoneId;
  /** nome exibido */
  name: string;
  /** trecho do eixo pvAxis (frações do comprimento, 0 = início do eixo) */
  from: number;
  to: number;
  /** meia-largura (m) para dentro da zona a partir do eixo */
  halfWidth: number;
  /** ponto de câmera (espectador) e marcador do minimapa: fração do eixo + deslocamento lateral (m) */
  anchor?: { t: number; side: number };
  /** rodada 9 — política de confronto da zona (src/combat/policy.ts); ausente = 'COMBAT' (rodada 12: não há zona de paz) */
  combatPolicy?: import('../combat/policy').ZoneCombatPolicy;
}

type XZ = [number, number];

/** projeta (x, z) no eixo: fração ao longo dele (0..1) e distância lateral */
export function projectOnAxis(axis: XZ[], x: number, z: number): { t: number; dist: number } {
  let total = 0;
  const seg: number[] = [];
  for (let i = 0; i < axis.length - 1; i++) { const l = Math.hypot(axis[i + 1][0] - axis[i][0], axis[i + 1][1] - axis[i][1]); seg.push(l); total += l; }
  let best = { t: 0, dist: Infinity }, acc = 0;
  for (let i = 0; i < axis.length - 1; i++) {
    const [ax, az] = axis[i], [bx, bz] = axis[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
    if (d < best.dist) best = { t: (acc + seg[i] * u) / (total || 1), dist: d };
    acc += seg[i];
  }
  return best;
}

/** ponto do eixo numa fração t (e deslocamento lateral, m, à esquerda do sentido do eixo) */
export function pointOnAxis(axis: XZ[], t: number, side = 0): { x: number; z: number; heading: number } {
  let total = 0;
  const seg: number[] = [];
  for (let i = 0; i < axis.length - 1; i++) { const l = Math.hypot(axis[i + 1][0] - axis[i][0], axis[i + 1][1] - axis[i][1]); seg.push(l); total += l; }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const [ax, az] = axis[i], [bx, bz] = axis[i + 1];
      const u = seg[i] ? Math.min(1, want / seg[i]) : 0;
      const dx = (bx - ax) / (seg[i] || 1), dz = (bz - az) / (seg[i] || 1);
      return { x: ax + (bx - ax) * u - dz * side, z: az + (bz - az) * u + dx * side, heading: Math.atan2(dx, dz) };
    }
    want -= seg[i];
  }
  return { x: axis[0][0], z: axis[0][1], heading: 0 };
}

/** zona em (x, z) — a primeira que contém (ordem dos dados) ou null fora de todas */
export function zoneAt(zones: readonly ZoneDefinition[], axis: XZ[], x: number, z: number): ZoneDefinition | null {
  const p = projectOnAxis(axis, x, z);
  for (const zn of zones) if (p.t >= zn.from && p.t <= zn.to && p.dist <= zn.halfWidth) return zn;
  return null;
}
