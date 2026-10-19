/**
 * Rodada 12 — colisão entre corpos, resolução PURA (src/physics/bodyResolve.ts): A anda contra B e não atravessa,
 * diagonal desliza, corredor fechado por 10 corpos bloqueia, 100 concentrados sem sobreposição generalizada, ponto
 * livre para spawn/reconexão, anti-trap e a distância de contato dentro do alcance de combate.
 */
import { describe, expect, it } from 'vitest';
import { BODY, type BodyRef } from '../src/physics/bodies';
import { SpatialBodyGrid, StuckDetector, canEscape, constrainMove, findFreeSpot, penetrationOf, resolveBodies, steerAround } from '../src/physics/bodyResolve';

const R = BODY.radius;
const body = (id: string, x: number, z: number, o: Partial<BodyRef> = {}): BodyRef => ({ id, x, z, r: R, ...o });

/** anda `self` em passos de dt até `to` (velocidade v) contra os vizinhos do índice */
function walk(grid: SpatialBodyGrid, self: BodyRef, toX: number, toZ: number, v = 1.6, dt = 1 / 60, steps = 600) {
  const near: BodyRef[] = [];
  let minD = Infinity;
  for (let i = 0; i < steps; i++) {
    const dx = toX - self.x, dz = toZ - self.z, l = Math.hypot(dx, dz);
    if (l < 0.02) break;
    const st = Math.min(l, v * dt);
    grid.near(self.x, self.z, BODY.queryRadius, near);
    const r = constrainMove(self.id, self.r, self.x, self.z, self.x + (dx / l) * st, self.z + (dz / l) * st, near, dt);
    grid.move(self.id, r.x, r.z);
    for (const n of near) if (n.id !== self.id) minD = Math.min(minD, Math.hypot(self.x - n.x, self.z - n.z));
  }
  return minD;
}

