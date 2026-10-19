/**
 * Rodada 10 — escolha PURA (sem three.js) da variante de animação de confronto pela direção, testável
 * (tests/combatAnim.test.ts). Ângulos: rumo h → frente (sin h, cos h); esquerda do corpo (cos h, −sin h); ângulo
 * relativo > 0 = para a esquerda do corpo. Nomes = clipes de src/characters/human/proceduralClips.ts (`~m` = espelhado,
 * MIRROR_SUFFIX).
 */
const MIRROR = '~m';

/** esquiva pela direção do deslocamento relativa ao corpo (rad): frente, trás (padrão parado) ou lado */
export function dodgeClipFor(rel: number): string {
  const a = Math.abs(rel);
  if (!Number.isFinite(rel) || a >= (Math.PI * 3) / 4) return 'cbt_dodge';
  if (a <= Math.PI / 4) return 'cbt_dodge_fwd';
  return rel > 0 ? 'cbt_dodge_side' + MIRROR : 'cbt_dodge_side';
}

/**
 * cambaleio pelo sentido do EMPURRÃO no mundo (dx, dz; cbt_hit/npcHits) e o rumo do corpo: empurrado para trás
 * (golpe de frente) `stagger`, para a frente (golpe pelas costas) `stagger_back`, para a direita `stagger_side`,
 * para a esquerda `stagger_side~m`
 */
export function staggerClipFor(dx: number, dz: number, heading: number): string {
  const f = dx * Math.sin(heading) + dz * Math.cos(heading);
  const l = dx * Math.cos(heading) - dz * Math.sin(heading);
  if (!(Math.abs(f) + Math.abs(l) > 1e-6)) return 'stagger';
  if (Math.abs(f) >= Math.abs(l)) return f < 0 ? 'stagger' : 'stagger_back';
  return l < 0 ? 'stagger_side' : 'stagger_side' + MIRROR;
}

/**
 * levantar a partir da pose do chão: `frontY` = componente vertical da frente do peito (mundo), (upX, upZ) =
 * horizontal do eixo pelve → pescoço. De bruços (peito para baixo): `getup_prone`, virado para onde a cabeça aponta;
 * de costas ou de lado: `getup` (de costas), virado para onde os pés apontam. `yaw` = rumo do personagem (rad).
 */
export function getupClipFor(frontY: number, upX: number, upZ: number): { clip: string; yaw: number } {
  const prone = frontY < -0.35;
  const h = Math.hypot(upX, upZ) > 1e-4 ? (prone ? Math.atan2(upX, upZ) : Math.atan2(-upX, -upZ)) : 0;
  return { clip: prone ? 'getup_prone' : 'getup', yaw: h };
}
