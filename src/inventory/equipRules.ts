/**
 * Rodada 11 — REGRAS de equipar (puras, sem DOM; o servidor importa as que validam). docs/EQUIPMENT_SYSTEM.md
 *
 *  planEquip / planUnequip  item do inventário → PEDIDO a fazer (aparência nova, item na mão, título, torcida). Um
 *                           pedido por slot: a aparência tem um campo por peça; a mão (HAND) é um campo só (`prop`) —
 *                           bandeira, cartaz, megafone e taco disputam a mesma mão, o anterior sai (o de confronto
 *                           possuído fica GUARDADO, como no X); camisa estampada exige o modelo camiseta (troca junto)
 *  lockedAppearanceItems    o que, numa aparência pedida, está BLOQUEADO para estes direitos — o servidor RECUSA o
 *                           pedido estrito do inventário (PUT /api/me/appearance {strict:true} → 403 `bloqueado`) em vez
 *                           de trocar em silêncio pelo padrão
 *  validateTitle            título pedido × títulos ganhos (grants `title:<texto>` do servidor)
 */
import type { CharacterAppearance } from '../characters/bodyTypes';
import { ACCESSORIES, type Accessory } from '../characters/bodyTypes';
import { GARMENT_SLOTS, SLOT_FIELD, resolveStyle, type GarmentSlot } from '../characters/garments';
import { isAvailable, type ItemEntitlements, type ItemKey } from '../characters/unlocks';
import { sanitizeShirtDesign } from '../net/protocol';
import { DESIGN_BY_ID, DESIGN_BY_KEY } from '../social/designs';
import { PROPS, PROP_BY_ID, NO_PROP } from '../social/props';

export type EquipPlan =
  | { kind: 'appearance'; app: CharacterAppearance }
  | { kind: 'prop'; prop: number; design?: number }
  | { kind: 'title'; title: string | null }
  | { kind: 'supporter'; group: string }
  | { kind: 'none'; reason: string };

export interface EquipState {
  app: CharacterAppearance;
  prop: number;
  design: number;
  /** id do neutro (dados das torcidas) — desequipar a torcida */
  neutralId?: string | null;
}

const PREFIX_SLOT: Record<string, GarmentSlot> = { top: 'SHIRT', bottom: 'PANTS', shoes: 'SHOES', hair: 'HAIR' };

/** pedido para EQUIPAR `key` sobre o estado atual */
export function planEquip(key: string, s: EquipState): EquipPlan {
  const [pre, ...restParts] = key.split(':');
  const rest = restParts.join(':');
  const app = s.app;
  const slot = PREFIX_SLOT[pre];
  if (slot) {
    const st = resolveStyle(app.body, slot, rest);
    if (st !== rest) return { kind: 'none', reason: 'Essa peça não serve neste corpo' };
    const next: CharacterAppearance = { ...app, [SLOT_FIELD[slot]]: rest };
    // camisa estampada só existe no modelo camiseta: trocar a parte de cima tira a estampa
    if (slot === 'SHIRT' && rest !== 'camiseta') next.shirtDesign = 0;
    return { kind: 'appearance', app: next };
  }
  if (pre === 'shirt') {
    const id = Number(rest);
    if (!DESIGN_BY_ID.get(id)?.targets.includes('shirt')) return { kind: 'none', reason: 'Camisa inexistente' };
    return { kind: 'appearance', app: { ...app, topStyle: 'camiseta', shirtDesign: id } };
  }
  if (pre === 'acc') {
    if (!(ACCESSORIES as readonly string[]).includes(rest) || rest === 'nenhum') return { kind: 'none', reason: 'Acessório inexistente' };
    return { kind: 'appearance', app: { ...app, accessory: rest as Accessory } };
  }
  if (pre === 'prop') {
    const id = Number(rest);
    if (!PROP_BY_ID.has(id)) return { kind: 'none', reason: 'Item inexistente' };
    return { kind: 'prop', prop: id };
  }
  if (pre === 'design') {
    const d = DESIGN_BY_KEY.get(rest);
    if (!d) return { kind: 'none', reason: 'Arte inexistente' };
    // o item na mão aceita a arte? troca só a arte; senão pega o primeiro item que aceita (bandeira, cartaz ou faixa)
    const held = PROP_BY_ID.get(s.prop);
    if (held?.designSlot && d.targets.includes(held.designSlot)) return { kind: 'prop', prop: held.id, design: d.id };
    const p = PROPS.find((x) => x.designSlot && d.targets.includes(x.designSlot));
    if (!p) return { kind: 'none', reason: 'Nenhum item usa essa arte' };
    return { kind: 'prop', prop: p.id, design: d.id };
  }
  if (pre === 'title') return { kind: 'title', title: rest };
  if (pre === 'sup') return { kind: 'supporter', group: rest };
  return { kind: 'none', reason: 'Item desconhecido' };
}

