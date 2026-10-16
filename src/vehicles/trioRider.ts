/**
 * Jogador LOCAL em cima do trio elétrico: a posição de verdade é LOCAL (no piso do trio); o mundo é sempre
 * "pose do trio × local" — quando o trio anda ou vira, o jogador vai junto sem escorregar.
 * Movimento: direção do input (relativa à câmera, no mundo) → referencial do trio → passo → preso ao polígono do
 * piso (o mesmo que o servidor usa para validar, src/vehicles/platform.ts).
 */
import type { PlayerState } from '../player/PlayerState';
import { TRIO, TRIO_DECK, clampToPolygon, localToWorld } from './platform';

/** passos curtos: o piso é estreito e cheio de gente */
const WALK = 1.3, RUN = 2.6;

export interface PlatformLocal { id: string; lx: number; lz: number; lh: number; speed: number; loco: number }

export class TrioRider {
  state: PlatformLocal | null = null;

  get active() { return !!this.state; }

  board(id: string, lx: number = TRIO.ladderTop[0], lz: number = TRIO.ladderTop[1]) {
    this.state = { id, lx, lz, lh: 0, speed: 0, loco: 0 };
  }

  unboard() { this.state = null; }

  /** correção do servidor (rara: o cliente prende ao mesmo polígono) */
  correct(lx: number, lz: number) { if (this.state) { this.state.lx = lx; this.state.lz = lz; } }

  /** um quadro: `dirX/dirZ` = direção desejada NO MUNDO (|d| ≤ 1); escreve a pose de mundo no `player` */
  step(player: PlayerState, pose: { x: number; y: number; z: number; heading: number }, dirX: number, dirZ: number, run: boolean, dt: number) {
    const s = this.state;
    if (!s) return;
    const len = Math.min(1, Math.hypot(dirX, dirZ));
    const c = Math.cos(pose.heading), sn = Math.sin(pose.heading);
    // mundo → local (só rotação): mesmo referencial de platform.ts
    const ldx = dirX * c - dirZ * sn, ldz = dirX * sn + dirZ * c;
    const target = len > 0.05 ? (run ? RUN : WALK) * len : 0;
    s.speed += (target - s.speed) * Math.min(1, dt * 10);
    if (len > 0.05) {
      const l = Math.hypot(ldx, ldz) || 1;
      const nx = s.lx + (ldx / l) * s.speed * dt, nz = s.lz + (ldz / l) * s.speed * dt;
      const cl = clampToPolygon(nx, nz, TRIO_DECK);
      s.lx = cl.x; s.lz = cl.z;
      s.lh = Math.atan2(ldx, ldz);
    }
    s.loco = s.speed > 2 ? 2 : s.speed > 0.15 ? 1 : 0;
    const w = localToWorld(pose, s.lx, s.lz);
    player.x = w.x; player.z = w.z; player.y = pose.y + TRIO.deckH;
    player.heading = pose.heading + s.lh;
    player.vx = player.vz = player.vy = 0;
    player.grounded = true;
    player.speed = s.speed;
    player.locomotion = s.loco === 2 ? 'run' : s.loco === 1 ? 'walk' : 'idle';
  }
}
