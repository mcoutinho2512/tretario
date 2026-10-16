/**
 * Despacho dos edifícios com modelo dedicado (campo `model` vindo de data/overrides/buildings.json
 * via tools/process_osm.ts). O ChunkManager deixa de desenhar esses edifícios; o jogo constrói o
 * modelo aqui assim que o chunk do edifício é carregado.
 *
 * Landmarks heróis: palacio_duque_caxias, ccbb. Edifícios de reconhecimento (rodada 6,
 * docs/RECOGNITION_BUILDINGS.md): banco_central, presidente_kennedy, belacap[:letreiro], embratel,
 * pv1111, biblioteca_parque, paulo_frontin:<0|1>, pa:<variante>[:esquina].
 */
import type * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import type { ArchMat } from './arch';
import type { LandmarkInstance } from './central';
import { buildPalacioDuqueCaxias } from './palacioDuqueCaxias';
import { buildCCBB } from './ccbb';
import { buildBancoCentral } from './bancoCentral';
import { buildPaBlock } from './paBlocks';
import { buildBelacap, buildBibliotecaParque, buildEmbratel, buildPauloDeFrontin, buildPresidenteKennedy, buildVidroPV1111 } from './recognitionModels';

/** ponto do eixo da avenida mais próximo de um ponto (orientação da fachada principal) */
function nearestOnAxis(axis: XZ[], c: XZ): XZ {
  let near = axis[0], bd = Infinity;
  for (const p of axis) { const d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; near = p; } }
  return near;
}

/** ponto mais próximo sobre o eixo (projeção nos segmentos) e direção unitária do segmento */
export function axisFrame(axis: XZ[], c: XZ): { p: XZ; dir: XZ } {
  let bp: XZ = axis[0], bdir: XZ = [1, 0], bd = Infinity;
  for (let i = 0; i < axis.length - 1; i++) {
    const a = axis[i], b = axis[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / (l * l)));
    const q: XZ = [a[0] + dx * t, a[1] + dz * t];
    const d = Math.hypot(c[0] - q[0], c[1] - q[1]);
    if (d < bd) { bd = d; bp = q; bdir = [dx / l, dz / l]; }
  }
  return { p: bp, dir: bdir };
}

function centroid(r: XZ[]): XZ {
  let x = 0, z = 0;
  for (const p of r) { x += p[0]; z += p[1]; }
  return [x / r.length, z / r.length];
}

export function buildModelBuilding(b: BuildingRec, archMats: Record<ArchMat, THREE.Material>, pvAxis: XZ[]): LandmarkInstance | null {
  const model = b.model ?? '';
  const ax = axisFrame(pvAxis, centroid(b.poly.outer));
  if (model.startsWith('pa:') || model === 'pa') return buildPaBlock(b, archMats, ax.dir);
  if (model.startsWith('paulo_frontin')) return buildPauloDeFrontin(b, archMats, ax.p, model.endsWith(':1') ? 1 : 0);
  if (model.startsWith('belacap')) return buildBelacap(b, archMats, ax.p, model.endsWith(':letreiro'));
  switch (model) {
    case 'palacio_duque_caxias':
      return buildPalacioDuqueCaxias(b, archMats, nearestOnAxis(pvAxis, b.poly.outer[0]));
    case 'ccbb':
      return buildCCBB(b, archMats);
    case 'banco_central':
      return buildBancoCentral(b, archMats);
    case 'presidente_kennedy':
      return buildPresidenteKennedy(b, archMats);
    case 'embratel':
      return buildEmbratel(b, archMats, ax.p);
    case 'pv1111':
      return buildVidroPV1111(b, archMats);
    case 'biblioteca_parque':
      return buildBibliotecaParque(b, archMats, ax.p);
    default:
      return null;
  }
}
