import { describe, expect, it } from 'vitest';
import { PresenceTracker } from '../server/src/presence/PresenceTracker';
import { computePublicMetrics, environmentCrowdFor, PEDESTRIAN_ESTIMATE, publicMetrics, liveWorlds, resetMetricsCache, METRICS_CACHE_MS } from '../server/src/presence/publicMetrics';
import { testJoinFlags } from '../server/src/presence/testJoin';

const P = (userId: string | null, bot = false) => ({ userId, role: 'player' as const, bot });
const S = (userId: string | null) => ({ userId, role: 'spectator' as const, bot: false });

describe('presença (memória, batimento/TTL)', () => {
  it('ONLINE até entrar no mundo; PLAYING/SPECTATING com atividade; AWAY por inatividade; OFFLINE caído', () => {
    const t = new PresenceTracker({ awayMs: 60_000, ttlMs: 30_000 });
    t.join('a', P('u1'), 0);
    expect(t.state('a', 0)).toBe('ONLINE');
    t.enterWorld('a', 10);
    expect(t.state('a', 1000)).toBe('PLAYING');
    // batimento (ping) mantém a conexão, mas não conta como atividade
    for (let now = 10_000; now <= 70_000; now += 10_000) t.heartbeat('a', now);
    expect(t.state('a', 70_000)).toBe('AWAY');
    t.activity('a', 71_000);
    expect(t.state('a', 71_000)).toBe('PLAYING');
    t.drop('a');
    expect(t.state('a', 72_000)).toBe('OFFLINE');
    t.resume('a', 73_000);
    expect(t.state('a', 73_000)).toBe('PLAYING');
    t.leave('a');
    expect(t.state('a', 74_000)).toBe('OFFLINE');
  });
  it('sem batimento além do TTL → AWAY (conexão provavelmente morta)', () => {
    const t = new PresenceTracker({ awayMs: 600_000, ttlMs: 30_000 });
    t.join('s', S(null), 0); t.enterWorld('s', 0);
    expect(t.state('s', 29_000)).toBe('SPECTATING');
    expect(t.state('s', 31_000)).toBe('AWAY');
  });
  it('conta com várias sessões: byUser devolve a mais forte; sessionsOf por papel', () => {
    const t = new PresenceTracker();
    t.join('a', P('u1'), 0); t.enterWorld('a', 0);
    t.join('b', S('u1'), 0); t.enterWorld('b', 0);
    expect(t.byUser('u1', 1000)).toBe('PLAYING');
    expect(t.sessionsOf('u1', 'player')).toEqual(['a']);
    expect(t.sessionsOf('u1')).toEqual(['a', 'b']);
    t.leave('a');
    expect(t.byUser('u1', 1000)).toBe('SPECTATING');
    expect(t.byUser('nada', 1000)).toBe('OFFLINE');
  });
  it('contagens semânticas: bot nunca é jogador; em graça conta como jogador mas não como conexão', () => {
    const t = new PresenceTracker();
    t.join('h1', P('u1'), 0); t.join('h2', P(null), 0); t.join('b1', P(null, true), 0); t.join('b2', P(null, true), 0);
    t.join('s1', S(null), 0); t.join('s2', S('u9'), 0);
    t.drop('h2');
    expect(t.counts(0)).toMatchObject({ players: 2, bots: 2, spectators: 2, connections: 5 });
  });
});

describe('métricas públicas', () => {
  const src = (counts: ReturnType<PresenceTracker['counts']>, crowd = 400) => ({ counts: () => counts, eventId: 'manifestacao', eventName: 'Ato', environmentCrowd: crowd });
  it('soma salas; multidão ambiental é a simulação do evento, separada de jogadores', () => {
    const m = computePublicMetrics([src({ players: 3, spectators: 5, bots: 100, connections: 107, away: 0 }), src({ players: 1, spectators: 0, bots: 0, connections: 1, away: 0 })], 42);
    expect(m).toEqual({ playersOnline: 4, spectatorsOnline: 5, environmentCrowd: 400, totalConnections: 108, testBots: 100, eventId: 'manifestacao', eventName: 'Ato', updatedAt: 42 });
  });
  it('sem sala viva: zeros + evento padrão', () => {
    const m = computePublicMetrics([], 1, { eventId: 'x', eventName: 'X', environmentCrowd: 77 });
    expect(m.playersOnline + m.spectatorsOnline + m.testBots + m.totalConnections).toBe(0);
    expect(m.environmentCrowd).toBe(77);
    expect(m.eventId).toBe('x');
  });
  it('multidão ambiental = rallyCrowd + estimativa de pedestres × densidade', () => {
    expect(environmentCrowdFor({ social: { rallyCrowd: 360 }, npcs: { pedestrianDensity: 1 } })).toBe(360 + PEDESTRIAN_ESTIMATE);
    expect(environmentCrowdFor({ npcs: { pedestrianDensity: 0.5 } })).toBe(Math.round(PEDESTRIAN_ESTIMATE / 2));
    expect(environmentCrowdFor(undefined)).toBe(0);
  });
  it('cache de ~1,5 s', () => {
    resetMetricsCache();
    let players = 1;
    const s = { counts: () => ({ players, spectators: 0, bots: 0, connections: players, away: 0 }), eventId: 'e', eventName: 'E', environmentCrowd: 0 };
    liveWorlds.add(s);
    try {
      expect(publicMetrics(1000).playersOnline).toBe(1);
      players = 2;
      expect(publicMetrics(1000 + METRICS_CACHE_MS - 1).playersOnline).toBe(1);
      expect(publicMetrics(1000 + METRICS_CACHE_MS + 1).playersOnline).toBe(2);
    } finally { liveWorlds.delete(s); resetMetricsCache(); }
  });
  it('opções de teste (bot/testUser) só valem em servidor de teste', () => {
    expect(testJoinFlags({ bot: true, testUser: 'qa 1!' }, true)).toEqual({ bot: true, testUser: 'qa1' });
    expect(testJoinFlags({ bot: true, testUser: 'qa' }, false)).toEqual({ bot: false, testUser: null });
    expect(testJoinFlags({ bot: 'sim' }, true)).toEqual({ bot: false, testUser: null });
  });
});
