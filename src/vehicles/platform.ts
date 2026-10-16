/**
 * Plataforma do TRIO ELÉTRICO — geometria e matemática PURAS (servidor valida, cliente prevê e desenha).
 *
 * Referencial LOCAL do veículo (o mesmo do modelo three.js com `rotation.y = heading`):
 *   +z = frente (cabine), +x = lateral esquerda do motorista; origem no centro da carroceria, no chão.
 *   mundo = (x + lx·cos h + lz·sin h,  z − lx·sin h + lz·cos h)
 *
 * Quem está em cima do trio guarda só a posição LOCAL (NetPlayer.platform/plx/plz/plh). O mundo é sempre
 * "transformação do trio × local": quando o trio anda ou vira, os passageiros vão junto sem escorregar.
 */

export type XZ = [number, number];

export interface Pose2D { x: number; z: number; heading: number }

/** dimensões do trio (m) — carroceria, piso, escada, cabine */
export const TRIO = {
  len: 12.6,
  width: 2.6,
  /** altura do piso (deck) acima do chão */
  deckH: 3.4,
  /** cabine na frente (z ∈ [cabZ0, len/2]) — o deck termina antes dela */
  cabZ0: 3.7,
  /** máximo de jogadores em cima */
  capacity: 20,
  /** pé da escada (chão, atrás do trio) — "E — SUBIR NO TRIO" a até `boardRange` daqui */
  ladderFoot: [0, -7.2] as XZ,
  /** topo da escada (no deck) — onde quem sobe aparece */
  ladderTop: [0, -5.6] as XZ,
  boardRange: 2.2,
  /** porta do motorista (lado esquerdo, cabine) — "E — DIRIGIR O TRIO" a até `driveRange` daqui */
  cabDoor: [1.9, 4.9] as XZ,
  driveRange: 2.0,
} as const;

/**
 * Piso onde dá para ficar em pé (polígono local, sentido anti-horário): o deck inteiro menos a folga do guarda-corpo
 * e o recorte da mesa de som (frente-direita). Não convexo de propósito: o teste cobre o caso geral.
 */
export const TRIO_DECK: XZ[] = [
  [-1.0, -5.95],
  [1.0, -5.95],
  [1.0, 3.3],
  [-0.1, 3.3],
  [-0.1, 2.0],
  [-1.0, 2.0],
];

/** pontos sugeridos para NPCs/QA em cima do trio (todos dentro do polígono) */
export const TRIO_STAND_SPOTS: XZ[] = (() => {
  const out: XZ[] = [];
  for (let z = -5.2; z <= 1.6; z += 1.0) for (const x of [-0.55, 0.55]) out.push([x, Math.round(z * 10) / 10]);
  return out;
})();

export function localToWorld(p: Pose2D, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(p.heading), s = Math.sin(p.heading);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

export function worldToLocal(p: Pose2D, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(p.heading), s = Math.sin(p.heading);
  const dx = x - p.x, dz = z - p.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** ponto dentro do polígono (par-ímpar; polígonos simples, convexos ou não) */
export function pointInPolygon(x: number, z: number, poly: readonly XZ[]): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}

/** ponto mais próximo DENTRO do polígono (o próprio ponto se já estiver dentro); `inset` afasta da borda */
export function clampToPolygon(x: number, z: number, poly: readonly XZ[], inset = 0.02): { x: number; z: number; clamped: boolean } {
  if (pointInPolygon(x, z, poly)) return { x, z, clamped: false };
  let bx = x, bz = z, bd = Infinity, nx = 0, nz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [cx, cz] = poly[i];
    const ex = cx - ax, ez = cz - az, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const px = ax + ex * t, pz = az + ez * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; bx = px; bz = pz; nx = px - x; nz = pz - z; }
  }
  // empurra um pouco para dentro (na direção de quem estava fora → borda)
  const l = Math.hypot(nx, nz) || 1;
  let rx = bx + (nx / l) * inset, rz = bz + (nz / l) * inset;
  if (!pointInPolygon(rx, rz, poly)) {
    // canto côncavo: cai no centro de massa mais próximo da borda
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    for (let k = 1; k <= 10 && !pointInPolygon(rx, rz, poly); k++) { rx = bx + (cx - bx) * k * 0.05; rz = bz + (cz - bz) * k * 0.05; }
  }
  return { x: rx, z: rz, clamped: true };
}

