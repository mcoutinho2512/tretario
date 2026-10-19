/**
 * Rodada 11 — CATÁLOGO do inventário (puro, sem DOM/three.js): uma VISÃO do que já existe no jogo, montada a cada
 * abertura a partir dos registros únicos — peças por corpo (garments.ts), acessórios (bodyTypes.ts), camisas e artes
 * (designs.ts), seguráveis e itens de confronto (props.ts), torcidas (DADOS public/gameplay/supporters.json) e
 * títulos (recompensas `title` das missões/conquistas). Nada é inventado: categoria sem conteúdo não aparece.
 *
 * Estado de cada item: `equipped` (está no avatar/na mão/no perfil agora), `available` (pode equipar) ou `locked`
 * (com o MOTIVO da progressão: "Nível 4", "Missão: …", "Conquista: …" — nunca preço; não há loja). O servidor decide
 * de novo ao equipar (docs/EQUIPMENT_SYSTEM.md): este catálogo só desenha a interface.
 */
import type { CharacterAppearance } from '../characters/bodyTypes';
import { ACCESSORIES, type Accessory } from '../characters/bodyTypes';
import { STYLE_LABELS, resolveStyle, stylesFor, type GarmentSlot } from '../characters/garments';
import { isAvailable, tierOf, type ItemKey } from '../characters/unlocks';
import { DESIGNS, DESIGN_BY_ID, DESIGN_BY_KEY, type Design } from '../social/designs';
import { PROPS, PROP_BY_ID, type PropDefinition } from '../social/props';
import type { SupporterData } from '../supporters/types';
import { requirementOf, type ProgressionCatalog } from '../progression/engine';
import type { EquipSlot, InventoryCategory, InventoryFilter, InventoryItem } from './types';
import { PERSONAL_KINDS, PERSONAL_LABEL } from '../vehicles/personal'; // rodada 12 — veículo pessoal

/** rótulos dos acessórios (mesmos textos do editor) */
export const ACCESSORY_LABEL: Record<Accessory, string> = { nenhum: 'Nenhum', bone: 'Boné', chapeu: 'Chapéu', oculos: 'Óculos', mochila: 'Sacola', bolsa: 'Bolsa' };

/** ordem e nomes das categorias na interface */
export const CATEGORY_ORDER: readonly InventoryCategory[] = ['ROUPAS', 'ACESSORIOS', 'ITENS', 'MANIFESTACAO', 'BANDEIRAS', 'EQUIPAMENTOS', 'VEICULOS', 'TORCIDA', 'TITULOS', 'COSMETICOS'];
export const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  ROUPAS: 'Roupas', ACESSORIOS: 'Acessórios', ITENS: 'Itens', MANIFESTACAO: 'Manifestação', BANDEIRAS: 'Bandeiras',
  EQUIPAMENTOS: 'Equipamentos', TORCIDA: 'Torcida', TITULOS: 'Títulos', COSMETICOS: 'Cosméticos', VEICULOS: 'Veículos',
};
export const FILTER_LABEL: Record<InventoryFilter, string> = { TODOS: 'Todos', EQUIPADOS: 'Equipados', DESBLOQUEADOS: 'Desbloqueados', NOVOS: 'Novos' };

/** o que o jogador tem AGORA (cópia local do que o servidor confirmou) */
export interface InventoryContext {
  app: CharacterAppearance;
  /** item na mão (NetPlayer.prop/design) */
  prop: number;
  design: number;
  /** direitos (itens UNLOCKED/EVENT_REWARD liberados) — cópia do `prog` do servidor */
  ent: ReadonlySet<string>;
  /** item de confronto POSSUÍDO (servidor) e `freeCombatProps` (dado) */
  carried: number;
  freeCombat: boolean;
  /** títulos ganhos (texto) e o equipado */
  titles: readonly string[];
  title: string | null;
  /** torcidas (dados) e a escolhida (id; neutro/null = nenhuma) */
  supporters: SupporterData | null;
  supporter: string | null;
  /** catálogo de progressão (requisitos dos bloqueados); ausente = "Bloqueado" */
  progression?: ProgressionCatalog | null;
  /** chaves já vistas (marcador NOVO, local) */
  seen?: ReadonlySet<string>;
  /** rodada 12 — veículo pessoal em que está montado agora (tipo) */
  vehicle?: string | null;
}

