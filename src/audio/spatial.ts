/**
 * Rodada 10 — áudio espacial PURO (sem WebAudio): atenuação por distância, pan estéreo pelo rumo do ouvinte e
 * filtro de "ar" (agudos caem com a distância). O AudioManager aplica estes números em GainNode/StereoPannerNode
 * com rampas curtas (sem estalo); o alocador de vozes usa a mesma audibilidade para decidir quem toca.
 */

/** alcance de uma fonte: `ref` = distância até onde o ganho é 1; `max` = além disto a fonte é inaudível (virtualiza) */
export interface Falloff { ref: number; max: number; rolloff?: number }

/** abaixo disto a voz não vale um nó real (≈ −50 dB) */
export const AUDIBLE_MIN = 0.003;

/**
 * Ganho 0..1 por distância: inverso-da-distância (modelo "inverse" do WebAudio) com rampa final até zero entre
 * 75% e 100% do alcance — perto mais forte, longe cai, fora do alcance = 0 (a fonte é virtualizada).
 */
export function attenuation(dist: number, f: Falloff): number {
  if (!(dist >= 0)) return 0;
  if (dist >= f.max) return 0;
  const r = f.rolloff ?? 1;
  const g = dist <= f.ref ? 1 : f.ref / (f.ref + r * (dist - f.ref));
  const edge = f.max * 0.75;
  return dist <= edge ? g : g * (1 - (dist - edge) / (f.max - edge));
}

/** estado do ouvinte (câmera) */
export interface ListenerPose { x: number; y: number; z: number; yaw: number }

/**
 * Pan −1 (esquerda) .. +1 (direita) de uma fonte em (x, z) para o ouvinte olhando no rumo `yaw` (convenção do
 * jogo: rumo 0 = +z, frente = (sin yaw, cos yaw)). Bem perto o pan encolhe (a fonte "envolve" em vez de pular de
 * lado a lado quando o ouvinte passa por ela).
 */
export function panFor(l: ListenerPose, x: number, z: number, near = 2): number {
  const dx = x - l.x, dz = z - l.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return 0;
  // direita do ouvinte = frente girada −90°: (−cos yaw, sin yaw) na convenção x→leste/z→norte do jogo
  const rx = -Math.cos(l.yaw), rz = Math.sin(l.yaw);
  const side = (dx * rx + dz * rz) / d;
  const k = d < near ? d / near : 1;
  return Math.max(-1, Math.min(1, side * 0.85 * k));
}

/** distância 3D ouvinte → fonte (y ausente = altura do ouvinte − 1,5 m, ou seja, no chão perto do jogador) */
export function distTo(l: ListenerPose, x: number, y: number | undefined, z: number): number {
  const dy = (y ?? l.y - 1.5) - l.y;
  return Math.hypot(x - l.x, dy, z - l.z);
}

/** frequência de corte (Hz) do passa-baixa de "ar": longe, só os graves chegam (trio a 200 m vira batida abafada) */
export function airCutoff(dist: number, max: number): number {
  const t = Math.min(1, Math.max(0, dist / Math.max(1, max)));
  return 18000 * Math.pow(350 / 18000, Math.pow(t, 0.7));
}

/** ganho de multidão por densidade: ~logarítmico e com teto (nunca soma linear por pessoa) */
export function crowdLoudness(density: number, cap = 80): number {
  if (!(density > 0)) return 0;
  return Math.min(1, Math.log1p(density) / Math.log1p(cap));
}

/** alcances por categoria de som (m) */
export const FALLOFF = {
  step: { ref: 1.5, max: 28 },
  body: { ref: 2.5, max: 45 },
  hit: { ref: 3, max: 60 },
  item: { ref: 2, max: 30 },
  vehicleSfx: { ref: 4, max: 80 },
  horn: { ref: 8, max: 160 },
  crowdShot: { ref: 6, max: 110 },
  whistle: { ref: 8, max: 140 },
  megaphone: { ref: 6, max: 120 },
  car: { ref: 4, max: 90 },
  moto: { ref: 4, max: 100 },
  bike: { ref: 1.5, max: 25 },
  scooter: { ref: 1.5, max: 30 },
  soundcar: { ref: 10, max: 190 },
  trio: { ref: 14, max: 280 },
  crowdCell: { ref: 12, max: 170 },
} satisfies Record<string, Falloff>;
