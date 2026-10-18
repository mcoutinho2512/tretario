/**
 * Naturalidade do andar dos NPCs (rodada 9.1), barata e determinística por semente:
 *  - giro com velocidade angular limitada e suavizado (sem virar o corpo de uma vez quando o rumo muda)
 *  - parâmetros individuais (ritmo, passada, balanço do parado) a partir de uma semente inteira
 */

/** diferença angular em (−π, π] */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * aproxima `h` de `want`: suavização exponencial (`k` por s) com teto de velocidade angular (`maxRate` rad/s).
 * Meia-volta leva ~0,8 s a 4 rad/s — um pedestre real gira o corpo em 2–3 passos.
 */
export function turnToward(h: number, want: number, dt: number, k = 8, maxRate = 4): number {
  const d = angleDelta(h, want);
  const step = d * (1 - Math.exp(-k * dt));
  const lim = maxRate * dt;
  return h + Math.max(-lim, Math.min(lim, step));
}

/** número em [0, 1) a partir de uma semente e de um canal (hash inteiro; o mesmo em todos os clientes) */
export function seeded(seed: number, channel: number): number {
  let h = Math.imul((seed ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
