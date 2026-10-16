import { describe, it, expect } from 'vitest';
import { SpatialGrid, selectInterest, selectInterestSlots, InterestScratch, makeSlotView } from '../src/net/spatialGrid';
import { encodeCrowd, decodeCrowd, CrowdTable, type CrowdEntry } from '../src/net/crowdCodec';

// gerador determinístico
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe('SpatialGrid', () => {
  it('consulta por raio == força bruta (pontos aleatórios, células variadas)', () => {
    const r = rng(7);
    for (const cell of [5, 50, 110]) {
      const g = new SpatialGrid(cell);
      const pts = Array.from({ length: 600 }, () => ({ x: (r() - 0.5) * 2000, z: (r() - 0.5) * 1500 }));
      pts.forEach((p, i) => g.insert(i, p.x, p.z));
      for (let q = 0; q < 40; q++) {
        const cx = (r() - 0.5) * 2000, cz = (r() - 0.5) * 1500, rad = 5 + r() * 300;
        const got = g.queryRadius(cx, cz, rad).map((e) => e.item).sort((a, b) => a - b);
        const want = pts.map((p, i) => [i, Math.hypot(p.x - cx, p.z - cz)] as const).filter(([, d]) => d <= rad).map(([i]) => i);
        expect(got).toEqual(want);
      }
    }
  });
  it('move/remove mantêm o índice coerente (inclusive coordenadas negativas e troca de célula)', () => {
    const g = new SpatialGrid(10);
    const a = 0, b = 700; // id alto: arrays internos crescem
    g.insert(a, -5, -5);
    g.insert(b, 3, 3);
    expect(g.queryRadius(0, 0, 8).length).toBe(2);
    g.move(a, -500, 40);
    expect(g.queryRadius(0, 0, 8).map((e) => e.item)).toEqual([b]);
    expect(g.queryRadius(-500, 40, 1)[0].item).toBe(a);
    g.remove(b);
    expect(g.queryRadius(0, 0, 8)).toEqual([]);
    expect(g.size).toBe(1);
    g.clear();
    expect(g.size).toBe(0);
    expect(g.has(a)).toBe(false);
    g.insert(a, 5, 5);
    g.insert(a, 1, 1); // reinserir = mover
    expect(g.size).toBe(1);
    expect(g.queryRadius(0, 0, 2)[0].d).toBeCloseTo(Math.SQRT2);
  });
});

describe('selectInterest (AOI com histerese, limite e prioridade por distância)', () => {
  /** algoritmo antigo (todos contra todos), para provar que o comportamento sem limite é idêntico */
  function legacy(pts: { x: number; z: number }[], me: number, inView: Set<number>, R: number) {
    const next = new Set(inView);
    pts.forEach((p, i) => {
      const d = Math.hypot(p.x - pts[me].x, p.z - pts[me].z);
      const near = i === me || d <= R;
      const has = next.has(i);
      if (near && !has) next.add(i);
      else if (!near && has && d > R * 1.15) next.delete(i);
    });
    return next;
  }

  it('sem limite: idêntico ao algoritmo antigo, ao longo de vários passos de movimento', () => {
    const r = rng(42);
    const R = 220;
    const pts = Array.from({ length: 300 }, () => ({ x: (r() - 0.5) * 1600, z: (r() - 0.5) * 300 }));
    const views = pts.map(() => new Set<number>());
    const viewsL = pts.map(() => new Set<number>());
    const g = new SpatialGrid(R / 2);
    for (let step = 0; step < 25; step++) {
      g.clear();
      pts.forEach((p, i) => g.insert(i, p.x, p.z));
      pts.forEach((p, me) => {
        const res = selectInterest({ candidates: g.queryRadius(p.x, p.z, R * 1.15), inView: views[me], radius: R, always: new Set([me]) });
        res.add.forEach((a) => views[me].add(a));
        res.remove.forEach((a) => views[me].delete(a));
        viewsL[me] = legacy(pts, me, viewsL[me], R);
        expect([...views[me]].sort((a, b) => a - b)).toEqual([...viewsL[me]].sort((a, b) => a - b));
      });
      for (const p of pts) { p.x += (r() - 0.5) * 60; p.z += (r() - 0.5) * 30; }
    }
  });

  it('histerese: entra a ≤ R, só sai além de R × 1,15', () => {
    const cand = (d: number) => [{ item: 'x', d }];
    expect(selectInterest({ candidates: cand(230), inView: new Set(), radius: 220 }).add).toEqual([]);
    expect(selectInterest({ candidates: cand(230), inView: new Set(['x']), radius: 220 }).remove).toEqual([]);
    expect(selectInterest({ candidates: [], inView: new Set(['x']), radius: 220 }).remove).toEqual(['x']);
    expect(selectInterest({ candidates: cand(200), inView: new Set(), radius: 220 }).add).toEqual(['x']);
  });

  it('limite: mantém os mais próximos, devolve o resto como "overflow" e não troca na borda', () => {
    const cands = Array.from({ length: 10 }, (_, i) => ({ item: i, d: 10 + i * 10 }));
    const res = selectInterest({ candidates: cands, inView: new Set<number>(), radius: 220, cap: 4, always: new Set([99]) });
    expect([...res.add].sort((a: number, b: number) => a - b)).toEqual([0, 1, 2, 3, 99]);
    expect(res.overflow.map((o) => o.item)).toEqual([4, 5, 6, 7, 8, 9]);
    // o item 3 (40 m) já está na vista; um novo a 38 m não o desaloja (vantagem de quem já está)
    const c2 = [...cands.slice(0, 3), { item: 3, d: 40 }, { item: 50, d: 38 }];
    const r2 = selectInterest({ candidates: c2, inView: new Set([0, 1, 2, 3]), radius: 220, cap: 4 });
    expect(r2.add).toEqual([]);
    expect(r2.remove).toEqual([]);
    // mas um novo bem mais perto entra e o mais distante sai
    const r3 = selectInterest({ candidates: [...c2.slice(0, 4), { item: 51, d: 5 }], inView: new Set([0, 1, 2, 3]), radius: 220, cap: 4 });
    expect(r3.add).toEqual([51]);
    expect(r3.remove).toEqual([3]);
  });
});

