/**
 * Autoridade do servidor sobre a posição, com a geometria REAL da Pres. Vargas
 * (mesmo arquivo de colisão que o servidor carrega).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WallGrid, decodeSegments } from '../src/physics/walls';
import { validateMoveInWorld, checkPath } from '../src/net/authority';
import type { MoveMsg } from '../src/net/protocol';
import type { WorldManifest, ChunkData } from '../src/world/types';

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as WorldManifest;
const buf = readFileSync(`public/world/${manifest.collision}`);
const walls = new WallGrid();
walls.addAll(decodeSegments(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)));

// um prédio alto real perto do meio do corredor (sem galeria, no térreo)
const chunk = manifest.chunks.find((c) => c.key === '0_0')!;
const data = JSON.parse(readFileSync(`public/world/${chunk.file}`, 'utf8')) as ChunkData;
const b = data.buildings.find((x) => x.height > 20 && !x.arcadeEdges && !x.canopy && x.minHeight === 0 && x.poly.outer.length >= 4)!;
const ring = b.poly.outer;
const inside = (p: [number, number]) => {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};
// parede real: maior aresta do polígono; normal apontando para FORA
let ei = 0, el = 0;
ring.forEach((a, i) => { const c = ring[(i + 1) % ring.length]; const l = Math.hypot(c[0] - a[0], c[1] - a[1]); if (l > el) { el = l; ei = i; } });
const A = ring[ei], C = ring[(ei + 1) % ring.length];
const mid: [number, number] = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2];
let nx = (C[1] - A[1]) / el, nz = -(C[0] - A[0]) / el;
if (inside([mid[0] + nx * 0.5, mid[1] + nz * 0.5])) { nx = -nx; nz = -nz; }
const outside = (d: number): [number, number] => [mid[0] + nx * d, mid[1] + nz * d];

const move = (x: number, z: number, mode: MoveMsg['mode'] = 'foot'): MoveMsg => ({ x, y: 0.15, z, heading: 0, speed: 1, loco: 1, mode, seq: 1 });

describe('servidor autoritativo × geometria da cidade', () => {
  it('arquivo de colisão carregado (dezenas de milhares de segmentos)', () => {
    expect(walls.segmentCount).toBeGreaterThan(30000);
  });

  it('cliente modificado não atravessa um prédio enviando coordenadas falsas (passos pequenos, velocidade "legal")', () => {
    // parte de 8 m fora da parede e "anda" em passos de 0,5 m a cada 100 ms para dentro do prédio
    const o = outside(8);
    let pos = { x: o[0], y: 0.15, z: o[1], t: 0 };
    let blocked = 0;
    for (let i = 1; i <= 60; i++) {
      const target = move(pos.x - nx * 0.5, pos.z - nz * 0.5);
      const r = validateMoveInWorld(walls, pos, target, i * 100);
      if (!r.ok) blocked++;
      pos = { x: r.x, y: r.y, z: r.z, t: i * 100 };
    }
    expect(blocked).toBeGreaterThan(0);
    // nunca chegou ao interior do prédio
    expect(inside([pos.x, pos.z])).toBe(false);
  });

  it('teleporte para dentro de um prédio é rejeitado', () => {
    const o = outside(2), target = outside(-4);
    expect(inside(target)).toBe(true);
    const r = validateMoveInWorld(walls, { x: o[0], y: 0.15, z: o[1], t: 0 }, move(target[0], target[1]), 2000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('collision');
    expect(inside([r.x, r.z])).toBe(false);
  });

  it('movimento livre na pista da Pres. Vargas é aceito', () => {
    const p = manifest.spawn.p;
    const r = validateMoveInWorld(walls, { x: p[0], y: 0, z: p[1], t: 0 }, move(p[0] + 0.5, p[1] - 0.1), 300);
    expect(r.ok).toBe(true);
  });

  it('carro usa largura do veículo (3 raios)', () => {
    const o = outside(6), t = outside(-3);
    const c = checkPath(walls, { x: o[0], z: o[1] }, { x: t[0], z: t[1] }, 'car', 0.5);
    expect(c.blocked).toBe(true);
    expect(inside([c.x, c.z])).toBe(false);
  });
});
