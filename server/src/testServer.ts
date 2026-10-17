/**
 * Sala no MESMO processo para testes de integração (tests/*.test.ts): o pacote @colyseus/core só existe em
 * server/node_modules, então a montagem fica aqui. Quem chama já fez setServices(...) e importou as rotas da API.
 */
import './polyfills.ts';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PresidenteVargasRoom } from './PresidenteVargasRoom.ts';
import { ROOM_NAME } from '../../src/net/protocol.ts';

export async function listenGameServer(port: number, host = '127.0.0.1'): Promise<{ close(): Promise<void> }> {
  const s = new Server({ transport: new WebSocketTransport() });
  s.define(ROOM_NAME, PresidenteVargasRoom);
  await s.listen(port, host);
  return { close: () => s.gracefullyShutdown(false) };
}
