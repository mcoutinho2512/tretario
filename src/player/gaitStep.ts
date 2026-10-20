/**
 * Rumo/velocidade VISÍVEIS de um personagem (rodada 9.1, extraído de AvatarVisual na rodada 12 — AGENTE F): o rumo
 * segue o da simulação/rede com giro limitado, a velocidade que dirige a animação é suavizada e o corpo inclina na
 * curva (roll) e ao acelerar/frear (pitch). Puro (sem three): testável.
 *
 * Rodada 12 — remoto que SUMIA com o nome ainda na tela: a primeira amostra de um jogador que acabou de entrar chega
 * sem `speed` (o campo do NetPlayer só é escrito no primeiro movimento), virava NaN na interpolação e os filtros
 * exponenciais daqui a guardavam PARA SEMPRE (NaN + x = NaN): a inclinação do esqueleto ficava NaN, todas as matrizes
 * dos ossos também, e a malha deixava de aparecer até o avatar ser devolvido ao pool. Entradas não finitas viram
 * valores neutros e um estado já contaminado se recupera no passo seguinte.
 */
import { angleDelta, turnToward } from '../npc/gait';

export interface GaitState { face: number; speed: number; yawRate: number; accel: number; roll: number; pitch: number; init: boolean }

export function createGait(): GaitState { return { face: 0, speed: 0, yawRate: 0, accel: 0, roll: 0, pitch: 0, init: false }; }

/** `v` se for número finito; senão `fallback` (amostra de rede incompleta, divisão por zero…) */
export function finiteOr(v: unknown, fallback: number): number { return typeof v === 'number' && Number.isFinite(v) ? v : fallback; }

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** algum campo do estado deixou de ser finito (QA/teste) */
export function gaitPoisoned(g: GaitState): boolean {
  return !(Number.isFinite(g.face) && Number.isFinite(g.speed) && Number.isFinite(g.yawRate) && Number.isFinite(g.accel) && Number.isFinite(g.roll) && Number.isFinite(g.pitch));
}

/** um passo do rumo visível; `heading`/`speed` da simulação ou da rede (podem vir não finitos: ver acima) */
export function stepGait(g: GaitState, heading: number, speed: number, grounded: boolean, dt: number): GaitState {
  if (gaitPoisoned(g)) { // nunca carrega NaN/∞ de um quadro para o outro
    g.init = false; g.yawRate = g.accel = g.roll = g.pitch = 0;
    if (!Number.isFinite(g.face)) g.face = 0;
    if (!Number.isFinite(g.speed)) g.speed = 0;
  }
  const h = finiteOr(heading, g.face), s = finiteOr(speed, 0);
  dt = finiteOr(dt, 0);
  if (!g.init || dt <= 0) { g.face = h; g.speed = s; g.init = true; return g; }
  const prev = g.face, prevSpeed = g.speed;
  g.face = turnToward(g.face, h, dt, 16, 7.5);
  g.speed += (s - g.speed) * (1 - Math.exp(-12 * dt));
  const k = 1 - Math.exp(-8 * dt);
  g.yawRate += (angleDelta(prev, g.face) / dt - g.yawRate) * k;
  g.accel += ((g.speed - prevSpeed) / dt - g.accel) * k;
  // inclinação: centrípeta ~ ω·v (curva aberta correndo inclina mais), aceleração inclina para a frente
  const rollT = clamp(-g.yawRate * g.speed * 0.035, -0.2, 0.2);
  const pitchT = clamp(g.accel * 0.018 + g.speed * 0.008, -0.1, 0.12) * (grounded ? 1 : 0.3);
  g.roll += (rollT - g.roll) * k;
  g.pitch += (pitchT - g.pitch) * k;
  return g;
}
