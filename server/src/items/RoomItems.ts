/**
 * Itens no mundo DENTRO da sala (rodada 9): mensagens `item_*`, área de interesse dos itens, "caiu → larga", saída.
 * Sem Colyseus: a sala entrega um `ItemsHost` (posição aceita, estado do jogador, envio, mão, paredes) e chama
 * os ganchos (pick/drop/leave/reconnect/tick). Regras do item em GroundItems; contrato em src/items/protocol.ts.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { encodeItemList, type CombatPropsData, type ItemDenial, type ItemSelf, type ItemView } from '../../../src/items/protocol';
import { STATUS } from '../../../src/net/rules';
import { GroundItems } from './GroundItems';
import { log } from '../log';

/** o que a sala sabe do jogador (NetPlayer + posição aceita) */
export interface ItemPlayer { prop: number; status: number; vehicle: string; platform: string; heading: number }

export interface ItemsHost {
  /** jogador + última posição ACEITA pelo servidor */
  player(sid: string): { p: ItemPlayer; x: number; z: number } | undefined;
  /** todos os jogadores (fatia da área de interesse) */
  each(fn: (sid: string, slot: number, x: number, z: number) => void): void;
  send(sid: string, type: string, msg: unknown): void;
  /** item na mão (0 = vazia) — aplica as regras sociais (ação que dependia do item termina) */
  setHand(sid: string, prop: number, now: number): void;
  /** fração livre do segmento (paredes) — 1 = livre */
  raycast(ax: number, az: number, bx: number, bz: number): number;
}

const here = dirname(fileURLToPath(import.meta.url));
export const COMBAT_PROPS_FILE = resolve(here, '../../../public/gameplay/combat_props.json');
const COMBAT_FILE = resolve(here, '../../../public/gameplay/combat.json');

export function loadCombatProps(file = COMBAT_PROPS_FILE): CombatPropsData {
  const empty: CombatPropsData = { version: 1, props: [], supply: { maxGround: 1, pickRangeM: 2.2, aoiM: 70, racks: [] } };
  if (!existsSync(file)) return empty;
  let data: CombatPropsData;
  try { data = { ...empty, ...(JSON.parse(readFileSync(file, 'utf8')) as CombatPropsData) }; } catch (e) { log.warn('error', 'combat_props.json ilegível', { err: e as Error }); return empty; }
  // itens: fonte ÚNICA em combat.json `props` (ações + groundTtlMs); este arquivo só traz os pontos de apoio
  if (!data.props?.length && existsSync(COMBAT_FILE)) {
    try { data.props = ((JSON.parse(readFileSync(COMBAT_FILE, 'utf8')) as { props?: CombatPropsData['props'] }).props ?? []); } catch { /* sem itens */ }
  }
  return data;
}

/** intervalo mínimo entre pedidos item_* do mesmo jogador (ms) */
const ITEM_COOLDOWN_MS = 200;
/** fatias da área de interesse dos itens (tick 10 Hz → cada cliente a 2 Hz) */
export const ITEM_SLICES = 5;

export class RoomItems {
  readonly items: GroundItems;
  private sigs = new Map<string, number>();
  private last = new Map<string, number>();
  private buf: ItemView[] = [];
  private expireAcc = 0;
  /** QA/telemetria: mensagens/bytes de item_list */
  stats = { lists: 0, bytes: 0 };

  constructor(private host: ItemsHost, data: CombatPropsData, axis: [number, number][]) {
    this.items = new GroundItems(data, axis);
    log.info('items', `${this.items.items.size} itens de confronto em ${this.items.racks.length} pontos de apoio`);
  }

  private deny(sid: string, r: ItemDenial) { this.host.send(sid, 'item_denied', r); }
  private self(sid: string) {
    const it = this.items.carriedItem(sid);
    const m: ItemSelf = { c: it?.prop ?? 0, i: it?.id ?? 0 };
    this.host.send(sid, 'item_self', m);
  }
  private rate(sid: string, now: number) {
    if (now - (this.last.get(sid) ?? -Infinity) < ITEM_COOLDOWN_MS) return false;
    this.last.set(sid, now);
    return true;
  }
  private check(sid: string, now: number): { p: ItemPlayer; x: number; z: number } | null {
    const pl = this.host.player(sid);
    if (!pl) return null;
    if (!this.rate(sid, now)) { this.deny(sid, 'rapido'); return null; }
    if (pl.p.status !== STATUS.OK && pl.p.status !== STATUS.STAGGER) { this.deny(sid, 'caido'); return null; }
    if (pl.p.vehicle && !pl.p.platform) { this.deny(sid, 'em_veiculo'); return null; }
    return pl;
  }