describe('selectInterestSlots (caminho rápido do servidor) == selectInterest (referência)', () => {
  for (const [label, cap, spread] of [['denso, limite 48', 48, 60], ['espalhado, limite 48', 48, 1600], ['denso, sem limite', 0, 80], ['limite 5', 5, 300]] as const) {
    it(label, () => {
      const r = rng(99 + cap);
      const R = 220;
      const N = 260;
      const pts = Array.from({ length: N }, () => ({ x: (r() - 0.5) * spread, z: (r() - 0.5) * spread * 0.3 }));
      const ref = pts.map(() => new Set<number>());
      const fast = pts.map(() => makeSlotView());
      const g = new SpatialGrid(R / 2);
      const sc = new InterestScratch();
      const add: number[] = [], rem: number[] = [], over: number[] = [];
      for (let step = 0; step < 12; step++) {
        g.clear();
        pts.forEach((p, i) => g.insert(i, p.x, p.z));
        pts.forEach((p, me) => {
          const res = selectInterest({ candidates: g.queryRadius(p.x, p.z, R * 1.15), inView: ref[me], radius: R, cap: cap || undefined, always: new Set([me]) });
          res.add.forEach((a) => ref[me].add(a));
          res.remove.forEach((a) => ref[me].delete(a));
          selectInterestSlots(g, me, p.x, p.z, fast[me], { radius: R, cap }, sc, add, rem, over);
          expect([...fast[me].list].sort((a, b) => a - b)).toEqual([...ref[me]].sort((a, b) => a - b));
          expect([...over].sort((a, b) => a - b)).toEqual(res.overflow.map((o) => o.item).sort((a, b) => a - b));
          if (cap) expect(fast[me].list.length).toBeLessThanOrEqual(cap + 1);
        });
        for (const p of pts) { p.x += (r() - 0.5) * spread * 0.05; p.z += (r() - 0.5) * spread * 0.02; }
      }
    });
  }
});

describe('crowdCodec (multidão distante)', () => {
  it('ida e volta com quantização (dm, rumo 8 bits, velocidade 0,05 m/s) e aparência opcional', () => {
    const es: CrowdEntry[] = [
      { nid: 1, x: -1193.32, y: 0.4, z: 491.9, heading: 1.75, speed: 1.3, body: 2, status: 0, vehicle: false, app: { skin: 0xc68b62, hair: 0x222222, top: 0x2f6f8f, bottom: 0x2c3a52 } },
      { nid: 65535, x: 1500, y: 12.3, z: -1000, heading: -3.0, speed: 5.5, body: 3, status: 1, vehicle: true },
    ];
    const buf = encodeCrowd(es);
    expect(buf.byteLength).toBe(3 + 11 * 2 + 12);
    const d = decodeCrowd(buf);
    expect(d.length).toBe(2);
    expect(d[0].nid).toBe(1);
    expect(d[0].x).toBeCloseTo(-1193.3, 1);
    expect(d[0].z).toBeCloseTo(491.9, 1);
    expect(Math.abs(d[0].heading - 1.75)).toBeLessThan(0.013);
    expect(d[0].speed).toBeCloseTo(1.3, 1);
    expect(d[0].app).toEqual(es[0].app);
    expect(d[1]).toMatchObject({ nid: 65535, body: 3, status: 1, vehicle: true });
    expect(Math.abs(d[1].heading + 3.0)).toBeLessThan(0.013);
    expect(d[1].app).toBeUndefined();
  });
  it('CrowdTable (servidor: cada jogador codificado uma vez) produz os mesmos bytes que encodeCrowd', () => {
    const app = { skin: 0x112233, hair: 0x445566, top: 0x778899, bottom: 0xaabbcc };
    const t = new CrowdTable();
    const es = Array.from({ length: 300 }, (_, i) => ({ nid: i + 1, x: i * 3.1 - 400, y: 0.2, z: -i * 1.7, heading: i * 0.1 - 3, speed: (i % 7) * 0.4, body: i % 4, status: i % 3, vehicle: i % 5 === 0, app }));
    es.forEach((e, i) => t.set(i, e));
    const slots = [5, 299, 0, 42];
    const withApp = new Set([299, 42]);
    const got = t.build(slots, slots.length, (sl) => withApp.has(sl));
    const want = encodeCrowd(slots.map((sl) => ({ ...es[sl], app: withApp.has(sl) ? app : undefined })));
    expect(Array.from(got)).toEqual(Array.from(want));
    expect(decodeCrowd(t.build([], 0, () => false))).toEqual([]);
  });
  it('rejeita buffer de outra versão ou truncado sem lançar', () => {
    expect(decodeCrowd(new Uint8Array([9, 1, 0]))).toEqual([]);
    const b = encodeCrowd([{ nid: 3, x: 1, y: 0, z: 2, heading: 0, speed: 0, body: 0, status: 0, vehicle: false }]);
    expect(decodeCrowd(b.slice(0, 8))).toEqual([]);
  });
});