/** pedido para DESEQUIPAR `key` (sem obrigar a escolher outro: peça volta para a base, mão fica livre…) */
export function planUnequip(key: string, s: EquipState): EquipPlan {
  const [pre] = key.split(':');
  const app = s.app;
  const slot = PREFIX_SLOT[pre];
  if (slot) {
    const next: CharacterAppearance = { ...app, [SLOT_FIELD[slot]]: resolveStyle(app.body, slot, undefined) };
    if (slot === 'SHIRT' && next.topStyle !== 'camiseta') next.shirtDesign = 0;
    return { kind: 'appearance', app: next };
  }
  if (pre === 'shirt') return { kind: 'appearance', app: { ...app, shirtDesign: 0 } };
  if (pre === 'acc') return { kind: 'appearance', app: { ...app, accessory: 'nenhum' } };
  if (pre === 'prop' || pre === 'design') return { kind: 'prop', prop: NO_PROP };
  if (pre === 'title') return { kind: 'title', title: null };
  if (pre === 'sup') return s.neutralId ? { kind: 'supporter', group: s.neutralId } : { kind: 'none', reason: 'Sem dados de torcida' };
  return { kind: 'none', reason: 'Item desconhecido' };
}

/**
 * itens BLOQUEADOS (unlocks.ts) que uma aparência pedida usa — vazio = tudo liberado. Peças que o corpo não veste
 * não contam (o validador já troca pela base, sem vantagem nenhuma); só o que depende de desbloqueio.
 */
export function lockedAppearanceItems(raw: unknown, ent: ItemEntitlements): ItemKey[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const o = raw as Record<string, unknown>;
  const out: ItemKey[] = [];
  const body = typeof o.body === 'string' ? o.body : null;
  if (typeof o.accessory === 'string' && (ACCESSORIES as readonly string[]).includes(o.accessory)) {
    const k = `acc:${o.accessory}` as ItemKey;
    if (!isAvailable(k, ent)) out.push(k);
  }
  if (body) for (const slot of GARMENT_SLOTS) {
    const want = o[SLOT_FIELD[slot]];
    if (typeof want !== 'string') continue;
    const st = resolveStyle(body as CharacterAppearance['body'], slot, want);
    const k = `${{ SHIRT: 'top', PANTS: 'bottom', SHOES: 'shoes', HAIR: 'hair' }[slot]}:${st}` as ItemKey;
    if (st === want && !isAvailable(k, ent)) out.push(k);
  }
  const d = sanitizeShirtDesign(o.shirtDesign);
  if (d && !isAvailable(`shirt:${d}`, ent)) out.push(`shirt:${d}`);
  return out;
}

/** tamanho máximo do título na rede (os dos dados têm até ~30) */
export const TITLE_MAX = 48;

/** título pedido (`null`/'' = nenhum) contra os títulos ganhos (texto) */
export function validateTitle(owned: Iterable<string>, raw: unknown): { ok: true; title: string | null } | { ok: false; reason: 'invalido' | 'bloqueado' } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, title: null };
  if (typeof raw !== 'string' || raw.length > TITLE_MAX) return { ok: false, reason: 'invalido' };
  for (const t of owned) if (t === raw) return { ok: true, title: raw };
  return { ok: false, reason: 'bloqueado' };
}
