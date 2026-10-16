import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { bake, carModelFor, VEHICLE_MATS } from '../src/traffic/vehicleModels';
import { legacyGeometry } from '../src/traffic/TrafficSystem';

describe('modelos de veículos', () => {
  it('escolha do modelo de passeio é determinística e variada', () => {
    const counts: Record<string, number> = {};
    for (let id = 1; id <= 600; id++) {
      const m = carModelFor(id);
      expect(carModelFor(id)).toBe(m);
      counts[m] = (counts[m] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['hatch', 'sedan', 'suv']);
    for (const k of Object.keys(counts)) expect(counts[k]).toBeGreaterThan(60);
  });

  it('bake converte materiais em atributos por vértice (cor + aPbr)', () => {
    const g = bake([
      { geo: new THREE.BoxGeometry(1, 1, 1), name: 'paint' },
      { geo: new THREE.BoxGeometry(1, 1, 1), name: 'lamp_rear', color: new THREE.Color(1, 0, 0) },
    ])!;
    const pbr = g.getAttribute('aPbr');
    const col = g.getAttribute('color');
    expect(pbr.itemSize).toBe(4);
    // primeira metade = pintura (máscara 1, cor branca multiplicada pelo instanceColor)
    expect(pbr.getZ(0)).toBe(1);
    expect(col.getX(0)).toBe(1);
    // segunda metade = lanterna (classe de emissão 2)
    const last = pbr.count - 1;
    expect(pbr.getW(last)).toBe(VEHICLE_MATS.lamp_rear.emit);
    expect(col.getY(last)).toBe(0);
  });

  it('reserva procedural tem as dimensões do carro de colisão (4,4 × 1,8 m)', () => {
    const g = legacyGeometry('sedan');
    g.computeBoundingBox();
    const s = g.boundingBox!.getSize(new THREE.Vector3());
    expect(s.z).toBeGreaterThan(4.3);
    expect(s.z).toBeLessThan(4.6);
    expect(s.x).toBeLessThan(1.9);
  });
});

describe('GLB dos veículos', () => {
  it('sedan tem ~4,4 m × 1,8 m (caixa de colisão do carro dirigível) e todos os modelos/LODs existem', async () => {
    const { readFileSync } = await import('node:fs');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    const buf = readFileSync(new URL('../public/vehicles/vehicles.glb', import.meta.url));
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await loader.parseAsync(ab, '');
    for (const n of ['sedan', 'hatch', 'suv', 'taxi', 'bus']) for (const l of [0, 1]) expect(gltf.scene.getObjectByName(`${n}_LOD${l}`)).toBeTruthy();
    const sedan = gltf.scene.getObjectByName('sedan_LOD0')!;
    const box = new THREE.Box3().setFromObject(sedan);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(4.3);
    expect(size.z).toBeLessThan(4.5);
    expect(size.x).toBeLessThan(2.0); // inclui retrovisores; carroceria 1,78 m
    expect(box.min.y).toBeGreaterThan(-0.02); // rodas apoiadas no chão
    // frente em +Z: faróis (lamp_front) na metade dianteira
    let front = 0;
    sedan.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'lamp_front') front = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).z;
    });
    expect(front).toBeGreaterThan(1.5);
  });
});