  /** item_pick {i}: pega (e põe na mão); trocando, o anterior cai aos pés */
  onPick(sid: string, m: unknown, now: number) {
    const pl = this.check(sid, now);
    if (!pl) return;
    const id = m && typeof m === 'object' ? (m as { i?: unknown }).i : undefined;
    const r = this.items.pick(sid, id, { x: pl.x, z: pl.z }, now);
    if (!r.ok) { this.deny(sid, r.reason); return; }
    this.host.setHand(sid, r.item.prop, now);
    this.self(sid);
  }

  /** item_drop: larga o item possuído à frente dos pés (sem atravessar parede); mão esvazia se era ele */
  onDrop(sid: string, now: number) {
    const pl = this.check(sid, now);
    if (!pl) return;
    const held = this.items.carriedProp(sid);
    const r = this.items.drop(sid, this.dropPoint(pl), now);
    if (!r.ok) { this.deny(sid, r.reason); return; }
    if (pl.p.prop === held) this.host.setHand(sid, 0, now);
    this.self(sid);
  }

  private dropPoint(pl: { p: ItemPlayer; x: number; z: number }) {
    const fx = pl.x + Math.sin(pl.p.heading) * 0.7, fz = pl.z + Math.cos(pl.p.heading) * 0.7;
    return this.host.raycast(pl.x, pl.z, fx, fz) >= 1 ? { x: fx, z: fz } : { x: pl.x, z: pl.z };
  }

  /** saiu do mundo (saída, graça vencida, sessão substituída): o item cai onde estava */
  leave(sid: string, now: number) {
    const pl = this.host.player(sid);
    if (pl) this.items.release(sid, { x: pl.x, z: pl.z }, now);
    else { const it = this.items.carriedItem(sid); if (it) this.items.release(sid, { x: it.x, z: it.z }, now); }
    this.sigs.delete(sid);
    this.last.delete(sid);
  }

  /** reconectou (mesma entidade): lista e item próprio de novo */
  reconnect(sid: string) { this.sigs.delete(sid); this.self(sid); }

  carriedProp(sid: string) { return this.items.carriedProp(sid); }


  /** por tick (10 Hz): quem caiu larga o item; expiração (1 Hz); área de interesse fatiada (2 Hz por cliente) */
  tick(now: number, dtMs: number, tickN: number) {
    for (const sid of this.carriersDown()) {
      const pl = this.host.player(sid)!;
      const held = this.items.carriedProp(sid);
      this.items.release(sid, { x: pl.x, z: pl.z }, now);
      if (pl.p.prop === held) this.host.setHand(sid, 0, now);
      this.self(sid);
    }
    this.expireAcc += dtMs;
    if (this.expireAcc >= 1000) { this.expireAcc = 0; this.items.tick(now); }
    const slice = tickN % ITEM_SLICES;
    this.host.each((sid, slot, x, z) => {
      if (slot % ITEM_SLICES !== slice) return;
      const { list, sig } = this.items.near(x, z, this.items.aoiM, this.buf);
      if (sig === (this.sigs.get(sid) ?? 0)) return;
      this.sigs.set(sid, sig);
      const enc = encodeItemList(list);
      this.stats.lists++; this.stats.bytes += enc.length * 4;
      this.host.send(sid, 'item_list', enc);
    });
  }

  private carriersDown(): string[] {
    const out: string[] = [];
    for (const it of this.items.items.values()) {
      if (!it.by) continue;
      const pl = this.host.player(it.by);
      if (!pl) continue;
      if (pl.p.status === STATUS.DOWN || pl.p.status === STATUS.RAGDOLL) out.push(it.by);
    }
    return out;
  }

  info() { return { ...this.items.info(), lists: { ...this.stats } }; }
}
