/**
 * Tabela de confronto (rodada 9) — leitura/validação de `public/gameplay/combat.json` e consultas PURAS usadas pelos
 * dois lados: o servidor decide (server/src/combat/CombatSystem.ts), o cliente só prevê animação e esconde botões.
 * Nada aqui conhece Colyseus, DOM ou three.js.
 */
import { PHYS, type CombatActionDefinition, type CombatData, type CombatDummyDefinition, type PhysState } from './types';
import { PLAYER_CONSTANTS } from '../player/PlayerState';

/** pulo: mesma física do cliente (stepPlayer) — o servidor valida a janela no ar e a altura balística */
export const JUMP = {
  velocity: PLAYER_CONSTANTS.jumpVelocity,
  gravity: PLAYER_CONSTANTS.gravity,
  /** depois de aterrissar: sem pulo seguido (anti "bunny hop") */
  cooldownMs: 700,
  /** pouso: a mensagem de movimento que diz "no chão" só conta depois deste tempo no ar */
  landWindowMs: 120,
  /** folga vertical (m) acima do pico/chão (latência, meio-fio 0,15 m) */
  slackM: 0.25,
  /** degrau aceito sem pulo (meio-fio 0,15 m + folga) */
  stepM: 0.2,
  /** atraso máximo de rede aceito na janela no ar (ms) */
  lateMs: 600,
} as const;
/** altura máxima do pulo (m) e tempo de voo (ms) */
export const JUMP_PEAK = (JUMP.velocity * JUMP.velocity) / (2 * JUMP.gravity);
export const JUMP_FLIGHT_MS = ((2 * JUMP.velocity) / JUMP.gravity) * 1000;
/** altura balística (m) acima do ponto de partida t ms depois do impulso (≥ 0) */
export const jumpHeightAt = (ms: number) => { const t = Math.max(0, ms) / 1000; return Math.max(0, JUMP.velocity * t - (JUMP.gravity * t * t) / 2); };

const KINDS = new Set(['strike', 'push', 'dodge', 'spray']);
const STATES = new Set(Object.keys(PHYS));

/** valida o arquivo (lança com a lista de problemas): ids únicos u8, tempos/alcance finitos, combos coerentes */
export function parseCombatData(raw: unknown): CombatData {
  const d = raw as CombatData;
  const errs: string[] = [];
  if (!d || d.version !== 1 || !d.tuning || !Array.isArray(d.actions)) throw new Error('combat.json: formato inválido');
  const num = (v: unknown, k: string, min = 0) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min) errs.push(k); };
  for (const [k, v] of Object.entries(d.tuning)) num(v, `tuning.${k}`);
  const ids = new Set<number>(), keys = new Set<string>();
  for (const a of d.actions) {
    const tag = `ação ${a?.key ?? a?.id}`;
    if (!Number.isInteger(a.id) || a.id < 1 || a.id > 255 || ids.has(a.id)) errs.push(`${tag}: id`);
    if (!a.key || keys.has(a.key)) errs.push(`${tag}: key`);
    ids.add(a.id); keys.add(a.key);
    if (!KINDS.has(a.kind)) errs.push(`${tag}: kind`);
    for (const k of ['windupMs', 'activeMs', 'recoveryMs', 'range', 'arcDeg', 'staminaCost', 'cooldownMs'] as const) num(a[k], `${tag}.${k}`);
    if (!a.impact) errs.push(`${tag}: impact`);
    else { num(a.impact.condition, `${tag}.impact.condition`); num(a.impact.knockback, `${tag}.impact.knockback`); }
    for (const s of a.allowedStates ?? []) if (!STATES.has(s)) errs.push(`${tag}: estado ${s}`);
    if (a.kind === 'dodge' && !(a.iFramesMs! > 0)) errs.push(`${tag}: iFramesMs`);
  }
  for (const a of d.actions) {
    if (a.comboFrom !== undefined && !ids.has(a.comboFrom)) errs.push(`ação ${a.key}: comboFrom`);
    if (a.comboOf !== undefined && (!ids.has(a.comboOf) || a.comboFrom === undefined || !(a.comboWindowMs! > 0))) errs.push(`ação ${a.key}: comboOf`);
  }
  for (const m of d.dummies ?? []) if (![m.id, m.x, m.z, m.heading, m.areaR, m.conditionMax, m.resetMs].every((v) => typeof v === 'number' && Number.isFinite(v))) errs.push(`boneco ${m.key}`);
  if (errs.length) throw new Error(`combat.json: ${errs.join(', ')}`);
  return d;
}

