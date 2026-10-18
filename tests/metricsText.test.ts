/** Rodada 8/9.1 — texto de pessoas na tela inicial: NPCs nunca viram "jogadores" nem são citados; bots de teste não contam. */
import { describe, it, expect } from 'vitest';
import { metricsLine } from '../src/ui/metricsText';

const base = { playersOnline: 38, spectatorsOnline: 0, environmentCrowd: 360, totalConnections: 538, testBots: 500, eventId: 'e', eventName: 'E', updatedAt: 0 };
const text = (m: Parameters<typeof metricsLine>[0]) => (metricsLine(m) ?? '').replace(/<[^>]+>/g, '');

describe('métricas públicas na tela inicial', () => {
  it('jogadores = pessoas com conta; NPCs rotulados como simulados; bots e conexões fora', () => {
    expect(text(base)).toBe('Alguns jogadores na avenida'); // sem número; NPCs não são citados nem contados (rodada 9.1)
    expect(text(base)).not.toContain('538');
    expect(text(base)).not.toContain('500');
    expect(text({ ...base, playersOnline: 1, environmentCrowd: 0 })).toBe('Alguns jogadores na avenida');
    expect(text({ ...base, playersOnline: 0, spectatorsOnline: 3 })).toBe('Avenida movimentada agora · entre e junte-se · 3 assistindo');
    expect(text({ ...base, playersOnline: 0 })).not.toMatch(/Nenhum|jogador/);
  });
  it('sem métricas → null (a tela mostra texto neutro)', () => {
    expect(metricsLine(null)).toBeNull();
    expect(metricsLine({} as never)).toBeNull();
  });
});