/** item do inventário com o que a interface precisa para desenhar/agir */
export interface InventoryEntry extends InventoryItem {
  /** design (camisa/bandeira) — miniatura de cor */
  designId?: number;
  /** segurável/equipamento */
  propId?: number;
  /** grupo da torcida (id dos dados) */
  group?: string;
  /** a prévia 3D vale para este item (roupa, acessório, camisa) */
  preview3d: boolean;
  /** cabe DESEQUIPAR (peça base de roupa não: sempre há uma) */
  removable: boolean;
}

const GARMENT: { slot: GarmentSlot; prefix: 'top' | 'bottom' | 'shoes' | 'hair'; eq: EquipSlot; kind: string; field: 'topStyle' | 'bottomStyle' | 'shoeStyle' | 'hairStyle' }[] = [
  { slot: 'SHIRT', prefix: 'top', eq: 'TORSO', kind: 'Parte de cima', field: 'topStyle' },
  { slot: 'PANTS', prefix: 'bottom', eq: 'LEGS', kind: 'Parte de baixo', field: 'bottomStyle' },
  { slot: 'SHOES', prefix: 'shoes', eq: 'FEET', kind: 'Calçado', field: 'shoeStyle' },
  { slot: 'HAIR', prefix: 'hair', eq: 'HEAD', kind: 'Cabelo', field: 'hairStyle' },
];

/** designs que pertencem às torcidas (camisa, bandeiras, faixas e cosméticos dos DADOS) */
export function supporterDesignIds(data: SupporterData | null): Set<number> {
  const s = new Set<number>();
  for (const g of data?.groups ?? []) for (const id of [g.clothingSet.shirtDesign, ...g.flagSet, ...g.bannerSet, ...g.allowedCosmetics]) s.add(id);
  return s;
}

const HOLD_TARGETS = ['flag', 'sign', 'banner'] as const;
const holdable = (d: Design) => d.targets.some((t) => (HOLD_TARGETS as readonly string[]).includes(t));
const targetLabel = (d: Design) => {
  const t = d.targets.filter((x) => (HOLD_TARGETS as readonly string[]).includes(x));
  return t.length >= 3 ? 'Bandeira / cartaz / faixa' : t.map((x) => (x === 'flag' ? 'Bandeira' : x === 'sign' ? 'Cartaz' : 'Faixa')).join(' / ');
};

