/**
 * Rastreador de vazamento de GPU (rodada 9.1) — roda NA PÁGINA (`page.evaluate(installLeakTrack)`, com ?mem=1 para
 * achar a cena em `__pvScene`). Ganchos nos protótipos do three.js do bundle (achados por um Mesh da cena):
 *  - pilha de criação de cada geometria (primeiro setAttribute) e textura (primeiro needsUpdate)
 *  - "enviada à GPU" = o renderer registrou o ouvinte de 'dispose' (WebGLGeometries/WebGLTextures)
 *  - `gcd`: coletadas pelo GC sem dispose() depois de enviadas (o three.js mantém atributos/VAO em bindingStates)
 *  - `live`: vivas, enviadas e sem dispose, por pilha — o que CRESCE entre duas leituras é retenção por cache/lista
 * `window.__pvLeakTrack()` → { gcd: [...], live: [...], tracked } (top 30 por contagem). Pilhas legíveis só com
 * build sem minificação (`npx vite build --minify false`).
 */
export function installLeakTrack() {
  if (window.__pvLeakTrack) return;
  const find = (pred) => { let r = null; window.__pvScene.traverse((o) => { if (!r && pred(o)) r = o; }); return r; };
  const protoOf = (o, key) => { for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) if (Object.prototype.hasOwnProperty.call(p, key)) return p; return null; };
  const mesh = find((o) => o.isMesh && o.geometry && o.material?.map);
  const G = protoOf(mesh.geometry, 'setAttribute'), T = protoOf(mesh.material.map, 'dispose');
  const gcd = new Map(); const live = new WeakMap(); const refs = new Set();
  const reg = new FinalizationRegistry((h) => { refs.delete(h.ref); if (h.used && !h.disposed) { const g = gcd.get(h.k) ?? { n: 0, kind: h.kind, name: h.name }; g.n++; gcd.set(h.k, g); } });
  const stack = () => (new Error().stack ?? '').split('\n').slice(4, 11).map((s) => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '')).join(' < ');
  const track = (o, kind) => {
    if (live.has(o)) return;
    const h = { k: `${kind} ${stack()}`, kind, name: o.name || o.type || '', used: false, disposed: false, ref: new WeakRef(o) };
    live.set(o, h); refs.add(h.ref); reg.register(o, h);
  };
  const sa = G.setAttribute; G.setAttribute = function (...a) { track(this, 'geo'); return sa.apply(this, a); };
  const desc = Object.getOwnPropertyDescriptor(T, 'needsUpdate');
  Object.defineProperty(T, 'needsUpdate', { ...desc, set(v) { track(this, 'tex'); desc.set.call(this, v); } });
  for (const P of [G, T]) {
    const ae = P.addEventListener, de = P.dispose;
    P.addEventListener = function (t, f) { if (t === 'dispose') { const h = live.get(this); if (h) h.used = true; } return ae.call(this, t, f); };
    P.dispose = function (...a) { const h = live.get(this); if (h) h.disposed = true; return de.apply(this, a); };
  }
  window.__pvLeakTrack = () => {
    const lv = new Map();
    for (const r of refs) { const o = r.deref(); const h = o && live.get(o); if (!h || !h.used || h.disposed) continue; const g = lv.get(h.k) ?? { n: 0, kind: h.kind, name: h.name }; g.n++; lv.set(h.k, g); }
    const top = (m) => [...m].map(([k, g]) => ({ k, ...g })).sort((a, b) => b.n - a.n).slice(0, 30);
    return { gcd: top(gcd), live: top(lv), tracked: refs.size };
  };
}
