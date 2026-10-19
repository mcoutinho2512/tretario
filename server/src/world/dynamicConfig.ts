/**
 * Rodada 12 — dados do MUNDO DINÂMICO (public/gameplay/dynamic_world.json; docs/DYNAMIC_WORLD.md). Tudo que regula
 * frequência, escalada e reações é DADO: o código só lê. Leitura tolerante: chave ausente = padrão abaixo; número fora da
 * faixa é preso; tipo errado é ignorado (fica o padrão). Probabilidades em 0..1.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DynamicEventKind, Escalation, Personality } from '../autonomous/types';

export type PersonalityTable = Record<Personality, number>;
export interface Reaction { join: number; watch: number; flee: number; ignore: number }
export type Range = [number, number];

const P = (SOCIAL: number, OBSERVADOR: number, AGITADO: number, TORCEDOR: number, MANIFESTANTE: number, EXPLORADOR: number, CURIOSO: number, CONFRONTADOR: number, CAUTELOSO: number): PersonalityTable =>
  ({ SOCIAL, OBSERVADOR, AGITADO, TORCEDOR, MANIFESTANTE, EXPLORADOR, CURIOSO, CONFRONTADOR, CAUTELOSO });
const R = (join: number, watch: number, flee: number, ignore: number): Reaction => ({ join, watch, flee, ignore });

export const DYNAMIC_DEFAULTS = {
  version: 1,
  director: { probesPerS: 2, probeRadiusM: 22, probeNearHumanShare: 0.75, probeHumanOffsetM: 70, eventEvalMs: 1000, conflictEvalMs: 800, maxNearSample: 160, sendMinMs: 1000 },
  regions: { sizeM: 80 },
  budget: {
    gathering: { maxConcurrent: 4, perHour: 14, regionCooldownS: 240, minSpacingM: 55 },
    race: { maxConcurrent: 1, perHour: 3, regionCooldownS: 600 },
    conflict: { maxConcurrent: 2, globalCooldownS: 150, regionCooldownS: 600, minSpacingM: 40, perHour: { DISCUSSAO: 10, BRIGA: 4, BRIGA_GENERALIZADA: 1 } },
  },
  gathering: {
    seedChance: 0.12, coreMin: 3, coreRadiusM: 10, attractRadiusM: 45, radiusM: 14, maxRadiusM: 30, invitePerEval: 2, maxSize: 60,
    growS: [90, 240] as Range, peakS: [60, 180] as Range, drainS: [60, 150] as Range, leaveShare: 0.12, endBelow: 2,
    attract: P(0.6, 0.35, 0.3, 0.55, 0.6, 0.2, 0.5, 0.25, 0.15),
    watchShare: P(0.1, 0.7, 0.1, 0.1, 0.05, 0.3, 0.6, 0.2, 0.5),
    sameSupMult: 1.6,
    manifest: { minSize: 10, share: 0.35, walkChance: 0.35, walkLengthM: [180, 420] as Range, paceMS: 1.1 },
    festa: { minSize: 8, supShare: 0.6, socialShare: 0.5 },
    torcidas: { minPerSide: 3, tensionPerMin: 0.12 },
  },
  race: { seedChance: 0.04, racersMin: 2, racersMax: 4, lengthM: [150, 260] as Range, maxS: 120, watchPerEval: 2, racer: P(0.2, 0.05, 0.7, 0.3, 0.1, 0.8, 0.3, 0.5, 0.05) },
  conflict: {
    seedChance: 0.01, pairRadiusM: 6,
    temper: P(0.3, 0.15, 0.9, 0.6, 0.4, 0.25, 0.2, 1.0, 0.05),
    differentSupMult: 1.8, heatMult: 1.5,
    tension: { minS: 6, maxS: 25, escalateChance: 0.18, calmChance: 0.1, watchersPerEval: 1, reactRadiusM: 12 },
    fight: { minS: 8, maxS: 50, pushFirstS: 3, reactRadiusM: 18, decisionsPerEval: 3, maxJoinPerEval: 1, generalizeAt: 6 },
    general: { minS: 10, maxS: 120, reactRadiusM: 28, decisionsPerEval: 4, maxJoinPerEval: 2, maxFighters: 30, stepDownBelow: 3 },
    dispersal: { perEval: 3, stepS: 4 },
    friendJoinMult: 2.5, strangerJoinMult: 0.35,
    reactions: {
      SOCIAL: R(0.1, 0.45, 0.25, 0.2), OBSERVADOR: R(0.03, 0.75, 0.12, 0.1), AGITADO: R(0.45, 0.35, 0.05, 0.15), TORCEDOR: R(0.3, 0.45, 0.1, 0.15),
      MANIFESTANTE: R(0.12, 0.4, 0.25, 0.23), EXPLORADOR: R(0.08, 0.3, 0.12, 0.5), CURIOSO: R(0.05, 0.7, 0.1, 0.15), CONFRONTADOR: R(0.65, 0.25, 0.02, 0.08), CAUTELOSO: R(0, 0.1, 0.75, 0.15),
    } as Record<Personality, Reaction>,
    provocation: { cooldownPerHumanS: 20 },
  },
  signals: {
    crowdFull: 40,
    cheer: { CONCENTRACAO: 0.35, CAMINHADA: 0.6, MANIFESTACAO: 0.7, ENCONTRO_TORCIDAS: 0.8, DISCUSSAO: 0.1, BRIGA: 0.3, BRIGA_GENERALIZADA: 0.45, CORRIDA_IMPROVISADA: 0.7, FESTA: 1 } as Record<DynamicEventKind, number>,
    combatFloor: { CALMO: 0, TENSAO: 0.15, CONFRONTO: 0.45, GENERALIZADO: 0.75 } as Record<Escalation, number>,
  },
  presentation: {
    agendaMin: 6,
    labels: { CONCENTRACAO: 'Concentração', CAMINHADA: 'Caminhada', MANIFESTACAO: 'Manifestação', ENCONTRO_TORCIDAS: 'Encontro de torcidas', DISCUSSAO: 'Discussão', BRIGA: 'Briga', BRIGA_GENERALIZADA: 'Briga generalizada', CORRIDA_IMPROVISADA: 'Corrida improvisada', FESTA: 'Festa' } as Record<DynamicEventKind, string>,
    agenda: ['CONCENTRACAO', 'CAMINHADA', 'MANIFESTACAO', 'ENCONTRO_TORCIDAS', 'CORRIDA_IMPROVISADA', 'FESTA', 'BRIGA_GENERALIZADA'] as DynamicEventKind[],
    rally: ['CONCENTRACAO', 'CAMINHADA', 'MANIFESTACAO', 'ENCONTRO_TORCIDAS', 'FESTA'] as DynamicEventKind[],
  },
  qa: { forcedMinS: 60, forcedSpeedup: 3 },
};

export type DynamicWorldConfig = typeof DYNAMIC_DEFAULTS;

/** teto genérico para números (evita Infinity/negativos vindos dos dados) */
const MAX_NUM = 1e6;

