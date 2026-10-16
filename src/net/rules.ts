/**
 * Regras de interação física e de veículos — PURAS e testáveis; o servidor é quem as aplica.
 * Conceito: estilizado, sem sangue, sem morte, sem dano permanente (queda → alguns segundos no chão → levanta).
 */
import type { WallGrid } from '../physics/walls';
import { checkPath } from './authority';

export const RULES = {
  pushRange: 1.9, // m (centro a centro)
  pushAngleDeg: 75, // alvo dentro deste ângulo da frente do atacante
  pushCooldownMs: 1000,
  rateWindowMs: 15000, // anti-spam: no máximo N ações por janela
  rateMax: 6,
  pushDistance: 1.8, // deslocamento do alvo
  downMs: 2600, // tempo no chão
  getupMs: 1400, // animação de levantar
  immuneMs: 5000, // proteção anti-griefing após levantar
  enterRange: 3.5, // distância máxima (ao centro) para montar em bicicleta/patinete
  enterRangeCar: 2.2, // distância máxima à CARROCERIA para entrar num carro
  impactMinSpeed: 2.5, // m/s
} as const;

export type Mode = 'pacifico' | 'interacao';
export const STATUS = { OK: 0, DOWN: 1, GETUP: 2 } as const;

export interface Actor {
  id: string;
  x: number; z: number; heading: number;
  mode: Mode;
  status: number;
  vehicle: string;
  immuneUntil: number;
  lastActionAt: number;
  actionTimes: number[];
  /** instante da última queda (servidor) */
  lastDown?: number;
}

export type Denial =
  | 'pacifico_atacante' | 'pacifico_alvo' | 'estado' | 'veiculo' | 'distancia' | 'angulo'
  | 'cooldown' | 'spam' | 'imune' | 'obstaculo' | 'alvo_invalido';

/** O empurrão é válido? (servidor) */
export function canPush(a: Actor, t: Actor | undefined, now: number, walls?: WallGrid): { ok: true } | { ok: false; reason: Denial } {
  if (!t || t.id === a.id) return { ok: false, reason: 'alvo_invalido' };
  if (a.mode !== 'interacao') return { ok: false, reason: 'pacifico_atacante' };
  if (t.mode !== 'interacao') return { ok: false, reason: 'pacifico_alvo' };
  if (a.status !== STATUS.OK || t.status !== STATUS.OK) return { ok: false, reason: 'estado' };
  if (a.vehicle || t.vehicle) return { ok: false, reason: 'veiculo' };
  if (now - a.lastActionAt < RULES.pushCooldownMs) return { ok: false, reason: 'cooldown' };
  const recent = a.actionTimes.filter((x) => now - x < RULES.rateWindowMs);
  if (recent.length >= RULES.rateMax) return { ok: false, reason: 'spam' };
  if (now < t.immuneUntil) return { ok: false, reason: 'imune' };
  const dx = t.x - a.x, dz = t.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d > RULES.pushRange) return { ok: false, reason: 'distancia' };
  if (d > 0.05) {
    const cos = (dx * Math.sin(a.heading) + dz * Math.cos(a.heading)) / d;
    if (cos < Math.cos((RULES.pushAngleDeg * Math.PI) / 180)) return { ok: false, reason: 'angulo' };
  }
  if (walls && walls.raycast(a.x, 1, a.z, t.x, 1, t.z) < 1) return { ok: false, reason: 'obstaculo' };
  return { ok: true };
}

/** Resultado físico autoritativo de uma queda: direção, posição de repouso (limitada por paredes). */
export function knockdownOutcome(from: { x: number; z: number }, target: { x: number; z: number }, distance: number, walls?: WallGrid, fallbackHeading = 0) {
  let dx = target.x - from.x, dz = target.z - from.z;
  let l = Math.hypot(dx, dz);
  if (l < 0.05) { dx = Math.sin(fallbackHeading); dz = Math.cos(fallbackHeading); l = 1; }
  dx /= l; dz /= l;
  const to = { x: target.x + dx * distance, z: target.z + dz * distance };
  const r = walls ? checkPath(walls, target, to, 'foot', 0.6) : { x: to.x, z: to.z, blocked: false };
  return { dx, dz, rx: r.x, rz: r.z };
}

/** Impacto veículo → avatar: alvo dentro da caixa do carro (ou do trajeto) e velocidade suficiente. */
export function vehicleImpact(
  car: { x: number; z: number; px: number; pz: number; heading: number; speed: number; len?: number; width?: number },
  t: { x: number; z: number },
): { hit: boolean; strength: number } {
  if (car.speed < RULES.impactMinSpeed) return { hit: false, strength: 0 };
  const len = car.len ?? 4.4, width = car.width ?? 1.8;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  // amostra o trajeto (anti-tunelamento em alta velocidade)
  for (let k = 0; k <= 4; k++) {
    const cx = car.px + (car.x - car.px) * (k / 4), cz = car.pz + (car.z - car.pz) * (k / 4);
    const dx = t.x - cx, dz = t.z - cz;
    const along = dx * fx + dz * fz, lat = dx * fz - dz * fx;
    if (Math.abs(along) < len / 2 + 0.35 && Math.abs(lat) < width / 2 + 0.35) {
      // queda moderada, proporcional à velocidade (sem "pontuação", sem dano)
      return { hit: true, strength: Math.min(6, Math.max(1.6, car.speed * 0.45)) };
    }
  }
  return { hit: false, strength: 0 };
}

/** distância de um ponto à carroceria (caixa orientada) — carros; bicicletas/patinetes: ao centro */
export function distToVehicle(px: number, pz: number, v: { x: number; z: number; heading?: number; kind?: string }): number {
  if (v.kind !== 'car') return Math.hypot(px - v.x, pz - v.z);
  const h = v.heading ?? 0, fx = Math.sin(h), fz = Math.cos(h);
  const dx = px - v.x, dz = pz - v.z;
  const along = Math.max(0, Math.abs(dx * fx + dz * fz) - 2.2), lat = Math.max(0, Math.abs(dx * fz - dz * fx) - 0.9);
  return Math.hypot(along, lat);
}

/** Pode entrar no veículo? */
export function canEnter(p: { x: number; z: number; status: number; vehicle: string }, v: { x: number; z: number; occupant: string; heading?: number; kind?: string } | undefined) {
  if (!v) return { ok: false as const, reason: 'inexistente' };
  if (v.occupant) return { ok: false as const, reason: 'ocupado' };
  if (p.vehicle) return { ok: false as const, reason: 'ja_em_veiculo' };
  if (p.status !== STATUS.OK) return { ok: false as const, reason: 'estado' };
  if (distToVehicle(p.x, p.z, v) > (v.kind === 'car' ? RULES.enterRangeCar : RULES.enterRange)) return { ok: false as const, reason: 'distancia' };
  return { ok: true as const };
}

/** mensagens de movimento compactas: [x, y, z, heading, speed, loco, seq] com 2 casas */
export function packMove(m: { x: number; y: number; z: number; heading: number; speed: number; loco: number; seq: number }): number[] {
  const r = (v: number, k = 100) => Math.round(v * k) / k;
  return [r(m.x), r(m.y), r(m.z), r(m.heading, 1000), r(m.speed), m.loco, m.seq];
}
export function unpackMove(a: unknown): { x: number; y: number; z: number; heading: number; speed: number; loco: number; seq: number } | null {
  if (!Array.isArray(a) || a.length !== 7 || !a.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { x: a[0], y: a[1], z: a[2], heading: a[3], speed: a[4], loco: a[5], seq: a[6] };
}
