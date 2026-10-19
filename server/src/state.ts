/** Estado sincronizado da sala (Colyseus Schema v5). Coleções com `.view()` → filtradas por área de interesse. */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const NetPlayer = schema({
  /** id numérico curto (u16) — o mesmo usado na mensagem binária "crowd" (multidão distante) */
  nid: t.uint16(),
  name: t.string(),
  body: t.string(),
  skin: t.uint32(),
  hair: t.uint32(),
  top: t.uint32(),
  bottom: t.uint32(),
  shoes: t.uint32(),
  accessory: t.string(),
  acc: t.uint32(),
  /** peças variantes (src/characters/garments.ts; '' = roupa base) e design da camisa (0 = lisa) */
  topStyle: t.string(),
  bottomStyle: t.string(),
  shoeStyle: t.string(),
  hairStyle: t.string(),
  shirtDesign: t.uint16(),
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  heading: t.float32(),
  speed: t.float32(),
  loco: t.uint8(),
  /** id do veículo em uso ('' = a pé) */
  vehicle: t.string(),
  /** 'pacifico' | 'interacao' — decidido pelo servidor */
  interaction: t.string(),
  /** 0 normal · 1 caído · 2 levantando */
  status: t.uint8(),
  /** ação social em curso (src/social/actions.ts; 0 = nenhuma) — validada pelo servidor */
  act: t.uint8(),
  /** início da ação no relógio do servidor (ms): todos tocam a mesma fase */
  actAt: t.float64(),
  /** variação da ação (desfasamento/espelho), 0..7 */
  actVar: t.uint8(),
  /** item segurado (src/social/props.ts; 0 = mãos vazias) */
  prop: t.uint8(),
  /** design do item (src/social/designs.ts; 0 = padrão) */
  design: t.uint16(),
  /**
   * em cima de um TRIO (id do veículo; '' = no chão) — src/vehicles/platform.ts. `vehicle` continua '' (ações
   * sociais permitidas); x/z/y continuam no MUNDO (AOI, multidão), mas quem desenha usa o LOCAL abaixo × a pose
   * interpolada do trio: o passageiro não escorrega quando o trio anda.
   */
  platform: t.string(),
  /** posição local no piso do trio (m) e rumo relativo ao trio (rad) */
  plx: t.float32(),
  plz: t.float32(),
  plh: t.float32(),
  /** conexão: 0 conectado · 1 caiu, em graça de reconexão (entidade congelada; src/net/reconnect.ts LINK_WIRE) */
  link: t.uint8(),
  /** rodada 9 — efeitos temporários (bits src/combat/types.ts FX: desorientado, protegido, esquivando, em confronto) */
  fx: t.uint8(),
  /**
   * rodada 10 — torcida (public/gameplay/supporters.json): 0 = neutro/sem torcida, i+1 = índice em `groups`.
   * Lido por outros sistemas (painel de pessoa, áudio, minimapa) — NÃO renomear nem mudar a semântica.
   */
  sup: t.uint8(),
  /**
   * rodada 11 — PÚBLICOS (docs/PRIVACY_ARCHITECTURE.md): nível da progressão (0 = desconhecido: bot/sem progressão) e
   * título EQUIPADO (texto de uma recompensa `title` que a conta ganhou; '' = nenhum). Validados pelo servidor.
   */
  lvl: t.uint8(),
  title: t.string(),
}, 'NetPlayer');
export type NetPlayer = SchemaType<typeof NetPlayer>;

export const NetVehicle = schema({
  kind: t.string(),
  x: t.float32(),
  z: t.float32(),
  y: t.float32(),
  heading: t.float32(),
  speed: t.float32(),
  /** sessionId do ocupante ('' = livre) */
  occupant: t.string(),
  /** 0 disponível · 1 ocupado · 2 voltando para a vaga (VEHICLE_STATE) */
  state: t.uint8(),
  /** design dos painéis (carro de som/trio; src/social/designs.ts; 0 = arte neutra padrão) */
  design: t.uint16(),
}, 'NetVehicle');
export type NetVehicle = SchemaType<typeof NetVehicle>;

export const WorldState = schema({
  players: t.map(NetPlayer).view(),
  vehicles: t.map(NetVehicle).view(),
  eventId: t.string(),
  /** semente do mundo (aparência de NPCs, etc.) */
  seed: t.uint32(),
  /** relógio do servidor (ms) — base de semáforos/eventos */
  serverTime: t.float64(),
}, 'WorldState');
export type WorldState = SchemaType<typeof WorldState>;
