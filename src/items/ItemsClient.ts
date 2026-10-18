/**
 * Itens de confronto no CLIENTE (rodada 9): só intenções — `item_pick {i}` / `item_drop` / `prop` (guardar/sacar);
 * o servidor decide (alcance, posse, troca) e responde com `item_list` / `item_self` / `item_denied`.
 * Mostra o que há no chão (GroundItemsView) e o indicador MÃOS (HandIndicator, só escreve quando muda).
 *
 * Teclas (desktop): T pega o item ao alcance (trocando, o atual cai) ou, sem nada perto, LARGA o possuído; Z larga;
 * X guarda/saca o possuído (a mão fica livre para bandeira/cartaz). Toque: tocar na pílula MÃOS (pegar/largar).
 */
import { PROPS, PROP_BY_ID, isCombatProp } from '../social/props';
import { decodeItemList, ITEM_DENIAL_TEXT, type CombatPropsData, type ItemDenial, type ItemSelf } from './protocol';
import { GroundItemsView } from './GroundItemsView';
import type { HandIndicator } from '../ui/hud/HandIndicator';

export interface ItemsNet {
  on(type: string, fn: (m: any) => void): () => void;
  send(type: string, payload?: unknown): void;
}

/** alcance mostrado ao jogador (um pouco abaixo do do servidor, 2,2 m: pedido nunca chega "longe" por arredondamento) */
export const PICK_HINT_M = 2.0;

const COMBAT_PROP_IDS = PROPS.filter((p) => p.category === 'COMBAT_PROP').map((p) => p.id);

export class ItemsClient {
  readonly view: GroundItemsView;
  /** item de confronto possuído (servidor) */
  carried: ItemSelf = { c: 0, i: 0 };
  near: { id: number; prop: number; d: number } | null = null;
  lastDenial = '';
  /** combat_props.json `freeCombatProps`: a roda oferece todos os itens de confronto (o servidor confere o mesmo dado) */
  free = false;
  private offs: (() => void)[] = [];

  constructor(ground: (x: number, z: number) => number, private hand: HandIndicator, private notify: (msg: string) => void) {
    this.view = new GroundItemsView(ground);
  }

  /** dados públicos dos pontos de apoio (caixotes visíveis mesmo vazios) */
  async loadRacks(base: string, axis: [number, number][]) {
    try {
      const r = await fetch(`${base}gameplay/combat_props.json`);
      if (!r.ok) return;
      const d = (await r.json()) as CombatPropsData;
      this.free = d.freeCombatProps === true;
      this.view.setRacks(d.supply?.racks ?? [], axis);
    } catch { /* sem apoio desenhado: os itens ainda aparecem pela lista do servidor */ }
  }

  attach(net: ItemsNet) {
    this.detach();
    this.offs.push(
      net.on('item_list', (raw) => { const l = decodeItemList(raw); if (l) this.view.apply(l); }),
      net.on('item_self', (m: ItemSelf) => { this.carried = { c: Number(m?.c) || 0, i: Number(m?.i) || 0 }; }),
      net.on('item_denied', (r: ItemDenial) => { this.lastDenial = String(r); this.notify(ITEM_DENIAL_TEXT[r] ?? `Item: ${r}`); }),
    );
    this.net = net;
  }
  private net: ItemsNet | null = null;
  detach() { for (const f of this.offs) f(); this.offs = []; this.net = null; }

  /** por quadro (barato: dezenas de itens no máximo): item ao alcance e indicador MÃOS */
  update(x: number, z: number, heldProp: number) {
    this.near = this.view.nearest(x, z, PICK_HINT_M);
    const held = PROP_BY_ID.get(heldProp);
    const own = PROP_BY_ID.get(this.carried.c);
    this.hand.set({
      held: held ? held.label : null,
      stowed: own && heldProp !== own.id ? own.label : null,
      near: this.near ? PROP_BY_ID.get(this.near.prop)?.label ?? 'item' : null,
      canDrop: !!own,
    });
  }

  /** R / toque: pega o que está perto; senão larga o possuído */
  pickOrDrop() {
    if (!this.net) return;
    if (this.near) this.net.send('item_pick', { i: this.near.id });
    else if (this.carried.c) this.net.send('item_drop', {});
    else this.notify(this.free ? 'Nenhum item por perto — taco, barra e spray também estão na roda (G → itens)' : 'Nenhum item por perto (pontos de apoio só nas áreas de confronto)');
  }

  /** Z: larga o possuído (à frente dos pés) */
  drop() {
    if (!this.net) return;
    if (this.carried.c) this.net.send('item_drop', {});
    else this.notify('Você não está com nenhum item');
  }

  /** X: guarda (mão livre) / saca o item possuído — pelo `prop` normal (o servidor confere a posse) */
  stowToggle(heldProp: number, requestProp: (id: number) => void) {
    if (!this.carried.c) return;
    requestProp(heldProp === this.carried.c ? 0 : this.carried.c);
  }

  /** a roda de ações oferece o item possuído (além dos sociais) — ou, com `free`, todos os de confronto */
  get wheelExtra(): number[] {
    if (this.free) return COMBAT_PROP_IDS;
    return this.carried.c && isCombatProp(this.carried.c) ? [this.carried.c] : [];
  }

  info() { return { carried: { ...this.carried }, near: this.near, items: this.view.list, lastDenial: this.lastDenial, hand: this.hand.text, free: this.free, wheel: this.wheelExtra }; }
}
