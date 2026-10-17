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
  // servidores de TESTE (PV_TEST=1: bots/QA) usam memória por padrão — não sujam o banco local; o E2E de
  // persistência pede o banco explicitamente com PV_STORE=prisma
  const testDefault = process.env.PV_TEST === '1' && process.env.PV_STORE !== 'prisma';
  const wantPrisma = !!process.env.DATABASE_URL && process.env.PV_STORE !== 'memory' && !testDefault;
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
