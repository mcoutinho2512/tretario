/**
 * Monumentos, relógio de rua e placas de logradouro — posições reais do OSM, modelos procedurais originais.
 *  - estátua equestre de Duque de Caxias (sobre o Panteão), bustos (Zumbi, Pereira Passos…), estátuas
 *  - "Pira do Povo" (escultura cinética da Candelária) — forma estilizada, giratória
 *  - relógio de rua (hora real do Rio)
 *  - placas azuis de logradouro do padrão carioca, com nomes reais (atlas único → 1 draw call)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MonumentRec, StreetSignRec } from './types';
import { CURB_HEIGHT } from './types';

const bronze = () => new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.45, metalness: 0.85 });
const granite = () => new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.75, metalness: 0 });

function g(geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  geo.scale(sx, sy, sz);
  geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  geo.translate(x, y, z);
  geo.deleteAttribute('uv');
  return geo;
}
const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 3, 10);

function figure(scale = 1): THREE.BufferGeometry {
  return mergeGeometries([
    g(cap(0.22, 0.7), 0, 1.25, 0, 0, 0, 0, 1.1, 1, 0.75),
    g(new THREE.SphereGeometry(0.16, 12, 10), 0, 1.92, 0),
    g(cap(0.09, 0.75), 0.13, 0.55, 0), g(cap(0.09, 0.75), -0.13, 0.55, 0),
    g(cap(0.07, 0.55), 0.32, 1.25, 0, 0, 0, 0.15), g(cap(0.07, 0.55), -0.32, 1.25, 0, 0, 0, -0.15),
  ])!.scale(scale, scale, scale);
}

function equestrian(): THREE.BufferGeometry {
  const horse = [
    g(cap(0.42, 1.3), 0, 1.65, 0, Math.PI / 2, 0, 0, 1, 1, 0.9), // corpo
    g(cap(0.2, 0.75), 0, 2.25, 1.05, 0.75), // pescoço (inclinado para frente)
    g(cap(0.15, 0.45), 0, 2.55, 1.45, -1.9), // cabeça
    g(new THREE.ConeGeometry(0.12, 0.8, 8), 0, 1.5, -1.15, -2.3), // cauda
  ];
  for (const [x, z, rx] of [[0.24, 0.75, -0.35], [-0.24, 0.75, 0.15], [0.24, -0.7, 0.2], [-0.24, -0.7, -0.15]]) {
    horse.push(g(cap(0.09, 1.1), x, 0.7, z, rx));
  }
  const rider = [
    g(cap(0.2, 0.55), 0, 2.55, 0.05, -0.1, 0, 0, 1.1, 1, 0.8),
    g(new THREE.SphereGeometry(0.15, 12, 10), 0, 3.2, 0.1),
    g(new THREE.CylinderGeometry(0.13, 0.16, 0.22, 10), 0, 3.38, 0.1), // quepe
    g(cap(0.08, 0.5), 0.3, 2.35, 0.25, 0.6), g(cap(0.08, 0.5), -0.3, 2.35, 0.25, 0.6),
    g(cap(0.08, 0.55), 0.32, 1.95, 0.05), g(cap(0.08, 0.55), -0.32, 1.95, 0.05),
  ];
  return mergeGeometries([...horse, ...rider])!;
}

function bust(): THREE.BufferGeometry {
  return mergeGeometries([
    g(cap(0.3, 0.2), 0, 0.3, 0, 0, 0, Math.PI / 2, 1, 1.1, 0.6),
    g(new THREE.SphereGeometry(0.2, 14, 12), 0, 0.72, 0.02, 0, 0, 0, 0.9, 1.1, 1),
  ])!;
}

function makeClockTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f2efe6';
  x.beginPath(); x.arc(128, 128, 124, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1b1b1b';
  for (let i = 0; i < 12; i++) {
    x.save(); x.translate(128, 128); x.rotate((i / 12) * Math.PI * 2);
    x.fillRect(-4, -116, 8, i % 3 === 0 ? 26 : 16);
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MonumentSystem {
  readonly group = new THREE.Group();
  private kinetic: THREE.Object3D[] = [];
  private clockHands: { h: THREE.Mesh; m: THREE.Mesh }[] = [];

  constructor(monuments: MonumentRec[], signs: StreetSignRec[], heightAt: (x: number, z: number) => number, pvDir: number) {
    this.group.name = 'monuments';
    const bz = bronze(), gr = granite();
    for (const m of monuments) {
      const y0 = m.base ?? heightAt(m.p[0], m.p[1]);
      const root = new THREE.Group();
      root.position.set(m.p[0], y0, m.p[1]);
      root.rotation.y = m.r ?? Math.atan2(Math.cos(pvDir), Math.sin(pvDir));
      root.name = `monument_${m.kind}_${m.name ?? ''}`;
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        root.add(mesh);
        return mesh;
      };
      switch (m.kind) {
        case 'equestrian': {
          add(g(new THREE.BoxGeometry(3.2, 1.6, 4.4), 0, 0.8, 0), gr);
          add(g(new THREE.BoxGeometry(3.6, 0.3, 4.8), 0, 1.75, 0), gr);
          const s = add(equestrian(), bz);
          s.position.y = 1.9;
          s.scale.setScalar(2.1); // estátua maior que o natural
          break;
        }
        case 'bust': {
          const big = /Zumbi/.test(m.name ?? '') ? 2.4 : 1;
          add(g(new THREE.CylinderGeometry(0.35 * big, 0.45 * big, 1.6 * big, 12), 0, 0.8 * big, 0), gr);
          const b = add(bust(), bz);
          b.position.y = 1.6 * big;
          b.scale.setScalar(big * 1.2);
          break;
        }
        case 'statue': {
          add(g(new THREE.BoxGeometry(1.4, 1.6, 1.4), 0, 0.8, 0), gr);
          const f = add(figure(1.15), bz);
          f.position.y = 1.6;
          break;
        }
        case 'kinetic': {
          // escultura cinética espelhada (forma estilizada): anel de discos refletivos girando sobre um mastro
          const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.08, metalness: 1 });
          add(g(new THREE.CylinderGeometry(1.6, 1.9, 0.6, 24), 0, 0.3, 0), gr);
          add(g(new THREE.CylinderGeometry(0.18, 0.25, 4.2, 12), 0, 2.4, 0), steel);
          const rot = new THREE.Group();
          rot.position.y = 6.2;
          const discs: THREE.BufferGeometry[] = [];
          const N = 140;
          for (let i = 0; i < N; i++) {
            const t = i / N, a = t * Math.PI * 2 * 13, el = Math.acos(1 - 2 * t);
            const r = 3.4;
            const p = new THREE.Vector3(Math.sin(el) * Math.cos(a) * r, Math.cos(el) * r * 0.75, Math.sin(el) * Math.sin(a) * r);
            const d = new THREE.CircleGeometry(0.28, 10);
            d.lookAt(p);
            d.translate(p.x, p.y, p.z);
            d.deleteAttribute('uv');
            discs.push(d);
            if (i % 7 === 0) {
              const rod = new THREE.CylinderGeometry(0.02, 0.02, p.length(), 4);
              rod.translate(0, p.length() / 2, 0);
              rod.lookAt(p);
              rod.rotateX(Math.PI / 2);
              rod.deleteAttribute('uv');
              discs.push(rod);
            }
          }
          const sculpt = new THREE.Mesh(mergeGeometries(discs.map((x) => x.index ? x.toNonIndexed() : x))!, new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.05, metalness: 1, side: THREE.DoubleSide }));
          sculpt.castShadow = true;
          rot.add(sculpt);
          root.add(rot);
          this.kinetic.push(rot);
          break;
        }
        case 'clock': {
          const dark = new THREE.MeshStandardMaterial({ color: 0x22282c, roughness: 0.5, metalness: 0.6 });
          add(g(new THREE.CylinderGeometry(0.09, 0.12, 4.0, 10), 0, 2.0 + CURB_HEIGHT, 0), dark);
          add(g(new THREE.BoxGeometry(0.95, 0.95, 0.95), 0, 4.45, 0), dark);
          const tex = makeClockTexture();
          const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 });
          const handMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
          for (let k = 0; k < 4; k++) {
            const face = new THREE.Group();
            face.rotation.y = (k * Math.PI) / 2;
            face.position.y = 4.45;
            const dial = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), faceMat);
            dial.position.z = 0.48;
            const h = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.01).translate(0, 0.09, 0), handMat);
            const mi = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.33, 0.01).translate(0, 0.14, 0), handMat);
            h.position.z = mi.position.z = 0.49;
            face.add(dial, h, mi);
            root.add(face);
            this.clockHands.push({ h, m: mi });
          }
          break;
        }
      }
      this.group.add(root);
    }
    if (signs.length) this.group.add(this.buildSigns(signs, heightAt));
  }

  /** Placas de logradouro: atlas com todos os nomes + uma única malha */
  private buildSigns(signs: StreetSignRec[], heightAt: (x: number, z: number) => number): THREE.Object3D {
    const names = [...new Set(signs.flatMap((s) => s.names))];
    const W = 1024, rowH = 256;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, names.length) * rowH);
    const x = c.getContext('2d')!;
    names.forEach((n, i) => {
      const y = i * rowH;
      x.fillStyle = '#14306b';
      x.fillRect(0, y, W, rowH);
      x.strokeStyle = '#ffffff';
      x.lineWidth = 10;
      x.strokeRect(8, y + 8, W - 16, rowH - 16);
      x.fillStyle = '#e8c31c';
      x.fillRect(14, y + rowH - 62, W - 28, 46);
      x.fillStyle = '#14306b';
      x.font = 'bold 34px Arial, sans-serif';
      x.fillText('CENTRO', 30, y + rowH - 26);
      x.fillStyle = '#ffffff';
      // tipo de logradouro pequeno + nome grande (como nas placas cariocas)
      const m = /^(Avenida|Rua|Praça|Travessa|Largo|Terminal Rodoviário)\s+(.*)$/.exec(n);
      const kind = m ? m[1] : '';
      const main = m ? m[2] : n;
      x.font = '38px Arial, sans-serif';
      x.fillText(kind, 30, y + 56);
      let size = 92;
      x.font = `bold ${size}px Arial, sans-serif`;
      while (x.measureText(main).width > W - 60 && size > 40) { size -= 2; x.font = `bold ${size}px Arial, sans-serif`; }
      x.fillText(main, 30, y + 150);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const plates: THREE.BufferGeometry[] = [];
    const poles: THREE.BufferGeometry[] = [];
    for (const s of signs) {
      const y0 = heightAt(s.p[0], s.p[1]);
      const pole = new THREE.CylinderGeometry(0.04, 0.05, 2.9, 8);
      pole.translate(s.p[0], y0 + 1.45, s.p[1]);
      pole.deleteAttribute('uv');
      poles.push(pole);
      s.names.forEach((n, k) => {
        const idx = names.indexOf(n);
        const plate = new THREE.PlaneGeometry(1.0, rowH / W, 1, 1);
        // UV para a linha do atlas
        const uv = plate.attributes.uv as THREE.BufferAttribute;
        const v0 = 1 - ((idx + 1) * rowH) / c.height, v1 = 1 - (idx * rowH) / c.height;
        for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? v1 : v0);
        const back = plate.clone();
        back.rotateY(Math.PI);
        const both = mergeGeometries([plate, back])!;
        // placa 1 alinhada à avenida; placa 2 perpendicular (rua transversal)
        const ang = k === 0 ? -s.r : -s.r + Math.PI / 2;
        both.rotateY(ang + Math.PI / 2);
        both.translate(s.p[0], y0 + 2.75 - k * 0.28, s.p[1]);
        plates.push(both);
      });
    }
    const group = new THREE.Group();
    group.name = 'street_signs';
    const plateMesh = new THREE.Mesh(mergeGeometries(plates)!, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    const poleMesh = new THREE.Mesh(mergeGeometries(poles)!, new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.6 }));
    plateMesh.castShadow = poleMesh.castShadow = true;
    group.add(plateMesh, poleMesh);
    return group;
  }

  update(dt: number, sim: Date) {
    for (const k of this.kinetic) k.rotation.y += dt * 0.35;
    const h = (sim.getUTCHours() + 21) % 24, m = sim.getUTCMinutes();
    for (const c of this.clockHands) {
      c.m.rotation.z = -(m / 60) * Math.PI * 2;
      c.h.rotation.z = -(((h % 12) + m / 60) / 12) * Math.PI * 2;
    }
  }
}
