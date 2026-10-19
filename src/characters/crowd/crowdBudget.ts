/**
 * Orçamento de personagens humanos (puro, testável): decide, a cada quadro, QUEM é desenhado COMO.
 *
 *   tier 2  esqueleto próprio (HumanCharacter + AnimationMixer): só os mais próximos, até `skinned` por preset
 *           LOD0 < 20 m (no máximo `lod0` deles) · LOD1 < 35 m · LOD2 além; nunca mais detalhado que `maxDetail`
 *   tier 1  multidão INSTANCIADA (uma InstancedMesh por corpo/LOD, animação assada em textura): custo O(1) em draw calls
 *   tier 0  não desenhado (passou do teto total do preset — os mais distantes/fora de vista saem primeiro)
 *
 * Jogadores remotos, multidão distante da rede e pedestres NPC entram na MESMA fila: o total de humanos é
 * limitado pelo preset, não pela soma dos sistemas. Quem já tem esqueleto ganha vantagem na disputa
 * (distância × 0,85) para não trocar de representação a cada passo; quem está fora da vista perde (× 4).
 */
import type { QualityLevel } from '../../core/settings';
import type { Lod } from '../human/HumanAssets';
import { animVariant, personSeed } from './animVariety';

export interface CrowdBudget {
  /** personagens com esqueleto próprio (os mais próximos) */
  skinned: number;
  /** quantos desses podem usar o LOD0 (camadas completas, ~35 k triângulos) */
  lod0: number;
  /** LOD mais detalhado permitido */
  maxDetail: Lod;
  /** distância máxima para ter esqueleto (além: instanciado) */
  skinnedMaxDist: number;
  /** teto TOTAL de humanos desenhados (esqueleto + instanciados) */
  total: number;
  /** instanciados a menos desta distância usam a malha LOD2 (~2,5 k tri); além, LOD3 (~600 tri). 0 = só LOD3 */
  instancedLod2Dist: number;
  /** teto de esqueletos no LOD1 e distância máxima para ele (BAIXO: só os 2 mais próximos; sem campo = sem teto) */
  lod1?: number;
  lod1Dist?: number;
}

export const CROWD_BUDGETS: Record<QualityLevel, CrowdBudget> = {
  // rodada 9.1: no BAIXO os 2 mais próximos (< 10 m) ganham o LOD1 e o instanciado de perto (< 10 m) é o LOD2 — antes
  // quem estava colado no jogador era LOD2/LOD3 (600 tri), facetado
  low: { skinned: 8, lod0: 0, maxDetail: 1, skinnedMaxDist: 35, total: 200, instancedLod2Dist: 10, lod1: 2, lod1Dist: 10 },
  medium: { skinned: 16, lod0: 2, maxDetail: 1, skinnedMaxDist: 50, total: 350, instancedLod2Dist: 30 },
  high: { skinned: 24, lod0: 6, maxDetail: 0, skinnedMaxDist: 60, total: 600, instancedLod2Dist: 45 },
  ultra: { skinned: 32, lod0: 10, maxDetail: 0, skinnedMaxDist: 80, total: 800, instancedLod2Dist: 60 },
};

export type Tier = 0 | 1 | 2;

export interface CrowdAgent {
  /** identificador estável (escalonamento da animação) */
  id: number;
  x: number; y: number; z: number;
  heading: number;
  speed: number;
  /** inclinação (rad) para trás em torno do pé (+π/2 = deitado de costas; − = curvado) — NPC atingido (npcHits.ts) */
  tilt: number;
  /** índice do corpo (BODIES: homem, mulher, idoso, idosa) */
  body: number;
  scale: number;
  /** cores (hex) usadas na representação instanciada */
  skin: number; hair: number; top: number; bottom: number;
  /** peças variantes empacotadas (garments.ts `packLook`) e design da camisa (designs.ts; 0 = lisa) */
  look: number; shirt: number;
  /** 1 = só instanciado (multidão distante da rede, sem estado completo); 2 = pode ter esqueleto */
  maxTier: Tier;
  /** multiplicador de distância na disputa (< 1 = mais importante: caído, em veículo, interagindo) */
  priority: number;
  /** o esqueleto deste agente já está pronto e visível (senão o instanciado continua cobrindo) */
  skinReady: boolean;
  // ---- saídas (escritas pelo orçamento a cada quadro)
  tier: Tier;
  lod: Lod;
  /** atualizar a animação do esqueleto a cada N quadros (escalonado por id) */
  animEvery: number;
  inView: boolean;
  dist: number;
  // ---- estado da representação instanciada
  phase: number;
  /**
   * rodada 12 — individualidade (src/characters/crowd/animVariety.ts): semente estável (nid da rede / id) e o que sai
   * dela — passada (cadência), andamento do parado, deslocamento e andamento das ações em laço. Use `setAgentSeed`.
   */
  seed: number;
  stride: number;
  idleRate: number;
  actOff: number;
  actRate: number;
  // ---- vida social (src/social): ação, início (s, relógio local), item e design — usados pelos instanciados
  act: number;
  actAt: number;
  prop: number;
  design: number;
}