/** consultas sobre a tabela (índices montados uma vez) */
export class CombatTable {
  readonly byId = new Map<number, CombatActionDefinition>();
  readonly byKey = new Map<string, CombatActionDefinition>();
  /** variantes de combo por ação base pedida */
  private combos = new Map<number, CombatActionDefinition[]>();
  readonly dummies: CombatDummyDefinition[];

  constructor(readonly data: CombatData) {
    for (const a of data.actions) { this.byId.set(a.id, a); this.byKey.set(a.key, a); }
    for (const a of data.actions) if (a.comboOf !== undefined) { const l = this.combos.get(a.comboOf) ?? []; l.push(a); this.combos.set(a.comboOf, l); }
    this.dummies = data.dummies ?? [];
  }

  get tuning() { return this.data.tuning; }

  /** id de uma ação pela chave (0 = não existe) */
  id(key: string) { return this.byKey.get(key)?.id ?? 0; }

  /**
   * ação efetiva de um pedido: o cliente pede a BASE (soco, chute); se a ação anterior abre um combo para ela e o
   * pedido cai na janela (a partir do fim da janela ativa da anterior), vale a variante. Variantes não se pedem direto.
   */
  resolve(requested: number, last: { id: number; activeEnd: number } | null, now: number): CombatActionDefinition | undefined {
    const base = this.byId.get(requested);
    if (!base || base.comboOf !== undefined) return undefined;
    if (last) for (const c of this.combos.get(requested) ?? []) if (c.comboFrom === last.id && now >= last.activeEnd - 60 && now <= last.activeEnd + (c.comboWindowMs ?? 0)) return c;
    return base;
  }

  /** ação de golpe habilitada pelo item na mão (tipo do prop), ou undefined */
  itemAction(kind: string | undefined): CombatActionDefinition | undefined {
    if (!kind) return undefined;
    for (const a of this.data.actions) if (a.requiredItem === kind && a.comboOf === undefined) return a;
    return undefined;
  }

  /** estado físico permitido para começar a ação */
  stateAllowed(a: CombatActionDefinition, st: PhysState): boolean {
    const allowed = a.allowedStates ?? ['NORMAL'];
    return allowed.some((k) => PHYS[k] === st);
  }

  /** o item na mão satisfaz a ação? (requiredItem = tipo; bareHanded = mãos vazias) */
  itemOk(a: CombatActionDefinition, heldKind: string | undefined): boolean {
    if (a.requiredItem) return heldKind === a.requiredItem;
    if (a.bareHanded) return !heldKind;
    return true;
  }
}

/** alvo dentro do arco (graus totais) à frente de `heading` (0 = +Z), com folga; perto demais conta como à frente */
export function inArc(ax: number, az: number, heading: number, tx: number, tz: number, arcDeg: number, slackDeg = 0): boolean {
  const dx = tx - ax, dz = tz - az, d = Math.hypot(dx, dz);
  if (d < 0.25) return true;
  const cos = (dx * Math.sin(heading) + dz * Math.cos(heading)) / d;
  const half = Math.min(180, arcDeg / 2 + slackDeg);
  return cos >= Math.cos((half * Math.PI) / 180);
}

/** dentro do raio (área de treino de um boneco)? */
export const inDummyArea = (dummies: readonly CombatDummyDefinition[], x: number, z: number): CombatDummyDefinition | null => {
  for (const m of dummies) if ((x - m.x) ** 2 + (z - m.z) ** 2 <= m.areaR * m.areaR) return m;
  return null;
};

/** carrega a tabela (cliente: fetch; servidor: leitura do arquivo) */
export async function loadCombatTable(base: string): Promise<CombatTable> {
  const r = await fetch(`${base}gameplay/combat.json`);
  if (!r.ok) throw new Error(`combat.json: ${r.status}`);
  return new CombatTable(parseCombatData(await r.json()));
}
