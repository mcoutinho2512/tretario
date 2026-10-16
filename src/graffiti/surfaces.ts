/**
 * Superfícies AUTORIZADAS para pichação/grafite — módulo PURO (sem three/DOM), compartilhado por cliente,
 * servidor e pipeline. Só se pinta onde há uma superfície destas (nunca em malha arbitrária): fachadas no nível
 * da rua voltadas para a avenida, tapumes e algumas áreas de chão. Dados em public/world/graffiti_surfaces.json
 * (gerado por tools/build_graffiti_surfaces.ts; ver docs/GRAFFITI.md).
 *
 * Plano: origem `o` (canto inferior-esquerdo, mundo), eixos unitários `u` (largura) e `v` (altura) e tamanho
 * `w × h` em metros. A normal (lado pintável) é u × v. Coordenadas locais (s, t) ∈ [0, w] × [0, h].
 */

export type V3 = [number, number, number];

/** wall = fachada · tapume = painel de obra · mural = painel autorizado (permanente) · ground = chão */
export type SurfaceKind = 'wall' | 'tapume' | 'mural' | 'ground';
/** permanent: autorizado, sem prazo (só moderação remove) · temporary: da manifestação, expira (TTL) */
export type SurfacePersistence = 'permanent' | 'temporary';

export interface GraffitiSurface {
  id: string;
  kind: SurfaceKind;
  persistence: SurfacePersistence;
  o: V3;
  u: V3;
  v: V3;
  w: number;
  h: number;
  /** máximo de grafites simultâneos nesta superfície */
  max: number;
  /** TTL próprio (ms) — temporárias; ausente = padrão do servidor (PV_GRAFFITI_TTL_MS). 0 = permanente */
  ttlMs?: number;
}

/** sólidos renderizados pelo cliente e com colisão nos dois lados (tapumes): caixa orientada */
export interface GraffitiSolid {
  id: string;
  kind: 'tapume';
  /** centro da base (x, z), rumo do eixo longo (rad, atan2(dx, dz)), dimensões */
  x: number; z: number; heading: number; len: number; thick: number; height: number;
}

export interface GraffitiSurfaceFile {
  version: 1;
  surfaces: GraffitiSurface[];
  solids: GraffitiSolid[];
}

/** retângulo de um grafite na superfície (metros, coordenadas locais do plano: canto inferior-esquerdo + tamanho) */
export interface GraffitiRect { s: number; t: number; w: number; h: number }

export const normalOf = (sf: GraffitiSurface): V3 => {
  const [ux, uy, uz] = sf.u, [vx, vy, vz] = sf.v;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
};

/** ponto do mundo para (s, t) da superfície */
export function surfacePoint(sf: GraffitiSurface, s: number, t: number, lift = 0): V3 {
  const n = lift ? normalOf(sf) : [0, 0, 0];
  return [
    sf.o[0] + sf.u[0] * s + sf.v[0] * t + n[0] * lift,
    sf.o[1] + sf.u[1] * s + sf.v[1] * t + n[1] * lift,
    sf.o[2] + sf.u[2] * s + sf.v[2] * t + n[2] * lift,
  ];
}

/** centro da superfície no plano XZ (índice espacial) */
export function surfaceCenter(sf: GraffitiSurface): { x: number; z: number } {
  const p = surfacePoint(sf, sf.w / 2, sf.h / 2);
  return { x: p[0], z: p[2] };
}

/** raio (XZ) que envolve a superfície a partir do centro */
export const surfaceRadius = (sf: GraffitiSurface) => Math.hypot(sf.w * Math.hypot(sf.u[0], sf.u[2]), sf.h * Math.hypot(sf.v[0], sf.v[2])) / 2;

/**
 * Distância horizontal (XZ) de (x, z) ao retângulo da superfície (ou a uma parte dela) e lado.
 * `front` = o jogador está do lado pintável (paredes) — o servidor exige isso além da distância.
 */
