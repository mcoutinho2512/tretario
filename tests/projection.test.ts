import { describe, it, expect } from 'vitest';
import { GeoProjection, WORLD_ORIGIN, haversine } from '../src/geo/projection';

const proj = new GeoProjection(WORLD_ORIGIN);

describe('GeoProjection', () => {
  it('origem mapeia para (0,0)', () => {
    const p = proj.toWorld(WORLD_ORIGIN.lat, WORLD_ORIGIN.lon);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.z)).toBeLessThan(1e-6);
  });

  it('leste é +x e norte é -z', () => {
    const east = proj.toWorld(WORLD_ORIGIN.lat, WORLD_ORIGIN.lon + 0.001);
    const north = proj.toWorld(WORLD_ORIGIN.lat + 0.001, WORLD_ORIGIN.lon);
    expect(east.x).toBeGreaterThan(90);
    expect(Math.abs(east.z)).toBeLessThan(0.5);
    expect(north.z).toBeLessThan(-100);
    expect(Math.abs(north.x)).toBeLessThan(0.5);
  });

  it('ida e volta lat/lon ↔ mundo com erro < 1 mm', () => {
    for (const [lat, lon] of [[-22.9036, -43.1911], [-22.9008, -43.1777], [-22.91, -43.17]]) {
      const w = proj.toWorld(lat, lon);
      const back = proj.toLatLon(w.x, w.z);
      const err = haversine({ lat, lon }, back);
      expect(err).toBeLessThan(0.001);
    }
  });

  it('1 unidade ≈ 1 metro: distância no mundo ≈ distância geodésica (Central → Candelária)', () => {
    const central = { lat: -22.9036, lon: -43.1911 };
    const candelaria = { lat: -22.9008, lon: -43.1777 };
    const a = proj.toWorld(central.lat, central.lon);
    const b = proj.toWorld(candelaria.lat, candelaria.lon);
    const dWorld = Math.hypot(a.x - b.x, a.z - b.z);
    const dGeo = haversine(central, candelaria);
    expect(dGeo).toBeGreaterThan(1300);
    expect(dGeo).toBeLessThan(1500);
    expect(Math.abs(dWorld - dGeo) / dGeo).toBeLessThan(0.003);
  });
});
