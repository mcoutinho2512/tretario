/**
 * Prévia isolada das árvores/mobiliário (dev): /tools/qa/veg_preview.html?lod=0|1|2&dist=75&h=4
 * Mostra todas as variantes lado a lado, para ajuste dos parâmetros do bake e comparação LOD0/LOD1/impostor.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadVegetation, VegetationSystem, vegetationOptionsFor } from '../../src/world/vegetation';
import { PropSystem } from '../../src/world/builders/props';
import type { PropKind, PropRec } from '../../src/world/types';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8c8d6);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6b604f, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.position.set(40, 60, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 40, bottom: -40, far: 200 });
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 2000);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;

if (q.has('props')) {
  // mobiliário lado a lado (frente dos modelos para +Z = câmera)
  const kinds: PropKind[] = q.get('only') ? [q.get('only') as PropKind] : ['lamp', 'signal', 'signal', 'signal', 'bus_stop', 'bus_pole', 'bench', 'waste', 'bollard', 'kiosk'];
  ground.visible = !q.get('only');
  const ps = new PropSystem(new THREE.Texture());
  scene.add(ps.group);
  const recs: PropRec[] = kinds.map((k, i) => ({ k, p: [(i - kinds.length / 2) * 3.4, 0], r: Math.PI / 2, j: k === 'signal' ? i : undefined, ph: 0 }));
  ps.rebuild(recs, [], 1, () => 0);
  ps.updateSignals((j) => (['R', 'Y', 'G'] as const)[j % 3]);
  camera.position.set(Number(q.get('x') ?? 0), Number(q.get('h') ?? 2), Number(q.get('dist') ?? 18));
  camera.lookAt(Number(q.get('x') ?? 0), Number(q.get('ly') ?? 2), 0);
  renderer.render(scene, camera);
  (window as unknown as { __vegReady: unknown }).__vegReady = { tris: renderer.info.render.triangles, calls: renderer.info.render.calls };
  throw new Error('ok-props'); // encerra o módulo (prévia de mobiliário)
}

const assets = await loadVegetation('/vegetation/');
const opts = vegetationOptionsFor(1);
opts.forceLod = q.has('lod') ? (Number(q.get('lod')) as 0 | 1 | 2) : undefined;
const veg = new VegetationSystem(renderer, assets, { value: 0 }, opts);
scene.add(veg.group);
const n = assets.variants.length;
const sp = Number(q.get('sp') ?? 13);
veg.setTrees(assets.variants.map((_, i) => ({ x: (i - (n - 1) / 2) * sp, y: 0, z: 0, rot: Number(q.get('rot') ?? 0.6) * i, scale: 1, variant: i })));
const dist = Number(q.get('dist') ?? 75);
camera.position.set(Number(q.get('x') ?? 0), Number(q.get('h') ?? 4), dist);
camera.lookAt(Number(q.get('x') ?? 0), Number(q.get('ly') ?? 6), 0);
veg.update(camera.position);
renderer.render(scene, camera);
const tris = renderer.info.render.triangles, calls = renderer.info.render.calls;
(window as unknown as { __vegReady: unknown }).__vegReady = { tris, calls, variants: assets.variants.map((v) => v.name) };
