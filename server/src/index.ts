/**
 * Servidor multiplayer de DESENVOLVIMENTO. Escuta só em localhost por padrão.
 * NÃO fazer deploy sem autorização (ver docs/MULTIPLAYER.md).
 */
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PresidenteVargasRoom } from './PresidenteVargasRoom.ts';
import { ROOM_NAME } from '../../src/net/protocol.ts';

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '127.0.0.1';

const server = new Server({ transport: new WebSocketTransport() });
server.define(ROOM_NAME, PresidenteVargasRoom);
await server.listen(port, host);
console.log(`[pv3d-server] ws://${host}:${port} · sala "${ROOM_NAME}" (desenvolvimento)`);
