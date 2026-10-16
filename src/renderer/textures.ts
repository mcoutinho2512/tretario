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

/**
 * Asfalto urbano (CBUQ envelhecido): agregado fino, remendos discretos, manchas de óleo e
 * trincas FINAS e ESPARSAS (rodada 5: antes a rede de trincas cobria todo o tile com células de
 * ~1.5 m — "trincas gigantes"). Agora: trincas só em zonas (máscara de baixa frequência),
 * mais estreitas e com frequência maior; normal mais suave. Período: 1 tile.
 */
export function asphaltTexture(size = 1024): PbrSet {
  const f = newField(size);
  const rnd = mulberry32(11);
  // remendos (patches) retangulares, discretos
  const patches = Array.from({ length: 4 }, () => ({ x: rnd(), y: rnd(), w: 0.06 + rnd() * 0.14, h: 0.05 + rnd() * 0.1, d: (rnd() - 0.5) * 0.035 }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const i = y * size + x;
      const large = tileFbm(u, v, 3, 4, 1);
      const mid = tileFbm(u, v, 20, 3, 2);
      const grain = hash2(x, y, 3);
      const stone = hash2(x >> 1, y >> 1, 4);
      let g = 0.34 + (large - 0.5) * 0.06 + (mid - 0.5) * 0.04;
      // agregado claro/escuro (pedrisco ~1–2 cm)
      if (stone > 0.94) g += 0.08 * (stone - 0.94) / 0.06;
      else if (stone < 0.05) g -= 0.04;
      g += (grain - 0.5) * 0.03;
      let ht = 0.5 + (stone - 0.5) * 0.5 + (mid - 0.5) * 0.2;
      // remendos: borda levemente marcada
      for (const p of patches) {
        const dx = Math.abs(((u - p.x + 1.5) % 1) - 0.5), dy = Math.abs(((v - p.y + 1.5) % 1) - 0.5);
        if (dx < p.w / 2 && dy < p.h / 2) {
          g += p.d;
          const edge = Math.min(p.w / 2 - dx, p.h / 2 - dy);
          if (edge < 0.0015) { g -= 0.03; ht -= 0.15; }
        }
      }
      // manchas de óleo
      const oil = tileFbm(u, v, 6, 3, 9);
      if (oil > 0.64) g -= (oil - 0.64) * 0.3;
      // trincas finas, só em zonas fissuradas (≈ 25% da área)
      const zone = tileFbm(u, v, 2, 3, 77);
      if (zone > 0.56) {
        const crack = Math.abs(tileFbm(u, v, 14, 3, 21) - 0.5);
        const w = 0.0035 * Math.min(1, (zone - 0.56) / 0.1);
        if (crack < w) { g -= 0.07; ht -= 0.3; }
      }
      g = Math.max(0.14, Math.min(0.5, g));
      // tom neutro-quente (o asfalto real não é azulado)
      f.albedo[i * 3] = g * 1.02;
      f.albedo[i * 3 + 1] = g * 1.0;
      f.albedo[i * 3 + 2] = g * 0.96;
      f.height[i] = ht;
      f.rough[i] = Math.min(1, 0.9 + (grain - 0.5) * 0.08 - (oil > 0.64 ? (oil - 0.64) * 0.7 : 0));
    }
  }
  return fieldToPbr(f, 1.3);
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
      // calcário branco (levemente creme) e basalto preto; juntas com areia/terra
      let base = dark ? 0.13 + sv * 0.07 : 0.74 + sv * 0.14;
      const tint = dark ? [1, 1, 1.02] : [1.0, 0.985, 0.95];
      const dirt = tileFbm(x / size, y / size, 6, 4, 33);
      base *= 0.86 + dirt * 0.2;
      const joint = edge < 0.09;
      const jointCol = 0.42 + dirt * 0.08;
      const c = joint ? jointCol : base;
      f.albedo[i * 3] = c * tint[0];
      f.albedo[i * 3 + 1] = c * tint[1];
      f.albedo[i * 3 + 2] = c * tint[2];
      f.height[i] = joint ? 0.1 : 0.55 + Math.min(edge, 0.4) + sv * 0.1;
      f.rough[i] = joint ? 0.95 : 0.66 + sv * 0.16; // pedra polida pelo uso
    }
  }
  return fieldToPbr(f, 2.2);
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

/** Granito cinza (meio-fio): grão salpicado preto/branco/rosado; sem juntas (uv do topo é do mundo). */
export function graniteTexture(size = 256): PbrSet {
  const f = newField(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      const n = tileFbm(u, v, 4, 4, 141);
      const gr = hash2(x >> 1, y >> 1, 142);
      const gr2 = hash2(x, y, 143);
      let r = 0.56 + (n - 0.5) * 0.08, g = 0.55 + (n - 0.5) * 0.08, b = 0.54 + (n - 0.5) * 0.08;
      if (gr < 0.18) { r -= 0.3; g -= 0.3; b -= 0.29; } // biotita (preto)
      else if (gr > 0.86) { r += 0.16; g += 0.15; b += 0.14; } // quartzo (branco)
      else if (gr > 0.8) { r += 0.12; g += 0.04; b += 0.02; } // feldspato (rosado)
      const k = 0.94 + (gr2 - 0.5) * 0.08;
      // sujeira/limo no meio-fio
      const dirt = tileFbm(u, v, 8, 3, 144);
      const d = dirt > 0.6 ? 1 - (dirt - 0.6) * 0.6 : 1;
      f.albedo[i * 3] = r * k * d; f.albedo[i * 3 + 1] = g * k * d; f.albedo[i * 3 + 2] = b * k * d * 0.98;
      f.height[i] = 0.5 + (gr2 - 0.5) * 0.2 + (n - 0.5) * 0.3;
      f.rough[i] = 0.62 + (gr2 - 0.5) * 0.12;
    }
  }
  return fieldToPbr(f, 1.2);
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
