/**
 * Node 20 não tem `WebSocket` global, mas o @colyseus/core 0.18 usa `WebSocket.OPEN` na RECONEXÃO
 * (Room._onJoin): sem isto toda reconexão falha com ReferenceError e o cliente perde a entidade. Importar primeiro.
 */
import WebSocket from 'ws';

const g = globalThis as unknown as { WebSocket?: unknown };
g.WebSocket ??= WebSocket;
