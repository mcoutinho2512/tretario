import type { LatLon } from './projection';

/** Bounding box do MVP: Central do Brasil → Av. Presidente Vargas → Candelária (+ margem). */
export const REGION_BBOX = {
  south: -22.9095,
  west: -43.1965,
  north: -22.8965,
  east: -43.1735,
};

/** Pontos de referência conhecidos (usados para spawn, minimapa, validação). Coordenadas aproximadas,
 *  refinadas no pipeline com base nas geometrias OSM correspondentes quando encontradas. */
export const REFERENCE_POINTS: Record<string, LatLon & { label: string }> = {
  LANDMARK_CENTRAL: { lat: -22.9036, lon: -43.1912, label: 'Central do Brasil (Ed. D. Pedro II)' },
  LANDMARK_CANDELARIA: { lat: -22.9009, lon: -43.1776, label: 'Igreja da Candelária' },
};

/** Tamanho do chunk em metros (grade alinhada à origem do mundo). */
export const CHUNK_SIZE = 250;
