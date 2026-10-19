/**
 * Rodada 12 (agente D) — custo SINTÉTICO da decisão dos nomes (src/net/nameLod.ts) com 50/250/500 candidatos — o pior
 * caso teórico (no jogo o cliente só tem até 64 remotos detalhados; o resto é multidão distante, sem nome). Mistura
 * 60 % autônomos (60 % deles com nome), distâncias 0–60 m, posições na tela aleatórias, oclusão por cache com raio
 * de custo simulado (~40 segmentos testados). Imprime ms por decisão (média de 2000) — a decisão roda a 5 Hz.
 * uso: npx tsx tools/qa/nametag_synth.ts
 */
import { OcclusionCache, autonomousTagged, selectNames, type NameCandidate } from '../../src/net/nameLod';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296); }
const out: { n: number; decideMs: number; shown: number; raysPerDecision: number }[] = [];
for (const n of [50, 250, 500]) {
  const r = rng(n);
  const cands: NameCandidate[] = Array.from({ length: n }, (_, i) => {
    const kind = r() < 0.6 ? 1 : 0;
    return { key: i, dist: r() * 60, nx: r() * 2.2 - 1.1, ny: r() * 2.2 - 1.1, front: r() > 0.1, interacting: r() < 0.05, prev: 'hidden' as const, kind, tagged: kind === 1 ? autonomousTagged(i + 1, 0.6) : true };
  });
  const oc = new OcclusionCache(400, 8);
  const scratch: { c: NameCandidate; t: 'full' | 'short' | 'hidden'; p: number }[] = [];
  let sink = 0;
  const ray = () => { let x = 0; for (let k = 0; k < 40; k++) x += Math.sin(k * 1.7) * Math.cos(k); sink += x; return r() < 0.15; };
  const N = 2000;
  let shown = 0;
  const t0 = performance.now();
  for (let it = 0; it < N; it++) {
    oc.begin();
    for (const c of cands) { c.dist = Math.max(0, c.dist + (r() - 0.5) * 0.4); }
    const pick = selectNames(cands, 'PROXIMOS', 14, scratch, (k) => oc.test(k, it * 200, ray));
    for (const [k, t] of pick) cands[k].prev = t;
    shown += pick.size;
  }
  const ms = (performance.now() - t0) / N;
  out.push({ n, decideMs: +ms.toFixed(4), shown: +(shown / N).toFixed(1), raysPerDecision: +(oc.rays / N).toFixed(2) });
  void sink;
}
console.log(JSON.stringify(out));
