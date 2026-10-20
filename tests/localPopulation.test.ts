/**
 * Rodada 12 (agente G) — POPULAÇÃO DUPLA: pedestres/multidão LOCAIS do cliente cedem aos autônomos do servidor
 * (src/npc/localPopulation.ts). Sem autônomos, tudo como antes (avenida nunca vazia).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCAL_POPULATION_DEFAULTS as D, RallySuppression, isServerCrowdPoint, localPedLimit, localPedMinSpawn, parseLocalPopulation } from '../src/npc/localPopulation';

describe('rodada 12 (G) — população local × autônomos', () => {
  it('pedestres locais: cheios sem autônomos, caem linear até o mínimo, e com autônomos só nascem no fundo', () => {
    expect(localPedLimit(56, 0)).toBe(56);
    expect(localPedLimit(56, D.fullAt)).toBe(56);
    const mid = localPedLimit(56, (D.fullAt + D.offAt) / 2);
    expect(mid).toBeLessThan(56); expect(mid).toBeGreaterThan(D.minPeds);
    expect(localPedLimit(56, D.offAt)).toBe(D.minPeds);
    expect(localPedLimit(56, 500)).toBe(D.minPeds);
    expect(localPedLimit(2, 500)).toBe(2);
    expect(localPedMinSpawn(0)).toBe(0);
    expect(localPedMinSpawn(D.fullAt + 1)).toBe(D.backgroundM);
  });

  it('concentração: ponto com autônomos perde os NPCs locais (histerese); concentração dinâmica nunca tem locais', () => {
    const s = new RallySuppression();
    const pts = [{ id: 'trio1', x: 0, z: 0, radius: 20 }, { id: 'evt_dyn_dyn7', x: 100, z: 0, radius: 14 }];
    let n = 0;
    const count = (x: number) => (x === 0 ? n : 0);
    s.update(pts, count);
    expect(s.suppressed('trio1')).toBe(false);
    expect(s.suppressed('evt_dyn_dyn7')).toBe(true);
    n = D.rallySuppressAt; s.update(pts, count); expect(s.suppressed('trio1')).toBe(true);
    n = D.rallySuppressAt - 1; s.update(pts, count); expect(s.suppressed('trio1')).toBe(true); // histerese
    n = D.rallyResumeAt; s.update(pts, count); expect(s.suppressed('trio1')).toBe(false);
    s.update([], count); expect(s.size).toBe(0);
    expect(isServerCrowdPoint('evt_dyn_dyn1')).toBe(true);
    expect(isServerCrowdPoint('evt_caminhada')).toBe(false);
  });

  it('números vêm dos dados (public/gameplay/autonomous.json `localPopulation`) e são presos', () => {
    const raw = JSON.parse(readFileSync('public/gameplay/autonomous.json', 'utf8'));
    expect(parseLocalPopulation(raw.localPopulation)).toEqual(D);
    const bad = parseLocalPopulation({ fullAt: 10, offAt: 2, rallySuppressAt: 1, rallyResumeAt: 5, nearM: 'x' });
    expect(bad.offAt).toBeGreaterThan(bad.fullAt);
    expect(bad.rallySuppressAt).toBeGreaterThan(bad.rallyResumeAt);
    expect(bad.nearM).toBe(D.nearM);
  });
});
