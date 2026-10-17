/**
 * Espectador (rodada 8) — limites e protocolo PUROS, compartilhados por cliente (câmera) e servidor (área de
 * interesse). O espectador não tem corpo: só manda a posição da câmera (`spec_cam {x, z}`) em baixa frequência;
 * o servidor limita aos limites do mapa e à taxa abaixo antes de usar como centro da área de interesse.
 */
export type Bounds = readonly [number, number, number, number]; // [minX, minZ, maxX, maxZ] (manifest.bounds)

export const SPECTATOR = {
  /** margem interna dos limites do mapa (m): a câmera não sai do mundo construído */
  margin: 60,
  /** altitude da câmera (m acima do chão): mínimo (rente à multidão) e máximo (aérea) */
  minAlt: 4,
  maxAlt: 260,
  /** distância da câmera ao foco (m) */
  minDist: 8,
  maxDist: 320,
  /** cliente: envio de spec_cam (Hz) e deslocamento mínimo para reenviar antes do intervalo de manutenção */
  sendHz: 2,
  sendMinMoveM: 6,
  keepAliveMs: 3000,
  /** servidor: intervalo mínimo entre spec_cam aceitos (ms) — o excesso é ignorado */
  serverMinIntervalMs: 200,
} as const;

export function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }

/** ponto (x, z) preso aos limites do mapa (com margem) */
export function clampToBounds(x: number, z: number, b: Bounds, margin: number = SPECTATOR.margin): { x: number; z: number } {
  const [x0, z0, x1, z1] = b;
  const mx = Math.min(margin, (x1 - x0) / 2), mz = Math.min(margin, (z1 - z0) / 2);
  return { x: clamp(x, x0 + mx, x1 - mx), z: clamp(z, z0 + mz, z1 - mz) };
}

/** valida a mensagem spec_cam do cliente: números finitos → preso aos limites; senão null (descartada) */
export function sanitizeSpecCam(raw: unknown, b: Bounds): { x: number; z: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, z } = raw as { x?: unknown; z?: unknown };
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return clampToBounds(x, z, b);
}

/** limitação de taxa simples por conexão: aceita se passou o intervalo mínimo desde o último aceito */
export function rateOk(lastAcceptedAt: number, now: number, minIntervalMs: number = SPECTATOR.serverMinIntervalMs): boolean {
  return now - lastAcceptedAt >= minIntervalMs;
}

/** pose da câmera livre limitada: foco no chão + órbita; tudo preso aos limites e à faixa de altitude */
export interface SpecPose { x: number; z: number; yaw: number; pitch: number; dist: number }

/** pitch: 0,12 rad (quase horizontal) a 1,45 rad (quase vertical) */
export const PITCH_RANGE = [0.12, 1.45] as const;

export function clampPose(p: SpecPose, b: Bounds): SpecPose {
  const f = clampToBounds(p.x, p.z, b);
  const pitch = clamp(p.pitch, PITCH_RANGE[0], PITCH_RANGE[1]);
  let dist = clamp(p.dist, SPECTATOR.minDist, SPECTATOR.maxDist);
  // altitude = sen(pitch) × distância (acima do foco): fora da faixa, ajusta a distância
  const s = Math.sin(pitch);
  if (s * dist > SPECTATOR.maxAlt) dist = SPECTATOR.maxAlt / s;
  if (s * dist < SPECTATOR.minAlt) dist = Math.min(SPECTATOR.maxDist, SPECTATOR.minAlt / s);
  // a própria câmera também fica dentro do mapa: encurta a órbita até caber
  const out: SpecPose = { x: f.x, z: f.z, yaw: p.yaw, pitch, dist };
  for (let i = 0; i < 24 && !insideBounds(poseToCamera(out), b) && out.dist > SPECTATOR.minDist; i++) out.dist = Math.max(SPECTATOR.minDist, out.dist * 0.85);
  return out;
}

export function insideBounds(p: { x: number; z: number }, b: Bounds): boolean {
  return p.x >= b[0] && p.x <= b[2] && p.z >= b[1] && p.z <= b[3];
}

/** posição da câmera de uma pose (y relativo ao chão do foco) */
export function poseToCamera(p: SpecPose): { x: number; y: number; z: number } {
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  return { x: p.x - Math.sin(p.yaw) * cp * p.dist, y: sp * p.dist, z: p.z - Math.cos(p.yaw) * cp * p.dist };
}
