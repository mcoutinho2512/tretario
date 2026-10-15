/**
 * Sistema de coordenadas do mundo.
 *
 * WGS84 (lat/lon/alt) → ECEF → ENU (East-North-Up) tangente à ORIGEM do mundo.
 * Mapeamento para o Three.js (1 unidade = 1 metro):
 *   x = East   (leste positivo)
 *   y = Up     (altura acima do elipsoide no ponto de origem; usamos 0 = nível da rua)
 *   z = -North (norte é -Z, como "para frente" na convenção do Three.js)
 *
 * A projeção é exata (tangente local via ECEF), sem distorção relevante num raio
 * de alguns km (erro < 1 cm a 2 km da origem, devido apenas à curvatura em y).
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface WorldXZ {
  x: number;
  z: number;
}

// Elipsoide WGS84
const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

const DEG = Math.PI / 180;

/**
 * Origem oficial do mundo: canteiro central da Av. Presidente Vargas
 * aproximadamente em frente ao Campo de Santana / entre a Central e a Candelária.
 * NÃO ALTERAR sem migrar todos os dados processados (multiplayer/eventos dependem disso).
 */
export const WORLD_ORIGIN: LatLon = { lat: -22.9025, lon: -43.1850 };

export function geodeticToEcef(lat: number, lon: number, h = 0): [number, number, number] {
  const sl = Math.sin(lat * DEG), cl = Math.cos(lat * DEG);
  const so = Math.sin(lon * DEG), co = Math.cos(lon * DEG);
  const N = A / Math.sqrt(1 - E2 * sl * sl);
  return [(N + h) * cl * co, (N + h) * cl * so, (N * (1 - E2) + h) * sl];
}

export function ecefToGeodetic(x: number, y: number, z: number): { lat: number; lon: number; h: number } {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const sl = Math.sin(lat);
    const N = A / Math.sqrt(1 - E2 * sl * sl);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - E2 * (N / (N + h))));
  }
  return { lat: lat / DEG, lon: lon / DEG, h };
}

export class GeoProjection {
  readonly origin: LatLon;
  private readonly o: [number, number, number];
  private readonly sLat: number;
  private readonly cLat: number;
  private readonly sLon: number;
  private readonly cLon: number;

  constructor(origin: LatLon = WORLD_ORIGIN) {
    this.origin = origin;
    this.o = geodeticToEcef(origin.lat, origin.lon, 0);
    this.sLat = Math.sin(origin.lat * DEG);
    this.cLat = Math.cos(origin.lat * DEG);
    this.sLon = Math.sin(origin.lon * DEG);
    this.cLon = Math.cos(origin.lon * DEG);
  }

  /** lat/lon → ENU (metros) */
  toENU(lat: number, lon: number, h = 0): { e: number; n: number; u: number } {
    const [x, y, z] = geodeticToEcef(lat, lon, h);
    const dx = x - this.o[0], dy = y - this.o[1], dz = z - this.o[2];
    const e = -this.sLon * dx + this.cLon * dy;
    const n = -this.sLat * this.cLon * dx - this.sLat * this.sLon * dy + this.cLat * dz;
    const u = this.cLat * this.cLon * dx + this.cLat * this.sLon * dy + this.sLat * dz;
    return { e, n, u };
  }

  /** ENU (metros) → lat/lon */
  fromENU(e: number, n: number, u = 0): { lat: number; lon: number; h: number } {
    const dx = -this.sLon * e - this.sLat * this.cLon * n + this.cLat * this.cLon * u;
    const dy = this.cLon * e - this.sLat * this.sLon * n + this.cLat * this.sLon * u;
    const dz = this.cLat * n + this.sLat * u;
    return ecefToGeodetic(this.o[0] + dx, this.o[1] + dy, this.o[2] + dz);
  }

  /** lat/lon → coordenadas do mundo Three.js (x, z). Altura tratada separadamente. */
  toWorld(lat: number, lon: number): WorldXZ {
    const { e, n } = this.toENU(lat, lon);
    return { x: e, z: -n };
  }

  /** coordenadas do mundo (x, z) → lat/lon */
  toLatLon(x: number, z: number): LatLon {
    const { lat, lon } = this.fromENU(x, -z, 0);
    return { lat, lon };
  }
}

/** Distância geodésica aproximada (haversine) em metros — útil para validação/testes. */
export function haversine(a: LatLon, b: LatLon): number {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const worldProjection = new GeoProjection(WORLD_ORIGIN);
