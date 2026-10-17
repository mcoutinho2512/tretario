/**
 * Regras PURAS de missões/progressão (rodada 9) — sem DOM, sem Colyseus: o servidor (server/src/progression) aplica;
 * o cliente só usa para exibir (nível, barra, requisito de item). Contrato em ./types.ts.
 *
 *  objetivo   `on` (tipo do GameplayEvent) + `where` (igualdade campo a campo) → +1, ou + ev[sumField] (ex.: metros)
 *  missão     visível quando todas as `requires` estão concluídas e o nível ≥ `minLevel`; conclui com TODOS os objetivos
 *  nível      maior i com levels[i] ≤ xp (nível = i + 1), limitado a maxLevel
 *  catálogo   parseCatalog valida os JSON (descarta entradas inválidas, nunca lança) — mesmo código nos dois lados
 */
import type { GameplayEvent, GameplayEventType } from '../gameplay/events';
import type { AchievementDefinition, LevelCurve, MissionDefinition, MissionObjective, Reward, UnlockDefinition, UnlockSource } from './types';

export interface ProgressionCatalog {
  missions: MissionDefinition[];
  achievements: AchievementDefinition[];
  levels: LevelCurve;
  rewards: UnlockDefinition[];
}

/** tipos válidos de GameplayEvent (validação dos dados: objetivo com `on` desconhecido nunca completaria) */
export const GAMEPLAY_EVENT_TYPES: readonly GameplayEventType[] = [
  'zone_enter', 'distance', 'action', 'prop', 'vehicle_enter', 'trio_board', 'rally_visit', 'combat_action', 'combat_dodge',
  'dummy_knockdown', 'event_join', 'event_complete', 'race_finish', 'debate_watch', 'debate_turn', 'debate_react', 'graffiti', 'chat',
];
/** eventos de CONFRONTO: missões não opcionais nunca podem depender deles (neutralidade/progressão pacífica) */
export const COMBAT_EVENT_TYPES: ReadonlySet<string> = new Set(['combat_action', 'combat_dodge', 'dummy_knockdown']);

export function matchesObjective(o: MissionObjective, ev: GameplayEvent): boolean {
  if (o.on !== ev.type) return false;
  if (!o.where) return true;
  const rec = ev as unknown as Record<string, unknown>;
  for (const k in o.where) if (rec[k] !== o.where[k]) return false;
  return true;
}

/** quanto este evento soma ao objetivo (já casado): 1, ou o campo `sumField` (finito, ≥ 0) */
export function objectiveIncrement(o: MissionObjective, ev: GameplayEvent): number {
  if (!o.sumField) return 1;
  const v = (ev as unknown as Record<string, unknown>)[o.sumField];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export function objectiveTarget(o: MissionObjective): number { return o.count && o.count > 0 ? o.count : 1; }

export function objectiveDone(o: MissionObjective, values: Record<string, number> | undefined): boolean {
  return (values?.[o.id] ?? 0) >= objectiveTarget(o);
}

export function allDone(objs: readonly MissionObjective[], values: Record<string, number> | undefined): boolean {
  return objs.every((o) => objectiveDone(o, values));
}

export function levelForXp(c: LevelCurve, xp: number): number {
  let lv = 1;
  for (let i = 1; i < c.levels.length && i < c.maxLevel; i++) if (xp >= c.levels[i]) lv = i + 1;
  return lv;
}

/** XP de início do nível e do próximo (null no máximo) */
export function levelBounds(c: LevelCurve, level: number): { cur: number; next: number | null } {
  const cur = c.levels[Math.max(0, level - 1)] ?? 0;
  const next = level < c.maxLevel && level < c.levels.length ? c.levels[level] : null;
  return { cur, next };
}

export function missionVisible(m: MissionDefinition, completed: { has(id: string): boolean }, level: number): boolean {
  if (completed.has(m.id)) return false;
  if ((m.minLevel ?? 1) > level) return false;
  return (m.requires ?? []).every((r) => completed.has(r));
}

/** itens liberados só pelo NÍVEL (PROGRESSION com `level`) */
export function levelUnlocks(cat: ProgressionCatalog, level: number): string[] {
  return cat.rewards.filter((r) => r.source === 'PROGRESSION' && r.level !== undefined && r.level <= level).map((r) => r.item);
}

/** XP total das recompensas de uma missão/conquista */
export function rewardXp(rs: readonly Reward[]): number { return rs.reduce((n, r) => n + (r.kind === 'xp' ? r.amount ?? 0 : 0), 0); }

/** texto do requisito de um item bloqueado (editor/PROGRESSO): nível, missão, conquista ou "em breve" */
export function requirementOf(cat: ProgressionCatalog, item: string): string {
  const def = cat.rewards.find((r) => r.item === item);
  if (def?.source === 'PREMIUM_FUTURE') return 'Em breve';
  if (def?.level !== undefined) return `Nível ${def.level}`;
  const m = cat.missions.find((x) => x.rewards.some((r) => r.kind === 'unlock' && r.item === item));
  if (m) return `Missão: ${m.title}`;
  const a = cat.achievements.find((x) => x.rewards.some((r) => r.kind === 'unlock' && r.item === item));
  if (a) return a.hidden ? 'Conquista secreta' : `Conquista: ${a.title}`;
  return def?.source === 'EVENT_REWARD' ? 'Recompensa de evento' : 'Bloqueado';
}

// ------------------------------------------------------------------ catálogo (validação dos JSON)
const str = (x: unknown, max = 120): string | null => (typeof x === 'string' && x.length > 0 && x.length <= max ? x : null);
const ID = /^[a-z0-9_]{1,40}$/;
const SOURCES: readonly UnlockSource[] = ['FREE', 'PROGRESSION', 'EVENT_REWARD', 'PREMIUM_FUTURE'];

function parseObjective(raw: unknown): MissionObjective | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const id = str(o.id, 40), label = str(o.label), on = o.on as GameplayEventType;
  if (!id || !ID.test(id) || !label || !GAMEPLAY_EVENT_TYPES.includes(on)) return null;
  const out: MissionObjective = { id, label, on };
  if (o.where && typeof o.where === 'object' && !Array.isArray(o.where)) {
    const w: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(o.where as Record<string, unknown>)) if (['string', 'number', 'boolean'].includes(typeof v)) w[k] = v as string | number | boolean;
    out.where = w;
  }
  if (typeof o.count === 'number' && Number.isFinite(o.count) && o.count > 0) out.count = o.count;
  if (typeof o.sumField === 'string' && /^[a-zA-Z]{1,20}$/.test(o.sumField)) out.sumField = o.sumField;
  return out;
}

