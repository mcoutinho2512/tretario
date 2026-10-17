/**
 * Regras de ações sociais e itens — PURAS (servidor aplica; cliente prevê). O servidor é a autoridade:
 * o cliente pede "quero acenar" / "quero segurar a bandeira X com o design Y"; o servidor valida e grava no estado
 * do jogador (act, actAt, actVar, prop, design), que vai a quem está na área de interesse.
 */
import { ACTION_BY_ID, NO_ACTION, actionExpired } from './actions';
import { PROP_BY_ID, NO_PROP } from './props';
import { DESIGN_BY_ID, NO_DESIGN } from './designs';
import { isAvailable, type ItemEntitlements } from '../characters/unlocks';

export const ACTION_RULES = {
  /** intervalo mínimo entre pedidos de ação/item (curto: "pegar megafone + usar" é um par legítimo; o anti-spam
   * de verdade é o limite por janela) */
  cooldownMs: 60,
  /** anti-spam: no máximo N pedidos por janela */
  rateWindowMs: 10_000,
  rateMax: 24,
  /** deslocamento (m) entre mensagens de movimento que cancela ação que não permite andar */
  moveCancelM: 0.12,
  /** variações por ação (u8, o cliente escolhe o desfasamento/espelhamento) */
  maxVariation: 7,
} as const;

export interface ActionActor {
  act: number;
  actAt: number;
  prop: number;
  design: number;
  /** 0 normal (caído/levantando não fazem ações) */
  status: number;
  /** veículo em uso ('' = a pé). Em plataforma (trio) as ações são permitidas */
  vehicle: string;
  onPlatform?: boolean;
  /** histórico de pedidos (ms) — anti-spam */
  recent: number[];
  /** último pedido de cada tipo (o intervalo mínimo vale entre pedidos do MESMO tipo: "pegar item + usar" passa) */
  lastAct?: number;
  lastProp?: number;
  /** rodada 9: direitos (recompensas) — com eles, ações/designs bloqueados (unlocks.ts) são negados ('bloqueado') */
  ent?: ItemEntitlements;
  /** rodada 9 — item de confronto que o jogador POSSUI (pegou no chão/apoio; server/src/items) — prop id, 0 = nenhum */
  carried?: number;
}

export type RuleResult = { ok: true } | { ok: false; reason: string };

function rate(a: ActionActor, now: number, last: number | undefined): RuleResult {
  if (now - (last ?? -Infinity) < ACTION_RULES.cooldownMs) return { ok: false, reason: 'rapido' };
  while (a.recent.length && now - a.recent[0] > ACTION_RULES.rateWindowMs) a.recent.shift();
  if (a.recent.length >= ACTION_RULES.rateMax) return { ok: false, reason: 'spam' };
  return { ok: true };
}

/** pedido de ação (0 = parar). Não altera `a` (o servidor aplica com `applyAction`) */
export function validateAction(a: ActionActor, actionId: unknown, now: number): RuleResult {
  if (typeof actionId !== 'number' || !Number.isInteger(actionId)) return { ok: false, reason: 'invalido' };
  if (a.status !== 0) return { ok: false, reason: 'caido' };
  if (actionId !== NO_ACTION) {
    const d = ACTION_BY_ID.get(actionId);
    if (!d) return { ok: false, reason: 'acao_invalida' };
    if (a.vehicle && !a.onPlatform) return { ok: false, reason: 'em_veiculo' };
    if (a.ent && !isAvailable(`action:${d.key}`, a.ent)) return { ok: false, reason: 'bloqueado' };
    if (d.needs) {
      const p = PROP_BY_ID.get(a.prop);
      if (!p || !d.needs.includes(p.kind)) return { ok: false, reason: 'sem_item' };
    }
  }
  return rate(a, now, a.lastAct);
}

export function applyAction(a: ActionActor, actionId: number, now: number) {
  a.recent.push(now);
  a.lastAct = now;
  a.act = actionId;
  a.actAt = now;
}

/** pedido de item (0 = mãos vazias) com design opcional (0 = padrão do item) */
export function validateProp(a: ActionActor, propId: unknown, designId: unknown, now: number): RuleResult {
  if (typeof propId !== 'number' || !Number.isInteger(propId)) return { ok: false, reason: 'invalido' };
  if (a.status !== 0) return { ok: false, reason: 'caido' };
  if (propId !== NO_PROP) {
    const p = PROP_BY_ID.get(propId);
    if (!p) return { ok: false, reason: 'item_invalido' };
    if (a.vehicle && !a.onPlatform) return { ok: false, reason: 'em_veiculo' };
    // item de confronto: só o que foi pego (nunca sai do nada pela roda)
    if (p.category === 'COMBAT_PROP' && a.carried !== propId) return { ok: false, reason: 'sem_item' };
    if (designId !== undefined && designId !== NO_DESIGN) {
      const d = typeof designId === 'number' ? DESIGN_BY_ID.get(designId) : undefined;
      if (!d) return { ok: false, reason: 'design_invalido' };
      if (!p.designSlot || !d.targets.includes(p.designSlot)) return { ok: false, reason: 'design_incompativel' };
      if (a.ent && !isAvailable(`design:${d.key}`, a.ent)) return { ok: false, reason: 'bloqueado' };
    }
  }
  return rate(a, now, a.lastProp);
}

export function applyProp(a: ActionActor, propId: number, designId: number, now: number) {
  a.recent.push(now);
  a.lastProp = now;
  a.prop = propId;
  a.design = propId === NO_PROP ? NO_DESIGN : designId;
  // ação que dependia do item anterior termina
  const d = ACTION_BY_ID.get(a.act);
  const p = PROP_BY_ID.get(propId);
  if (d?.needs && (!p || !d.needs.includes(p.kind))) { a.act = NO_ACTION; a.actAt = now; }
}

/** o movimento cancela a ação atual? */
export function cancelsOnMove(actionId: number, movedM: number): boolean {
  if (actionId === NO_ACTION || movedM < ACTION_RULES.moveCancelM) return false;
  return !ACTION_BY_ID.get(actionId)?.allowMove;
}

/** a ação `once` já acabou (o servidor zera o estado) */
export function onceFinished(a: Pick<ActionActor, 'act' | 'actAt'>, now: number): boolean {
  return a.act !== NO_ACTION && actionExpired(a.act, a.actAt, now);
}
