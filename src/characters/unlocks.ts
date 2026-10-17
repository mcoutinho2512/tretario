/**
 * Desbloqueio de itens do personagem (rodada 8) — ARQUITETURA preparada, sem loja: hoje tudo é FREE.
 * Cada peça/acessório/camisa tem um nível; `isAvailable` decide com base nos direitos do usuário. O validador de
 * aparência (validateAppearance.ts) já passa por aqui, no cliente (esconder) e no servidor (autoridade).
 * Nenhum item dá vantagem de jogo: desbloqueio é só cosmético.
 */
import type { Accessory } from './bodyTypes';
import type { BottomStyle, HairStyle, ShoeStyle, TopStyle } from './garments';

export type UnlockTier = 'FREE' | 'UNLOCKED' | 'PREMIUM' | 'EVENT_REWARD';

/** chave do item: "<camada>:<estilo>" (ex.: "top:polo", "acc:bone", "shirt:200") */
export type ItemKey = `top:${TopStyle}` | `bottom:${BottomStyle}` | `shoes:${ShoeStyle}` | `hair:${HairStyle}` | `acc:${Accessory}` | `shirt:${number}`;

/** exceções à regra (tudo que não está aqui é FREE). Vazio de propósito nesta rodada. */
export const ITEM_TIERS: Partial<Record<ItemKey, UnlockTier>> = {};

export function tierOf(item: ItemKey): UnlockTier {
  return ITEM_TIERS[item] ?? 'FREE';
}

/** direitos do usuário sobre itens não gratuitos (futuro: compras, recompensas de evento) */
export interface ItemEntitlements {
  /** itens liberados individualmente (UNLOCKED/PREMIUM/EVENT_REWARD) */
  items?: ReadonlySet<string>;
}

export function isAvailable(item: ItemKey, ent: ItemEntitlements = {}): boolean {
  return tierOf(item) === 'FREE' || !!ent.items?.has(item);
}
