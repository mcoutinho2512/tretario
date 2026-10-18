/**
 * Diferença entre dois heap snapshots do CDP (rodada 9.1) — mesmo processo: os ids dos objetos são estáveis.
 *  - por construtor: contagem e bytes próprios (A → B), incluindo "Detached …"
 *  - NOVOS (id só em B, vivos após GC) agrupados por construtor, com caminhos de retenção amostrados
 *    (retentor de menor distância à raiz, ignorando arestas fracas)
 *
 * uso: node --max-old-space-size=8192 tools/qa/heap_diff.mjs A.heapsnapshot B.heapsnapshot [top=40] [caminhos=3]
 */
import { readFileSync } from 'node:fs';

const [fa, fb] = process.argv.slice(2, 4);
const TOP = Number(process.argv[4] ?? 40), PATHS = Number(process.argv[5] ?? 3);

function load(f) {
  const s = JSON.parse(readFileSync(f, 'utf8'));
  const m = s.snapshot.meta, nf = m.node_fields, ef = m.edge_fields;
  const N = nf.length, E = ef.length;
  const iType = nf.indexOf('type'), iName = nf.indexOf('name'), iId = nf.indexOf('id'), iSize = nf.indexOf('self_size'), iEc = nf.indexOf('edge_count'), iDet = nf.indexOf('detachedness');
  const types = m.node_types[0], etypes = m.edge_types[0];
  const eT = ef.indexOf('type'), eN = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  const nodes = s.nodes, edges = s.edges, str = s.strings;
  const count = nodes.length / N;
  const firstEdge = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * N + iEc] * E; firstEdge[i + 1] = e; }
  const label = (i) => {
    const t = types[nodes[i * N + iType]];
    let n = str[nodes[i * N + iName]];
    if (t === 'string' || t === 'concatenated string' || t === 'sliced string') n = '(string)';
    else if (t === 'code') n = '(code)';
    else if (t === 'number') n = '(number)';
    else if (t === 'closure') n = `closure ${n}`;
    else if (t === 'array') n = `(array) ${n}`;
    else if (t === 'hidden') n = `(hidden) ${n}`;
    const det = iDet >= 0 && nodes[i * N + iDet] === 2 ? 'Detached ' : '';
    return det && !n.startsWith('Detached') ? det + n : n;
  };
  return { nodes, edges, str, N, E, count, firstEdge, iId, iSize, eT, eN, eTo, etypes, types, iType, label };
}

const A = load(fa), B = load(fb);
const agg = (S) => { const m = new Map(); for (let i = 0; i < S.count; i++) { const k = S.label(i); const o = m.get(k) ?? { n: 0, b: 0 }; o.n++; o.b += S.nodes[i * S.N + S.iSize]; m.set(k, o); } return m; };
const ma = agg(A), mb = agg(B);
const rows = [];
for (const k of new Set([...ma.keys(), ...mb.keys()])) { const a = ma.get(k) ?? { n: 0, b: 0 }, b = mb.get(k) ?? { n: 0, b: 0 }; rows.push({ k, dn: b.n - a.n, db: b.b - a.b, a: a.n, b: b.n }); }
let ta = 0, tb = 0; for (const v of ma.values()) ta += v.b; for (const v of mb.values()) tb += v.b;
console.log(`total: ${(ta / 1048576).toFixed(2)} → ${(tb / 1048576).toFixed(2)} MB (${A.count} → ${B.count} nós)`);
console.log('\n== maior crescimento em bytes ==');
for (const r of rows.sort((x, y) => y.db - x.db).slice(0, TOP)) console.log(`${(r.db / 1024).toFixed(1).padStart(9)} KB ${String(r.dn).padStart(7)}  (${r.a}→${r.b})  ${r.k.slice(0, 100)}`);
console.log('\n== maior crescimento em contagem ==');
for (const r of rows.sort((x, y) => y.dn - x.dn).slice(0, TOP)) console.log(`${String(r.dn).padStart(7)} ${(r.db / 1024).toFixed(1).padStart(9)} KB  (${r.a}→${r.b})  ${r.k.slice(0, 100)}`);
// nós do DOM (presos ou não): tag/classe e texto
const dom = rows.filter((r) => /^(Detached )?(<|Text|Comment|HTML|SVG)/.test(r.k) && r.dn !== 0);
console.log('\n== nós do DOM (variação ≠ 0) ==');
let dsum = 0; for (const r of dom) dsum += r.dn;
console.log(`soma: ${dsum}`);
for (const r of dom.sort((x, y) => Math.abs(y.dn) - Math.abs(x.dn)).slice(0, 40)) console.log(`${String(r.dn).padStart(7)} (${r.a}→${r.b}) ${r.k.slice(0, 120)}`);
const det = rows.filter((r) => r.k.startsWith('Detached'));
console.log('\n== Detached ==');
for (const r of det.sort((x, y) => y.dn - x.dn).slice(0, 20)) console.log(`${String(r.dn).padStart(7)} (${r.a}→${r.b}) ${r.k}`);

