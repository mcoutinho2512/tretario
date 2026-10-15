/**
 * Testes dos dados processados (public/world): integridade do manifest, chunks, landmarks,
 * eixo da Presidente Vargas e coerência geográfica.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import type { WorldManifest, ChunkData } from '../src/world/types';
import { worldProjection, haversine } from '../src/geo/projection';

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as WorldManifest;
const loadChunk = (file: string) => JSON.parse(readFileSync(`public/world/${file}`, 'utf8')) as ChunkData;

describe('manifest do mundo', () => {
  it('tem chunks, landmarks, spawn e atribuição OSM', () => {
    expect(manifest.chunks.length).toBeGreaterThan(20);
    expect(manifest.landmarks.map((l) => l.key).sort()).toEqual(['LANDMARK_CANDELARIA', 'LANDMARK_CENTRAL']);
    expect(manifest.attribution).toMatch(/OpenStreetMap/);
    expect(manifest.origin).toEqual({ lat: -22.9025, lon: -43.185 });
  });

  it('todos os arquivos de chunk existem, têm hash no nome e chave consistente', () => {
    for (const c of manifest.chunks) {
      expect(c.file).toMatch(/^chunk_-?\d+_-?\d+\.[0-9a-f]{10}\.json$/);
      expect(existsSync(`public/world/${c.file}`)).toBe(true);
    }
    const sample = manifest.chunks[Math.floor(manifest.chunks.length / 2)];
    const data = loadChunk(sample.file);
    expect(data.key).toBe(sample.key);
    expect(data.bounds[2] - data.bounds[0]).toBe(manifest.chunkSize);
  });

  it('edifícios estão dentro do seu chunk (centróide) e têm altura plausível', () => {
    let total = 0;
    for (const c of manifest.chunks) {
      const d = loadChunk(c.file);
      for (const b of d.buildings) {
        total++;
        expect(b.height).toBeGreaterThan(0);
        expect(b.height).toBeLessThan(200);
        expect(b.poly.outer.length).toBeGreaterThanOrEqual(3);
      }
    }
    expect(total).toBeGreaterThan(5000);
  });
});

describe('geografia', () => {
  it('Central → Candelária ≈ 1,4 km (distância real)', () => {
    const c = manifest.landmarks.find((l) => l.key === 'LANDMARK_CENTRAL')!;
    const k = manifest.landmarks.find((l) => l.key === 'LANDMARK_CANDELARIA')!;
    const d = Math.hypot(c.center[0] - k.center[0], c.center[1] - k.center[1]);
    expect(d).toBeGreaterThan(1300);
    expect(d).toBeLessThan(1500);
    // posição geográfica dos landmarks confere com coordenadas de referência (±60 m)
    const cLL = worldProjection.toLatLon(c.center[0], c.center[1]);
    const kLL = worldProjection.toLatLon(k.center[0], k.center[1]);
    expect(haversine(cLL, { lat: -22.9036, lon: -43.1912 })).toBeLessThan(60);
    expect(haversine(kLL, { lat: -22.9009, lon: -43.1776 })).toBeLessThan(60);
  });

  it('Presidente Vargas segue de oeste (Central) para leste (Candelária), rumo ~ENE', () => {
    const ax = manifest.pvAxis;
    const a = ax[0], b = ax[ax.length - 1];
    expect(b[0]).toBeGreaterThan(a[0]);
    const bearing = ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 360) % 360;
    expect(bearing).toBeGreaterThan(55);
    expect(bearing).toBeLessThan(80);
  });

  it('Candelária: eixo longo alinhado à avenida (±15°) e dimensões ~70×40 m', () => {
    const k = manifest.landmarks.find((l) => l.key === 'LANDMARK_CANDELARIA')!;
    const axisDeg = (((Math.atan2(Math.sin(k.axis), Math.cos(k.axis)) * 180) / Math.PI) + 360) % 180;
    const ax = manifest.pvAxis;
    const pvDeg = (((Math.atan2(ax[ax.length - 1][1] - ax[0][1], ax[ax.length - 1][0] - ax[0][0]) * 180) / Math.PI) + 360) % 180;
    const diff = Math.min(Math.abs(axisDeg - pvDeg), 180 - Math.abs(axisDeg - pvDeg));
    expect(diff).toBeLessThan(15);
    expect(k.length).toBeGreaterThan(60);
    expect(k.length).toBeLessThan(90);
    expect(k.width).toBeGreaterThan(30);
  });

  it('spawn fica perto da Central e sobre a Presidente Vargas', () => {
    const c = manifest.landmarks.find((l) => l.key === 'LANDMARK_CENTRAL')!;
    const d = Math.hypot(manifest.spawn.p[0] - c.center[0], manifest.spawn.p[1] - c.center[1]);
    expect(d).toBeLessThan(260);
  });

  it('pontos de validação essenciais existem', () => {
    const keys = manifest.validation.map((v) => v.key);
    for (const k of ['LANDMARK_CENTRAL', 'LANDMARK_CANDELARIA', 'INTERSECTION_RIO_BRANCO', 'INTERSECTION_URUGUAIANA', 'INTERSECTION_PASSOS', 'CAMPO_DE_SANTANA']) {
      expect(keys).toContain(k);
    }
    for (const v of manifest.validation) {
      const back = worldProjection.toWorld(v.lat, v.lon);
      expect(Math.hypot(back.x - v.p[0], back.z - v.p[1])).toBeLessThan(0.05);
    }
  });

  it('Pres. Vargas tem pistas centrais e laterais com 3–5 faixas', () => {
    let central = 0, lateral = 0;
    for (const c of manifest.minimapRoads) if (c.pv) { if (c.w > 9) central++; else lateral++; }
    expect(central + lateral).toBeGreaterThan(30);
  });
});
