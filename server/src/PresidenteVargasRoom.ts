/**
 * Sala da Presidente Vargas (servidor autoritativo). DESENVOLVIMENTO/LOCAL apenas.
 */
import { Room, type Client } from '@colyseus/core';
import { WorldState, NetPlayer } from './state.ts';
import {
  BODIES, MAX_SPEED, sanitizeColor, sanitizeName, validateMove, type JoinOptions, type MoveMsg, type MoveMode,
} from '../../src/net/protocol.ts';

/** spawn: Pres. Vargas em frente à Central (mesmo ponto do cliente, com espalhamento) */
const SPAWN = { x: -580, z: 280 };

export class PresidenteVargasRoom extends Room<{ state: WorldState }> {
  maxClients = 100;
  state = new WorldState();
  private last = new Map<string, { x: number; y: number; z: number; t: number; seq: number }>();

  messages = {
    move: (client: Client, msg: MoveMsg) => {
      const p = this.state.players.get(client.sessionId);
      const prev = this.last.get(client.sessionId);
      if (!p || !prev || typeof msg !== 'object' || msg === null) return;
      if (!(msg.mode in MAX_SPEED)) (msg as { mode: MoveMode }).mode = 'foot';
      if (typeof msg.seq !== 'number' || msg.seq <= prev.seq) return; // fora de ordem
      const now = Date.now();
      const r = validateMove(prev, msg, now);
      p.x = r.x; p.y = r.y; p.z = r.z;
      p.heading = msg.heading;
      p.speed = Math.min(Math.abs(msg.speed), MAX_SPEED[msg.mode]);
      p.loco = Math.max(0, Math.min(4, msg.loco | 0));
      p.vehicle = msg.mode === 'foot' ? '' : msg.mode;
      this.last.set(client.sessionId, { x: r.x, y: r.y, z: r.z, t: now, seq: msg.seq });
      if (!r.ok) client.send('correct', { x: r.x, y: r.y, z: r.z, seq: msg.seq, reason: r.reason });
    },
    appearance: (client: Client, opts: Partial<JoinOptions>) => {
      const p = this.state.players.get(client.sessionId);
      if (p && opts) this.applyAppearance(p, opts);
    },
  };

  onCreate(options: { eventId?: string } = {}) {
    this.state.eventId = typeof options.eventId === 'string' ? options.eventId : 'cotidiano';
    this.patchRate = 50;
    this.setSimulationInterval(() => { this.state.serverTime = Date.now(); }, 250);
    console.log(`[room] criada ${this.roomId} (evento: ${this.state.eventId})`);
  }

  private applyAppearance(p: NetPlayer, o: Partial<JoinOptions>) {
    p.body = (BODIES as readonly string[]).includes(o.body as string) ? (o.body as string) : (p.body || 'homem');
    p.skin = sanitizeColor(o.skin, p.skin || 0xb98a68);
    p.hair = sanitizeColor(o.hair, p.hair || 0x1d1714);
    p.top = sanitizeColor(o.top, p.top || 0x2f6f8f);
    p.bottom = sanitizeColor(o.bottom, p.bottom || 0x2c3a52);
    p.shoes = sanitizeColor(o.shoes, p.shoes || 0xe8e8e2);
    if (o.name !== undefined) p.name = sanitizeName(o.name);
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new NetPlayer();
    p.name = sanitizeName(options?.name);
    this.applyAppearance(p, options ?? {});
    // posição inicial decidida pelo servidor
    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
    p.x = SPAWN.x + Math.cos(a) * r;
    p.z = SPAWN.z + Math.sin(a) * r;
    p.y = 0;
    p.heading = 1.75;
    p.loco = 0;
    p.vehicle = '';
    p.interaction = 'pacifico';
    this.state.players.set(client.sessionId, p);
    this.last.set(client.sessionId, { x: p.x, y: p.y, z: p.z, t: Date.now(), seq: -1 });
    client.send('spawn', { x: p.x, y: p.y, z: p.z, heading: p.heading, sessionId: client.sessionId });
    console.log(`[room] entrou ${client.sessionId} (${p.name}, ${p.body}) — total ${this.state.players.size}`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.last.delete(client.sessionId);
    console.log(`[room] saiu ${client.sessionId} — total ${this.state.players.size}`);
  }
}