// novos em B (id ausente em A)
const idsA = new Set(); for (let i = 0; i < A.count; i++) idsA.add(A.nodes[i * A.N + A.iId]);
const fresh = new Map();
for (let i = 0; i < B.count; i++) if (!idsA.has(B.nodes[i * B.N + B.iId])) { const k = B.label(i); const o = fresh.get(k) ?? { n: 0, b: 0, ix: [] }; o.n++; o.b += B.nodes[i * B.N + B.iSize]; if (o.ix.length < 200) o.ix.push(i); fresh.set(k, o); }

// distância da raiz (BFS sem arestas fracas) e retentores → caminho de retenção (retentor mais perto da raiz)
function graph(S) {
  const dist = new Int32Array(S.count).fill(-1);
  const weak = S.etypes.indexOf('weak'), shortcut = S.etypes.indexOf('shortcut');
  const q = new Uint32Array(S.count); let qh = 0, qt = 0; q[qt++] = 0; dist[0] = 0;
  const retainers = Array.from({ length: S.count }, () => null);
  for (let i = 0; i < S.count; i++) for (let e = S.firstEdge[i]; e < S.firstEdge[i + 1]; e += S.E) {
    const t = S.edges[e + S.eT]; if (t === weak || t === shortcut) continue;
    const to = S.edges[e + S.eTo] / S.N; (retainers[to] ??= []).push(e, i);
  }
  while (qh < qt) { const i = q[qh++]; for (let e = S.firstEdge[i]; e < S.firstEdge[i + 1]; e += S.E) { const t = S.edges[e + S.eT]; if (t === weak || t === shortcut) continue; const to = S.edges[e + S.eTo] / S.N; if (dist[to] < 0) { dist[to] = dist[i] + 1; q[qt++] = to; } } }
  const edgeName = (e) => { const t = S.etypes[S.edges[e + S.eT]]; const v = S.edges[e + S.eN]; return t === 'element' || t === 'hidden' ? `[${v}]` : String(S.str[v]); };
  return (i) => {
    const out = []; let cur = i; const seen = new Set();
    while (cur !== 0 && out.length < 14 && !seen.has(cur)) {
      seen.add(cur); const r = retainers[cur]; if (!r) break;
      let best = -1, be = -1; for (let k = 0; k < r.length; k += 2) { const f = r[k + 1]; if (dist[f] >= 0 && (best < 0 || dist[f] < dist[best])) { best = f; be = r[k]; } }
      if (best < 0) break;
      out.push(`${S.label(best).slice(0, 50)}.${edgeName(be).slice(0, 40)}`); cur = best;
    }
    return out.reverse().join(' → ');
  };
}
const pathOf = graph(B);
console.log('\n== NOVOS em B (vivos) por construtor ==');
const fr = [...fresh].sort((x, y) => y[1].b - x[1].b);
for (const [k, o] of fr.slice(0, TOP)) console.log(`${String(o.n).padStart(7)} ${(o.b / 1024).toFixed(1).padStart(9)} KB  ${k.slice(0, 100)}`);
console.log('\n== caminhos de retenção (amostra dos novos) ==');
for (const [k, o] of fr.slice(0, Number(process.env.PATH_GROUPS ?? 25))) {
  if (k === '(code)' || k.startsWith('(hidden)') || k === 'system / Context') continue;
  const ps = new Map();
  for (const i of o.ix) { const p = pathOf(i); ps.set(p, (ps.get(p) ?? 0) + 1); }
  console.log(`\n# ${k} (${o.n} novos)`);
  for (const [p, n] of [...ps].sort((x, y) => y[1] - x[1]).slice(0, PATHS)) console.log(`  ${n}× ${p}`);
}

