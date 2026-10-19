/**
 * Rodada 10 — provedores do InteractionSystem (docs/INTERACTION_SYSTEM.md). Cada um só DESCREVE candidatos (rótulo,
 * alcance, prioridade, ponto do realce) e, no `activate`, chama o caminho que já existia (Game: enter/exit/board/
 * unboard pelo NetworkClient; item_pick; editor de grafite; painel da pessoa). Nada de regra nova aqui: alcance de
 * veículo = `useDistance` (a mesma do `RideableSystem.nearest`), item = PICK_HINT_M, escada do trio = TRIO.boardRange.
 * Objetos reaproveitados por chave (sem alocar por quadro).
 */
import type { Interactable, InteractionPlayerState, InteractionProvider } from './types';
import { COLLECT_RADIUS_M } from './select';
import { useDistance, type RideableInstance, type RideableKind } from '../vehicles/Rideable';
import { TRIO, localToWorld } from '../vehicles/platform';
import { PICK_HINT_M } from '../items/ItemsClient';
import type { GraffitiSurface } from '../graffiti/surfaces';

const R2 = COLLECT_RADIUS_M * COLLECT_RADIUS_M;

/** prioridades (maior vence; ≤ 15 = só por clique/toque) */
export const IX_PRIORITY = { exit: 100, ladder: 55, vehicle: 50, pickup: 40, graffiti: 20, person: 10 } as const;
/** alcance (m) para abrir o painel de uma pessoa */
export const PERSON_RANGE_M = 8;
const VEHICLE_RANGE_M = 2.4;

class Pool {
  private m = new Map<string, Interactable>();
  get(key: string, make: () => Interactable): Interactable {
    let c = this.m.get(key);
    if (!c) this.m.set(key, (c = make()));
    return c;
  }
}
const base = (key: string, type: Interactable['interactionType'], serverAction: string, allowed: InteractionPlayerState[], activate: () => void): Interactable => ({
  key, interactionType: type, interactionLabel: '', targetLabel: '', maxDistance: 0, priority: 0, allowedStates: allowed,
  serverAction, availability: 'available', x: 0, y: 0, z: 0, pickRadius: 1, activate,
});

/** verbo por tipo de veículo — dado, não ramo por veículo na lógica */
const VERB: Record<RideableKind, { verb: string; prep: 'em' | 'obj' }> = {
  car: { verb: 'Entrar', prep: 'em' }, moto: { verb: 'Montar', prep: 'em' }, bicycle: { verb: 'Montar', prep: 'em' },
  scooter: { verb: 'Usar', prep: 'obj' }, soundcar: { verb: 'Dirigir', prep: 'obj' }, trio: { verb: 'Dirigir', prep: 'obj' },
};
/** tamanho do alvo de clique (m) e altura do rótulo (m) */
const SHAPE: Record<RideableKind, { r: number; h: number }> = {
  car: { r: 2.0, h: 1.7 }, moto: { r: 1.1, h: 1.35 }, bicycle: { r: 0.9, h: 1.3 }, scooter: { r: 0.7, h: 1.25 }, soundcar: { r: 2.6, h: 3.3 }, trio: { r: 1.4, h: 3.6 },
};
const EXIT_LABEL: Record<RideableKind, string> = { car: 'Sair', moto: 'Descer', bicycle: 'Descer', scooter: 'Descer', soundcar: 'Sair', trio: 'Sair' };

export function vehiclePrompt(kind: RideableKind, label: string, article: 'o' | 'a'): string {
  const v = VERB[kind];
  const L = label.toUpperCase();
  return `E — ${v.verb.toUpperCase()} ${v.prep === 'em' ? (article === 'a' ? 'NA' : 'NO') : article === 'a' ? 'A' : 'O'} ${L}`;
}

export interface VehicleDeps {
  items(): readonly RideableInstance[];
  riding(): RideableInstance | null;
  /** id do trio em que o jogador está em cima (plataforma) */
  platform(): string | null;
  /** pedido em andamento (enter/board): candidatos esperam */
  pending(): boolean;
  enter(it: RideableInstance): void;
  board(it: RideableInstance): void;
  exit(): void;
}

/** veículos (entrar/montar/usar/dirigir), escada do trio (subir) e sair/descer */
export class VehicleProvider implements InteractionProvider {
  readonly id = 'vehicles';
  private pool = new Pool();
  constructor(private d: VehicleDeps) {}

