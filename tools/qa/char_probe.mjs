/**
 * Sonda de PERSONAGENS de perto (rodada 9.1): leva o jogador para junto de um ponto de concentração (carro de som /
 * trio) e, por preset, registra cada humano visível — esqueleto (LOD, triângulos, materiais por camada, recorte da
 * pele) ou instanciado (LOD2/LOD3 da multidão VAT) — com a distância à câmera e ao jogador; e tira capturas de perto.
 *
 * uso (build de produção + servidor de teste):
 *   node tools/qa/char_probe.mjs <baseUrl> [presets=low,medium,high,auto] [saída=screenshots/char_probe] [mp=ws://127.0.0.1:3150]
 * Precisa de ?mem=1 (expõe a cena no build de produção). Grava <saída>/<preset>.json e <saída>/<preset>_<d>m.jpg.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3161';
const PRESETS = (process.argv[3] ?? 'low,medium,high,auto').split(',');
const OUT = process.argv[4] ?? 'screenshots/char_probe';
const MP = process.argv[5] ?? '';
const EXTRA = process.env.EXTRA ? `&${process.env.EXTRA}` : '';
const w = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

/** roda na página: inventário dos humanos visíveis */
function inventory() {
  const scene = window.__pvScene;
  let cam = null;
  scene.traverse((o) => { if (!cam && o.isCamera) cam = o; });
  const pl = window.__pv.metrics().player;
  const cp = window.__pvCam ? window.__pvCam() : null;
  const camPos = cp ?? (cam ? { x: cam.position.x, y: cam.position.y, z: cam.position.z } : null);
  const out = { cam: camPos, player: pl, skinned: [], instanced: [] };
  const wp = { x: 0, y: 0, z: 0 };
  const tris = (g) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  scene.traverse((o) => {
    if (!/^human_/.test(o.name)) return;
    // visível de fato (todos os pais)
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements; wp.x = e[12]; wp.y = e[13]; wp.z = e[14];
    const lods = [];
    o.traverse((g) => { if (/^lod\d$/.test(g.name)) lods.push(g); });
    const shown = lods.find((g) => g.visible);
    const layers = [];
    let t = 0;
    shown?.traverse((m) => {
      if (!m.isSkinnedMesh || !m.visible) return;
      const mat = m.material;
      t += tris(m.geometry);
      layers.push({ layer: m.userData.layer, style: m.userData.style, tris: Math.round(tris(m.geometry)), full: Math.round(tris(m.geometry.userData?.src ?? m.geometry)),
        transparent: mat.transparent, alphaTest: mat.alphaTest, depthWrite: mat.depthWrite, side: mat.side, map: !!mat.map, mapSize: mat.map?.image?.width ?? 0,
        vertexColors: mat.vertexColors, geo: m.geometry.uuid.slice(0, 8) });
    });
    const d = (p) => (p ? Math.hypot(wp.x - p.x, wp.y - (p.y ?? wp.y), wp.z - p.z) : null);
    out.skinned.push({ name: o.name, x: +wp.x.toFixed(1), z: +wp.z.toFixed(1), dCam: +(d(camPos) ?? 0).toFixed(1), dPlayer: +Math.hypot(wp.x - pl.x, wp.z - pl.z).toFixed(1),
      lod: shown?.name ?? null, loaded: lods.map((g) => g.name), tris: Math.round(t), rotX: +o.rotation.x.toFixed(3), parentRotX: +(o.parent?.rotation?.x ?? 0).toFixed(3), layers });
  });
  scene.traverse((o) => {
    if (!o.isInstancedMesh || !/^crowd_/.test(o.name) || !o.visible) return;
    const a = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
      out.instanced.push({ mesh: o.name, x: +x.toFixed(1), z: +z.toFixed(1), heading: +Math.atan2(a[i * 16 + 8], a[i * 16 + 10]).toFixed(2), dCam: camPos ? +Math.hypot(x - camPos.x, y - camPos.y, z - camPos.z).toFixed(1) : null, dPlayer: +Math.hypot(x - pl.x, z - pl.z).toFixed(1), tris: Math.round(tris(o.geometry)),
        side: o.material.side, transparent: o.material.transparent });
    }
  });
  out.skinned.sort((p, q) => p.dPlayer - q.dPlayer);
  out.instanced.sort((p, q) => p.dPlayer - q.dPlayer);
  return out;
}

