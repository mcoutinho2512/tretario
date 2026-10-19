/**
 * Rodada 10 — TABELAS do áudio (puras): de cada pedido do contrato (SfxId/LoopKind) para som gerado, barramento,
 * alcance e peso de prioridade; reações de multidão por família de perfil; som de cada golpe pela definição de
 * combate (dados de public/gameplay/combat.json); perfil de multidão padrão pelo formato do evento.
 */
import type { LoopKind, SfxId, SfxOpts } from './bus';
import { FALLOFF, type Falloff } from './spatial';
import { layerFamily } from './sounds';

export type Bus = 'ambient' | 'crowd' | 'vehicles' | 'events' | 'ui' | 'sfx';
export interface SfxSpec { key: string; bus: Bus; falloff: Falloff | null; weight: number }

const sp = (key: string, bus: Bus, falloff: Falloff | null, weight = 1): SfxSpec => ({ key, bus, falloff, weight });
const SFX: Record<SfxId, SfxSpec> = {
  step: sp('step_asphalt', 'sfx', FALLOFF.step, 0.5), jump: sp('jump', 'sfx', FALLOFF.body, 0.7), land: sp('land', 'sfx', FALLOFF.body, 0.7),
  punch: sp('punch', 'sfx', FALLOFF.hit, 1.2), kick: sp('kick', 'sfx', FALLOFF.hit, 1.2), whoosh: sp('whoosh', 'sfx', FALLOFF.body, 0.9),
  dodge: sp('dodge', 'sfx', FALLOFF.body, 0.9), impact: sp('impact', 'sfx', FALLOFF.hit, 1.3), fall: sp('fall', 'sfx', FALLOFF.hit, 1.1),
  getup: sp('getup', 'sfx', FALLOFF.body, 0.6), bat: sp('bat', 'sfx', FALLOFF.hit, 1.2), bar: sp('bar', 'sfx', FALLOFF.hit, 1.2),
  spray: sp('spray', 'sfx', FALLOFF.body, 1), push: sp('push', 'sfx', FALLOFF.body, 1), blocked: sp('blocked', 'sfx', FALLOFF.hit, 1),
  pickup: sp('pickup', 'sfx', FALLOFF.item, 0.8), drop: sp('drop', 'sfx', FALLOFF.item, 0.7),
  ui_click: sp('ui_click', 'ui', null, 3), ui_open: sp('ui_open', 'ui', null, 3), ui_close: sp('ui_close', 'ui', null, 3), ui_denied: sp('ui_denied', 'ui', null, 3), ui_ok: sp('ui_ok', 'ui', null, 3),
  veh_door: sp('veh_door', 'vehicles', FALLOFF.vehicleSfx, 1), veh_mount: sp('veh_mount', 'vehicles', FALLOFF.vehicleSfx, 0.9), veh_brake: sp('veh_brake', 'vehicles', FALLOFF.vehicleSfx, 0.9),
  veh_horn: sp('veh_horn', 'vehicles', FALLOFF.horn, 1.1), bike_bell: sp('bike_bell', 'vehicles', FALLOFF.vehicleSfx, 1),
  whistle: sp('whistle', 'crowd', FALLOFF.whistle, 0.6), clap: sp('clap', 'crowd', FALLOFF.crowdShot, 0.5), cheer: sp('cheer', 'crowd', FALLOFF.crowdShot, 0.6), megaphone: sp('megaphone', 'events', FALLOFF.megaphone, 0.8),
};
/** sons internos (não fazem parte do contrato) */
const INTERNAL: Record<string, SfxSpec> = {
  bike_brake: sp('bike_brake', 'vehicles', FALLOFF.step, 0.6), shout: sp('shout', 'crowd', FALLOFF.crowdShot, 0.5), surdo: sp('surdo', 'crowd', FALLOFF.crowdShot, 0.5),
};

/** especificação de um one-shot (passo escolhe a variação pela superfície) */
export function sfxSpec(id: SfxId | string, o?: SfxOpts): SfxSpec | null {
  const s = (SFX as Record<string, SfxSpec>)[id] ?? INTERNAL[id];
  if (!s) return null;
  if (id === 'step' && o?.surface) return { ...s, key: `step_${o.surface}` };
  return s;
}

