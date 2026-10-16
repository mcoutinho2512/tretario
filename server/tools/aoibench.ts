/**
 * Micro-benchmark da área de interesse (sem rede): N jogadores numa elipse de 60 × 20 m (denso) ou ao longo de 2 km
 * (espalhado); mede o custo de UM recálculo completo de AOI (todos os clientes) com a grade espacial e o limite
 * de detalhados, comparado com o algoritmo antigo (todos contra todos).
 *
 * uso: npx tsx tools/aoibench.ts [N=500] [denso|espalhado] [limite=48]
 */
import { SpatialGrid, selectInterest, selectInterestSlots, InterestScratch, makeSlotView } from '../../src/net/spatialGrid.ts';

const N = Number(process.argv[2] ?? 500);
const dense = (process.argv[3] ?? 'denso') === 'denso';
const CAP = Number(process.argv[4] ?? 48);
const R = 220;
let s = 1;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const pts = Array.from({ length: N }, () => (dense ? { x: (rnd() - 0.5) * 120, z: (rnd() - 0.5) * 40 } : { x: (rnd() - 0.5) * 2000, z: (rnd() - 0.5) * 60 }));
const views = pts.map(() => new Set<number>());
const sviews = pts.map(() => makeSlotView());
const g = new SpatialGrid(R / 2);
const sc = new InterestScratch();
const add: number[] = [], rem: number[] = [], over: number[] = [];

/** referência (objetos, ordenação completa) */
function refPass() {
  g.clear();
  pts.forEach((p, i) => g.insert(i, p.x, p.z));
  let o = 0;
  for (let i = 0; i < N; i++) {
    const res = selectInterest({ candidates: g.queryRadius(pts[i].x, pts[i].z, R * 1.15), inView: views[i], radius: R, cap: CAP, always: new Set([i]) });
    res.add.forEach((a) => views[i].add(a));
    res.remove.forEach((a) => views[i].delete(a));
    o += res.overflow.length;
  }
  return o;
}
/** caminho do servidor (slots, quickselect, sem alocação) */
function gridPass() {
  g.clear();
  pts.forEach((p, i) => g.insert(i, p.x, p.z));
  let o = 0;
  for (let i = 0; i < N; i++) { selectInterestSlots(g, i, pts[i].x, pts[i].z, sviews[i], { radius: R, cap: CAP }, sc, add, rem, over); o += over.length; }
  return o;
}
function legacyPass() {
  let n = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { if (Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z) <= R) n++; }
  return n;
}
for (const [name, fn] of [['grade+limite (servidor)', gridPass], ['grade+limite (referência)', refPass], ['todos×todos (só distâncias)', legacyPass]] as const) {
  fn();
  const t0 = performance.now();
  const K = 10;
  for (let k = 0; k < K; k++) { fn(); for (const p of pts) { p.x += (rnd() - 0.5) * 0.4; p.z += (rnd() - 0.5) * 0.4; } }
  console.log(`${name}: ${((performance.now() - t0) / K).toFixed(2)} ms por recálculo (N=${N}, ${dense ? 'denso' : 'espalhado'}, limite ${CAP})`);
}
