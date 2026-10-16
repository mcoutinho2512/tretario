/**
 * Cenário de AVENIDA FECHADA para o evento (rodada 7): não há trânsito NPC.
 *  - ônibus estacionados encostados no meio-fio (manifest.parkedBuses; carroceria na colisão do servidor e aqui)
 *  - gradis de contenção atravessando as pistas nas duas pontas do corredor, com passagens para pedestres
 *    (sólidos no cliente: carros não passam; quem está a pé passa pelas aberturas)
 *  - placas "via interditada" no meio de cada linha de gradis
 * Tudo instanciado (poucos draw calls) e sem textura além da placa (canvas).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorldManifest } from './types';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { getVehicleGeometry, vehicleMaterial } from '../traffic/vehicleModels';
import { legacyGeometry } from '../traffic/legacyModels';

type XZ = [number, number];
const BUS_COLORS = [0x1f5fa8, 0x2e8b57, 0xd8742a, 0xc23b3b, 0xe2c23a, 0x3a3f8f];
const MODULE = 2.3; // comprimento de um gradil (m)

function barrierGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0) => { if (rz) g.rotateZ(rz); g.translate(x, y, z); return g; };
  const L = MODULE - 0.1;
  for (const x of [-L / 2, L / 2]) parts.push(at(new THREE.CylinderGeometry(0.022, 0.022, 1.05, 6), x, 0.6, 0)); // montantes
  for (const y of [0.18, 1.1]) parts.push(at(new THREE.CylinderGeometry(0.02, 0.02, L, 6), 0, y, 0, Math.PI / 2)); // travessas
  for (let i = 1; i < 14; i++) parts.push(at(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4), -L / 2 + (i * L) / 14, 0.64, 0)); // grades
  for (const x of [-L / 2 + 0.08, L / 2 - 0.08]) parts.push(at(new THREE.BoxGeometry(0.06, 0.03, 0.62), x, 0.05, 0)); // pés
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }))!;
  g.computeBoundingSphere();
  return g;
}

function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const x = c.getContext('2d')!;
  x.fillStyle = '#c8102e'; x.fillRect(0, 0, 512, 192);
  x.fillStyle = '#fff'; x.fillRect(10, 10, 492, 172);
  x.fillStyle = '#c8102e'; x.fillRect(18, 18, 476, 156);
  x.fillStyle = '#fff'; x.textAlign = 'center';
  x.font = '800 44px system-ui, sans-serif'; x.fillText('VIA INTERDITADA', 256, 82);
  x.font = '600 28px system-ui, sans-serif'; x.fillText('AV. PRES. VARGAS · EVENTO', 256, 132);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class ClosureDressing {
  readonly group = new THREE.Group();
  private barriers: THREE.InstancedMesh | null = null;
  /** posições das linhas de gradis (para QA / minimapa) */
  readonly lines: { center: XZ; dir: XZ; modules: number }[] = [];

  constructor(manifest: WorldManifest, heightAt: (x: number, z: number) => number, collision?: CollisionWorld) {
    this.group.name = 'closure';
    this.group.userData.category = 'world/closure';
    // ---- ônibus de cenário
    const buses = manifest.parkedBuses ?? [];
    if (buses.length) {
      const im = new THREE.InstancedMesh(getVehicleGeometry('bus', 0, () => legacyGeometry('bus')), vehicleMaterial(), buses.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      buses.forEach((b, i) => {
        q.setFromAxisAngle(up, b.heading);
        m.compose(new THREE.Vector3(b.x, heightAt(b.x, b.z), b.z), q, new THREE.Vector3(1, 1, 1));
        im.setMatrixAt(i, m);
        im.setColorAt(i, new THREE.Color(BUS_COLORS[i % BUS_COLORS.length]));
        // colisão no cliente igual à do servidor (pipeline)
        if (collision) {
          const fx = Math.sin(b.heading), fz = Math.cos(b.heading), hl = 6.1, hw = 1.3;
          const c = [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([a, l]) => [b.x + fx * a + fz * l, b.z + fz * a - fx * l]);
          for (let k = 0; k < 4; k++) collision.addSegment({ ax: c[k][0], az: c[k][1], bx: c[(k + 1) % 4][0], bz: c[(k + 1) % 4][1], bottom: 0, top: 3.2 });
        }
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.name = 'parked_buses';
      this.group.add(im);
    }
    // ---- gradis nas duas pontas do corredor (só sobre o asfalto, com aberturas para pedestres)
    const ax = manifest.pvAxis as XZ[];
    if (ax.length >= 2) {
      const mats: THREE.Matrix4[] = [];
      const signs: { p: XZ; h: number }[] = [];
      const ends: { p: XZ; d: XZ }[] = [];
      const dirOf = (a: XZ, b: XZ): XZ => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
      const d0 = dirOf(ax[0], ax[1]), d1 = dirOf(ax[ax.length - 2], ax[ax.length - 1]);
      ends.push({ p: [ax[0][0] + d0[0] * 25, ax[0][1] + d0[1] * 25], d: d0 });
      ends.push({ p: [ax[ax.length - 1][0] - d1[0] * 25, ax[ax.length - 1][1] - d1[1] * 25], d: d1 });
      const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      for (const e of ends) {
        const perp: XZ = [-e.d[1], e.d[0]];
        const h = Math.atan2(perp[0], perp[1]) + Math.PI / 2; // gradil alinhado com a linha (perpendicular à avenida)
        let n = 0, run = 0;
        for (let s = -48; s <= 48; s += MODULE) {
          const p: XZ = [e.p[0] + perp[0] * s, e.p[1] + perp[1] * s];
          const y = heightAt(p[0], p[1]);
          if (y > 0.05) { run = 0; continue; } // calçada/canteiro: livre
          run++;
          if (run % 5 === 0) continue; // abertura para pedestres a cada 4 gradis
          q.setFromAxisAngle(up, h);
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], y, p[1]), q, new THREE.Vector3(1, 1, 1)));
          if (collision) {
            const a: XZ = [p[0] - perp[0] * (MODULE / 2 - 0.05), p[1] - perp[1] * (MODULE / 2 - 0.05)], b: XZ = [p[0] + perp[0] * (MODULE / 2 - 0.05), p[1] + perp[1] * (MODULE / 2 - 0.05)];
            collision.addSegment({ ax: a[0], az: a[1], bx: b[0], bz: b[1], bottom: 0, top: 1.15 });
          }
          n++;
        }
        this.lines.push({ center: e.p, dir: perp, modules: n });
        signs.push({ p: [e.p[0] - e.d[0] * 1.2, e.p[1] - e.d[1] * 1.2], h });
      }
      if (mats.length) {
        const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.42, metalness: 0.85 });
        const im = new THREE.InstancedMesh(barrierGeometry(), metal, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = true;
        im.name = 'closure_barriers';
        this.barriers = im;
        this.group.add(im);
      }
      // placas no meio de cada linha
      const tex = signTexture();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.75), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
      for (const s of signs) {
        const y = heightAt(s.p[0], s.p[1]);
        const sign = new THREE.Group();
        const b = board.clone();
        b.position.y = 1.35;
        const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
        for (const x of [-0.85, 0.85]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), legMat); leg.position.set(x, 0.65, 0); sign.add(leg); }
        sign.add(b);
        sign.position.set(s.p[0], y, s.p[1]);
        sign.rotation.y = s.h;
        this.group.add(sign);
      }
    }
  }

  update(cam: THREE.Vector3) {
    if (!this.barriers) return;
    // os gradis só aparecem de perto (são pequenos): evita custo nas vistas distantes
    this.barriers.visible = this.lines.some((l) => Math.hypot(l.center[0] - cam.x, l.center[1] - cam.z) < 700);
  }
}
