/**
 * Rodada 12 (agente G) — POPULAÇÃO LOCAL × AUTÔNOMOS DO SERVIDOR (docs/AUTONOMOUS_CHARACTERS.md, "população dupla").
 *
 * Os pedestres (PedestrianSystem) e a multidão de concentração (RallyCrowd) são simulados SÓ neste cliente: cada
 * jogador vê os seus. Os autônomos são do servidor: todos veem os mesmos. Perto de autônomos, gente local vira
 * "fantasma" (só eu vejo, ninguém mais). A regra:
 *
 *  pedestres     com `autoNear` autônomos a ≤ nearM do jogador: limite = max (≤ fullAt), cai linear até minPeds
 *                (≥ offAt). Com autônomos por perto (≥ fullAt) os locais só nascem a ≥ backgroundM (FUNDO), e quem passou
 *                do limite só some fora da vista ou longe (nada desaparece na frente da câmera)
 *  concentração  ponto com ≥ rallySuppressAt autônomos a ≤ raio + rallyMarginM: os NPCs locais daquele ponto saem
 *                (quem está lá de verdade são os autônomos); voltam com ≤ rallyResumeAt (histerese). Concentração
 *                DINÂMICA do servidor (`evt_pts` id `dyn_…` → ponto `evt_dyn_…`) é feita de autônomos: nunca recebe gente local
 *  sem autônomos (PV_AUTONOMOUS=0, dormentes, servidor antigo): autoNear = 0 → tudo como antes (avenida nunca vazia)
 *
 * Números: public/gameplay/autonomous.json `localPopulation` (padrões abaixo).
 */
export interface LocalPopulationRule {
  nearM: number; fullAt: number; offAt: number; minPeds: number; backgroundM: number;
  rallyMarginM: number; rallySuppressAt: number; rallyResumeAt: number;
}

export const LOCAL_POPULATION_DEFAULTS: LocalPopulationRule = { nearM: 80, fullAt: 4, offAt: 24, minPeds: 4, backgroundM: 45, rallyMarginM: 10, rallySuppressAt: 6, rallyResumeAt: 2 };

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
export function parseLocalPopulation(raw: unknown): LocalPopulationRule {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const D = LOCAL_POPULATION_DEFAULTS;
  const fullAt = num(o.fullAt, D.fullAt, 0, 500);
  const resume = num(o.rallyResumeAt, D.rallyResumeAt, 0, 500);
  return {
    nearM: num(o.nearM, D.nearM, 5, 500), fullAt, offAt: Math.max(fullAt + 1, num(o.offAt, D.offAt, 1, 1000)), minPeds: Math.round(num(o.minPeds, D.minPeds, 0, 200)),
    backgroundM: num(o.backgroundM, D.backgroundM, 0, 300), rallyMarginM: num(o.rallyMarginM, D.rallyMarginM, 0, 100),
    rallySuppressAt: Math.max(resume + 1, num(o.rallySuppressAt, D.rallySuppressAt, 1, 500)), rallyResumeAt: resume,
  };
}

/** quantos pedestres LOCAIS com `autoNear` autônomos por perto (preset: `max`) */
export function localPedLimit(max: number, autoNear: number, r: LocalPopulationRule = LOCAL_POPULATION_DEFAULTS): number {
  if (autoNear <= r.fullAt) return max;
  const lo = Math.min(max, r.minPeds);
  if (autoNear >= r.offAt) return lo;
  const f = (autoNear - r.fullAt) / (r.offAt - r.fullAt);
  return Math.round(max + (lo - max) * f);
}

/** distância mínima (m) para um pedestre LOCAL nascer: com autônomos por perto, só no fundo */
export const localPedMinSpawn = (autoNear: number, r: LocalPopulationRule = LOCAL_POPULATION_DEFAULTS) => (autoNear > r.fullAt ? r.backgroundM : 0);

/** ponto de concentração feito de autônomos (concentração dinâmica do servidor) */
export const isServerCrowdPoint = (id: string) => id.startsWith('dyn_') || id.startsWith('evt_dyn_'); // EventClient: `evt_${id}`

/** quais pontos de concentração ficam SEM NPCs locais (histerese por ponto) */
export class RallySuppression {
  private off = new Set<string>();
  constructor(public rule: LocalPopulationRule = LOCAL_POPULATION_DEFAULTS) {}
  /** `count(x, z, r)` = autônomos a ≤ r m; devolve true se o conjunto mudou */
  update(points: readonly { id: string; x: number; z: number; radius: number }[], count: (x: number, z: number, r: number) => number): boolean {
    let changed = false;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      const n = count(p.x, p.z, p.radius + this.rule.rallyMarginM);
      const was = this.off.has(p.id);
      const now = isServerCrowdPoint(p.id) || (was ? n > this.rule.rallyResumeAt : n >= this.rule.rallySuppressAt);
      if (now !== was) { changed = true; if (now) this.off.add(p.id); else this.off.delete(p.id); }
    }
    for (const id of [...this.off]) if (!seen.has(id)) { this.off.delete(id); changed = true; }
    return changed;
  }
  suppressed(id: string) { return this.off.has(id); }
  get size() { return this.off.size; }
}
