/**
 * Despacho dos edifícios com modelo dedicado (campo `model` vindo de data/overrides/buildings.json
 * via tools/process_osm.ts). O ChunkManager deixa de desenhar esses edifícios; o jogo constrói o
 * modelo aqui assim que o chunk do edifício é carregado.
 */
import type * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import type { ArchMat } from './arch';
import type { LandmarkInstance } from './central';
import { buildPalacioDuqueCaxias } from './palacioDuqueCaxias';
import { buildCCBB } from './ccbb';

/** ponto do eixo da avenida mais próximo de um ponto (orientação da fachada principal) */
function nearestOnAxis(axis: XZ[], c: XZ): XZ {
  let near = axis[0], bd = Infinity;
  for (const p of axis) { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; near = p; } }
  return near;
}

export function buildModelBuilding(b: BuildingRec, archMats: Record<ArchMat, THREE.Material>, pvAxis: XZ[]): LandmarkInstance | null {
  switch (b.model) {
    case 'palacio_duque_caxias':
      return buildPalacioDuqueCaxias(b, archMats, nearestOnAxis(pvAxis, b.poly.outer[0]));
    case 'ccbb':
      return buildCCBB(b, archMats);
    default:
      return null;
  }
}
