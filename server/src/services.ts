/**
 * Serviços do servidor (rodada 8) — um container ÚNICO compartilhado pela API HTTP e pela sala:
 * banco (DataStore), tickets de entrada e a identidade resolvida de cada conexão.
 * Escolha do banco: PostgreSQL (Prisma) quando DATABASE_URL existe e PV_STORE != 'memory'; senão memória.
 */
import { MemoryDataStore } from './data/memory';
import type { DataStore } from './data/types';
import { TicketService } from './identity/tickets';

export interface Services {
  store: DataStore;
  tickets: TicketService;
}

let current: Services | null = null;

/** fábrica do banco — o PrismaDataStore se registra aqui (server/src/data/prisma.ts) */
export const storeFactories: { prisma?: () => Promise<DataStore> } = {};

export async function initServices(): Promise<Services> {
  if (current) return current;
  const wantPrisma = !!process.env.DATABASE_URL && process.env.PV_STORE !== 'memory';
  const store = wantPrisma && storeFactories.prisma ? await storeFactories.prisma() : new MemoryDataStore();
  current = { store, tickets: new TicketService() };
  console.log(`[services] banco: ${store.kind}`);
  return current;
}

export function services(): Services {
  if (!current) throw new Error('initServices() não foi chamado');
  return current;
}

/** testes: injeta serviços prontos */
export function setServices(s: Services) { current = s; }

/** servidor de TESTE (bots/QA): entrada anônima como jogador permitida. Nunca em produção. */
export function anonPlayersAllowed(): boolean {
  return process.env.PV_TEST === '1' || process.env.PV_ALLOW_ANON_PLAYERS === '1';
}