let nextId = 1;
export function createAgent(init: Partial<CrowdAgent> = {}): CrowdAgent {
  const a: CrowdAgent = {
    id: nextId++, x: 0, y: 0, z: 0, heading: 0, speed: 0, tilt: 0, body: 0, scale: 1,
    skin: 0xc68b62, hair: 0x222222, top: 0x2f6f8f, bottom: 0x2c3a52, look: 0, shirt: 0,
    maxTier: 2, priority: 1, skinReady: false,
    tier: 1, lod: 3, animEvery: 1, inView: true, dist: 0, phase: 0,
    seed: 0, stride: 1, idleRate: 1, actOff: 0, actRate: 1,
    act: 0, actAt: 0, prop: 0, design: 0,
    ...init,
  };
  setAgentSeed(a, init.seed ?? personSeed(a.id), init.phase === undefined);
  return a;
}

/** rodada 12 — semente da individualidade; `resetPhase` também sorteia (deterministicamente) a fase do ciclo */
export function setAgentSeed(a: CrowdAgent, seed: number, resetPhase = true) {
  const v = animVariant(seed);
  a.seed = seed; a.stride = v.stride; a.idleRate = v.idleRate; a.actOff = v.actOffset; a.actRate = v.actRate;
  if (resetPhase) a.phase = v.phase0;
}

/** intervalo de atualização da animação do esqueleto pela distância */
export function animEveryFor(d: number): number {
  return d < 12 ? 1 : d < 25 ? 2 : d < 45 ? 3 : 4;
}

/** LOD do esqueleto pela distância (antes dos limites do preset) */
export function skinnedLodFor(d: number): Lod {
  return d < 20 ? 0 : d < 35 ? 1 : 2;
}

export interface TierStats { skinned: number; instanced: number; hidden: number; lod: [number, number, number, number] }

/**
 * Atribui tier/LOD/frequência de animação a cada agente. `inView` e `dist` já devem estar preenchidos.
 * Retorna as contagens. Custo: O(n log n) com n = humanos submetidos (centenas).
 */
export function assignTiers(agents: CrowdAgent[], b: CrowdBudget, order: number[] = [], rank: Float64Array = new Float64Array(0)): TierStats {
  const n = agents.length;
  if (rank.length < n) rank = new Float64Array(Math.max(n, rank.length * 2));
  order.length = n;
  for (let i = 0; i < n; i++) {
    const a = agents[i];
    const visibleish = a.inView || a.dist < 6;
    rank[i] = a.dist * a.priority * (a.tier === 2 ? 0.85 : 1) * (visibleish ? 1 : 4);
    order[i] = i;
  }
  order.sort((i, j) => rank[i] - rank[j]);
  const st: TierStats = { skinned: 0, instanced: 0, hidden: 0, lod: [0, 0, 0, 0] };
  let lod0 = 0, lod1 = 0;
  for (let k = 0; k < n; k++) {
    const a = agents[order[k]];
    if (k >= b.total) { a.tier = 0; st.hidden++; continue; }
    const maxD = b.skinnedMaxDist * (a.tier === 2 ? 1.1 : 1);
    if (a.maxTier >= 2 && st.skinned < b.skinned && a.dist < maxD && (a.inView || a.dist < 6)) {
      a.tier = 2;
      let l = skinnedLodFor(a.dist);
      // LOD0 só para quem está À VISTA (os colados atrás da câmera ganham esqueleto, mas não gastam vaga de LOD0)
      if (l === 0 && (lod0 >= b.lod0 || !a.inView)) l = 1;
      l = Math.max(l, b.maxDetail) as Lod;
      if (l === 1 && b.lod1 !== undefined && (lod1 >= b.lod1 || a.dist > (b.lod1Dist ?? Infinity))) l = 2;
      if (l === 0) lod0++;
      if (l === 1) lod1++;
      a.lod = l;
      a.animEvery = animEveryFor(a.dist);
      st.skinned++;
      st.lod[l]++;
    } else {
      a.tier = 1;
      a.lod = b.instancedLod2Dist > 0 && a.dist < b.instancedLod2Dist ? 2 : 3;
      st.instanced++;
    }
  }
  return st;
}
