/** HUD da rodada 8: LOD dos apelidos, rastreador de zona com histerese, grade de densidade, ajudantes de ritmo. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NAME_LOD, nameTier, selectNames, shortName, type NameCandidate } from '../src/net/nameLod';
import { ZoneTracker } from '../src/world/zoneTracker';
import { pointOnAxis, type ZoneDefinition } from '../src/world/zones';
import { DensityGrid, heatLevel } from '../src/ui/hud/densityGrid';
import { AutoHide, RateGate, TextSlot } from '../src/ui/hud/throttle';
import { DEFAULT_HUD_PREFS, mergePrefs } from '../src/ui/hud/hudPrefs';

const cand = (o: Partial<NameCandidate> = {}): NameCandidate => ({ key: 0, dist: 10, nx: 0, ny: 0, front: true, interacting: false, prev: 'hidden', ...o });

describe('LOD dos apelidos', () => {
  it('faixas por distância (PRÓXIMOS)', () => {
    expect(nameTier(cand({ dist: 5 }), 'PROXIMOS')).toBe('full');
    expect(nameTier(cand({ dist: 14.9 }), 'PROXIMOS')).toBe('full');
    expect(nameTier(cand({ dist: 20 }), 'PROXIMOS')).toBe('short');
    expect(nameTier(cand({ dist: 29 }), 'PROXIMOS')).toBe('short');
    expect(nameTier(cand({ dist: 55 }), 'PROXIMOS')).toBe('hidden');
  });

  it('30–50 m: só no centro da tela ou interagindo', () => {
    expect(nameTier(cand({ dist: 40, nx: 0.05, ny: 0.05 }), 'PROXIMOS')).toBe('short');
    expect(nameTier(cand({ dist: 40, nx: 0.7, ny: 0 }), 'PROXIMOS')).toBe('hidden');
    expect(nameTier(cand({ dist: 40, nx: 0.7, ny: 0, interacting: true }), 'PROXIMOS')).toBe('short');
    expect(nameTier(cand({ dist: 40, nx: 0.7, ny: 0 }), 'TODOS')).toBe('short');
    expect(nameTier(cand({ dist: 49, nx: 0.7, interacting: true }), 'PROXIMOS')).toBe('short');
  });

  it('NENHUM, atrás da câmera e fora da tela: nada', () => {
    expect(nameTier(cand({ dist: 3 }), 'NENHUM')).toBe('hidden');
    expect(nameTier(cand({ dist: 3, front: false }), 'PROXIMOS')).toBe('hidden');
    expect(nameTier(cand({ dist: 3, nx: 1.4 }), 'TODOS')).toBe('hidden');
  });

  it('histerese nas fronteiras (não pisca)', () => {
    const d = NAME_LOD.full + 0.8;
    expect(nameTier(cand({ dist: d, prev: 'hidden' }), 'PROXIMOS')).toBe('short');
    expect(nameTier(cand({ dist: d, prev: 'full' }), 'PROXIMOS')).toBe('full');
    const m = NAME_LOD.max + 0.8;
    expect(nameTier(cand({ dist: m, prev: 'hidden', interacting: true }), 'PROXIMOS')).toBe('hidden');
    expect(nameTier(cand({ dist: m, prev: 'short', interacting: true }), 'PROXIMOS')).toBe('short');
  });

  it('limite de rótulos: mais perto/centro primeiro; interagindo ganha', () => {
    const cs: NameCandidate[] = [];
    for (let i = 0; i < 40; i++) cs.push(cand({ key: i, dist: 2 + i * 0.6, nx: (i % 5) * 0.1 }));
    const pick = selectNames(cs, 'TODOS', 12);
    expect(pick.size).toBe(12);
    for (let i = 0; i < 12; i++) expect(pick.has(i)).toBe(true);
    cs.push(cand({ key: 99, dist: 24, nx: 0.3, interacting: true }));
    const pick2 = selectNames(cs, 'TODOS', 12);
    expect(pick2.has(99)).toBe(true);
    expect(selectNames(cs, 'NENHUM').size).toBe(0);
  });

  it('apelido simplificado', () => {
    expect(shortName('Ana')).toBe('Ana');
    expect(shortName('Maria Aparecida da Silva')).toBe('Maria');
    expect(shortName('Bartolomeucristovao')).toBe('Bartolome…');
    expect(shortName('Bartolomeucristovao').length).toBe(10);
  });
});

describe('zonas com histerese', () => {
  const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as { pvAxis: [number, number][] };
  const zones = (JSON.parse(readFileSync('public/world/zones.json', 'utf8')) as { zones: ZoneDefinition[] }).zones;
  const axis = manifest.pvAxis;
  const at = (t: number, side = 0) => pointOnAxis(axis, t, side);

  it('entra direto na primeira amostra e reconhece os trechos calibrados', () => {
    for (const [t, id] of [[0.28, 'CENTRAL'], [0.37, 'CAMPO_DE_SANTANA'], [0.6, 'CENTRO'], [0.885, 'RIO_BRANCO'], [0.954, 'CANDELARIA'], [0.08, 'CIDADE_NOVA']] as const) {
      const tr = new ZoneTracker(zones, axis);
      const p = at(t);
      expect(tr.update(p.x, p.z, 0)?.to?.id).toBe(id);
    }
  });

  it('troca só depois de permanecer como candidata (dwell)', () => {
    const tr = new ZoneTracker(zones, axis, { dwellMs: 1000, marginT: 0 });
    const a = at(0.30), b = at(0.40);
    tr.update(a.x, a.z, 0);
    expect(tr.current?.id).toBe('CENTRAL');
    expect(tr.update(b.x, b.z, 100)).toBeNull();
    expect(tr.update(b.x, b.z, 600)).toBeNull();
    const ch = tr.update(b.x, b.z, 1200);
    expect(ch?.from?.id).toBe('CENTRAL');
    expect(ch?.to?.id).toBe('CAMPO_DE_SANTANA');
  });

  it('vai-e-volta na fronteira não troca de zona', () => {
    const tr = new ZoneTracker(zones, axis, { dwellMs: 1000 });
    const inside = at(0.325), over = at(0.334); // fronteira em 0,33 (margem padrão 0,006)
    tr.update(inside.x, inside.z, 0);
    let changes = 0;
    for (let ms = 100; ms < 10000; ms += 100) {
      const p = Math.floor(ms / 700) % 2 ? over : inside;
      if (tr.update(p.x, p.z, ms)) changes++;
    }
    expect(changes).toBe(0);
    expect(tr.current?.id).toBe('CENTRAL');
  });

  it('saindo lateralmente para longe: fora de todas (null) após o dwell; reset entra direto', () => {
    const tr = new ZoneTracker(zones, axis, { dwellMs: 500 });
    const p = at(0.6), far = at(0.6, 600);
    tr.update(p.x, p.z, 0);
    tr.update(far.x, far.z, 100);
    expect(tr.update(far.x, far.z, 700)?.to).toBeNull();
    tr.reset();
    expect(tr.update(p.x, p.z, 800)?.to?.id).toBe('CENTRO');
  });
});

describe('grade de densidade', () => {
  it('agrega pontos em células; ignora fora da grade', () => {
    const g = new DensityGrid(0, 0, 100, 50, 10);
    expect(g.cols).toBe(10);
    expect(g.rows).toBe(5);
    const pts = [{ x: 1, z: 1 }, { x: 9, z: 9 }, { x: 15, z: 2 }, { x: 99, z: 49 }, { x: -5, z: 3 }, { x: 200, z: 0 }];
    g.addAll(pts);
    expect(g.at(5, 5)).toBe(2);
    expect(g.at(15, 5)).toBe(1);
    expect(g.at(95, 45)).toBe(1);
    expect(g.total).toBe(4);
    expect(g.peak).toBe(2);
    expect(g.cells()).toEqual([[0, 0, 2], [1, 0, 1], [9, 4, 1]]);
    g.clear();
    expect(g.total).toBe(0);
    expect(g.cells()).toEqual([]);
  });

  it('500 agentes numa concentração: poucas células, não 500 marcadores', () => {
    const g = new DensityGrid(-1250, -750, 1250, 1000, 10);
    const pts = Array.from({ length: 500 }, (_, i) => ({ x: Math.cos(i) * 30 * ((i % 7) / 7), z: Math.sin(i * 1.7) * 10 }));
    g.addAll(pts);
    expect(g.total).toBe(500);
    expect(g.cells().length).toBeLessThan(40);
  });

  it('intensidade satura e é monotônica', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(5, 40)).toBeLessThan(heatLevel(10, 40));
    expect(heatLevel(400, 40)).toBe(1);
  });
});

describe('ajudantes de ritmo do HUD', () => {
  it('RateGate deixa passar no máximo hz vezes por segundo', () => {
    const g = new RateGate(2);
    let n = 0;
    for (let t = 0; t <= 5000; t += 16) if (g.due(t)) n++;
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(11);
    g.poke();
    expect(g.due(5001)).toBe(true);
  });

  it('TextSlot só escreve quando muda', () => {
    const el = { textContent: '' as string | null };
    const s = new TextSlot(el);
    for (let i = 0; i < 100; i++) s.set('Modo pacífico');
    s.set('Modo interação');
    expect(s.writes).toBe(2);
    expect(el.textContent).toBe('Modo interação');
  });

  it('AutoHide: esmaece andando ou parado sem interação; volta ao interagir', () => {
    const h = new AutoHide({ idleMs: 9000, movingMs: 2500 });
    h.poke(0);
    expect(h.update(1000, true)).toBe(false);
    expect(h.update(3600, true)).toBe(true);
    expect(h.faded).toBe(true);
    h.poke(4000);
    expect(h.update(4016, true)).toBe(true);
    expect(h.faded).toBe(false);
    expect(h.update(8000, false)).toBe(false);
    expect(h.update(13100, false)).toBe(true);
    h.enabled = false;
    h.update(14000, false);
    expect(h.faded).toBe(false);
  });

  it('preferências: dado inválido é ignorado campo a campo', () => {
    expect(mergePrefs(DEFAULT_HUD_PREFS, { names: 'NENHUM', hudAutoHide: 'x', sound: false })).toEqual({ ...DEFAULT_HUD_PREFS, names: 'NENHUM', sound: false });
    expect(mergePrefs(DEFAULT_HUD_PREFS, { names: 'ALGUNS' }).names).toBe('PROXIMOS');
    expect(mergePrefs(DEFAULT_HUD_PREFS, null)).toEqual(DEFAULT_HUD_PREFS);
  });
});
