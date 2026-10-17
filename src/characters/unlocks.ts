/**
 * Desbloqueio de itens do personagem (rodada 8; recompensas na rodada 9) — SEM loja: nada é vendido.
 * Cada peça/acessório/camisa/ação/design tem um nível; `isAvailable` decide com base nos direitos do usuário. O validador
 * de aparência (validateAppearance.ts) e as regras de ação/item (src/social/actionRules.ts) passam por aqui, no cliente
 * (esconder/cadeado) e no servidor (autoridade: direitos vêm de RewardGrant + nível, server/src/progression).
 * Nenhum item dá vantagem de jogo: desbloqueio é só cosmético. Catálogo com requisitos: public/gameplay/rewards.json.
 */
import type { Accessory } from './bodyTypes';
import type { BottomStyle, HairStyle, ShoeStyle, TopStyle } from './garments';

export type UnlockTier = 'FREE' | 'UNLOCKED' | 'PREMIUM' | 'EVENT_REWARD';

/** chave do item: "<camada>:<estilo>" (ex.: "top:polo", "acc:bone", "shirt:200"); rodada 9: "action:<key>", "design:<key>" */
export type ItemKey = `top:${TopStyle}` | `bottom:${BottomStyle}` | `shoes:${ShoeStyle}` | `hair:${HairStyle}` | `acc:${Accessory}` | `shirt:${number}` | `action:${string}` | `design:${string}`;

/**
 * exceções à regra (tudo que não está aqui é FREE). Rodada 9: recompensas de progressão/evento — a MESMA lista de
 * public/gameplay/rewards.json (tests/progression.test.ts confere). Só itens novos ou pouco usados: nada que era de
 * todo mundo vira pago; PREMIUM_FUTURE do catálogo não bloqueia nada ("em breve", nunca cobrado).
 */
export const ITEM_TIERS: Partial<Record<ItemKey, UnlockTier>> = {
  'shirt:205': 'UNLOCKED', 'shirt:206': 'UNLOCKED', 'shirt:207': 'UNLOCKED',
  'acc:bolsa': 'UNLOCKED',
  'action:dance_classic': 'UNLOCKED', 'action:jump_cheer': 'UNLOCKED',
  'design:mar_e_mata': 'UNLOCKED', 'design:por_do_sol': 'EVENT_REWARD',
};

export function tierOf(item: ItemKey): UnlockTier {
  return ITEM_TIERS[item] ?? 'FREE';
}

/** direitos do usuário sobre itens não gratuitos (recompensas de missão/conquista/nível/evento) */
export interface ItemEntitlements {
  /** itens liberados individualmente (UNLOCKED/PREMIUM/EVENT_REWARD) */
  items?: ReadonlySet<string>;
}

export function isAvailable(item: ItemKey, ent: ItemEntitlements = {}): boolean {
  return tierOf(item) === 'FREE' || !!ent.items?.has(item);
}

/** direitos locais do cliente (cópia do `prog` do servidor) — só para esconder/pôr cadeado; quem decide é o servidor */
export const localEntitlements: { items: ReadonlySet<string> } = { items: new Set() };
export function setLocalEntitlements(items: Iterable<string>) { localEntitlements.items = new Set(items); }
