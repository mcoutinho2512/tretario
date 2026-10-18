/**
 * Resumo antes/depois de duas pastas do char_probe.mjs (rodada 9.1): draw calls, triângulos e o que está a < 6 m da
 * câmera (LOD do esqueleto ou instanciado) por preset e distância; copia as capturas de 4 m para a pasta de docs.
 * uso: node tools/qa/char_probe_summary.mjs <pastaAntes> <pastaDepois> <saídaDocs>
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const [A, B, OUT] = process.argv.slice(2);
const out = {};
for (const [tag, dir] of [['antes', A], ['depois', B]]) {
  for (const q of ['low', 'medium', 'high', 'auto']) {
    const f = `${dir}/${q}.json`;
    if (!existsSync(f)) continue;
    const r = JSON.parse(readFileSync(f, 'utf8'));
    const row = (out[`${tag}_${q}`] = {});
    for (const [d, s] of Object.entries(r.shots)) {
      const m = s.metrics;
      const near = [
        ...s.inv.skinned.filter((h) => h.dCam < 6 && h.dPlayer > 0.3).map((h) => `${h.lod}/${h.tris}`),
        ...s.inv.instanced.filter((h) => /lod\d$/.test(h.mesh) && h.dCam < 6).map((h) => `inst_${h.mesh.slice(-4)}/${h.tris}`),
      ];
      row[`${d}m`] = { calls: m.calls, triangles: m.triangles, quality: m.quality, skinned: m.crowd.skinned, lods: m.crowd.lod, near6m: near };
    }
    if (OUT && existsSync(`${dir}/${q}_4m.jpg`)) copyFileSync(`${dir}/${q}_4m.jpg`, `${OUT}/perto_4m_${q}_${tag}.jpg`);
  }
}
if (OUT) writeFileSync(`${OUT}/char_probe.json`, JSON.stringify(out, null, 1));
for (const [k, row] of Object.entries(out)) {
  const cnt = (arr) => { const c = {}; for (const x of arr) { const n = x.split('/')[0]; c[n] = (c[n] ?? 0) + 1; } return JSON.stringify(c); };
  console.log(k.padEnd(14), Object.entries(row).map(([d, v]) => `${d}: ${v.calls}c ${(v.triangles / 1e6).toFixed(2)}M ${cnt(v.near6m)}`).join(' | '));
}