/** monta o inventário inteiro (todas as categorias com conteúdo) */
export function buildInventory(ctx: InventoryContext): InventoryEntry[] {
  const out: InventoryEntry[] = [];
  const ent = { items: ctx.ent };
  const reason = (key: string) => (ctx.progression ? requirementOf(ctx.progression, key) : 'Bloqueado');
  const seen = ctx.seen;
  /** NOVO = desbloqueio (não gratuito) que a pessoa ainda não viu */
  const fresh = (key: string, unlockedNonFree: boolean) => unlockedNonFree && !!seen && !seen.has(key);
  const supIds = supporterDesignIds(ctx.supporters);
  const app = ctx.app;

  // ---- ROUPAS: peças que ESTE corpo veste (base primeiro) + camisas estampadas
  for (const g of GARMENT) {
    const cur = resolveStyle(app.body, g.slot, app[g.field]);
    const base = resolveStyle(app.body, g.slot, undefined);
    for (const st of stylesFor(app.body, g.slot)) {
      const key = `${g.prefix}:${st}` as ItemKey;
      const ok = isAvailable(key, ent);
      out.push({
        key, category: 'ROUPAS', slot: g.eq, label: STYLE_LABELS[st as keyof typeof STYLE_LABELS] ?? st, kind: g.kind,
        state: !ok ? 'locked' : st === cur ? 'equipped' : 'available', ...(ok ? {} : { lockedReason: reason(key) }),
        isNew: fresh(key, ok && tierOf(key) !== 'FREE'), quickbar: false, preview3d: true, removable: st !== base,
      });
    }
  }
  for (const d of DESIGNS) {
    if (!d.targets.includes('shirt') || supIds.has(d.id)) continue;
    out.push(shirtEntry(d, 'ROUPAS', 'Camisa estampada', app, ent, reason, fresh));
  }

  // ---- ACESSÓRIOS (um por vez: slot único)
  for (const a of ACCESSORIES) {
    if (a === 'nenhum') continue;
    const key = `acc:${a}` as ItemKey;
    const ok = isAvailable(key, ent);
    out.push({
      key, category: 'ACESSORIOS', slot: 'ACCESSORY', label: ACCESSORY_LABEL[a], kind: 'Acessório',
      state: !ok ? 'locked' : app.accessory === a ? 'equipped' : 'available', ...(ok ? {} : { lockedReason: reason(key) }),
      isNew: fresh(key, ok && tierOf(key) !== 'FREE'), quickbar: false, preview3d: true, removable: true,
    });
  }

  // ---- seguráveis: ITENS (sem arte), MANIFESTAÇÃO (bandeiras/cartazes/faixas), EQUIPAMENTOS (confronto)
  for (const p of PROPS) out.push(propEntry(p, ctx));

  // ---- BANDEIRAS: artes de bandeira/cartaz/faixa (as das torcidas ficam em TORCIDA)
  for (const d of DESIGNS) {
    if (!holdable(d) || supIds.has(d.id)) continue;
    out.push(designEntry(d, 'BANDEIRAS', targetLabel(d), ctx, ent, reason, fresh));
  }

  // ---- TORCIDA: a escolha (dados) + camisa e bandeiras/faixas de cada uma
  for (const g of ctx.supporters?.groups ?? []) {
    out.push({
      key: `sup:${g.id}`, category: 'TORCIDA', slot: 'SUPPORTER', label: g.displayName, kind: 'Torcida', group: g.id,
      state: ctx.supporter === g.id ? 'equipped' : 'available', quickbar: false, preview3d: false, removable: true,
    });
    const shirt = DESIGN_BY_ID.get(g.clothingSet.shirtDesign);
    if (shirt) out.push({ ...shirtEntry(shirt, 'TORCIDA', `Camisa da torcida · ${g.shortName}`, app, ent, reason, fresh), group: g.id });
    for (const id of [...g.flagSet, ...g.bannerSet]) {
      const d = DESIGN_BY_ID.get(id);
      if (d && holdable(d)) out.push({ ...designEntry(d, 'TORCIDA', `${targetLabel(d)} da torcida · ${g.shortName}`, ctx, ent, reason, fresh), group: g.id });
    }
  }

  // ---- VEÍCULOS (rodada 12): veículo pessoal — escolher = aparece junto e monta (o servidor decide o ponto/estado)
  for (const k of PERSONAL_KINDS) {
    out.push({ key: `veh:${k}`, category: 'VEICULOS', slot: 'VEHICLE', label: PERSONAL_LABEL[k], kind: 'Veículo pessoal', state: ctx.vehicle === k ? 'equipped' : 'available', quickbar: true, preview3d: false, removable: true });
  }

  // ---- TÍTULOS (recompensas `title` das missões/conquistas; ganhos pelo servidor)
  const owned = new Set(ctx.titles);
  for (const t of titleCatalog(ctx.progression)) {
    const has = owned.has(t.title);
    const key = `title:${t.title}` as const;
    out.push({
      key, category: 'TITULOS', slot: 'TITLE', label: t.title, kind: 'Título',
      state: !has ? 'locked' : ctx.title === t.title ? 'equipped' : 'available', ...(has ? {} : { lockedReason: t.source }),
      isNew: fresh(key, has), quickbar: false, preview3d: false, removable: true,
    });
  }
  // título ganho que o catálogo local não conhece (dados mais novos no servidor): aparece mesmo assim
  for (const t of ctx.titles) if (!out.some((e) => e.key === `title:${t}`)) {
    out.push({ key: `title:${t}`, category: 'TITULOS', slot: 'TITLE', label: t, kind: 'Título', state: ctx.title === t ? 'equipped' : 'available', isNew: fresh(`title:${t}`, true), quickbar: false, preview3d: false, removable: true });
  }
  return out;
}

function shirtEntry(d: Design, category: InventoryCategory, kind: string, app: CharacterAppearance, ent: { items: ReadonlySet<string> }, reason: (k: string) => string, fresh: (k: string, n: boolean) => boolean): InventoryEntry {
  const key = `shirt:${d.id}` as ItemKey;
  const ok = isAvailable(key, ent);
  return {
    key, category, slot: 'TORSO', label: d.label, kind, designId: d.id,
    state: !ok ? 'locked' : app.shirtDesign === d.id && resolveStyle(app.body, 'SHIRT', app.topStyle) === 'camiseta' ? 'equipped' : 'available',
    ...(ok ? {} : { lockedReason: reason(key) }), isNew: fresh(key, ok && tierOf(key) !== 'FREE'), quickbar: false, preview3d: true, removable: true,
  };
}