  collect(x: number, z: number, state: InteractionPlayerState, out: Interactable[]) {
    const d = this.d;
    if (state === 'vehicle' || state === 'platform') {
      const v = d.riding(), plat = d.platform();
      const it = v ?? (plat ? d.items().find((i) => i.state.id === plat) ?? null : null);
      const c = this.pool.get('exit', () => base('exit', 'exit_vehicle', 'exit', ['vehicle', 'platform'], () => this.d.exit()));
      c.serverAction = v ? 'exit' : 'unboard';
      c.interactionLabel = v ? EXIT_LABEL[v.def.kind] : 'Descer';
      c.targetLabel = v ? v.def.label : 'Trio elétrico';
      c.prompt = v ? `E — ${EXIT_LABEL[v.def.kind].toUpperCase()}` : 'E — DESCER DO TRIO';
      c.priority = IX_PRIORITY.exit; c.maxDistance = Infinity; c.distance = 0; c.availability = d.pending() ? 'cooldown' : 'available';
      c.x = it?.state.x ?? x; c.z = it?.state.z ?? z; c.y = (it?.state.y ?? 0) + 1.5; c.pickRadius = 1.2;
      out.push(c);
      return;
    }
    if (state !== 'foot') return;
    const pend = d.pending();
    for (const it of d.items()) {
      const s = it.state;
      if ((s.x - x) ** 2 + (s.z - z) ** 2 > R2) continue;
      const busy = it.netState === 2 || (it.def.kind !== 'trio' && !!s.occupant);
      const kind = it.def.kind;
      if (kind === 'trio') {
        const f = localToWorld(s, TRIO.ladderFoot[0], TRIO.ladderFoot[1]);
        const l = this.pool.get(`ladder:${s.id}`, () => base(`ladder:${s.id}`, 'board_platform', 'board', ['foot'], () => this.d.board(it)));
        l.interactionLabel = 'Subir'; l.targetLabel = 'Trio elétrico'; l.prompt = 'E — SUBIR NO TRIO';
        l.priority = IX_PRIORITY.ladder; l.maxDistance = TRIO.boardRange; l.distance = Math.hypot(x - f.x, z - f.z);
        l.availability = it.netState === 2 ? 'busy' : pend ? 'cooldown' : 'available';
        l.x = f.x; l.z = f.z; l.y = s.y + 1.8; l.pickRadius = 1.2;
        out.push(l);
      }
      const c = this.pool.get(`veh:${s.id}`, () => base(`veh:${s.id}`, 'enter_vehicle', 'enter', ['foot'], () => this.d.enter(it)));
      c.interactionLabel = VERB[kind].verb; c.targetLabel = it.def.label; c.prompt = vehiclePrompt(kind, it.def.label, it.def.article);
      c.priority = IX_PRIORITY.vehicle; c.maxDistance = VEHICLE_RANGE_M; c.distance = useDistance(it, x, z, VEHICLE_RANGE_M);
      c.availability = busy || (kind === 'trio' && !!s.occupant) ? 'busy' : pend ? 'cooldown' : 'available';
      if (kind === 'trio') { const door = localToWorld(s, TRIO.cabDoor[0], TRIO.cabDoor[1]); c.x = door.x; c.z = door.z; }
      else { c.x = s.x; c.z = s.z; }
      c.y = s.y + SHAPE[kind].h; c.pickRadius = SHAPE[kind].r;
      out.push(c);
    }
  }
}

export interface ItemDeps {
  /** itens mostrados (GroundItemsView.forEach; sem itens/offline = não chama `fn`) */
  forEach(fn: (id: number, prop: number, x: number, z: number, state: number) => void): void;
  label(prop: number): string;
  ground(x: number, z: number): number;
  pick(id: number): void;
  /** pedido em andamento */
  pending(): boolean;
}

/** itens no chão / no ponto de apoio: "Pegar" (item_pick — o servidor confere alcance, posse, troca) */
export class ItemProvider implements InteractionProvider {
  readonly id = 'items';
  private pool = new Pool();
  private out: Interactable[] = [];
  private px = 0; private pz = 0;
  private visit = (id: number, prop: number, ix: number, iz: number) => {
    if ((ix - this.px) ** 2 + (iz - this.pz) ** 2 > R2) return;
    const c = this.pool.get(`item:${id}`, () => base(`item:${id}`, 'pickup', 'item_pick', ['foot'], () => this.d.pick(id)));
    c.interactionLabel = 'Pegar'; c.targetLabel = this.d.label(prop); c.prompt = `E — PEGAR ${c.targetLabel.toUpperCase()}`;
    c.priority = IX_PRIORITY.pickup; c.maxDistance = PICK_HINT_M; c.distance = undefined;
    c.availability = this.d.pending() ? 'cooldown' : 'available';
    c.x = ix; c.z = iz; c.y = this.d.ground(ix, iz) + 0.7; c.pickRadius = 0.55;
    this.out.push(c);
  };
  constructor(private d: ItemDeps) {}
  collect(x: number, z: number, state: InteractionPlayerState, out: Interactable[]) {
    if (state !== 'foot') return;
    this.px = x; this.pz = z; this.out = out;
    this.d.forEach(this.visit);
  }
}

