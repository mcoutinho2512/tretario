import { describe, it, expect } from 'vitest';
import { sunPosition, sunDirection, rioDate } from '../src/geo/solar';

const LAT = -22.9025, LON = -43.185;

describe('posição solar', () => {
  it('16:30 no Rio (outubro): sol a oeste, ainda alto o suficiente para boa visibilidade', () => {
    const p = sunPosition(rioDate(2026, 10, 15, 16, 30), LAT, LON);
    const elevDeg = (p.elevation * 180) / Math.PI;
    const azDeg = (p.azimuth * 180) / Math.PI;
    expect(elevDeg).toBeGreaterThan(12);
    expect(elevDeg).toBeLessThan(35);
    expect(azDeg).toBeGreaterThan(240);
    expect(azDeg).toBeLessThan(290);
    const d = sunDirection(p);
    expect(d[0]).toBeLessThan(0); // oeste = −x
  });
  it('meio-dia solar no verão: sol quase a pino', () => {
    const p = sunPosition(rioDate(2026, 12, 21, 11, 55), LAT, LON);
    expect((p.elevation * 180) / Math.PI).toBeGreaterThan(85);
  });
  it('meia-noite: sol abaixo do horizonte', () => {
    const p = sunPosition(rioDate(2026, 10, 15, 0, 0), LAT, LON);
    expect(p.elevation).toBeLessThan(0);
  });
});
