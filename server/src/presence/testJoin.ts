/**
 * Opções de entrada SÓ de servidor de teste (PV_TEST=1 / PV_ALLOW_ANON_PLAYERS=1; ignoradas em produção):
 *   bot: true          bot de carga (server/tools/bots.ts) — contado como testBots, nunca como jogador
 *   testUser: 'nome'   conta fictícia para QA de login duplicado / presença (userId = 'test:nome')
 */
import { anonPlayersAllowed } from '../services';

export interface TestJoinFlags { bot: boolean; testUser: string | null }

export function testJoinFlags(o: { bot?: unknown; testUser?: unknown } | undefined, allowed: boolean = anonPlayersAllowed()): TestJoinFlags {
  if (!allowed || !o) return { bot: false, testUser: null };
  const u = typeof o.testUser === 'string' ? o.testUser.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) : '';
  return { bot: o.bot === true, testUser: u || null };
}
