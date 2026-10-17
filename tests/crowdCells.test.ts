/**
 * Espectador AÉREO (rodada 8.1): camadas por altitude (histerese), agregador de células determinístico (jogadores e
 * ambiente separados, grupos/atividades), codificação binária e entrega por espectador (delta, full, teto de bytes).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CROWD_CELL, SPEC_TIER_ALT, SPEC_TIER_AOI, cellSeed, tierForAltitude, type SpecTier } from '../src/spectator/tiers';
import { cellKey, cellOfKey, decodeCells, encodeCells } from '../src/spectator/cellCodec';
import { CellFeed, CrowdCellAggregator, apportion, environmentCells, type CellPlayer, type EnvModel } from '../server/src/spectator/CrowdCellAggregator';
import { SpectatorSessions } from '../server/src/spectator/SpectatorSession';
import { sanitizeSpecAlt, SPECTATOR } from '../src/spectator/bounds';
import { pointOnAxis } from '../src/world/zones';
import { RALLY_SHAPE } from '../src/social/rally';

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const axis: [number, number][] = manifest.pvAxis;
const GROUPS = ['grupo-13', 'grupo-22', 'neutro', ''];

function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** n jogadores espalhados ao longo do eixo (Central → Candelária), grupos e atividades variados */
function crowd(n: number, seed = 1): CellPlayer[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const p = pointOnAxis(axis, 0.18 + (i / n) * 0.82, (r() - 0.5) * 30);
    return { x: p.x + (r() - 0.5) * 6, z: p.z + (r() - 0.5) * 6, group: GROUPS[i % GROUPS.length], activity: i % 4 };
  });
}
const ENV: EnvModel = {
  rallies: [{ x: 593, z: -143, ...RALLY_SHAPE.stage }, { x: -241, z: 192, ...RALLY_SHAPE.truck }, { x: 100, z: 60, ...RALLY_SHAPE.trio }],
  rallyCrowd: 360, peds: 56, axis, pedRange: [0.18, 1],
};
const strip = (s: Map<number, unknown>) => JSON.stringify([...s.values()]);

describe('camadas por altitude (histerese)', () => {
  it('sobe nos limites e desce só abaixo do limite menos a histerese', () => {
    const h = SPEC_TIER_ALT.hysteresis;
    expect(tierForAltitude(10, 'NEAR')).toBe('NEAR');
    expect(tierForAltitude(SPEC_TIER_ALT.MID, 'NEAR')).toBe('MID');
    expect(tierForAltitude(SPEC_TIER_ALT.FAR, 'NEAR')).toBe('FAR');
    expect(tierForAltitude(260, 'NEAR')).toBe('AGGREGATE');
    // zona de histerese: fica
    expect(tierForAltitude(SPEC_TIER_ALT.AGGREGATE - h + 1, 'AGGREGATE')).toBe('AGGREGATE');
    expect(tierForAltitude(SPEC_TIER_ALT.FAR - h + 1, 'FAR')).toBe('FAR');
    expect(tierForAltitude(SPEC_TIER_ALT.MID - h + 1, 'MID')).toBe('MID');
    // abaixo da histerese: desce (e pode descer várias camadas de uma vez)
    expect(tierForAltitude(SPEC_TIER_ALT.AGGREGATE - h - 1, 'AGGREGATE')).toBe('FAR');
    expect(tierForAltitude(5, 'AGGREGATE')).toBe('NEAR');
    expect(tierForAltitude(SPEC_TIER_ALT.FAR - h - 1, 'FAR')).toBe('MID');
  });
  it('oscilação na borda não troca de camada a cada amostra', () => {
    let t: SpecTier = 'NEAR', changes = 0;
    for (let i = 0; i < 200; i++) { const n = tierForAltitude(SPEC_TIER_ALT.FAR + Math.sin(i) * 5, t); if (n !== t) changes++; t = n; }
    expect(changes).toBeLessThanOrEqual(1);
  });
  it('spec_cam.alt: presa e opcional (cliente antigo = NEAR); AOI por camada nunca maior que o do jogador', () => {
    expect(sanitizeSpecAlt({ x: 0, z: 0 })).toBe(0);
    expect(sanitizeSpecAlt({ alt: 'x' })).toBe(0);
    expect(sanitizeSpecAlt({ alt: -5 })).toBe(0);
    expect(sanitizeSpecAlt({ alt: 1e9 })).toBe(SPECTATOR.maxAlt + 40);
    const s = new SpectatorSessions([-1250, -750, 1250, 1000], 0);
    s.add({ sessionId: 'a' } as never, 1, { x: 0, z: 0 }, 48);
    expect(s.get('a')!.tier).toBe('NEAR');
    expect(s.onCam('a', { x: 0, z: 0, alt: 250 }, 10)).toBe('ok');
    expect(s.get('a')!.tier).toBe('AGGREGATE');
    expect(SpectatorSessions.aoiRadius(s.get('a')!, 220)).toBe(SPEC_TIER_AOI.AGGREGATE);
    s.onCam('a', { x: 0, z: 0 }, 20); // sem alt → chão
    expect(s.get('a')!.tier).toBe('NEAR');
    expect(SpectatorSessions.aoiRadius(s.get('a')!, 220)).toBe(220);
    expect(SpectatorSessions.aoiRadius({ tier: 'NEAR' }, 150)).toBe(150);
  });
});

