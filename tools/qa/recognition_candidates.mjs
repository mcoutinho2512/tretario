import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('public/world/manifest.json', 'utf8'));
const ax = m.pvAxis;
function proj(p) {
  let best = null;
  let acc = 0;
  for (let i = 0; i < ax.length - 1; i++) {
    const a = ax[i], b = ax[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (l * l)));
    const q = [a[0] + dx * t, a[1] + dz * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const cross = dx * (p[1] - a[1]) - dz * (p[0] - a[0]); // >0 → à direita indo para leste = sul
    if (!best || d < best.d) best = { d, s: acc + t * l, side: cross > 0 ? 'S' : 'N' };
    acc += l;
  }
  return best;
}
const minH = Number(process.argv[2] ?? 30), maxD = Number(process.argv[3] ?? 90);
const rows = [];
for (const f of fs.readdirSync('public/world').filter((f) => f.startsWith('chunk_'))) {
  const d = JSON.parse(fs.readFileSync('public/world/' + f));
  for (const b of d.buildings) {
    if (b.height < minH && !b.name) continue;
    const o = b.poly.outer;
    const c = [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length];
    const dmin = Math.min(...o.map((p) => proj(p).d));
    if (dmin > maxD) continue;
    const pr = proj(c);
    let area = 0;
    for (let i = 0; i < o.length; i++) { const a = o[i], bb = o[(i + 1) % o.length]; area += a[0] * bb[1] - bb[0] * a[1]; }
    rows.push([Math.round(pr.s), pr.side, b.id, Math.round(c[0]), Math.round(c[1]), Math.round(dmin), Math.round(Math.abs(area) / 2), b.height, b.levels, b.heightSource, b.arcadeEdges ? 'arc' : '', b.name ?? '']);
  }
}
rows.sort((a, b) => a[0] - b[0]);
for (const r of rows) console.log(r.join('\t'));
