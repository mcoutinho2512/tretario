/**
 * Regras de interação física e de veículos — PURAS e testáveis; o servidor é quem as aplica.
 * Conceito: estilizado, sem sangue, sem morte, sem dano permanente (queda → alguns segundos no chão → levanta).
 */
import type { WallGrid } from '../physics/walls';
import { checkPath } from './authority';
import { TRIO, distToCabDoor } from '../vehicles/platform';

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
  /** veículo abandonado longe da vaga volta para ela depois de N ms sem ninguém por perto */
  vehicleResetMs: 300_000,
  vehicleResetAwayM: 15,
  vehicleResetClearM: 25,
  /** folga entre a carroceria e um jogador quando o veículo é bloqueado (modo pacífico) */
  vehicleBlockMargin: 0.45,
} as const;

/** tipos de veículo utilizáveis (servidor e cliente). soundcar/trio = veículos de EVENTO (lentos, nunca atropelam) */
export const VEHICLE_KINDS = ['car', 'moto', 'bicycle', 'scooter', 'soundcar', 'trio'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];
/** carroceria (comprimento × largura, m) por tipo — colisão, entrada, impacto, bloqueio */
export const VEHICLE_BOX: Record<VehicleKind, { len: number; width: number }> = {
  car: { len: 4.4, width: 1.8 }, moto: { len: 2.1, width: 0.8 }, bicycle: { len: 1.8, width: 0.6 }, scooter: { len: 1.2, width: 0.5 },
  soundcar: { len: 5.0, width: 2.0 }, trio: { len: 12.6, width: 2.6 },
};
/** veículos com carroceria (caixa orientada): alcance, bloqueio de quem anda a pé, colisão entre veículos */
export const BOXED_KINDS: ReadonlySet<string> = new Set(['car', 'moto', 'soundcar', 'trio']);
/** veículos de evento: velocidade de cortejo, sempre pacíficos (nunca derrubam ninguém), sólidos para quem anda */
export const EVENT_VEHICLE_KINDS: ReadonlySet<string> = new Set(['soundcar', 'trio']);
/** estado do veículo no servidor */
export const VEHICLE_STATE = { AVAILABLE: 0, OCCUPIED: 1, RESETTING: 2 } as const;

export type Mode = 'pacifico' | 'interacao';
/** estado físico (rodada 9 estende: 3 cambaleando, 4 ragdoll — src/combat/types.ts PHYS) */
export const STATUS = { OK: 0, DOWN: 1, GETUP: 2, STAGGER: 3, RAGDOLL: 4 } as const;

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
  /** id do trio em que está em cima ('' / ausente = no chão) — src/vehicles/platform.ts */
  platform?: string;
}

export type Denial =
  | 'pacifico_atacante' | 'pacifico_alvo' | 'estado' | 'veiculo' | 'distancia' | 'angulo'
  | 'cooldown' | 'spam' | 'imune' | 'obstaculo' | 'alvo_invalido';

/**
 * O empurrão é válido? (servidor) — `consent` (zones.json `combatConsent`): 'both' exige os dois em modo interação;
 * 'none' deixa o modo de fora e a política única (src/combat/policy.ts, CombatSystem.pushPolicy) decide.
 */
export function canPush(a: Actor, t: Actor | undefined, now: number, walls?: WallGrid, consent: 'none' | 'both' = 'both'): { ok: true } | { ok: false; reason: Denial } {
  if (!t || t.id === a.id) return { ok: false, reason: 'alvo_invalido' };
  if (consent === 'both' && a.mode !== 'interacao') return { ok: false, reason: 'pacifico_atacante' };
  if (consent === 'both' && t.mode !== 'interacao') return { ok: false, reason: 'pacifico_alvo' };
  if (a.status !== STATUS.OK || t.status !== STATUS.OK) return { ok: false, reason: 'estado' };
  if (a.vehicle || t.vehicle) return { ok: false, reason: 'veiculo' };
  // em cima do trio ninguém empurra nem é empurrado (queda de 3 m não existe neste jogo)
  if (a.platform || t.platform) return { ok: false, reason: 'veiculo' };
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

/** distância de um ponto à carroceria (caixa orientada) — carros, motos e veículos de evento; bicicletas/patinetes: ao centro */
export function distToVehicle(px: number, pz: number, v: { x: number; z: number; heading?: number; kind?: string }): number {
  if (!v.kind || !BOXED_KINDS.has(v.kind)) return Math.hypot(px - v.x, pz - v.z);
  const b = VEHICLE_BOX[v.kind as VehicleKind];
  const h = v.heading ?? 0, fx = Math.sin(h), fz = Math.cos(h);
  const dx = px - v.x, dz = pz - v.z;
  const along = Math.max(0, Math.abs(dx * fx + dz * fz) - b.len / 2), lat = Math.max(0, Math.abs(dx * fz - dz * fx) - b.width / 2);
  return Math.hypot(along, lat);
}

/**
 * atropelamento: com consentimento 'both' só quando motorista E alvo estão em modo interação (o padrão é pacífico);
 * com 'none' (zones.json `combatConsent`) o modo não conta — zona/proteção/evento vêm da política única
 */
export function impactAllowed(driverMode: Mode, targetMode: Mode, consent: 'none' | 'both' = 'both') {
  return consent === 'none' || (driverMode === 'interacao' && targetMode === 'interacao');
}

/**
 * Bloqueio por jogadores (modo pacífico): o veículo NÃO atravessa nem derruba ninguém — para antes de encostar.
 * Amostra o trajeto prev→next com a carroceria do tipo; devolve a última posição livre.
 * `others` = jogadores a pé que bloqueiam (o servidor passa só os que não permitem impacto).
 */
export function vehicleBlock(
  kind: VehicleKind, prev: { x: number; z: number }, next: { x: number; z: number }, heading: number,
  others: { x: number; z: number }[],
): { x: number; z: number; blocked: boolean } {
  const b = VEHICLE_BOX[kind], m = RULES.vehicleBlockMargin;
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const hit = (cx: number, cz: number) => others.some((o) => {
    const dx = o.x - cx, dz = o.z - cz;
    return Math.abs(dx * fx + dz * fz) < b.len / 2 + m && Math.abs(dx * fz - dz * fx) < b.width / 2 + m;
  });
  if (hit(prev.x, prev.z)) {
    // já encostado: só deixa se AFASTAR (ré / desviar) — nunca avançar sobre a pessoa
    const closer = others.some((o) => Math.hypot(o.x - next.x, o.z - next.z) < Math.hypot(o.x - prev.x, o.z - prev.z) - 1e-3);
    return closer ? { x: prev.x, z: prev.z, blocked: true } : { x: next.x, z: next.z, blocked: false };
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(next.x - prev.x, next.z - prev.z) / 0.25));
  let lx = prev.x, lz = prev.z;
  for (let k = 1; k <= steps; k++) {
    const cx = prev.x + (next.x - prev.x) * (k / steps), cz = prev.z + (next.z - prev.z) * (k / steps);
    if (hit(cx, cz)) return { x: lx, z: lz, blocked: true };
    lx = cx; lz = cz;
  }
  return { x: next.x, z: next.z, blocked: false };
}