function designEntry(d: Design, category: InventoryCategory, kind: string, ctx: InventoryContext, ent: { items: ReadonlySet<string> }, reason: (k: string) => string, fresh: (k: string, n: boolean) => boolean): InventoryEntry {
  const key = `design:${d.key}` as ItemKey;
  const ok = isAvailable(key, ent);
  const held = PROP_BY_ID.get(ctx.prop);
  const on = !!held?.designSlot && d.targets.includes(held.designSlot) && ctx.design === d.id;
  return {
    key, category, slot: 'HAND', label: d.label, kind, designId: d.id,
    state: !ok ? 'locked' : on ? 'equipped' : 'available', ...(ok ? {} : { lockedReason: reason(key) }),
    isNew: fresh(key, ok && tierOf(key) !== 'FREE'), quickbar: ok, preview3d: false, removable: true,
  };
}

function propEntry(p: PropDefinition, ctx: InventoryContext): InventoryEntry {
  const combat = p.category === 'COMBAT_PROP';
  const owns = !combat || ctx.freeCombat || ctx.carried === p.id;
  const category: InventoryCategory = combat ? 'EQUIPAMENTOS' : p.designSlot ? 'MANIFESTACAO' : 'ITENS';
  return {
    key: `prop:${p.id}`, category, slot: 'HAND', label: p.label, propId: p.id,
    kind: combat ? 'Equipamento de confronto' : p.designSlot ? 'Item de manifestação' : 'Item segurável',
    state: !owns ? 'locked' : ctx.prop === p.id ? 'equipped' : 'available',
    ...(owns ? {} : { lockedReason: 'Pegue num ponto de apoio (zonas de confronto)' }),
    quickbar: true, preview3d: false, removable: true,
  };
}

/** títulos que o jogo dá (texto + de onde vem), na ordem dos dados */
export function titleCatalog(cat: ProgressionCatalog | null | undefined): { title: string; source: string }[] {
  const out: { title: string; source: string }[] = [];
  if (!cat) return out;
  for (const m of cat.missions) for (const r of m.rewards) if (r.kind === 'title' && r.title) out.push({ title: r.title, source: `Missão: ${m.title}` });
  for (const a of cat.achievements) for (const r of a.rewards) if (r.kind === 'title' && r.title) out.push({ title: r.title, source: a.hidden ? 'Conquista secreta' : `Conquista: ${a.title}` });
  return out;
}

/** categorias com conteúdo (na ordem da interface) */
export function categoriesWithContent(items: readonly InventoryItem[]): InventoryCategory[] {
  const has = new Set(items.map((i) => i.category));
  return CATEGORY_ORDER.filter((c) => has.has(c));
}

/** filtro da lista */
export function filterItems<T extends InventoryItem>(items: readonly T[], f: InventoryFilter, category?: InventoryCategory | null): T[] {
  return items.filter((i) => (!category || i.category === category) && (
    f === 'TODOS' ? true : f === 'EQUIPADOS' ? i.state === 'equipped' : f === 'DESBLOQUEADOS' ? i.state !== 'locked' : !!i.isNew));
}

/** o que está em cada slot agora (resumo "Equipado") */
export function equippedBySlot(items: readonly InventoryItem[]): Partial<Record<EquipSlot, InventoryItem>> {
  const out: Partial<Record<EquipSlot, InventoryItem>> = {};
  for (const i of items) {
    if (i.state !== 'equipped') continue;
    // TORSO: a camisa estampada vence a peça (é o que se vê); HAND: o item vence a arte (a arte vai junto)
    const prev = out[i.slot];
    if (prev && ((i.slot === 'TORSO' && prev.key.startsWith('shirt:')) || (i.slot === 'HAND' && prev.key.startsWith('prop:')))) continue;
    out[i.slot] = i;
  }
  return out;
}

/** design pelo item (`design:<key>` ou `shirt:<id>`) */
export function designOfKey(key: string): Design | undefined {
  if (key.startsWith('design:')) return DESIGN_BY_KEY.get(key.slice(7));
  if (key.startsWith('shirt:')) return DESIGN_BY_ID.get(Number(key.slice(6)));
  return undefined;
}