function parseRewards(raw: unknown): Reward[] {
  if (!Array.isArray(raw)) return [];
  const out: Reward[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (r?.kind === 'xp' && typeof r.amount === 'number' && r.amount > 0 && r.amount <= 5000) out.push({ kind: 'xp', amount: Math.round(r.amount) });
    else if (r?.kind === 'unlock' && str(r.item, 60)) out.push({ kind: 'unlock', item: r.item as string });
    else if (r?.kind === 'title' && str(r.title, 40)) out.push({ kind: 'title', title: r.title as string });
  }
  return out;
}

function parseObjectives(raw: unknown): MissionObjective[] {
  const objs = (Array.isArray(raw) ? raw : []).map(parseObjective).filter((x): x is MissionObjective => !!x);
  return objs.filter((o, i) => objs.findIndex((p) => p.id === o.id) === i);
}

export function parseCatalog(raw: { missions?: unknown; achievements?: unknown; levels?: unknown; rewards?: unknown }): ProgressionCatalog {
  const missions: MissionDefinition[] = [];
  for (const m of (Array.isArray(raw.missions) ? raw.missions : []) as Record<string, unknown>[]) {
    const id = str(m?.id, 40), title = str(m?.title), objectives = parseObjectives(m?.objectives);
    if (!id || !ID.test(id) || !title || !objectives.length || missions.some((x) => x.id === id)) continue;
    const cat = (['exploracao', 'social', 'mobilidade', 'confronto', 'evento'] as const).find((c) => c === m.category) ?? 'exploracao';
    const def: MissionDefinition = { id, title, description: str(m.description, 300) ?? '', category: cat, objectives, rewards: parseRewards(m.rewards) };
    if (m.optional === true) def.optional = true;
    if (Array.isArray(m.requires)) def.requires = (m.requires as unknown[]).filter((x): x is string => typeof x === 'string');
    if (typeof m.minLevel === 'number' && m.minLevel > 1) def.minLevel = Math.round(m.minLevel);
    missions.push(def);
  }
  const achievements: AchievementDefinition[] = [];
  for (const a of (Array.isArray(raw.achievements) ? raw.achievements : []) as Record<string, unknown>[]) {
    const id = str(a?.id, 40), title = str(a?.title), objectives = parseObjectives(a?.objectives);
    if (!id || !ID.test(id) || !title || !objectives.length || achievements.some((x) => x.id === id)) continue;
    const def: AchievementDefinition = { id, title, description: str(a.description, 300) ?? '', objectives, rewards: parseRewards(a.rewards) };
    if (a.hidden === true) def.hidden = true;
    if (a.session === true) def.session = true;
    achievements.push(def);
  }
  const lv = raw.levels as Partial<LevelCurve> | undefined;
  const arr = Array.isArray(lv?.levels) ? (lv!.levels as unknown[]).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [];
  const ok = arr.length >= 2 && arr[0] === 0 && arr.every((x, i) => i === 0 || x > arr[i - 1]);
  const levels: LevelCurve = ok ? { levels: arr, maxLevel: Math.min(arr.length, typeof lv?.maxLevel === 'number' ? lv.maxLevel : arr.length) } : { levels: [0], maxLevel: 1 };
  const rewards: UnlockDefinition[] = [];
  for (const r of (Array.isArray(raw.rewards) ? raw.rewards : []) as Record<string, unknown>[]) {
    const item = str(r?.item, 60), label = str(r?.label);
    if (!item || !label || !SOURCES.includes(r.source as UnlockSource) || rewards.some((x) => x.item === item)) continue;
    const d: UnlockDefinition = { item, label, source: r.source as UnlockSource };
    if (typeof r.level === 'number' && r.level >= 1) d.level = Math.round(r.level);
    rewards.push(d);
  }
  return { missions, achievements, levels, rewards };
}
