/**
 * Itens de confronto no mundo (rodada 9) — AUTORIDADE do servidor, sem Colyseus (contrato: src/items/protocol.ts).
 *
 * Cada item tem um APOIO de origem (dados) e está em um de três estados:
 *   RACK     na vaga do apoio (estoque)
 *   GROUND   largado no chão (por quem largou, por quem caiu, por quem saiu) — some depois de `groundTtlMs` e VOLTA
 *            à vaga (o mundo nunca acumula lixo); acima de `maxGround` largados, o mais antigo volta já
 *   CARRIED  com um jogador (no máximo UM por jogador; trocar = o atual cai no lugar)
 * O número total de itens é fixo (soma dos estoques): nada nasce do nada. Pegar exige alcance (`pickRangeM`) a partir
 * da posição ACEITA pelo servidor.
 */
import { ITEM_STATE, rackPlacement, type CombatPropsData, type ItemDenial, type ItemView } from '../../../src/items/protocol';
import { PROP_BY_ID, isCombatProp } from '../../../src/social/props';
import { log } from '../log';

export const CARRIED = 2;
export type ServerItemState = typeof ITEM_STATE.RACK | typeof ITEM_STATE.GROUND | typeof CARRIED;

export interface WorldItem {
  id: number;
  prop: number;
  rack: number;
  slot: { x: number; z: number };
  state: ServerItemState;
  x: number;
  z: number;
  /** quando entrou no estado atual (ms) */
  since: number;
  /** quem carrega ('' = ninguém) */
  by: string;
  /** muda a cada alteração (assinatura da lista por cliente) */
  ver: number;
}

export type PickResult = { ok: true; item: WorldItem; swapped: WorldItem | null } | { ok: false; reason: ItemDenial };
export type DropResult = { ok: true; item: WorldItem } | { ok: false; reason: ItemDenial };

export class GroundItems {
  readonly items = new Map<number, WorldItem>();
  private carried = new Map<string, number>();
  private ttl = new Map<number, number>();
  readonly maxGround: number;
  readonly pickRangeM: number;
  readonly aoiM: number;
  readonly racks: { id: string; x: number; z: number }[] = [];
  /** muda a cada alteração de qualquer item */
  version = 0;
  stats = { picks: 0, drops: 0, expired: 0, capped: 0, denied: 0 };

  constructor(data: CombatPropsData, axis: [number, number][]) {
    for (const p of data.props) if (isCombatProp(p.propId)) this.ttl.set(p.propId, Math.max(5_000, p.groundTtlMs));
    const s = data.supply;
    this.maxGround = Math.max(1, s.maxGround | 0);
    this.pickRangeM = s.pickRangeM > 0 ? s.pickRangeM : 2.2;
    this.aoiM = s.aoiM > 0 ? s.aoiM : 70;
    let id = 1;
    s.racks.forEach((r, ri) => {
      const pl = rackPlacement(r, axis);
      this.racks.push({ id: r.id, x: pl.x, z: pl.z });
      r.props.forEach((prop, k) => {
        if (!isCombatProp(prop)) { log.warn('items', `apoio ${r.id}: prop ${prop} não é item de confronto — ignorado`); return; }
        const slot = pl.slots[k];
        this.items.set(id, { id, prop, rack: ri, slot, state: ITEM_STATE.RACK, x: slot.x, z: slot.z, since: 0, by: '', ver: 0 });
        id++;
      });
    });
  }

  /** prop id do item que `sid` possui (0 = nenhum) — actionRules ActionActor.carried */
  carriedProp(sid: string): number {
    const id = this.carried.get(sid);
    return id ? this.items.get(id)?.prop ?? 0 : 0;
  }
  carriedItem(sid: string): WorldItem | undefined { const id = this.carried.get(sid); return id ? this.items.get(id) : undefined; }

  private touch(it: WorldItem, now: number) { it.since = now; it.ver++; this.version++; }

