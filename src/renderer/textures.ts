/**
 * Texturas PBR 100% procedurais (sem assets externos — licença limpa).
 * Cada textura gera albedo + normal (+ roughness no canal G de um mapa ORM simplificado).
 */
import * as THREE from 'three';
import { tileFbm, hash2, mulberry32 } from './noise';

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

interface Field {
  size: number;
  albedo: Float32Array; // rgb 0–1
  height: Float32Array; // 0–1
  rough: Float32Array; // 0–1
}

function newField(size: number): Field {
  return { size, albedo: new Float32Array(size * size * 3), height: new Float32Array(size * size), rough: new Float32Array(size * size) };
}

function toTexture(data: Uint8ClampedArray, size: number, srgb: boolean): THREE.Texture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function fieldToPbr(f: Field, normalStrength: number): PbrSet {
  const n = f.size;
  const alb = new Uint8ClampedArray(n * n * 4);
  const nor = new Uint8ClampedArray(n * n * 4);
  const rou = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      alb[i * 4] = f.albedo[i * 3] * 255;
      alb[i * 4 + 1] = f.albedo[i * 3 + 1] * 255;
      alb[i * 4 + 2] = f.albedo[i * 3 + 2] * 255;
      alb[i * 4 + 3] = 255;
      const hL = f.height[y * n + ((x - 1 + n) % n)], hR = f.height[y * n + ((x + 1) % n)];
      const hU = f.height[((y - 1 + n) % n) * n + x], hD = f.height[((y + 1) % n) * n + x];
      const dx = (hL - hR) * normalStrength, dy = (hU - hD) * normalStrength;
      const l = Math.hypot(dx, dy, 1);
      nor[i * 4] = (dx / l * 0.5 + 0.5) * 255;
      nor[i * 4 + 1] = (-dy / l * 0.5 + 0.5) * 255;
      nor[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255;
      nor[i * 4 + 3] = 255;
      const r = f.rough[i] * 255;
      rou[i * 4] = r; rou[i * 4 + 1] = r; rou[i * 4 + 2] = r; rou[i * 4 + 3] = 255;
    }
  }
  return { map: toTexture(alb, n, true), normalMap: toTexture(nor, n, false), roughnessMap: toTexture(rou, n, false) };
}

/** Asfalto urbano gasto: agregado, remendos, manchas de óleo e trincas finas. Período: 1 tile. */
export function asphaltTexture(size = 1024): PbrSet {
  const f = newField(size);
  const rnd = mulberry32(11);
  // remendos (patches) retangulares
  const patches = Array.from({ length: 7 }, () => ({ x: rnd(), y: rnd(), w: 0.05 + rnd() * 0.2, h: 0.04 + rnd() * 0.12, d: (rnd() - 0.5) * 0.05 }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const i = y * size + x;
      const large = tileFbm(u, v, 4, 4, 1);
      const mid = tileFbm(u, v, 24, 3, 2);
      const grain = hash2(x, y, 3);
      const stone = hash2(x >> 1, y >> 1, 4);
      let g = 0.33 + (large - 0.5) * 0.08 + (mid - 0.5) * 0.05;
      // agregado claro/escuro
      if (stone > 0.93) g += 0.09 * (stone - 0.93) / 0.07;
      else if (stone < 0.05) g -= 0.05;
      g += (grain - 0.5) * 0.035;
      // remendos
      for (const p of patches) {
        const dx = Math.abs(((u - p.x + 1.5) % 1) - 0.5), dy = Math.abs(((v - p.y + 1.5) % 1) - 0.5);
        if (dx < p.w / 2 && dy < p.h / 2) g += p.d;
      }
      // manchas de óleo (faixa central das pistas tem mais)
      const oil = tileFbm(u, v, 8, 3, 9);
      if (oil > 0.62) g -= (oil - 0.62) * 0.35;
      // trincas
      const crack = Math.abs(tileFbm(u, v, 6, 4, 21) - 0.5);
      let ht = 0.5 + (stone - 0.5) * 0.6 + (mid - 0.5) * 0.3;
      if (crack < 0.006) { g -= 0.08; ht -= 0.4; }
      g = Math.max(0.12, Math.min(0.52, g));
      f.albedo[i * 3] = g * 1.0;
      f.albedo[i * 3 + 1] = g * 1.0;
      f.albedo[i * 3 + 2] = g * 1.04;
      f.height[i] = ht;
      f.rough[i] = Math.min(1, 0.86 + (grain - 0.5) * 0.1 - (oil > 0.62 ? (oil - 0.62) * 0.8 : 0));
    }
  }
  return fieldToPbr(f, 2.2);
}

