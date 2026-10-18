/**
 * ITENS NO MUNDO (rodada 9) — contrato compartilhado: itens de confronto (src/social/props.ts categoria COMBAT_PROP)
 * que ficam em PONTOS DE APOIO (dados: public/gameplay/combat_props.json `supply.racks`, só perto de áreas COMBAT/
 * CONTESTED — quem é pacífico nunca precisa deles) ou largados no CHÃO. O servidor é a autoridade (server/src/items):
 * lista, alcance para pegar, expiração (`groundTtlMs` por item) e volta ao apoio, teto de itens no chão.
 *
 * Mensagens `item_*` (o `prop` existente continua sendo o "o que está na mão"):
 *   cliente → servidor  item_pick {i}      pegar o item i (perto); já tendo um, TROCA (o atual cai no lugar)
 *                       item_drop {}       largar o item que possui (na frente dos pés)
 *   servidor → cliente  item_list [...]    itens na área de interesse (só quando muda para este cliente)
 *                       item_self {c, i}   item que o próprio possui (prop id, item id; 0 = nenhum)
 *                       item_denied r      pedido negado (ItemDenial)
 * Guardar/sacar sem largar: `prop {p: 0}` / `prop {p: c}` (actionRules.validateProp aceita item de confronto só se
 * for o possuído).
 */
import type { CombatPropDefinition } from '../combat/types';
import type { WorldPoint } from '../events/schedule';
import { pointOnAxis } from '../world/zones';

/** no apoio (estoque) ou largado no chão; carregado não aparece na lista */
export const ITEM_STATE = { RACK: 0, GROUND: 1 } as const;
export type ItemState = (typeof ITEM_STATE)[keyof typeof ITEM_STATE];

export interface ItemView { id: number; prop: number; x: number; z: number; state: ItemState }
export interface ItemSelf { c: number; i: number }
export type ItemDenial = 'inexistente' | 'longe' | 'ocupado' | 'sem_item' | 'caido' | 'em_veiculo' | 'rapido' | 'invalido';

export const ITEM_DENIAL_TEXT: Record<ItemDenial, string> = {
  inexistente: 'Esse item não está mais aí',
  longe: 'Chegue mais perto para pegar',
  ocupado: 'Alguém já pegou esse item',
  sem_item: 'Você não está com nenhum item',
  caido: 'Espere levantar',
  em_veiculo: 'Saia do veículo primeiro',
  rapido: 'Devagar…',
  invalido: 'Pedido inválido',
};

/** item_list: plano [id, prop, x·10, z·10, estado] por item (JSON curto; ≤ dezenas de itens por cliente) */
export function encodeItemList(list: readonly ItemView[]): number[] {
  const out: number[] = [];
  for (const it of list) out.push(it.id, it.prop, Math.round(it.x * 10), Math.round(it.z * 10), it.state);
  return out;
}

export function decodeItemList(raw: unknown): ItemView[] | null {
  if (!Array.isArray(raw) || raw.length % 5) return null;
  const out: ItemView[] = [];
  for (let i = 0; i < raw.length; i += 5) {
    const [id, prop, x, z, st] = raw.slice(i, i + 5);
    if (![id, prop, x, z, st].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    out.push({ id, prop, x: x / 10, z: z / 10, state: st === ITEM_STATE.GROUND ? ITEM_STATE.GROUND : ITEM_STATE.RACK });
  }
  return out;
}

// ------------------------------------------------------------------ dados (public/gameplay/combat_props.json)
export interface SupplyRack {
  id: string;
  /** posição: x/z ou fração do eixo da avenida (+ lado, m) */
  at: WorldPoint;
  /** orientação (rad) da fileira de itens; padrão: ao longo do eixo */
  heading?: number;
  /** prop ids no estoque (um item por entrada) */
  props: number[];
}

export interface SupplyConfig {
  /** teto de itens LARGADOS no chão ao mesmo tempo (o mais antigo volta ao apoio) */
  maxGround: number;
  /** alcance para pegar (m, da posição aceita pelo servidor) */
  pickRangeM: number;
  /** raio da área de interesse dos itens (m) */
  aoiM: number;
  racks: SupplyRack[];
}

/** fragmento `props` de public/gameplay/combat.json (o carregador do confronto mescla) + pontos de apoio */
export interface CombatPropsData {
  version: 1;
  props: CombatPropDefinition[];
  supply: SupplyConfig;
  /** taco/barra/spray direto da roda (ITENS), sem passar pelo apoio — servidor (validateProp) e cliente (roda) */
  freeCombatProps?: boolean;
}

/** apoio resolvido no mundo + posição de cada vaga (itens lado a lado, 0,45 m) */
export function rackPlacement(r: SupplyRack, axis: [number, number][]): { x: number; z: number; heading: number; slots: { x: number; z: number }[] } {
  const p = 't' in r.at ? pointOnAxis(axis, r.at.t, r.at.side ?? 0) : { x: r.at.x, z: r.at.z, heading: 0 };
  const h = r.heading ?? ('heading' in p ? p.heading : 0);
  const n = r.props.length;
  // fileira perpendicular a `h` (heading: 0 = +z)
  const ux = Math.cos(h), uz = -Math.sin(h);
  const slots = r.props.map((_, k) => { const o = (k - (n - 1) / 2) * 0.45; return { x: p.x + ux * o, z: p.z + uz * o }; });
  return { x: p.x, z: p.z, heading: h, slots };
}