  /** pegar o item `itemId` estando em `pos`; já possuindo outro, TROCA (o atual cai na posição do jogador) */
  pick(sid: string, itemId: unknown, pos: { x: number; z: number }, now: number): PickResult {
    if (typeof itemId !== 'number' || !Number.isInteger(itemId)) return this.deny('invalido');
    const it = this.items.get(itemId);
    if (!it) return this.deny('inexistente');
    if (it.state === CARRIED) return this.deny(it.by === sid ? 'invalido' : 'ocupado');
    if ((it.x - pos.x) ** 2 + (it.z - pos.z) ** 2 > this.pickRangeM ** 2) return this.deny('longe');
    let swapped: WorldItem | null = null;
    const cur = this.carriedItem(sid);
    if (cur) { this.toGround(cur, pos.x, pos.z, now); swapped = cur; }
    it.state = CARRIED; it.by = sid; it.x = pos.x; it.z = pos.z;
    this.touch(it, now);
    this.carried.set(sid, it.id);
    this.stats.picks++;
    if (swapped) this.cap(now);
    return { ok: true, item: it, swapped };
  }

  /** largar o item que possui em `at` (a sala escolhe o ponto: à frente dos pés, sem atravessar parede) */
  drop(sid: string, at: { x: number; z: number }, now: number): DropResult {
    const it = this.carriedItem(sid);
    if (!it) return this.deny('sem_item');
    this.toGround(it, at.x, at.z, now);
    this.stats.drops++;
    this.cap(now);
    return { ok: true, item: it };
  }

  /** saiu do mundo / caiu: o item possuído vai ao chão (idempotente; devolve o item largado) */
  release(sid: string, at: { x: number; z: number }, now: number): WorldItem | null {
    const it = this.carriedItem(sid);
    if (!it) { this.carried.delete(sid); return null; }
    this.toGround(it, at.x, at.z, now);
    this.cap(now);
    return it;
  }

  private toGround(it: WorldItem, x: number, z: number, now: number) {
    if (it.by) this.carried.delete(it.by);
    it.state = ITEM_STATE.GROUND; it.by = ''; it.x = x; it.z = z;
    this.touch(it, now);
  }

  private toRack(it: WorldItem, now: number) {
    if (it.by) this.carried.delete(it.by);
    it.state = ITEM_STATE.RACK; it.by = ''; it.x = it.slot.x; it.z = it.slot.z;
    this.touch(it, now);
  }

  /** teto de largados: o mais antigo volta à vaga */
  private cap(now: number) {
    let n = 0;
    for (const it of this.items.values()) if (it.state === ITEM_STATE.GROUND) n++;
    while (n > this.maxGround) {
      let old: WorldItem | null = null;
      for (const it of this.items.values()) if (it.state === ITEM_STATE.GROUND && (!old || it.since < old.since)) old = it;
      if (!old) break;
      this.toRack(old, now);
      this.stats.capped++;
      n--;
    }
  }

  /** expiração (≥ 1 Hz basta): largado há mais de `groundTtlMs` volta à vaga; devolve quantos voltaram */
  tick(now: number): number {
    let n = 0;
    for (const it of this.items.values()) {
      if (it.state !== ITEM_STATE.GROUND) continue;
      if (now - it.since >= (this.ttl.get(it.prop) ?? 90_000)) { this.toRack(it, now); n++; }
    }
    this.stats.expired += n;
    return n;
  }

  /** itens visíveis (apoio + chão) a ≤ r de (x, z) — a lista é curta (estoques somados) */
  near(x: number, z: number, r = this.aoiM, out: ItemView[] = []): { list: ItemView[]; sig: number } {
    out.length = 0;
    let sig = 0;
    const r2 = r * r;
    for (const it of this.items.values()) {
      if (it.state === CARRIED || (it.x - x) ** 2 + (it.z - z) ** 2 > r2) continue;
      out.push({ id: it.id, prop: it.prop, x: it.x, z: it.z, state: it.state });
      sig = (sig + Math.imul(it.id, 2654435761) + Math.imul(it.ver + 1, 40503)) >>> 0;
    }
    return { list: out, sig: out.length ? sig || 1 : 0 };
  }

  get groundCount() { let n = 0; for (const it of this.items.values()) if (it.state === ITEM_STATE.GROUND) n++; return n; }
  get carriedCount() { return this.carried.size; }

  private deny(reason: ItemDenial): { ok: false; reason: ItemDenial } { this.stats.denied++; return { ok: false, reason }; }

  /** QA: estado compacto */
  info() {
    return { items: [...this.items.values()].map((it) => ({ id: it.id, kind: PROP_BY_ID.get(it.prop)?.kind, state: it.state, by: it.by, x: +it.x.toFixed(1), z: +it.z.toFixed(1) })), stats: { ...this.stats } };
  }
}