describe('agregador de células', () => {
  const env = environmentCells(ENV);
  it('ambiente determinístico e com soma exata (concentrações + pedestres)', () => {
    const again = environmentCells(ENV);
    expect([...again]).toEqual([...env]);
    expect([...env.values()].reduce((a, b) => a + b, 0)).toBe(360 + 56);
    // mais gente na concentração do trio (força 1) do que no caminhão (0,35)
    const at = (x: number, z: number) => env.get(cellKey(Math.floor(x / 40), Math.floor(z / 40))) ?? 0;
    expect(at(100, 60)).toBeGreaterThan(at(-241, 192));
  });
  it('mesma entrada (em qualquer ordem) → snapshots idênticos; seed da célula = cellSeed(cx, cz, época)', () => {
    const ps = crowd(500);
    const a = new CrowdCellAggregator(20261015).build(ps, env, 1000);
    const shuffled = [...ps].sort(() => Math.random() - 0.5);
    const b = new CrowdCellAggregator(20261015).build(shuffled, new Map([...env].reverse()), 1000);
    expect(strip(a.cells)).toBe(strip(b.cells));
    expect([...a.sig]).toEqual([...b.sig]);
    for (const c of a.cells.values()) expect(c.seed).toBe(cellSeed(c.cx, c.cz, 20261015));
    // outra época → outras seeds, mesmas contagens
    const c = new CrowdCellAggregator(7).build(ps, env, 1000);
    expect([...c.cells.values()].map((x) => x.players)).toEqual([...a.cells.values()].map((x) => x.players));
    expect([...c.cells.values()].some((x, i) => x.seed !== [...a.cells.values()][i].seed)).toBe(true);
  });
  it('jogadores e ambiente separados; grupos e atividades somam os jogadores da célula', () => {
    const ps = crowd(500);
    const s = new CrowdCellAggregator(1).build(ps, env, 0);
    expect(s.totals.players).toBe(500);
    expect(s.totals.env).toBe(416);
    let gsum = 0;
    for (const c of s.cells.values()) {
      const g = Object.values(c.groups).reduce((a, b) => a + b, 0), act = c.activity.reduce((a, b) => a + b, 0);
      expect(g).toBe(c.players);
      expect(act).toBe(c.players);
      expect(c.density).toBeCloseTo((c.players + c.env) / 1600, 9);
      gsum += c.groups['grupo-13'] ?? 0;
    }
    expect(gsum).toBe(125);
    // só ambiente: nenhuma célula com jogadores
    const e = new CrowdCellAggregator(1).build([], env, 0);
    expect([...e.cells.values()].every((c) => c.players === 0 && c.env > 0 && !Object.keys(c.groups).length)).toBe(true);
    // jogadores sem ambiente: env 0
    const p = new CrowdCellAggregator(1).build(ps, new Map(), 0);
    expect([...p.cells.values()].every((c) => c.env === 0)).toBe(true);
  });
  it('arredondamento pelo maior resto: soma exata, empate pela menor chave', () => {
    const out = new Map<number, number>();
    apportion(10, new Map([[3, 1], [1, 1], [2, 1]]), out);
    expect([...out.entries()].sort()).toEqual([[1, 4], [2, 3], [3, 3]]);
    expect(cellOfKey(cellKey(-12, 7))).toEqual([-12, 7]);
  });
});

