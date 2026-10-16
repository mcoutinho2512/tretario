/**
 * Página de desenvolvimento (não entra no build): visualiza o personagem humano, LODs e animações.
 * /dev/human.html?body=homem&lod=0&speed=1.4&pose=walk&cam=close|full|lods
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HumanCharacter } from '../src/characters/human/HumanCharacter';
import { DEFAULT_PLAYER_APPEARANCE, type BodyType } from '../src/characters/bodyTypes';
import type { Lod } from '../src/characters/human/HumanAssets';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8796a4);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, new THREE.HemisphereLight(0xcfe0ff, 0x4a4036, 0.6));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const cam = new THREE.PerspectiveCamera(q.get('cam') === 'close' ? 22 : 35, innerWidth / innerHeight, 0.05, 100);
const mode = q.get('cam') ?? 'full';
if (mode === 'close') { cam.position.set(0.25, 1.62, 1.35); cam.lookAt(0, 1.55, 0); }
else if (mode === 'lods') { cam.position.set(0, 1.4, 7.5); cam.lookAt(0, 0.9, 0); }
else { cam.position.set(1.4, 1.25, 3.6); cam.lookAt(0, 0.9, 0); }

const body = (q.get('body') ?? 'homem') as BodyType;
const app = { ...DEFAULT_PLAYER_APPEARANCE[body], accessory: (q.get('acc') ?? 'nenhum') as never, acc: 0x2b4a7a };
if (q.get('top')) app.top = parseInt(q.get('top')!, 16);
if (q.get('skin')) app.skin = parseInt(q.get('skin')!, 16);
const chars: HumanCharacter[] = [];
const lods: Lod[] = mode === 'lods' ? [0, 1, 2, 3] : [Number(q.get('lod') ?? 0) as Lod];
lods.forEach((l, i) => {
  const h = new HumanCharacter(app, { lod: l });
  h.root.position.x = mode === 'lods' ? (i - 1.5) * 1.1 : 0;
  h.root.rotation.y = Number(q.get('yaw') ?? 0.3);
  scene.add(h.root);
  chars.push(h);
});
const speed = Number(q.get('speed') ?? 0);
const pose = q.get('pose');
let t0 = performance.now();
await Promise.all(chars.map((c) => c.ready));
await new Promise((r) => setTimeout(r, 400));
(window as any).__human = { chars, info: () => chars.map((c) => ({ lod: c.lod, natural: c.animator?.naturalSpeeds, tris: renderer.info.render.triangles, calls: renderer.info.render.calls })) };
const freeze = q.get('t') ? Number(q.get('t')) : null;
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - t0) / 1000);
  t0 = now;
  for (const c of chars) {
    if (pose && !c.userData) { c.animator?.setShow(pose as never); (c as any).userData = 1; }
    if (freeze !== null) { c.animator?.update(speed, true, 0); c.animator!.mixer.setTime(freeze); }
    else c.animator?.update(speed, true, dt);
  }
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
frame();
(window as any).__humanReady = true;