describe('colisão entre corpos — resolução pura', () => {
  it('contrato: dois corpos encostados ficam dentro do alcance de soco e de chute', () => {
    expect(2 * BODY.radius).toBeCloseTo(0.64, 5);
    expect(2 * BODY.radius).toBeLessThan(1.2); // soco
    expect(BODY.serverTolerance).toBeLessThan(BODY.radius);
  });

  it('A anda contra B (parado) e NÃO atravessa: para no contato', () => {
    const g = new SpatialBodyGrid();
    const a = g.upsert(body('A', 0, 0)), b = g.upsert(body('B', 0, 3));
    const minD = walk(g, a, 0, 6);
    expect(minD).toBeGreaterThan(2 * R - 1e-6);
    expect(a.z).toBeLessThan(b.z); // continua do mesmo lado
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(2 * R, 2);
    expect(b.x).toBe(0); expect(b.z).toBe(3); // B não foi empurrado (humano é duro)
  });

  it('diagonal: desliza pela tangente em vez de travar seco', () => {
    const g = new SpatialBodyGrid();
    const a = g.upsert(body('A', -0.2, 0));
    g.upsert(body('B', 0, 1.5));
    walk(g, a, 0.2, 4); // mira quase no centro de B, um pouco ao lado
    expect(a.z).toBeGreaterThan(3.9); // passou por B contornando
    // passo único: componente tangencial preservada
    const near = [body('B', 0, 1)];
    const r = constrainMove('A', R, 0.3, 0.4, 0.4, 0.55, near, 1 / 60);
    expect(Math.hypot(r.x - near[0].x, r.z - near[0].z)).toBeGreaterThanOrEqual(2 * R - 1e-9);
    expect(r.blocked).toBe(false);
  });

  it('10 corpos fechando um corredor de 6 m bloqueiam a passagem (sem deadlock: o lado continua livre)', () => {
    const g = new SpatialBodyGrid();
    for (let i = 0; i < 10; i++) g.upsert(body(`w${i}`, -2.9 + i * 0.64, 5)); // fila encostada (6,4 m)
    const a = g.upsert(body('A', 0, 0));
    walk(g, a, 0, 10, 1.6, 1 / 60, 900);
    expect(a.z).toBeLessThan(5); // não passou
    const near: BodyRef[] = [];
    g.near(a.x, a.z, 2, near);
    expect(penetrationOf('A', a.x, a.z, R, near).pen).toBeLessThan(1e-6);
    // andar de lado (para fora da fila) continua possível
    const x0 = a.x;
    walk(g, a, a.x + 1.5, a.z - 0.5, 1.6, 1 / 60, 120);
    expect(Math.abs(a.x - x0)).toBeGreaterThan(1);
  });

  it('corpo macio (NPC/autônomo) cede: penetração limitada a `soft`', () => {
    const near = [body('N', 0, 1, { soft: 0.15 })];
    const r = constrainMove('A', R, 0, 0, 0, 0.9, near, 1 / 60);
    expect(Math.hypot(r.x, r.z - 1)).toBeCloseTo(2 * R - 0.15, 3);
  });

  it('sobreposição antiga sai devagar (sem salto) e nunca afunda mais', () => {
    const near = [body('B', 0, 0.3)];
    const r = constrainMove('A', R, 0, 0, 0, 0.1, near, 1 / 60); // tenta ir para dentro
    const d = Math.hypot(r.x, r.z - 0.3);
    expect(d).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(d).toBeLessThan(0.3 + 0.6 / 60 + 1e-6);
  });

  it('100 concentrados no mesmo ponto: resolução progressiva separa sem explosão', () => {
    const g = new SpatialBodyGrid();
    const list: BodyRef[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 100; i++) list.push(g.upsert(body(`b${i}`, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2)));
    let maxStep = 0;
    for (let t = 0; t < 80; t++) {
      const before = list.map((b) => [b.x, b.z]);
      resolveBodies(list, g);
      list.forEach((b, i) => { maxStep = Math.max(maxStep, Math.hypot(b.x - before[i][0], b.z - before[i][1])); });
    }
    // estatística de distância mínima: cada corpo ao vizinho mais próximo
    const mins = list.map((a) => Math.min(...list.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.z - b.z))));
    mins.sort((x, y) => x - y);
    const median = mins[50], p05 = mins[5];
    expect(median).toBeGreaterThan(2 * R * 0.95);
    expect(p05).toBeGreaterThan(2 * R * 0.85);
    // sem explosão: ninguém andou mais que 2 × maxPush num passo e o grupo continua compacto (círculo de ~4 m)
    expect(maxStep).toBeLessThanOrEqual(2 * BODY.maxPushPerStep + 1e-9);
    expect(Math.max(...list.map((b) => Math.hypot(b.x, b.z)))).toBeLessThan(6);
  });

  it('autônomos contra humano FIXO: só os autônomos cedem', () => {
    const g = new SpatialBodyGrid();
    const h = g.upsert(body('h', 0, 0, { fixed: true }));
    const a = g.upsert(body('ac:1', 0.1, 0));
    for (let i = 0; i < 10; i++) resolveBodies([a], g);
    expect(h.x).toBe(0);
    expect(Math.hypot(a.x - h.x, a.z - h.z)).toBeGreaterThanOrEqual(2 * R - 1e-6);
  });

  it('spawn/reconexão em ponto ocupado vai para ponto livre próximo (e respeita parede)', () => {
    const g = new SpatialBodyGrid();
    for (let i = 0; i < 9; i++) g.upsert(body(`p${i}`, (i % 3 - 1) * 0.66, (Math.floor(i / 3) - 1) * 0.66));
    const f = findFreeSpot(0, 0, R, g);
    expect(f.moved).toBe(true);
    const near: BodyRef[] = [];
    g.near(f.x, f.z, 2, near);
    expect(penetrationOf('x', f.x, f.z, R, near).pen).toBeLessThanOrEqual(0);
    expect(Math.hypot(f.x, f.z)).toBeLessThan(2.5);
    // parede em x > 0: o ponto livre fica do lado de cá
    const w = findFreeSpot(0, 0, R, g, { clear: (x) => x < 0 });
    expect(w.x).toBeLessThan(0);
    // livre: fica onde está
    expect(findFreeSpot(10, 10, R, g)).toMatchObject({ x: 10, z: 10, moved: false });
  });

  it('anti-trap: só dispara preso de verdade (≥ 2 corpos ou corpo + parede) por X s', () => {
    const s = new StuckDetector(3);
    // multidão que atrapalha mas deixa andar: nunca dispara
    for (let i = 0; i < 600; i++) expect(s.update(1 / 60, 0.03, 0.012, 3, false)).toBe(false);
    // um só corpo, sem parede: não é armadilha
    for (let i = 0; i < 600; i++) expect(s.update(1 / 60, 0.03, 0, 1, false)).toBe(false);
    let fired = -1;
    for (let i = 0; i < 400 && fired < 0; i++) if (s.update(1 / 60, 0.03, 0, 2, false)) fired = i;
    expect(fired).toBeGreaterThan(170); expect(fired).toBeLessThan(185);
    // corpo + parede também
    let f2 = false;
    for (let i = 0; i < 200; i++) f2 = s.update(1 / 60, 0.03, 0, 1, true) || f2;
    expect(f2).toBe(true);
    // saída: só a frente fechada → escapa; cercado por 4 a 0,72 m → sem saída; parede atrás + 2 na frente → sem saída
    expect(canEscape('A', 0, 0, R, [body('f1', -0.33, 0.6), body('f2', 0.33, 0.6)])).toBe(true);
    const ring = [0, 1, 2, 3].map((i) => body(`c${i}`, Math.cos((i / 4) * Math.PI * 2) * 0.72, Math.sin((i / 4) * Math.PI * 2) * 0.72));
    expect(canEscape('A', 0, 0, R, ring)).toBe(false);
    expect(canEscape('A', 0, 0, R, ring.slice(0, 2))).toBe(true);
    expect(canEscape('A', 0, 0, R, ring.slice(0, 2), (_ax, _az, bx, bz) => bx > -0.1 && bz > -0.1)).toBe(false);
  });

  it('desvio local: contorna quem está à frente e nunca para de vez', () => {
    const near = [body('B', 0, 0.7)];
    const st = steerAround('A', 0, 0, 0, 1, near);
    expect(Math.abs(st.dx)).toBeGreaterThan(0.2);
    expect(st.speed).toBeGreaterThan(0.29);
    const free = steerAround('A', 0, 0, 0, 1, []);
    expect(free).toEqual({ dx: 0, dz: 1, speed: 1 });
  });

  it('grade: near só devolve o raio pedido; move troca de célula', () => {
    const g = new SpatialBodyGrid(2);
    g.upsert(body('a', 0, 0)); g.upsert(body('b', 1.5, 0)); g.upsert(body('c', 5, 5));
    const out: BodyRef[] = [];
    expect(g.near(0, 0, 2, out).map((b) => b.id).sort()).toEqual(['a', 'b']);
    g.move('c', 0.5, 0.5);
    expect(g.near(0, 0, 1, out).map((b) => b.id).sort()).toEqual(['a', 'c']);
    g.remove('a');
    expect(g.near(0, 0, 1, out).map((b) => b.id)).toEqual(['c']);
    expect(g.size).toBe(2);
    expect(g.queries).toBe(3);
  });
});
