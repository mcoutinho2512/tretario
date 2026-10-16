/**
 * Protocolo multiplayer compartilhado (cliente ↔ servidor). Sem dependências de three.js nem de Colyseus,
 * para poder ser importado pelos dois lados e testado isoladamente.
 *
 * Autoridade (ADR-013): o cliente só ENVIA intenções/propostas; o SERVIDOR decide o estado definitivo.
 *  - posição: o cliente propõe (predição local); o servidor valida velocidade máxima, limites do mundo
 *    e teleporte, e corrige (mensagem "correct") quando rejeita
 *  - aparência/avatar: validados contra listas permitidas
 *  - modo de interação, combate, inventário, dinheiro: nunca aceitos do cliente sem regra do servidor
 */

export const ROOM_NAME = 'presidente_vargas';
export const NET_TICK_HZ = 15; // envio de movimento pelo cliente
export const SERVER_PATCH_MS = 50; // 20 Hz de patches de estado

export const BODIES = ['homem', 'mulher', 'idoso', 'idosa'] as const;
export const NET_ACCESSORIES = ['nenhum', 'bone', 'mochila', 'bolsa', 'oculos', 'chapeu'] as const;
export type NetBody = (typeof BODIES)[number];

/** limites do mundo (m) — mesmo bbox do manifesto, com folga */
export const WORLD_LIMITS = { minX: -1800, maxX: 1600, minZ: -1100, maxZ: 1300 };

/** velocidades máximas aceitas (m/s), com folga para jitter de rede */
// limites URBANOS (avenida fechada para evento, não pista de corrida): carro/moto 30 km/h, bicicleta 25,
// patinete 20 km/h (≈ boost × 1,05; validateMove ainda dá 35 % de folga para jitter)
export const MAX_SPEED = { foot: 6.4, bicycle: 7.3, scooter: 5.9, car: 8.8, moto: 8.8 } as const;
export type MoveMode = keyof typeof MAX_SPEED;

export interface JoinOptions {
  name?: string;
  body: NetBody;
  skin: number;
  hair: number;
  top: number;
  bottom: number;
  shoes: number;
  accessory?: string;
  acc?: number;
  /** máximo de jogadores com estado completo que ESTE cliente quer receber (preset; o servidor limita a PV_AOI_MAX) */
  aoiMax?: number;
  /**
   * id ANÔNIMO e estável do aparelho (UUID no localStorage) — autoria de grafites, cota e denúncias.
   * Não é identidade real (não há login ainda): sessão + nome + este id. Ver docs/GRAFFITI.md.
   */
  cid?: string;
  /** SOMENTE servidor em modo de teste (PV_TEST=1): ponto de spawn para cenas reproduzíveis */
  testSpawn?: { x: number; z: number };
}

export interface MoveMsg {
  x: number; y: number; z: number;
  heading: number;
  speed: number;
  /** 0 idle, 1 walk, 2 run, 3 air, 4 riding */
  loco: number;
  mode: MoveMode;
  seq: number;
}

export interface CorrectMsg { x: number; y: number; z: number; seq: number; reason: string }

export const LOCO = ['idle', 'walk', 'run', 'air', 'riding'] as const;

export function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function sanitizeColor(c: unknown, fallback: number): number {
  return isFiniteNum(c) && c >= 0 && c <= 0xffffff ? Math.floor(c) : fallback;
}

export function sanitizeName(n: unknown): string {
  const s = typeof n === 'string' ? n : '';
  const clean = s.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 20);
  return clean || 'Visitante';
}

/**
 * Validação autoritativa de movimento (pura, testável).
 * Retorna a posição aceita e, se rejeitou, o motivo (o servidor envia "correct" ao cliente).
 */
export function validateMove(
  prev: { x: number; y: number; z: number; t: number },
  msg: MoveMsg,
  now: number,
): { x: number; y: number; z: number; ok: boolean; reason?: string } {
  if (![msg.x, msg.y, msg.z, msg.heading, msg.speed].every(isFiniteNum)) return { ...prev, ok: false, reason: 'invalid' };
  const L = WORLD_LIMITS;
  if (msg.x < L.minX || msg.x > L.maxX || msg.z < L.minZ || msg.z > L.maxZ || msg.y < -2 || msg.y > 60) {
    return { ...prev, ok: false, reason: 'out_of_bounds' };
  }
  const dt = Math.max(0.05, Math.min(1.5, (now - prev.t) / 1000));
  const vmax = MAX_SPEED[msg.mode] ?? MAX_SPEED.foot;
  const allowed = vmax * dt * 1.35 + 0.6; // folga para jitter
  const d = Math.hypot(msg.x - prev.x, msg.z - prev.z);
  if (d > allowed) {
    // aceita até o limite, na direção pedida (não deixa "teleportar")
    const k = allowed / d;
    return { x: prev.x + (msg.x - prev.x) * k, y: msg.y, z: prev.z + (msg.z - prev.z) * k, ok: false, reason: 'too_fast' };
  }
  return { x: msg.x, y: msg.y, z: msg.z, ok: true };
}
