/** Estado sincronizado da sala (Colyseus Schema v5). Coleções com `.view()` → filtradas por área de interesse. */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const NetPlayer = schema({
  name: t.string(),
  body: t.string(),
  skin: t.uint32(),
  hair: t.uint32(),
  top: t.uint32(),
  bottom: t.uint32(),
  shoes: t.uint32(),
  accessory: t.string(),
  acc: t.uint32(),
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