// GEOM=1: geometrias (objeto com `attributes` e `drawRange`), texturas (`source` e `mipmaps`) e materiais — vivos em
// A e B por tipo/nome, e os NOVOS em B com caminho de retenção (geometria/textura não descartada)
if (process.env.GEOM === '1') {
  const props = (S, i) => { const o = {}; for (let e = S.firstEdge[i]; e < S.firstEdge[i + 1]; e += S.E) if (S.etypes[S.edges[e + S.eT]] === 'property') o[S.str[S.edges[e + S.eN]]] = S.edges[e + S.eTo] / S.N; return o; };
  const sval = (S, i) => (i === undefined ? '' : S.types[S.nodes[i * S.N + S.iType]].includes('string') ? S.str[S.nodes[i * S.N + 1]] : '');
  const kinds = (S) => {
    const m = new Map();
    for (let i = 0; i < S.count; i++) {
      if (S.types[S.nodes[i * S.N + S.iType]] !== 'object') continue;
      const p = props(S, i);
      let k = null;
      if (p.attributes !== undefined && p.drawRange !== undefined) k = `geo ${sval(S, p.type)} "${sval(S, p.name)}"`;
      else if (p.source !== undefined && p.mipmaps !== undefined) k = `tex "${sval(S, p.name)}"`;
      else if (p.blending !== undefined && p.side !== undefined && p.depthWrite !== undefined) k = `mat ${sval(S, p.type)} "${sval(S, p.name)}"`;
      else if (p.bones !== undefined && p.boneInverses !== undefined) k = `skeleton ${p.boneTexture !== undefined && S.types[S.nodes[p.boneTexture * S.N + S.iType]] === 'object' ? 'com' : 'sem'} boneTexture`;
      if (!k) continue;
      const o = m.get(k) ?? { n: 0, ix: [] }; o.n++; o.ix.push(i); m.set(k, o);
    }
    return m;
  };
  const ka = kinds(A), kb = kinds(B);
  // LABELS=<regex>: também agrupa por construtor (rótulo do nó), com bytes próprios — p.ex. 'JSArrayBufferData'
  if (process.env.LABELS) {
    const re = new RegExp(process.env.LABELS);
    for (const [S, m] of [[A, ka], [B, kb]]) for (let i = 0; i < S.count; i++) { const l = S.label(i); if (!re.test(l)) continue; const k = `label ${l}`; const o = m.get(k) ?? { n: 0, ix: [] }; o.n++; o.ix.push(i); m.set(k, o); }
  }
  console.log('\n== geometrias/texturas/materiais (A → B) ==');
  const all = [...new Set([...ka.keys(), ...kb.keys()])].map((k) => ({ k, a: ka.get(k)?.n ?? 0, b: kb.get(k)?.n ?? 0 })).filter((r) => r.a !== r.b).sort((x, y) => (y.b - y.a) - (x.b - x.a));
  for (const r of all.slice(0, 40)) console.log(`${String(r.b - r.a).padStart(6)} (${r.a}→${r.b}) ${r.k}`);
  // OWNERS=<regex>: contagem por dono (prefixo do caminho de retenção, OWNER_HOPS passos depois da raiz global) em A e B
  if (process.env.OWNERS) {
    const re = new RegExp(process.env.OWNERS), hops = Number(process.env.OWNER_HOPS ?? 5), pathOfA = graph(A);
    const own = (p) => { const seg = p.split(' → '); const g = seg.findLastIndex((x) => x.includes('JSGlobalObject') || x.startsWith('(GC roots)') || x.includes('scope @')); return seg.slice(g + 1, g + 1 + hops).map((x) => x.replace(/\[\d+\]$/, '[]')).join(' → '); };
    for (const k of [...new Set([...ka.keys(), ...kb.keys()])].filter((k) => re.test(k))) {
      const ca = new Map(), cb = new Map(), wa = new Map(), wb = new Map();
      for (const i of ka.get(k)?.ix ?? []) { const o = own(pathOfA(i)); ca.set(o, (ca.get(o) ?? 0) + 1); wa.set(o, (wa.get(o) ?? 0) + A.nodes[i * A.N + A.iSize]); }
      for (const i of kb.get(k)?.ix ?? []) { const o = own(pathOf(i)); cb.set(o, (cb.get(o) ?? 0) + 1); wb.set(o, (wb.get(o) ?? 0) + B.nodes[i * B.N + B.iSize]); }
      console.log(`\n# donos de ${k}`);
      for (const o of [...new Set([...ca.keys(), ...cb.keys()])].sort((x, y) => Math.abs((wb.get(y) ?? 0) - (wa.get(y) ?? 0)) - Math.abs((wb.get(x) ?? 0) - (wa.get(x) ?? 0))).slice(0, 12)) console.log(`  ${String(ca.get(o) ?? 0).padStart(5)} → ${String(cb.get(o) ?? 0).padStart(5)} (${(((wb.get(o) ?? 0) - (wa.get(o) ?? 0)) / 1024).toFixed(0)} KB)  ${o}`);
    }
  }
  console.log('\n== caminhos dos NOVOS (B) ==');
  for (const r of all.filter((r) => r.b > r.a).slice(0, 12)) {
    const nw = kb.get(r.k).ix.filter((i) => !idsA.has(B.nodes[i * B.N + B.iId]));
    const ps = new Map(); for (const i of nw.slice(0, 60)) { const p = pathOf(i); ps.set(p, (ps.get(p) ?? 0) + 1); }
    console.log(`\n# ${r.k} (${nw.length} novos)`);
    for (const [p, n] of [...ps].sort((x, y) => y[1] - x[1]).slice(0, 3)) console.log(`  ${n}× ${p}`);
  }
}