/** pode subir? (perto do pé da escada, a pé, de pé, com lugar) */
export function canBoard(
  p: { x: number; z: number; status: number; vehicle: string; platform: string },
  trio: (Pose2D & { kind: string }) | undefined,
  riders: number,
): { ok: true } | { ok: false; reason: string } {
  if (!trio || trio.kind !== 'trio') return { ok: false, reason: 'inexistente' };
  if (p.vehicle) return { ok: false, reason: 'ja_em_veiculo' };
  if (p.platform) return { ok: false, reason: 'ja_em_cima' };
  if (p.status !== 0) return { ok: false, reason: 'estado' };
  if (riders >= TRIO.capacity) return { ok: false, reason: 'lotado' };
  const f = localToWorld(trio, TRIO.ladderFoot[0], TRIO.ladderFoot[1]);
  if (Math.hypot(p.x - f.x, p.z - f.z) > TRIO.boardRange) return { ok: false, reason: 'distancia' };
  return { ok: true };
}

/** distância à porta do motorista (só o trio é dirigido pela cabine; a escada é para subir) */
export function distToCabDoor(px: number, pz: number, trio: Pose2D): number {
  const d = localToWorld(trio, TRIO.cabDoor[0], TRIO.cabDoor[1]);
  return Math.hypot(px - d.x, pz - d.z);
}

/**
 * Movimento LOCAL proposto por quem está em cima (servidor): limita a velocidade e prende ao polígono.
 * `prev`/`next` em coordenadas locais; `dtS` desde a última mensagem aceita.
 */
export function validatePlatformMove(
  prev: { x: number; z: number }, next: { x: number; z: number }, dtS: number, maxSpeed: number, poly: readonly XZ[] = TRIO_DECK,
): { x: number; z: number; ok: boolean; reason?: string } {
  if (!Number.isFinite(next.x) || !Number.isFinite(next.z)) return { ...prev, ok: false, reason: 'invalid' };
  let x = next.x, z = next.z, ok = true, reason: string | undefined;
  const allowed = maxSpeed * Math.max(0.05, Math.min(1.5, dtS)) * 1.35 + 0.4;
  const d = Math.hypot(x - prev.x, z - prev.z);
  if (d > allowed) { const k = allowed / d; x = prev.x + (x - prev.x) * k; z = prev.z + (z - prev.z) * k; ok = false; reason = 'too_fast'; }
  const c = clampToPolygon(x, z, poly);
  if (c.clamped) { ok = false; reason = 'plataforma'; }
  return { x: c.x, z: c.z, ok, reason };
}

/** onde o MOTORISTA desce de um veículo de evento: porta da cabine (esquerda) ou a do outro lado — fora da carroceria */
export function exitPoints(kind: string, v: Pose2D): { x: number; z: number }[] {
  const [dx, dz] = kind === 'trio' ? TRIO.cabDoor : [1.6, 1.0];
  return [localToWorld(v, dx, dz), localToWorld(v, -dx, dz)];
}

/** mensagens de movimento na plataforma: [lx, lz, headingLocal, speed, loco, seq] com 2 casas */
export function packPlatformMove(m: { lx: number; lz: number; lh: number; speed: number; loco: number; seq: number }): number[] {
  const r = (v: number, k = 100) => Math.round(v * k) / k;
  return [r(m.lx), r(m.lz), r(m.lh, 1000), r(m.speed), m.loco, m.seq];
}
export function unpackPlatformMove(a: unknown): { lx: number; lz: number; lh: number; speed: number; loco: number; seq: number } | null {
  if (!Array.isArray(a) || a.length !== 6 || !a.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { lx: a[0], lz: a[1], lh: a[2], speed: a[3], loco: a[4], seq: a[5] };
}
