/** Estado sincronizado da sala (Colyseus Schema v5). */
import { schema, t, type SchemaType } from '@colyseus/schema';

export const NetPlayer = schema({
  name: t.string(),
  body: t.string(),
  skin: t.uint32(),
  hair: t.uint32(),
  top: t.uint32(),
  bottom: t.uint32(),
  shoes: t.uint32(),
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  heading: t.float32(),
  speed: t.float32(),
  loco: t.uint8(),
  /** veículo em uso ('' = a pé) */
  vehicle: t.string(),
  /** modo de interação decidido pelo servidor */
  interaction: t.string(),
}, 'NetPlayer');
export type NetPlayer = SchemaType<typeof NetPlayer>;

export const WorldState = schema({
  players: t.map(NetPlayer),
  /** evento ativo (id do JSON em public/events) */
  eventId: t.string(),
  /** relógio do servidor (ms) — base para semáforos/eventos sincronizados */
  serverTime: t.float64(),
}, 'WorldState');
export type WorldState = SchemaType<typeof WorldState>;
