/**
 * Prévia isolada das árvores/mobiliário (dev): /tools/qa/veg_preview.html?lod=0|1|2&dist=75&h=4
 * Mostra todas as variantes lado a lado, para ajuste dos parâmetros do bake e comparação LOD0/LOD1/impostor.
 */
import * as THREE from 'three';
import { loadVegetation, VegetationSystem, vegetationOptionsFor } from '../../src/world/vegetation';

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