describe('spec_cells: codificação e entrega', () => {
  const env = environmentCells(ENV);
  it('binário ida e volta = snapshot do servidor (density/seed recalculados iguais)', () => {
    const s = new CrowdCellAggregator(99).build(crowd(500), env, 123456);
    const cells = [...s.cells.values()];
    const m = decodeCells(encodeCells({ tier: 'AGGREGATE', cells, removed: [[1, -2]], full: true }, 99, 123456))!;
    expect(m.tier).toBe('AGGREGATE');
    expect(m.full).toBe(true);
    expect(m.removed).toEqual([[1, -2]]);
    expect(JSON.stringify(m.cells)).toBe(JSON.stringify(cells));
    expect(decodeCells(new Uint8Array([9, 9]))).toBeNull();
  });
  it('500 jogadores na avenida inteira: AGGREGATE full cabe no teto (bytes/s) e é ~4× menor que JSON', () => {
    const s = new CrowdCellAggregator(1).build(crowd(500), env, 0);
    const f = new CellFeed();
    f.setTier('AGGREGATE');
    const m = f.next(s, { x: 0, z: 0 }, 0)!;
    const bin = encodeCells(m, 1, 0).byteLength;
    const json = JSON.stringify(m).length;
    expect(m.cells.length).toBe(s.cells.size); // tudo coube num envio só
    expect(bin).toBeLessThanOrEqual(CROWD_CELL.maxBytesPerSec);
    expect(json / bin).toBeGreaterThan(2.5);
  });
  it('delta: só o que mudou; removidas; full na troca de camada; FAR só perto do foco', () => {
    const ps = crowd(300);
    const A = new CrowdCellAggregator(1);
    const s1 = A.build(ps, env, 0);
    const f = new CellFeed();
    f.setTier('FAR');
    const focus = pointOnAxis(axis, 0.954);
    const m1 = f.next(s1, focus, 0)!;
    expect(m1.full).toBe(true);
    for (const c of m1.cells) expect(Math.hypot((c.cx + 0.5) * 40 - focus.x, (c.cz + 0.5) * 40 - focus.z)).toBeLessThanOrEqual(CROWD_CELL.farRadiusM);
    expect(m1.cells.length).toBeLessThan(s1.cells.size);
    expect(f.next(A.build(ps, env, 1000), focus, 1000)).toBeNull(); // nada mudou
    // um jogador muda de célula perto do foco → 1–2 células no delta
    const moved = ps.map((p) => ({ ...p }));
    const near = moved.findIndex((p) => Math.hypot(p.x - focus.x, p.z - focus.z) < 60);
    moved[near].x += 45;
    const m3 = f.next(A.build(moved, env, 2000), focus, 2000)!;
    expect(m3.full).toBe(false);
    expect(m3.cells.length + (m3.removed?.length ?? 0)).toBeGreaterThanOrEqual(1);
    expect(m3.cells.length).toBeLessThanOrEqual(2);
    // foco vai para a Central: as da Candelária saem (removed)
    const m4 = f.next(A.build(moved, env, 3000), pointOnAxis(axis, 0.28), 3000)!;
    expect(m4.removed!.length).toBeGreaterThan(0);
    // troca de camada → full; NEAR → uma mensagem vazia full e depois nada
    f.setTier('AGGREGATE');
    expect(f.next(A.build(moved, env, 4000), focus, 4000)!.full).toBe(true);
    f.setTier('NEAR');
    expect(f.next(A.build(moved, env, 5000), focus, 5000)).toMatchObject({ tier: 'NEAR', cells: [], full: true });
    expect(f.next(A.build(moved, env, 6000), focus, 6000)).toBeNull();
  });
  it('teto de bytes/s: o que não cabe vai no próximo envio, mais perto do foco primeiro', () => {
    const s = new CrowdCellAggregator(1).build(crowd(500), env, 0);
    const f = new CellFeed(600);
    f.setTier('AGGREGATE');
    let got = 0, t = 0, maxBytes = 0, first: number | null = null;
    for (let i = 0; i < 40 && got < s.cells.size; i++, t += 1000) {
      const m = f.next(s, { x: 0, z: 0 }, t);
      if (!m) continue;
      const b = encodeCells(m, 1, t).byteLength;
      maxBytes = Math.max(maxBytes, b);
      if (first === null) first = Math.max(...m.cells.map((c) => Math.hypot(c.cx * 40, c.cz * 40)));
      got += m.cells.length;
    }
    expect(got).toBe(s.cells.size);
    expect(maxBytes).toBeLessThanOrEqual(600);
    expect(f.stats.capped).toBeGreaterThan(0);
    expect(first!).toBeLessThan(400); // o primeiro pedaço é o centro
  });
  it('dois espectadores com o mesmo conjunto recebem células idênticas', () => {
    const s = new CrowdCellAggregator(5).build(crowd(500), env, 0);
    const a = new CellFeed(), b = new CellFeed();
    a.setTier('AGGREGATE'); b.setTier('AGGREGATE');
    const ma = a.next(s, { x: 0, z: 0 }, 0)!, mb = b.next(s, { x: 0, z: 0 }, 0)!;
    expect(Buffer.from(encodeCells(ma, 5, 0)).equals(Buffer.from(encodeCells(mb, 5, 0)))).toBe(true);
  });
});
