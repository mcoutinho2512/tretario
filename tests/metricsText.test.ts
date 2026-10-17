/** Rodada 8 — texto de pessoas na tela inicial: multidão simulada nunca vira "jogadores"; bots de teste não contam. */
import { describe, it, expect } from 'vitest';
import { metricsLine } from '../src/ui/metricsText';

const base = { playersOnline: 38, spectatorsOnline: 0, environmentCrowd: 360, totalConnections: 538, testBots: 500, eventId: 'e', eventName: 'E', updatedAt: 0 };
const text = (m: Parameters<typeof metricsLine>[0]) => (metricsLine(m) ?? '').replace(/<[^>]+>/g, '');

describe('métricas públicas na tela inicial', () => {
  it('jogadores = pessoas com conta; NPCs rotulados como simulados; bots e conexões fora', () => {
    expect(text(base)).toBe('38 jogadores na avenida · multidão simulada ~360');
    expect(text(base)).not.toContain('538');
    expect(text(base)).not.toContain('500');
    expect(text({ ...base, playersOnline: 1, environmentCrowd: 0 })).toBe('1 jogador na avenida');
    expect(text({ ...base, playersOnline: 0, spectatorsOnline: 3 })).toBe('Nenhum jogador na avenida agora · 3 assistindo · multidão simulada ~360');
  });
  it('sem métricas → null (a tela mostra texto neutro)', () => {
    expect(metricsLine(null)).toBeNull();
    expect(metricsLine({} as never)).toBeNull();
  });
});
