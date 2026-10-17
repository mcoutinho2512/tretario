/**
 * Validador ÚNICO de aparência (rodada 8): o mesmo código para a API (PUT /api/me/appearance), a sala
 * (PresidenteVargasRoom.applyAppearance) e o editor do cliente. Nunca confia no cliente: corpo e acessório de listas
 * fechadas, cores 24 bits, peças que AQUELE corpo veste (senão a roupa base), camisa de time só com modelo camiseta,
 * itens bloqueados (unlocks.ts) caem no padrão. Puro (sem three.js) — importável pelo servidor e pelos testes.
 */
import { ACCESSORIES, DEFAULT_PLAYER_APPEARANCE, type Accessory, type BodyType, type CharacterAppearance } from './bodyTypes';
import { GARMENT_SLOTS, SLOT_FIELD, resolveStyle, type GarmentSlot } from './garments';
import { isAvailable, type ItemEntitlements, type ItemKey } from './unlocks';
import { sanitizeColor, sanitizeShirtDesign } from '../net/protocol';

export const APPEARANCE_BODIES: readonly BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];
const SLOT_ITEM: Record<GarmentSlot, string> = { SHIRT: 'top', PANTS: 'bottom', SHOES: 'shoes', HAIR: 'hair' };

/**
 * Aparência saneada a partir de qualquer valor. `fallback` completa campos ausentes/inválidos (a sala passa a
 * aparência atual do jogador); sem corpo válido em `raw` nem em `fallback` → null.
 */
export function validateAppearance(raw: unknown, fallback?: CharacterAppearance | null, ent: ItemEntitlements = {}): CharacterAppearance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback ? { ...fallback } : null;
  const o = raw as Record<string, unknown>;
  const body = (APPEARANCE_BODIES as readonly unknown[]).includes(o.body) ? (o.body as BodyType) : fallback?.body;
  if (!body) return null;
  const base = fallback && fallback.body === body ? fallback : DEFAULT_PLAYER_APPEARANCE[body];
  const out: CharacterAppearance = {
    body,
    skin: sanitizeColor(o.skin, base.skin),
    hair: sanitizeColor(o.hair, base.hair),
    top: sanitizeColor(o.top, base.top),
    bottom: sanitizeColor(o.bottom, base.bottom),
    shoes: sanitizeColor(o.shoes, base.shoes),
    scale: 1,
  };
  const acc = (ACCESSORIES as readonly unknown[]).includes(o.accessory) ? (o.accessory as Accessory) : (base.accessory ?? 'nenhum');
  out.accessory = isAvailable(`acc:${acc}` as ItemKey, ent) ? acc : 'nenhum';
  out.acc = sanitizeColor(o.acc, base.acc ?? 0x222222);
  for (const slot of GARMENT_SLOTS) {
    const field = SLOT_FIELD[slot];
    const want = typeof o[field] === 'string' ? (o[field] as string) : (base[field] as string | undefined);
    let st = resolveStyle(body, slot, want);
    if (!isAvailable(`${SLOT_ITEM[slot]}:${st}` as ItemKey, ent)) st = resolveStyle(body, slot, undefined);
    Object.assign(out, { [field]: st });
  }
  // camisa de time: só alvo 'shirt' (cores, sem escudos) e só no modelo camiseta
  const d = sanitizeShirtDesign(o.shirtDesign);
  out.shirtDesign = d && out.topStyle === 'camiseta' && isAvailable(`shirt:${d}`, ent) ? d : 0;
  return out;
}

/** igualdade de aparência (campos sincronizados) — testes e "há alterações não salvas?" */
export function sameAppearance(a: CharacterAppearance | null | undefined, b: CharacterAppearance | null | undefined): boolean {
  if (!a || !b) return a === b;
  const keys: (keyof CharacterAppearance)[] = ['body', 'skin', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'acc', 'topStyle', 'bottomStyle', 'shoeStyle', 'hairStyle', 'shirtDesign'];
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
