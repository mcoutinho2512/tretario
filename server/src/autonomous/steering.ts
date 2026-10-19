/**
 * Rodada 12 — MOVIMENTO HUMANO dos autônomos (puro, testável). Aceleração/desaceleração, curva com taxa limitada,
 * chegada desacelerando, ANTECIPAÇÃO (ponto de maior aproximação pela velocidade relativa), espaço pessoal, desvio
 * lateral SUAVIZADO (filtro passa-baixa + lado mantido por um tempo: sem zig-zag) e espera quando alguém parado
 * bloqueia a frente. Convenção de rumo do jogo: frente = (sin h, cos h).
 */
import { BODY, type BodyRef } from './bodies';

/** vizinho com velocidade (humanos e autônomos) */
export interface NeighborRef extends BodyRef { vx: number; vz: number }

export interface Kin {
  x: number; z: number; heading: number; speed: number;
  /** desvio lateral filtrado */
  avX: number; avZ: number;
  /** lado escolhido para desviar (+1 esquerda, -1 direita) e até quando vale */
  side: number; sideUntil: number;
  /** parado esperando passagem desde (ms; 0 = não) */
  waitSince: number;
}
export interface SteerParams {
  cruise: number; accel: number; decel: number; turnRate: number;
  /** espaço pessoal (m, centro a centro) */
  space: number;
  arriveR: number; dt: number; now: number; selfId: string;
}
export interface SteerOut { x: number; z: number; dist: number; avoiding: boolean; waiting: boolean; arrived: boolean }

export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const headingTo = (dx: number, dz: number) => Math.atan2(dx, dz);

export function makeKin(x: number, z: number, heading: number): Kin { return { x, z, heading, speed: 0, avX: 0, avZ: 0, side: 1, sideUntil: 0, waitSince: 0 }; }

/** um passo em direção a (tx, tz) — muda `k` (rumo/velocidade/desvio) e devolve a posição proposta */
export function steer(k: Kin, tx: number, tz: number, p: SteerParams, near: readonly NeighborRef[]): SteerOut {
  const dx = tx - k.x, dz = tz - k.z, dist = Math.hypot(dx, dz);
  const dirX = dist > 1e-3 ? dx / dist : Math.sin(k.heading), dirZ = dist > 1e-3 ? dz / dist : Math.cos(k.heading);
  const perpX = -dirZ, perpZ = dirX; // esquerda
  const myVx = Math.sin(k.heading) * k.speed, myVz = Math.cos(k.heading) * k.speed;
  const look = 1.6 + k.speed * 1.2;
  let ax = 0, az = 0, wSum = 0, sideVote = 0, block = false;
  for (const o of near) {
    if (o.id === p.selfId) continue;
    const rx = o.x - k.x, rz = o.z - k.z, d = Math.hypot(rx, rz);
    if (d > look + o.r) continue;
    const along = rx * dirX + rz * dirZ;
    // atrás de mim e sem encostar: não importa
    if (along < -0.2 && d > BODY.radius + o.r + 0.05) continue;
    // antecipação: maior aproximação nos próximos 2 s pela velocidade relativa
    const rvx = o.vx - myVx, rvz = o.vz - myVz, rv2 = rvx * rvx + rvz * rvz;
    const t = rv2 > 1e-4 ? Math.max(0, Math.min(2, -(rx * rvx + rz * rvz) / rv2)) : 0;
    const cx = rx + rvx * t, cz = rz + rvz * t, dmin = Math.hypot(cx, cz);
    const need = p.space + (o.r - BODY.radius);
    if (dmin >= need) continue;
    const w = ((need - dmin) / need) * (1 - t / 2.4);
    const lat = rx * perpX + rz * perpZ; // >0: o outro está à minha esquerda
    sideVote += lat > 0 ? -w : w;
    wSum += w;
    // empurra para o lado oposto; o lado efetivo é decidido abaixo (histerese)
    ax += perpX * w; az += perpZ * w;
    const still = Math.hypot(o.vx, o.vz) < 0.2;
    if (along > 0 && d < BODY.radius + o.r + 0.55 && Math.abs(lat) < BODY.radius + o.r + 0.1 && (still || o.vx * dirX + o.vz * dirZ < 0.2)) block = true;
  }
  const avoiding = wSum > 0.05;
  if (avoiding && p.now >= k.sideUntil) { k.side = sideVote >= 0 ? 1 : -1; k.sideUntil = p.now + 1100 + (Math.abs(Math.sin(k.x * 12.9 + k.z * 7.3)) * 600); }
  const mag = Math.min(1.4, Math.hypot(ax, az));
  const gx = perpX * k.side * mag, gz = perpZ * k.side * mag;
  const alpha = 1 - Math.exp(-p.dt / 0.35);
  k.avX += (gx - k.avX) * alpha; k.avZ += (gz - k.avZ) * alpha;
  // rumo desejado = alvo + desvio filtrado
  const hx = dirX + k.avX * 1.25, hz = dirZ + k.avZ * 1.25;
  const want = headingTo(hx, hz);
  // velocidade-alvo: chegada, curva, bloqueio
  let target = p.cruise * Math.max(0, Math.min(1, (dist - p.arriveR) / 1.8));
  const err = angleDiff(want, k.heading);
  target *= 0.5 + 0.5 * Math.max(0, Math.cos(err));
  let waiting = false;
  if (block) {
    target = Math.min(target, 0.12);
    if (!k.waitSince) k.waitSince = p.now;
    waiting = true;
    // esperou demais: troca de lado (contorna em vez de ficar travado)
    if (p.now - k.waitSince > 1400) { k.side = -k.side; k.sideUntil = p.now + 1500; k.waitSince = p.now; }
  } else k.waitSince = 0;
  const maxTurn = p.turnRate * p.dt * (k.speed < 0.4 ? 1.7 : 1);
  k.heading += Math.max(-maxTurn, Math.min(maxTurn, err));
  k.heading = Math.atan2(Math.sin(k.heading), Math.cos(k.heading));
  k.speed = target > k.speed ? Math.min(target, k.speed + p.accel * p.dt) : Math.max(target, k.speed - p.decel * p.dt);
  return { x: k.x + Math.sin(k.heading) * k.speed * p.dt, z: k.z + Math.cos(k.heading) * k.speed * p.dt, dist, avoiding, waiting, arrived: dist <= p.arriveR + 0.05 && k.speed < 0.35 };
}

/** parado: vira devagar para encarar um ponto (conversa, palco, briga) e desacelera até parar */
export function faceToward(k: Kin, fx: number, fz: number, dt: number, rate = 2.2) {
  k.speed = Math.max(0, k.speed - 3 * dt);
  const err = angleDiff(headingTo(fx - k.x, fz - k.z), k.heading);
  if (Math.abs(err) < 0.06) return;
  const m = rate * dt;
  k.heading += Math.max(-m, Math.min(m, err * 0.6));
  k.heading = Math.atan2(Math.sin(k.heading), Math.cos(k.heading));
}