export interface LoopSpec { key: string; bus: Bus; falloff: Falloff; weight: number }
export const LOOPS: Record<LoopKind, LoopSpec> = {
  car_engine: { key: 'car_engine', bus: 'vehicles', falloff: FALLOFF.car, weight: 1 },
  moto_engine: { key: 'moto_engine', bus: 'vehicles', falloff: FALLOFF.moto, weight: 1 },
  bike_roll: { key: 'bike_roll', bus: 'vehicles', falloff: FALLOFF.bike, weight: 0.8 },
  scooter_motor: { key: 'scooter_motor', bus: 'vehicles', falloff: FALLOFF.scooter, weight: 0.8 },
  soundcar_music: { key: 'soundcar_music', bus: 'events', falloff: FALLOFF.soundcar, weight: 1.2 },
  trio_music: { key: 'trio_music', bus: 'events', falloff: FALLOFF.trio, weight: 1.4 },
};

/** som de um golpe a partir do clipe/tipo da definição (combat.json) — sem tabela por id */
export function combatSfx(def: { kind: string; animation: string }): { swing: SfxId; hit: SfxId } {
  const a = def.animation;
  if (def.kind === 'dodge') return { swing: 'dodge', hit: 'dodge' };
  if (def.kind === 'push' || a === 'push') return { swing: 'whoosh', hit: 'push' };
  if (def.kind === 'spray' || a.includes('spray')) return { swing: 'spray', hit: 'spray' };
  if (a.includes('bat')) return { swing: 'whoosh', hit: 'bat' };
  if (a.includes('bar')) return { swing: 'whoosh', hit: 'bar' };
  if (a.includes('kick')) return { swing: 'whoosh', hit: 'kick' };
  return { swing: 'whoosh', hit: 'punch' };
}

/** perfil de multidão padrão do evento: `ambience.crowd` manda; senão pelo formato/categoria (dados do evento) */
export function eventCrowdProfile(ev: { format?: string; category?: string; ambience?: { crowd?: string } } | null | undefined): string {
  if (ev?.ambience?.crowd) return ev.ambience.crowd;
  const f = ev?.format ?? ev?.category ?? '';
  if (['manifestacao', 'caminhada', 'debate', 'eleicao_simulada', 'politico'].includes(f)) return 'manifestacao';
  if (f === 'show') return 'show';
  if (['confronto_grupos', 'torcida', 'futebol'].includes(f)) return 'torcida';
  return 'urbano';
}

/** reações pontuais de uma célula de multidão: taxa (eventos/s) e sorteio do tipo pela família do perfil */
export function crowdEventRate(loud: number, activity: number, celebration: number, combat: number, profile: string, eventType?: string): number {
  const fam = layerFamily(profile);
  const base = fam ? 0.08 + 0.55 * loud * (0.3 + activity) : 0.02 + 0.12 * loud * activity;
  return base * (eventType ? 1.4 : 1) + celebration * 0.5 * loud + combat * 0.6 * loud;
}
export function pickCrowdEvent(u: number, profile: string, celebration: number, combat: number, megaphoneOk: boolean): string {
  const fam = layerFamily(profile);
  if (combat > 0.3 && u < combat * 0.5) return 'shout';
  if (celebration > 0.4 && u < 0.35) return 'cheer';
  const table: [string, number][] = fam === 'manifestacao' ? [['whistle', 0.35], ['clap', 0.25], ['cheer', 0.12], ['megaphone', megaphoneOk ? 0.18 : 0], ['surdo', 0.1]]
    : fam === 'torcida' ? [['clap', 0.3], ['cheer', 0.28], ['shout', 0.27], ['whistle', 0.1], ['surdo', 0.05]]
    : fam === 'show' ? [['clap', 0.45], ['cheer', 0.4], ['whistle', 0.15]]
    : [['shout', 0.4], ['clap', 0.3], ['whistle', 0.3]];
  const tot = table.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  const v = ((u * 7.31) % 1) * tot;
  for (const [k, w] of table) { acc += w; if (v < acc) return k; }
  return table[0][0];
}
