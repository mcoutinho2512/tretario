/**
 * Estado de um jogador — puro dado, sem renderização nem input.
 * Serializável: é o que futuramente será sincronizado em rede (LocalPlayer / RemotePlayer / NPC).
 */
export type Locomotion = 'idle' | 'walk' | 'run' | 'air';

export interface PlayerState {
  id: string;
  /** posição no mundo (m): x = leste, y = altura, z = sul */
  x: number;
  y: number;
  z: number;
  /** velocidade (m/s) */
  vx: number;
  vy: number;
  vz: number;
  /** direção do corpo (rad, rotação em torno de Y; 0 = olhando para +Z) */
  heading: number;
  grounded: boolean;
  locomotion: Locomotion;
  /** velocidade horizontal escalar (m/s) — usada pela animação */
  speed: number;
}

export function createPlayerState(id: string, x: number, y: number, z: number, heading = 0): PlayerState {
  return { id, x, y, z, vx: 0, vy: 0, vz: 0, heading, grounded: true, locomotion: 'idle', speed: 0 };
}

/** Intenção de movimento produzida pelo input (local) ou pela rede/IA (remoto/NPC). */
export interface MoveIntent {
  /** direção desejada no plano XZ do mundo (não normalizada; |v| ≤ 1) */
  dirX: number;
  dirZ: number;
  run: boolean;
  jump: boolean;
  /** fator de velocidade do corpo (1 = adulto; idosos < 1) */
  speedFactor?: number;
}

export const PLAYER_CONSTANTS = {
  walkSpeed: 1.8,
  // 5,8 m/s (~21 km/h): trote + parte do sprint (passada mais longa), cadência única ponderada entre os clipes
  runSpeed: 5.8,
  accel: 14,
  airControl: 0.25,
  gravity: 15.5,
  jumpVelocity: 4.6,
  radius: 0.32,
  height: 1.78,
  maxStep: 0.45,
  turnRate: 12,
};
