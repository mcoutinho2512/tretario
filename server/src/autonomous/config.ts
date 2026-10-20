/**
 * Rodada 12 — dados dos PERSONAGENS AUTÔNOMOS (public/gameplay/autonomous.json), lidos e validados aqui com padrões
 * seguros. Nada de nome de grupo no código: as torcidas entram só como ids do arquivo de dados (mapeados para o índice
 * `sup` de public/gameplay/supporters.json por igualdade).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Personality } from './types';

export const PERSONALITIES: readonly Personality[] = ['SOCIAL', 'OBSERVADOR', 'AGITADO', 'TORCEDOR', 'MANIFESTANTE', 'EXPLORADOR', 'CURIOSO', 'CONFRONTADOR', 'CAUTELOSO'];
export type VehicleUseKind = 'bicycle' | 'scooter' | 'moto' | 'car';

export interface LodBand { radius: number; max: number; thinkMs: [number, number] }
export interface AutonomousConfig {
  population: {
    minActive: number; maxActive: number; perHumanReduction: number;
    near: LodBand; mid: LodBand; far: { thinkMs: [number, number] };
    fadeMs: number;
    /** além disto (m) do humano mais próximo o autônomo sai do estado sincronizado (DORMANT) */
    dormantM: number;
    /** só volta a aparecer (sai de DORMANT) a menos disto — histerese contra piscar na borda */
    materializeM: number;
    /**
     * densidade LOCAL perto de cada humano (rodada 12, agente G): quem tem menos de `want` autônomos a ≤ radiusM recebe
     * gente que chega andando de longe — inclusive quem joga longe do eixo (vagas a ~270 m). want = share × alvo ÷ humanos,
     * preso em [min, max]; até perPass chegadas por humano a cada passe (2 s). Chegada a arriveM do humano (no eixo) ou
     * por uma linha livre de parede a offAxisM (fora do eixo, onde as ruas fecham a vista).
     */
    local: { radiusM: number; min: number; max: number; share: number; perPass: number; arriveM: [number, number]; offAxisM: [number, number] };
  };
  nametag: { share: number; nearM: number; midM: number };
  /** id da torcida (dados) → fração; o id neutro de supporters.json = sem torcida */
  supporters: Record<string, number>;
  personalities: Record<Personality, number>;
  vehicles: { share: number; kinds: Record<VehicleUseKind, number> };
  titles: { share: number };
  /** peso de atração dos pontos FIXOS do mapa (palco, caminhões, telões, praça do spawn) sem evento rolando — pontos de
   * evento/trio/carro de som têm peso próprio. Mais baixo = menos gente parada "no evento" o tempo todo */
  hotspotWeights: { stage: number; truck: number; screen: number; spawn: number };
  names: { words: string[]; suffixWords: string[]; numbers: string[]; lowercaseShare: number; underscoreShare: number };
}

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const range = (v: unknown, d: [number, number]): [number, number] => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && x > 0) ? [Math.min(v[0], v[1]), Math.max(v[0], v[1])] : d);
const strs = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 16) : d);
const weights = <K extends string>(v: unknown, keys: readonly K[] | null): Record<K, number> => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out = {} as Record<K, number>;
  for (const k of keys ?? (Object.keys(o) as K[])) out[k] = num(o[k], 0, 0, 1000);
  return out;
};

