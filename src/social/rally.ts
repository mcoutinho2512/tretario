/**
 * Pontos de concentração (RallyPoint / EventPoint): trio elétrico, carro de som, palco ou ponto de evento atraem a
 * multidão de forma ORGÂNICA (sem teletransporte): NPCs que passam por perto tendem a ir para o anel ao redor do
 * ponto e, chegando lá, escolhem uma ação social com os pesos do ponto (mais dança perto do trio, etc.).
 * Puro (sem three.js): usado pelos NPCs no cliente e, futuramente, por NPCs no servidor.
 */
import { TRIO } from '../vehicles/platform';

export type RallyKind = 'trio' | 'soundcar' | 'stage' | 'event';

export interface RallyPoint {
  id: string;
  kind: RallyKind;
  x: number;
  z: number;
  /** raio interno livre (m): o veículo/palco ocupa isto */
  inner: number;
  /** raio da concentração (m) */
  radius: number;
  /** atração 0..1 (0 = inativo) */
  strength: number;
  /** pesos de ações (ACTION key → peso) aplicados a quem está na concentração; somados aos padrões */
  actionWeights?: Record<string, number>;
  /** direção para onde a multidão olha (rad); padrão: para o centro */
  faceCenter?: boolean;
  /** rodada 9 — NPCs RESERVADOS para o ponto (evento agendado: caminhada, torcida da corrida), além de rallyCrowd */
  crowd?: number;
  /** rodada 9 — rótulo no minimapa (nome do evento) */
  label?: string;
}

/** pesos típicos por tipo de ponto */
export const RALLY_DEFAULT_WEIGHTS: Record<RallyKind, Record<string, number>> = {
  trio: { dance_simple: 6, dance_lively: 5, dance_arms: 4, dance_party: 4, arms_up: 5, clap: 4, rhythm_clap: 4, flag_wave: 4, sign_raise: 3, phone: 2, cheer: 3 },
  soundcar: { clap: 5, rhythm_clap: 4, arms_up: 3, flag_wave: 4, sign_raise: 4, fist_up: 3, dance_simple: 3, phone: 2 },
  stage: { clap: 5, cheer: 4, arms_up: 4, phone: 3, flag_wave: 3, sign_raise: 3 },
  event: { talk: 4, clap: 2, sign_raise: 3, flag_wave: 3 },
};

/**
 * forma da concentração por origem (cliente: Rideable/EventScenery; servidor: estimativa da multidão de ambiente nas
 * células do espectador aéreo, src/spectator) — a MESMA tabela nos dois lados. `front`: deslocamento (m) à frente
 * do objeto (o palco olha para +z local).
 */
export const RALLY_SHAPE = {
  trio: { kind: 'trio', inner: TRIO.len / 2 + 1.5, radius: 24, strength: 1, front: 0 },
  soundcar: { kind: 'soundcar', inner: 3.5, radius: 14, strength: 0.75, front: 0 },
  stage: { kind: 'stage', inner: 3, radius: 20, strength: 0.9, front: 9 },
  truck: { kind: 'event', inner: 5.5, radius: 11, strength: 0.35, front: 0 },
} as const satisfies Record<string, { kind: RallyKind; inner: number; radius: number; strength: number; front: number }>;

export class RallyRegistry {
  private points = new Map<string, RallyPoint>();
  version = 0;

  upsert(p: RallyPoint) { this.points.set(p.id, p); this.version++; }
  remove(id: string) { if (this.points.delete(id)) this.version++; }
  get(id: string) { return this.points.get(id); }
  all(): RallyPoint[] { return [...this.points.values()]; }

  /** ponto ativo mais forte que alcança (x,z) — considerando distância de atração = radius × 2,5 */
  nearestActive(x: number, z: number): RallyPoint | null {
    let best: RallyPoint | null = null, score = 0;
    for (const p of this.points.values()) {
      if (p.strength <= 0) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      const reach = p.radius * 2.5;
      if (d > reach) continue;
      const s = p.strength * (1 - d / reach);
      if (s > score) { score = s; best = p; }
    }
    return best;
  }

  /**
   * lugar para um agente no anel do ponto: densidade maior perto do veículo e caindo para fora (distribuição
   * orgânica). `u1`, `u2` em [0,1) (sementes determinísticas do agente).
   */
  static spotFor(p: RallyPoint, u1: number, u2: number): { x: number; z: number } {
    const a = u1 * Math.PI * 2;
    // r² ~ quadrática invertida: mais gente perto do anel interno
    const t = 1 - Math.sqrt(1 - u2);
    const r = p.inner + (p.radius - p.inner) * t;
    return { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r };
  }
}

/** registro global do cliente (veículos de evento registram/atualizam seus pontos aqui) */
export const rallyPoints = new RallyRegistry();
