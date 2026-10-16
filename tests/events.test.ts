import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import type { EventDef } from '../src/events/types';
import type { WorldManifest } from '../src/world/types';

const idx = JSON.parse(readFileSync('public/events/index.json', 'utf8')) as { default: string; events: string[] };

describe('eventos (dados genéricos)', () => {
  it('índice aponta para eventos existentes e válidos', () => {
    expect(idx.events).toContain(idx.default);
    for (const id of idx.events) {
      const ev = JSON.parse(readFileSync(`public/events/${id}.json`, 'utf8')) as EventDef;
      expect(ev.id).toBe(id);
      expect(ev.name.length).toBeGreaterThan(3);
      for (const g of ev.groups ?? []) {
        expect(g.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
        if (g.teamId) expect(ev.teams?.some((t) => t.id === g.teamId)).toBe(true);
      }
      const share = (ev.groups ?? []).reduce((s, g) => s + (g.npcShare ?? 0), 0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });
  it('nenhum código-fonte depende de um tema específico (política/futebol ficam nos dados)', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    const offenders = walk('src').filter((f) => /\.ts$/.test(f) && /flamengo|vasco|fluminense|botafogo|partido|lula|bolsonaro/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('locais de painéis de LED identificados nas fachadas da avenida', () => {
    const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as WorldManifest;
    expect(m.billboards!.length).toBeGreaterThanOrEqual(10);
    for (const b of m.billboards!) {
      expect(b.y - b.h / 2).toBeGreaterThan(7);
      expect(b.w).toBeGreaterThan(5);
    }
  });
});