/** mescla `src` sobre `def` mantendo a FORMA de `def` (tipos e chaves); usado também pelos testes para variações */
export function mergeConfig<T>(def: T, src: unknown): T {
  if (Array.isArray(def)) {
    if (!Array.isArray(src)) return def;
    if (def.every((v) => typeof v === 'number')) {
      if (src.length !== def.length || !src.every((v) => typeof v === 'number' && Number.isFinite(v))) return def;
      const a = (src as number[]).map((v) => Math.max(0, Math.min(MAX_NUM, v)));
      return (a.length === 2 ? [Math.min(a[0], a[1]), Math.max(a[0], a[1])] : a) as T;
    }
    return src.every((v) => typeof v === typeof def[0]) ? (src.slice(0, 64) as T) : def;
  }
  if (def && typeof def === 'object') {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return def;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(def as Record<string, unknown>)) out[k] = mergeConfig(v, (src as Record<string, unknown>)[k]);
    return out as T;
  }
  if (typeof def === 'number') return (typeof src === 'number' && Number.isFinite(src) ? Math.max(0, Math.min(MAX_NUM, src)) : def) as T;
  if (typeof def === 'string') return (typeof src === 'string' ? src.slice(0, 64) : def) as T;
  if (typeof def === 'boolean') return (typeof src === 'boolean' ? src : def) as T;
  return def;
}

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/gameplay/dynamic_world.json');

/** lê os dados (arquivo ausente/ilegível = padrões) */
export function loadDynamicWorld(file = FILE): DynamicWorldConfig {
  try { return mergeConfig(DYNAMIC_DEFAULTS, JSON.parse(readFileSync(file, 'utf8'))); } catch { return DYNAMIC_DEFAULTS; }
}
