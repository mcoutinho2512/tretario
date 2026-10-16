/**
 * Modelos de reserva dos veículos (geometria simples): usados só se public/vehicles/vehicles.glb não carregar.
 * Antes ficavam no renderizador de trânsito NPC, removido na rodada 7 (avenida fechada para o evento).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bake, type VehicleModelName } from './vehicleModels';

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  return g;
}
function wheels(len: number, width: number, r: number, axles: number[]) {
  const gs: THREE.BufferGeometry[] = [];
  for (const az of axles) for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(r, r, 0.26, 14);
    g.rotateZ(Math.PI / 2);
    g.translate(s * (width / 2 - 0.12), r, az * len / 2);
    g.deleteAttribute('uv');
    gs.push(g);
  }
  return mergeGeometries(gs)!;
}
/** cabine com teto inclinado (para-brisa/vidro traseiro) a partir de uma caixa deformada */
function cabin(w: number, h: number, d: number, y: number, z: number, taper = 0.32) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setZ(i, p.getZ(i) * (1 - taper)); p.setX(i, p.getX(i) * 0.92); }
  }
  g.computeVertexNormals();
  g.translate(0, y + h / 2, z);
  g.deleteAttribute('uv');
  return g;
}

export interface ModelParts { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; dark: THREE.BufferGeometry; lights: THREE.BufferGeometry; stripe?: THREE.BufferGeometry }

export function carModel(taxi: boolean): ModelParts {
  const L = 4.4, W = 1.8;
  const body = mergeGeometries([box(W, 0.62, L, 0, 0.62, 0), box(W - 0.06, 0.12, L - 0.3, 0, 0.98, 0)])!;
  const glass = cabin(W - 0.12, 0.5, 2.2, 1.0, -0.15);
  const roof = box(W - 0.3, 0.06, 1.3, 0, 1.53, -0.15);
  const dark = mergeGeometries([wheels(L, W, 0.33, [0.62, -0.62]), box(W + 0.02, 0.18, L + 0.04, 0, 0.36, 0)])!;
  const lights = mergeGeometries([box(0.35, 0.12, 0.05, 0.6, 0.8, L / 2 + 0.01), box(0.35, 0.12, 0.05, -0.6, 0.8, L / 2 + 0.01),
    box(0.3, 0.12, 0.05, 0.62, 0.82, -L / 2 - 0.01), box(0.3, 0.12, 0.05, -0.62, 0.82, -L / 2 - 0.01)])!;
  const parts: ModelParts = { body: mergeGeometries([body, roof])!, glass, dark, lights };
  // táxi carioca: amarelo com faixa azul lateral + luminoso no teto
  if (taxi) parts.stripe = mergeGeometries([box(W + 0.02, 0.1, L - 0.6, 0, 0.75, 0), box(0.5, 0.14, 0.2, 0, 1.63, -0.15)])!;
  return parts;
}

export function busModel(): ModelParts {
  const L = 12.2, W = 2.55;
  const body = mergeGeometries([box(W, 2.0, L, 0, 1.45, 0), box(W - 0.05, 0.25, L - 0.2, 0, 2.95, 0)])!;
  const glass = mergeGeometries([box(W + 0.02, 1.0, L - 1.6, 0, 1.95, -0.3), box(W - 0.2, 1.3, 0.05, 0, 1.75, L / 2 + 0.01)])!;
  const dark = mergeGeometries([wheels(L, W, 0.5, [0.62, -0.5]), box(W + 0.02, 0.3, L + 0.02, 0, 0.55, 0)])!;
  const lights = mergeGeometries([box(0.35, 0.2, 0.05, 0.9, 0.85, L / 2 + 0.02), box(0.35, 0.2, 0.05, -0.9, 0.85, L / 2 + 0.02),
    box(0.3, 0.3, 0.05, 1.0, 1.0, -L / 2 - 0.02), box(0.3, 0.3, 0.05, -1.0, 1.0, -L / 2 - 0.02), box(1.6, 0.25, 0.05, 0, 2.7, L / 2 + 0.03)])!;
  return { body, glass, dark, lights };
}

/** reserva: converte as caixas antigas para o formato de geometria única (color + aPbr) */
export function legacyGeometry(name: VehicleModelName): THREE.BufferGeometry {
  const m = name === 'bus' ? busModel() : carModel(name === 'taxi');
  const parts = [{ geo: m.body, name: 'paint' }, { geo: m.glass, name: 'glass' }, { geo: m.dark, name: 'rubber', color: new THREE.Color(0x1a1a1a) }, { geo: m.lights, name: 'lamp_front', color: new THREE.Color(0xfff6e0) }];
  if (m.stripe) parts.push({ geo: m.stripe, name: 'stripe', color: new THREE.Color(0x1f4fa8) });
  return bake(parts)!;
}