const all = {};
for (const q of PRESETS) {
  const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', ...(process.env.UNCAPPED ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])], defaultViewport: { width: 1280, height: 720 } });
  const page = await br.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  try {
    const qual = q === 'auto' ? '' : `&quality=${q}`;
    await page.goto(`${BASE}/?autostart=1&welcome=0${qual}&time=10:30&mem=1&name=Probe${MP ? `&mp=${MP}` : ''}${process.env.UNCAPPED ? '&uncapped=1' : ''}${EXTRA}`);
    await page.waitForFunction('window.__pvReady === true', { timeout: 240000 });
    await w(2000);
    const rally = await page.evaluate(() => window.__pv.rallyCrowd());
    // carro de som (ou o primeiro ponto ativo)
    const pt = rally.rally.find((p) => /som/.test(p.kind + p.id) && p.strength > 0) ?? rally.rally.find((p) => p.strength > 0);
    const res = { preset: q, rally, point: pt, shots: {} };
    // no meio do anel do ponto (lugar dos membros da concentração)
    if (pt) await page.evaluate((x, z) => window.__pv.teleport(x, z, 0), pt.x + 7, pt.z + 1);
    await w(9000); // LOD0 liberado aos 6 s; peças/recorte no Worker
    await page.evaluate(() => window.__pv.hud(false));
    // alvo: o humano mais próximo do jogador (esqueleto ou instanciado), fora o próprio jogador
    const inv0 = await page.evaluate(inventory);
    const pick = new RegExp(process.env.TARGET ?? '.');
    const cand = [...inv0.skinned.filter((h) => h.dPlayer > 0.5), ...inv0.instanced.filter((h) => /lod\d$/.test(h.mesh))].filter((h) => pick.test(h.mesh ?? h.name)).sort((a, b) => a.dPlayer - b.dPlayer)[0];
    res.target = cand;
    for (const d of (process.env.DISTS ?? '2,4,8,15').split(',').map(Number)) {
      const pl = inv0.player;
      // câmera a `d` m do alvo, do lado do jogador, olhando o peito
      let dx = pl.x - cand.x, dz = pl.z - cand.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      // VIEW=back: por trás do alvo (cabelo/rabo de cavalo), pelo rumo do instanciado
      if (process.env.VIEW === 'back' && cand.heading !== undefined) { dx = -Math.sin(cand.heading); dz = -Math.cos(cand.heading); }
      const cam = { x: cand.x + dx * d, y: (pl.y ?? 0) + 1.6, z: cand.z + dz * d };
      await page.evaluate((c, t) => window.__pv.lookFrom(c.x, c.y, c.z, t.x, (t.y ?? 0) + 1.1, t.z), cam, { ...cand, y: pl.y });
      await w(3000);
      const inv = await page.evaluate(inventory);
      for (const h of [...inv.skinned, ...inv.instanced]) h.dCam = +Math.hypot(h.x - cam.x, h.z - cam.z).toFixed(1);
      const met = await page.evaluate(() => { const m = window.__pv.metrics(); return { cpuMs: m.cpuMs, gpuMs: m.gpuMs, fps: m.fps, calls: m.calls, triangles: m.triangles, quality: m.quality, crowd: m.crowd, peds: m.pedestrians }; });
      await page.screenshot({ path: `${OUT}/${q}_${d}m.jpg`, type: 'jpeg', quality: 85 });
      res.shots[d] = { cam, metrics: met, inv };
      const near = (arr) => arr.filter((h) => h.dCam < 16).sort((a, b) => a.dCam - b.dCam);
      console.log(q, `${d}m`, met.quality, 'calls', met.calls, 'tri', met.triangles, '| esqueletos <16m da câmera:', near(inv.skinned).map((h) => `${h.lod}/${h.tris}t@${h.dCam}`).join(' '), '| instanciados <16m:', near(inv.instanced).filter((h) => /lod\d$/.test(h.mesh)).map((h) => `${h.mesh.replace('crowd_', '')}/${h.tris}t@${h.dCam}`).join(' '));
    }
    res.errors = errs;
    all[q] = res;
    writeFileSync(`${OUT}/${q}.json`, JSON.stringify(res, null, 1));
  } catch (e) { console.log(q, 'falhou', e.message, errs); }
  await br.close();
}