export interface PersonDeps {
  /** remotos com corpo: id interno (nunca mostrado), apelido público, posição de desenho, em veículo */
  forEach(fn: (id: string, nid: number, name: string, x: number, y: number, z: number, inVehicle: boolean) => void): void;
  open(id: string, nid: number): void;
}

/** outras pessoas: "Interagir" abre o painel (só por clique/toque — prioridade baixa, sem realce automático) */
export class PersonProvider implements InteractionProvider {
  readonly id = 'people';
  private pool = new Pool();
  private out: Interactable[] = [];
  private px = 0; private pz = 0;
  private visit = (id: string, nid: number, name: string, x: number, y: number, z: number, inVehicle: boolean) => {
    if (inVehicle || !nid || (x - this.px) ** 2 + (z - this.pz) ** 2 > R2) return;
    const c = this.pool.get(`person:${id}`, () => base(`person:${id}`, 'person', 'panel', ['foot', 'platform'], () => this.d.open(id, nid)));
    c.interactionLabel = 'Interagir'; c.targetLabel = name.length > 18 ? `${name.slice(0, 17)}…` : name || 'Pessoa';
    c.priority = IX_PRIORITY.person; c.maxDistance = PERSON_RANGE_M; c.distance = undefined; c.availability = 'available';
    c.x = x; c.z = z; c.y = y + 1.05; c.pickRadius = 0.6;
    this.out.push(c);
  };
  constructor(private d: PersonDeps) {}
  collect(x: number, z: number, state: InteractionPlayerState, out: Interactable[]) {
    if (state !== 'foot' && state !== 'platform') return;
    this.px = x; this.pz = z; this.out = out;
    this.d.forEach(this.visit);
  }
}

export interface GraffitiDeps {
  /** superfície autorizada ao alcance (GraffitiSystem, mesma regra do prompt) */
  near(): GraffitiSurface | null;
  prompt(): string;
  open(): void;
}

const SURFACE_LABEL: Record<string, string> = { ground: 'Chão', tapume: 'Tapume', mural: 'Mural', wall: 'Parede' };

/** pichar: o ponto da superfície mais perto do jogador */
export class GraffitiProvider implements InteractionProvider {
  readonly id = 'graffiti';
  private c = base('graffiti', 'graffiti', 'gf_new', ['foot'], () => this.d.open());
  constructor(private d: GraffitiDeps) {}
  collect(x: number, z: number, state: InteractionPlayerState, out: Interactable[]) {
    if (state !== 'foot') return;
    const sf = this.d.near();
    if (!sf) return;
    const c = this.c;
    // projeção do jogador no retângulo da superfície (u = largura, v = altura)
    const dx = x - sf.o[0], dz = z - sf.o[2];
    const ul = Math.hypot(sf.u[0], sf.u[2]) || 1;
    const s = Math.max(0, Math.min(sf.w, (dx * sf.u[0] + dz * sf.u[2]) / ul));
    const ground = sf.kind === 'ground';
    c.x = sf.o[0] + (sf.u[0] / ul) * s + (ground ? sf.v[0] * Math.min(sf.h, 1) : 0);
    c.z = sf.o[2] + (sf.u[2] / ul) * s + (ground ? sf.v[2] * Math.min(sf.h, 1) : 0);
    c.y = sf.o[1] + (ground ? 0.4 : Math.min(sf.h, 2.4) * 0.6);
    c.interactionLabel = 'Pichar'; c.targetLabel = SURFACE_LABEL[sf.kind] ?? 'Parede'; c.prompt = this.d.prompt();
    c.priority = IX_PRIORITY.graffiti; c.maxDistance = Infinity; c.distance = 0; c.availability = 'available'; c.pickRadius = 1.1;
    out.push(c);
  }
}