export function parseAutonomousConfig(raw: unknown): AutonomousConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const p = r.population ?? {};
  const band = (b: any, d: LodBand): LodBand => ({ radius: num(b?.radius, d.radius, 5, 400), max: Math.round(num(b?.max, d.max, 0, 2000)), thinkMs: range(b?.thinkMs, d.thinkMs) });
  const near = band(p.near, { radius: 60, max: 80, thinkMs: [700, 1600] });
  const mid = band(p.mid, { radius: 160, max: 120, thinkMs: [2500, 5000] });
  const maxActive = Math.round(num(p.maxActive, 220, 0, 2000));
  const dormantM = num(p.dormantM, 270, mid.radius + 10, 600);
  const n = r.names ?? {};
  return {
    population: {
      minActive: Math.min(maxActive, Math.round(num(p.minActive, 60, 0, 2000))), maxActive,
      perHumanReduction: num(p.perHumanReduction, 3, 0, 100),
      near, mid: { ...mid, radius: Math.max(mid.radius, near.radius) },
      far: { thinkMs: range(p.far?.thinkMs, [8000, 15000]) },
      fadeMs: num(p.fadeMs, 4000, 0, 30000),
      dormantM,
      materializeM: Math.min(dormantM - 10, num(p.materializeM, 240, mid.radius, 600)),
      local: {
        radiusM: num(p.local?.radiusM, 70, 10, 300), min: Math.round(num(p.local?.min, 10, 0, 200)), max: Math.round(num(p.local?.max, 30, 0, 400)),
        share: num(p.local?.share, 0.4, 0, 1), perPass: Math.round(num(p.local?.perPass, 2, 0, 20)),
        arriveM: range(p.local?.arriveM, [mid.radius + 15, mid.radius + 70]), offAxisM: range(p.local?.offAxisM, [55, 110]),
      },
    },
    nametag: { share: num(r.nametag?.share, 0.6, 0, 1), nearM: num(r.nametag?.nearM, 18, 0, 200), midM: num(r.nametag?.midM, 35, 0, 400) },
    supporters: weights(r.supporters, null),
    personalities: weights(r.personalities, PERSONALITIES),
    vehicles: { share: num(r.vehicles?.share, 0.08, 0, 1), kinds: weights(r.vehicles?.kinds, ['bicycle', 'scooter', 'moto', 'car'] as const) },
    titles: { share: num(r.titles?.share, 0.12, 0, 1) },
    hotspotWeights: { stage: num(r.hotspotWeights?.stage, 1.3, 0, 3), truck: num(r.hotspotWeights?.truck, 0.8, 0, 3), screen: num(r.hotspotWeights?.screen, 0.6, 0, 3), spawn: num(r.hotspotWeights?.spawn, 0.7, 0, 3) },
    names: {
      words: strs(n.words, ['Carioca']), suffixWords: strs(n.suffixWords, []), numbers: strs(n.numbers, []),
      lowercaseShare: num(n.lowercaseShare, 0.25, 0, 1), underscoreShare: num(n.underscoreShare, 0.12, 0, 1),
    },
  };
}

let cached: AutonomousConfig | null = null;
/** o arquivo de dados do servidor (o mesmo do cliente) */
export function autonomousConfig(): AutonomousConfig {
  if (cached) return cached;
  let raw: unknown = {};
  try { raw = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/gameplay/autonomous.json', import.meta.url)), 'utf8')); } catch { /* padrões */ }
  return (cached = parseAutonomousConfig(raw));
}

/** títulos que existem como recompensa (achievements/missions `{kind:'title'}`) — autônomo só usa título real do jogo */
let titleCache: string[] | null = null;
export function rewardTitles(): string[] {
  if (titleCache) return titleCache;
  const out = new Set<string>();
  const scan = (v: unknown) => {
    if (Array.isArray(v)) { for (const x of v) scan(x); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.kind === 'title' && typeof o.title === 'string' && o.title.length <= 48) out.add(o.title);
    for (const x of Object.values(o)) if (x && typeof x === 'object') scan(x);
  };
  for (const f of ['achievements.json', 'missions.json']) {
    try { scan(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/gameplay/${f}`, import.meta.url)), 'utf8'))); } catch { /* sem títulos */ }
  }
  return (titleCache = [...out].sort());
}

/** ações de confronto usadas pelos autônomos (pela CHAVE de public/gameplay/combat.json; custo/recarga dos dados) */
export interface CombatMove { id: number; cost: number; cooldownMs: number; range: number }
export interface CombatMoves { punch: CombatMove | null; combo: CombatMove | null; kick: CombatMove | null; push: CombatMove | null; dodge: CombatMove | null; staminaMax: number;
  /** proteção de retorno (ms) depois de levantar/aparecer — golpe nesse tempo é bloqueado; o autônomo espera em vez de bater no vazio */
  protectMs: number }
let movesCache: CombatMoves | null = null;
export function combatMoves(): CombatMoves {
  if (movesCache) return movesCache;
  let raw: { tuning?: { staminaMax?: number; protectMs?: number }; actions?: { id: number; key: string; staminaCost: number; cooldownMs: number; range?: number }[] } = {};
  try { raw = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/gameplay/combat.json', import.meta.url)), 'utf8')); } catch { /* sem confronto */ }
  const by = (k: string): CombatMove | null => { const a = raw.actions?.find((x) => x.key === k); return a ? { id: a.id, cost: a.staminaCost, cooldownMs: a.cooldownMs, range: a.range ?? 1 } : null; };
  return (movesCache = { punch: by('soco'), combo: by('soco_2'), kick: by('chute'), push: by('empurrao'), dodge: by('esquiva'), staminaMax: raw.tuning?.staminaMax ?? 100, protectMs: raw.tuning?.protectMs ?? 5000 });
}