/**
 * Pedra portuguesa (mosaico de pedras irregulares) — calçadas cariocas.
 * pattern: 'plain' (claro) | 'wave' (ondas preto e branco).
 */
export function portugueseStoneTexture(size = 1024, pattern: 'plain' | 'wave' = 'plain', stonesPerTile = 96): PbrSet {
  const f = newField(size);
  const cell = size / stonesPerTile;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const gx = x / cell, gy = y / cell;
      const cx = Math.floor(gx), cy = Math.floor(gy);
      // voronoi jitterizado (vizinhança 3×3, periódico)
      let d1 = 9, d2 = 9, idX = 0, idY = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox, ny = cy + oy;
        const px = ((nx % stonesPerTile) + stonesPerTile) % stonesPerTile, py = ((ny % stonesPerTile) + stonesPerTile) % stonesPerTile;
        const jx = nx + 0.15 + hash2(px, py, 5) * 0.7, jy = ny + 0.15 + hash2(px, py, 6) * 0.7;
        const d = Math.hypot(gx - jx, gy - jy);
        if (d < d1) { d2 = d1; d1 = d; idX = px; idY = py; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1; // ~0 nas juntas
      const sv = hash2(idX, idY, 7);
      let dark = false;
      if (pattern === 'wave') {
        const u = idX / stonesPerTile, v = idY / stonesPerTile;
        const w = Math.sin((u * 2 + Math.sin(v * Math.PI * 2) * 0.18) * Math.PI * 2);
        dark = w > 0.35;
      }
      let base = dark ? 0.12 + sv * 0.08 : 0.68 + sv * 0.16;
      const tint = dark ? [1, 1, 1.03] : [1.0, 0.98, 0.93];
      const dirt = tileFbm(x / size, y / size, 6, 4, 33);
      base *= 0.86 + dirt * 0.2;
      const joint = edge < 0.09;
      const jointCol = 0.32 + dirt * 0.08;
      const c = joint ? jointCol : base;
      f.albedo[i * 3] = c * tint[0];
      f.albedo[i * 3 + 1] = c * tint[1];
      f.albedo[i * 3 + 2] = c * tint[2];
      f.height[i] = joint ? 0.1 : 0.55 + Math.min(edge, 0.4) + sv * 0.1;
      f.rough[i] = joint ? 0.95 : 0.72 + sv * 0.15;
    }
  }
  return fieldToPbr(f, 3.5);
}

/** Placas de concreto (canteiros, plataformas) com juntas a cada 1/4 da textura. */
export function concreteSlabTexture(size = 512, joints = 4, tone = 0.6): PbrSet {
  const f = newField(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      const n = tileFbm(u, v, 8, 5, 41);
      const g = hash2(x, y, 42);
      const slab = hash2(Math.floor(u * joints), Math.floor(v * joints), 43);
      const ju = Math.abs(((u * joints) % 1) - 0.5) > 0.494, jv = Math.abs(((v * joints) % 1) - 0.5) > 0.494;
      let c = tone + (n - 0.5) * 0.12 + (slab - 0.5) * 0.05 + (g - 0.5) * 0.03;
      if (ju || jv) c *= 0.6;
      f.albedo[i * 3] = c; f.albedo[i * 3 + 1] = c * 0.99; f.albedo[i * 3 + 2] = c * 0.96;
      f.height[i] = ju || jv ? 0.2 : 0.6 + (g - 0.5) * 0.15;
      f.rough[i] = 0.85 + (g - 0.5) * 0.1;
    }
  }
  return fieldToPbr(f, 1.6);
}