export function distanceToSurface(sf: GraffitiSurface, x: number, z: number, rect?: GraffitiRect): { d: number; front: boolean; s: number; t: number } {
  const dx = x - sf.o[0], dz = z - sf.o[2];
  const uxz = sf.u[0] * sf.u[0] + sf.u[2] * sf.u[2];
  const vxz = sf.v[0] * sf.v[0] + sf.v[2] * sf.v[2];
  // coordenadas locais da projeção (o plano das paredes é vertical: só `s` vem do XZ; o chão usa s e t)
  const s = uxz > 1e-6 ? (dx * sf.u[0] + dz * sf.u[2]) / uxz : 0;
  const t = vxz > 1e-6 ? (dx * sf.v[0] + dz * sf.v[2]) / vxz : 0;
  const s0 = rect ? rect.s : 0, s1 = rect ? rect.s + rect.w : sf.w;
  const t0 = rect ? rect.t : 0, t1 = rect ? rect.t + rect.h : sf.h;
  const cs = Math.max(s0, Math.min(s1, s));
  const ct = vxz > 1e-6 ? Math.max(t0, Math.min(t1, t)) : t0;
  const p = surfacePoint(sf, cs, ct);
  const n = normalOf(sf);
  const front = sf.kind === 'ground' ? true : (x - p[0]) * n[0] + (z - p[2]) * n[2] > -0.05;
  return { d: Math.hypot(x - p[0], z - p[2]), front, s, t };
}

/** tamanhos de grafite (m): pequeno, médio, grande — a proporção é sempre 2:1 (mesma do tile de textura) */
export const GRAFFITI_SIZES = [1.0, 1.6, 2.2] as const;

/**
 * Onde o grafite fica: centrado na projeção do jogador, à altura dos olhos (paredes) ou à frente dele (chão),
 * dentro da superfície. Null se não cabe.
 */
export function placeRect(sf: GraffitiSurface, x: number, z: number, heading: number, width: number): GraffitiRect | null {
  let w = Math.min(width, sf.w), h = w / 2;
  if (h > sf.h) { h = sf.h; w = h * 2; }
  if (w < 0.3) return null;
  let cs: number, ct: number;
  if (sf.kind === 'ground') {
    const fx = x + Math.sin(heading) * 1.6, fz = z + Math.cos(heading) * 1.6;
    const p = distanceToSurface(sf, fx, fz);
    cs = p.s; ct = p.t;
  } else {
    cs = distanceToSurface(sf, x, z).s;
    ct = Math.min(sf.h - h / 2, Math.max(h / 2, 1.45 - sf.o[1])); // centro ~1,45 m do chão
  }
  const s = Math.max(0, Math.min(sf.w - w, cs - w / 2));
  const t = Math.max(0, Math.min(sf.h - h, ct - h / 2));
  return { s: round2(s), t: round2(t), w: round2(w), h: round2(h) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function rectInside(sf: GraffitiSurface, r: GraffitiRect, eps = 0.02): boolean {
  return [r.s, r.t, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0 && r.s >= -eps && r.t >= -eps && r.s + r.w <= sf.w + eps && r.t + r.h <= sf.h + eps;
}

/** superfície mais próxima a ≤ maxDist (cliente: prompt "E — PICHAR"); lista pequena → varredura linear basta */
export function nearestSurface(list: readonly GraffitiSurface[], x: number, z: number, maxDist: number): GraffitiSurface | null {
  let best: GraffitiSurface | null = null, bd = maxDist;
  for (const sf of list) {
    const c = sf.o;
    if (Math.abs(c[0] - x) > 40 && Math.abs(c[2] - z) > 40) continue;
    const r = distanceToSurface(sf, x, z);
    if (r.front && r.d <= bd) { bd = r.d; best = sf; }
  }
  return best;
}

/** cantos (XZ) de um sólido (tapume) — colisão no cliente e no servidor */
export function solidRing(b: GraffitiSolid): [number, number][] {
  const fx = Math.sin(b.heading), fz = Math.cos(b.heading), hl = b.len / 2, hw = b.thick / 2;
  return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([a, l]) => [b.x + fx * a + fz * l, b.z + fz * a - fx * l]);
}

export function parseSurfaceFile(raw: unknown): GraffitiSurfaceFile {
  const f = raw as Partial<GraffitiSurfaceFile>;
  return { version: 1, surfaces: Array.isArray(f?.surfaces) ? f.surfaces : [], solids: Array.isArray(f?.solids) ? f.solids : [] };
}