/**
 * Empurra um ponto (pessoa a pé, raio `r`) para fora da carroceria de um veículo (caixa orientada).
 * Cliente (colisão local) e servidor (validação) usam a mesma função; devolve null se não havia sobreposição.
 */
export function pushOutOfBox(px: number, pz: number, v: { x: number; z: number; heading: number; kind: string }, r: number): { x: number; z: number } | null {
  const b = VEHICLE_BOX[v.kind as VehicleKind];
  if (!b) return null;
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const dx = px - v.x, dz = pz - v.z;
  const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
  const hx = b.width / 2 + r, hz = b.len / 2 + r;
  if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return null;
  if (hx - Math.abs(lx) < hz - Math.abs(lz)) { const nlx = Math.sign(lx || 1) * hx; return { x: v.x + lz * fx + nlx * fz, z: v.z + lz * fz - nlx * fx }; }
  const nlz = Math.sign(lz || 1) * hz;
  return { x: v.x + nlz * fx + lx * fz, z: v.z + nlz * fz - lx * fx };
}

/** dois veículos se sobrepõem? (caixas orientadas, teste de eixos separadores) — trio/carro de som são sólidos para os outros */
export function boxesOverlap(a: { x: number; z: number; heading: number; kind: string }, b: { x: number; z: number; heading: number; kind: string }, margin = 0): boolean {
  const A = VEHICLE_BOX[a.kind as VehicleKind], B = VEHICLE_BOX[b.kind as VehicleKind];
  if (!A || !B) return false;
  const axes = [[Math.sin(a.heading), Math.cos(a.heading)], [Math.cos(a.heading), -Math.sin(a.heading)], [Math.sin(b.heading), Math.cos(b.heading)], [Math.cos(b.heading), -Math.sin(b.heading)]];
  const half = (box: { len: number; width: number }, h: number, ax: number[]) =>
    (box.len / 2 + margin) * Math.abs(Math.sin(h) * ax[0] + Math.cos(h) * ax[1]) + (box.width / 2 + margin) * Math.abs(Math.cos(h) * ax[0] - Math.sin(h) * ax[1]);
  for (const ax of axes) {
    const d = Math.abs((b.x - a.x) * ax[0] + (b.z - a.z) * ax[1]);
    if (d > half(A, a.heading, ax) + half(B, b.heading, ax)) return false;
  }
  return true;
}

/** veículo abandonado longe da vaga, sem ninguém por perto há tempo suficiente → volta para a vaga */
export function shouldResetVehicle(
  v: { occupant: string; x: number; z: number; spawnX: number; spawnZ: number; idleSince: number },
  now: number, nearestPlayerM: number, resetMs: number = RULES.vehicleResetMs,
): boolean {
  if (v.occupant) return false;
  if (Math.hypot(v.x - v.spawnX, v.z - v.spawnZ) < RULES.vehicleResetAwayM) return false;
  if (nearestPlayerM < RULES.vehicleResetClearM) return false;
  return now - v.idleSince >= resetMs;
}

/** Pode entrar no veículo? */
export function canEnter(p: { x: number; z: number; status: number; vehicle: string }, v: { x: number; z: number; occupant: string; heading?: number; kind?: string } | undefined) {
  if (!v) return { ok: false as const, reason: 'inexistente' };
  if (v.occupant) return { ok: false as const, reason: 'ocupado' };
  if (p.vehicle) return { ok: false as const, reason: 'ja_em_veiculo' };
  if (p.status !== STATUS.OK) return { ok: false as const, reason: 'estado' };
  const range = v.kind === 'car' || v.kind === 'soundcar' ? RULES.enterRangeCar : v.kind === 'moto' ? 1.6 : RULES.enterRange;
  // trio: o motorista entra pela porta da cabine (a escada de trás é para SUBIR no trio, não dirigir)
  if (v.kind === 'trio') {
    if (distToCabDoor(p.x, p.z, { x: v.x, z: v.z, heading: v.heading ?? 0 }) > TRIO.driveRange) return { ok: false as const, reason: 'distancia' };
  } else if (distToVehicle(p.x, p.z, v) > range) return { ok: false as const, reason: 'distancia' };
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
