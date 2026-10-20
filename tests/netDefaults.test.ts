/** Rodada 12: todo NetPlayer novo passa por initNetPlayer — nenhum campo do schema pode ficar indefinido (o cliente
 * interpolava `speed` indefinido em NaN e o corpo sumia com o nome na tela; docs/CHARACTERS.md). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NetPlayer, initNetPlayer } from '../server/src/state';

describe('NetPlayer: valores padrão', () => {
  it('initNetPlayer define TODOS os campos do schema (números finitos, textos definidos)', () => {
    const src = readFileSync('server/src/state.ts', 'utf8');
    const block = src.slice(src.indexOf('export const NetPlayer = schema({'), src.indexOf("}, 'NetPlayer');"));
    const fields = [...block.matchAll(/^\s+(\w+): t\.(\w+)\(/gm)].map((m) => [m[1], m[2]] as const);
    expect(fields.length).toBeGreaterThan(30);
    const p = initNetPlayer(new NetPlayer()) as unknown as Record<string, unknown>;
    for (const [k, type] of fields) {
      const v = p[k];
      if (type === 'string') expect(typeof v, k).toBe('string');
      else { expect(typeof v, k).toBe('number'); expect(Number.isFinite(v as number), k).toBe(true); }
    }
  });
  it('a sala só cria NetPlayer pelo initNetPlayer', () => {
    const room = readFileSync('server/src/PresidenteVargasRoom.ts', 'utf8');
    expect(room.match(/new NetPlayer\(\)/g)?.length ?? 0).toBe(room.match(/initNetPlayer\(new NetPlayer\(\)\)/g)?.length ?? 0);
  });
});
