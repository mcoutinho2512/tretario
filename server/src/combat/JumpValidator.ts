/**
 * PULO no servidor (rodada 9) — sem Colyseus. O cliente pede `jump {seq}` e já pula (predição); aqui:
 *  - valida: no chão, sem pulo seguido (JUMP.cooldownMs depois do pouso), estado normal, fora de veículo/trio;
 *  - acompanha a janela no ar (tempo de voo + atraso de rede) e a altura balística esperada (curva do stepPlayer
 *    no instante do movimento, com −300/+150 ms de tolerância — ninguém "paira" no pico);
 *  - prende o `y` dos movimentos: modelo de chão GROSSO (o servidor não tem malha de chão) — o y do último
 *    movimento aceito no chão, degrau de meio-fio (±0,2 m) e teto absoluto do nível mais alto do mapa (plataforma
 *    1,0 m). Sem pulo aceito ninguém "voa"; no ar, no máximo o pico do pulo + folga.
 * Recusa → `jump_denied {seq, reason}` (só para o próprio). Descer é livre (meio-fio, plataforma → rua).
 */
import { JUMP, JUMP_FLIGHT_MS, JUMP_PEAK, jumpHeightAt } from '../../../src/combat/data';
import type { JumpDenial } from '../../../src/combat/types';
import { PLATFORM_HEIGHT } from '../../../src/world/types';

/** nível de chão mais alto do mapa (src/physics/CollisionWorld SURFACE_HEIGHT) + folga */
const GROUND_MAX = PLATFORM_HEIGHT + 0.05;

interface JumpState {
  /** y do último movimento aceito no chão */
  groundY: number;
  /** no ar: início (relógio do servidor), y de partida e seq do pedido */
  air: { t0: number; y0: number; seq: number } | null;
  landedAt: number;
}

export type JumpResult = { ok: true } | { ok: false; reason: JumpDenial };

export class JumpValidator {
  private s = new Map<string, JumpState>();
  /** QA/medição */
  readonly stats = { accepted: 0, denied: 0, clamped: 0 };

  join(sid: string, y = GROUND_MAX) { this.s.set(sid, { groundY: Math.min(GROUND_MAX, y), air: null, landedAt: -1e12 }); }
  leave(sid: string) { this.s.delete(sid); }
  /** posição decidida pelo servidor (queda, veículo, trio): chão novo, sem pulo em curso */
  reset(sid: string, y: number) { const st = this.s.get(sid); if (st) { st.air = null; st.groundY = Math.min(GROUND_MAX, y); } }

  airborne(sid: string, now: number): boolean {
    const st = this.s.get(sid);
    if (!st?.air) return false;
    if (now - st.air.t0 > JUMP_FLIGHT_MS + JUMP.lateMs) { this.land(st, now); return false; }
    return true;
  }

  request(sid: string, seq: unknown, now: number, ctx: { status: number; vehicle: string; platform: string }): JumpResult {
    const st = this.s.get(sid);
    if (!st) return { ok: false, reason: 'estado' };
    const r = this.check(st, now, ctx);
    if (!r.ok) { this.stats.denied++; return r; }
    st.air = { t0: now, y0: st.groundY, seq: typeof seq === 'number' && Number.isFinite(seq) ? seq : 0 };
    this.stats.accepted++;
    return r;
  }

  private check(st: JumpState, now: number, ctx: { status: number; vehicle: string; platform: string }): JumpResult {
    if (ctx.vehicle || ctx.platform) return { ok: false, reason: 'veiculo' };
    if (ctx.status !== 0) return { ok: false, reason: 'estado' };
    if (st.air && now - st.air.t0 <= JUMP_FLIGHT_MS + JUMP.lateMs) return { ok: false, reason: 'no_ar' };
    if (st.air) this.land(st, now);
    if (now - st.landedAt < JUMP.cooldownMs) return { ok: false, reason: 'cooldown' };
    return { ok: true };
  }

  /** pouso: o fim natural do voo ou a chegada do movimento "no chão", o que vier primeiro (janela curta) */
  private land(st: JumpState, now: number) {
    if (!st.air) return;
    st.landedAt = Math.min(now, st.air.t0 + JUMP_FLIGHT_MS);
    st.air = null;
  }

  /** filtra o y proposto num movimento a pé aceito (loco 3 = no ar) */
  clampY(sid: string, y: number, loco: number, now: number): number {
    const st = this.s.get(sid);
    if (!st) return y;
    let max: number;
    if (st.air && now - st.air.t0 <= JUMP_FLIGHT_MS + JUMP.lateMs) {
      // altura balística esperada agora, com tolerância de rede (−300/+150 ms): sem "pairar" no pico
      const el = now - st.air.t0, t1 = Math.max(0, el - 300), t2 = el + 150, tp = JUMP_FLIGHT_MS / 2;
      max = st.air.y0 + (t1 <= tp && tp <= t2 ? JUMP_PEAK : Math.max(jumpHeightAt(t1), jumpHeightAt(t2))) + JUMP.slackM;
      const out = Math.min(y, max);
      if (out < y) this.stats.clamped++;
      // pousou: movimento no chão depois da janela mínima, perto (ou abaixo) do nível de partida
      if (loco !== 3 && now - st.air.t0 >= JUMP.landWindowMs && out <= st.air.y0 + JUMP.stepM) { this.land(st, now); st.groundY = out; }
      return out;
    }
    if (st.air) this.land(st, now);
    max = Math.min(GROUND_MAX, st.groundY + JUMP.stepM);
    const out = Math.min(y, max);
    if (out < y - 1e-3) this.stats.clamped++;
    st.groundY = out;
    return out;
  }
}