export function grassTexture(size = 512): PbrSet {
  const f = newField(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      const n = tileFbm(u, v, 6, 5, 51);
      const blade = hash2(x, y, 52);
      const dry = tileFbm(u, v, 3, 3, 53);
      const r = 0.16 + n * 0.08 + (dry > 0.6 ? (dry - 0.6) * 0.5 : 0);
      const g = 0.28 + n * 0.12 + blade * 0.06;
      const b = 0.08 + n * 0.04;
      f.albedo[i * 3] = r; f.albedo[i * 3 + 1] = g; f.albedo[i * 3 + 2] = b;
      f.height[i] = blade * 0.6 + n * 0.4;
      f.rough[i] = 0.92;
    }
  }
  return fieldToPbr(f, 2.5);
}

export function ballastTexture(size = 512): PbrSet {
  const f = newField(size);
  const cells = 64;
  const cell = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const gx = x / cell, gy = y / cell;
      const cx = Math.floor(gx), cy = Math.floor(gy);
      let d1 = 9, id = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = (((cx + ox) % cells) + cells) % cells, ny = (((cy + oy) % cells) + cells) % cells;
        const jx = cx + ox + hash2(nx, ny, 61), jy = cy + oy + hash2(nx, ny, 62);
        const d = Math.hypot(gx - jx, gy - jy);
        if (d < d1) { d1 = d; id = hash2(nx, ny, 63); }
      }
      const rust = tileFbm(x / size, y / size, 5, 3, 64);
      const c = 0.32 + id * 0.18 - d1 * 0.15;
      f.albedo[i * 3] = c * (1 + rust * 0.25); f.albedo[i * 3 + 1] = c * (0.95 + rust * 0.05); f.albedo[i * 3 + 2] = c * 0.9;
      f.height[i] = 1 - d1;
      f.rough[i] = 0.95;
    }
  }
  return fieldToPbr(f, 4);
}

/** Textura de dormentes sobre brita (uso ao longo da via férrea; u = ao longo, v = através). */
export function trackbedTexture(size = 512): PbrSet {
  const base = ballastTexture(size);
  const img = (base.map as THREE.DataTexture).image.data as Uint8ClampedArray;
  const h = (base.roughnessMap as THREE.DataTexture).image.data as Uint8ClampedArray;
  // 8 dormentes por tile (tile = 4.8 m ao longo da via → 0.6 m de espaçamento)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const s = (u * 8) % 1;
      if (s < 0.38 && v > 0.12 && v < 0.88) {
        const i = (y * size + x) * 4;
        const w = 0.36 + hash2(Math.floor(u * 8), 0, 70) * 0.08 + (hash2(x, y, 71) - 0.5) * 0.04;
        img[i] = w * 255 * 0.95; img[i + 1] = w * 255 * 0.9; img[i + 2] = w * 255 * 0.85;
        h[i] = h[i + 1] = h[i + 2] = 0.8 * 255;
      }
    }
  }
  base.map.needsUpdate = true;
  base.roughnessMap.needsUpdate = true;
  return base;
}

/** Desgaste da pintura de sinalização (alpha). */
export function paintWearTexture(size = 256): THREE.Texture {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const n = tileFbm(x / size, y / size, 8, 4, 81);
    const g = hash2(x, y, 82);
    const a = n * 0.8 + g * 0.35;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = a > 0.42 ? 255 : 0;
  }
  return toTexture(data, size, false);
}

/** Pequena textura de ruído genérica (uso em shaders de edifícios e landmarks). */
export function noiseTexture(size = 256): THREE.Texture {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    data[i] = tileFbm(x / size, y / size, 4, 5, 91) * 255;
    data[i + 1] = tileFbm(x / size, y / size, 16, 3, 92) * 255;
    data[i + 2] = hash2(x, y, 93) * 255;
    data[i + 3] = tileFbm(x / size, y / size, 2, 4, 94) * 255;
  }
  const t = toTexture(data, size, false);
  return t;
}
