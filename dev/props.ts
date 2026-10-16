/**
 * Página de desenvolvimento (não entra no build): itens da manifestação — bandeiras grandes de cenário, multidão
 * instanciada com itens e um personagem segurando um item, para conferir visual e medir custo.
 * /dev/props.html?n=200&held=flag_large&design=brasil&big=1&wind=0.6&cam=crowd|big|held
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CrowdRenderer, CROWD_BODIES } from '../src/characters/crowd/CrowdRenderer';
import { createAgent, type CrowdAgent } from '../src/characters/crowd/crowdBudget';
import { PropInstancer, qaCrowdProp } from '../src/social/props/PropInstancer';
import { createBigFlag, createStaticBanner, type SceneFlag } from '../src/social/props/BigFlag';
import { PROP_CATEGORY, designMaterialStats, setPropWind } from '../src/social/props/propMaterials';
import { HumanCharacter } from '../src/characters/human/HumanCharacter';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/characters/bodyTypes';
import { EMPTY_SOCIAL } from '../src/social/types';
import { PROP_BY_KIND, type PropKind } from '../src/social/props';
import { DESIGN_BY_KEY } from '../src/social/designs';
import { assetManager } from '../src/core/AssetManager';
import { applyHoldPose } from './propHoldPose';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c8);
scene.fog = new THREE.Fog(0x9fb4c8, 120, 400);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 150 });
scene.add(sun, new THREE.HemisphereLight(0xcfe0ff, 0x4a4036, 0.7));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 800);
const camMode = q.get('cam') ?? 'crowd';
if (camMode === 'big') { cam.position.set(-3, 1.7, -7); cam.lookAt(1, 5, 8); }
else if (camMode === 'held') { cam.position.set(2.6, 2.0, 7.5); cam.lookAt(0, 2.0, 0); }
else { cam.position.set(0, 3.2, -6); cam.lookAt(0, 1.2, 40); }
if (q.get('wind')) setPropWind(0.8, 0.6, Number(q.get('wind')));
const designQ = q.get('design');
const design = designQ ? (DESIGN_BY_KEY.get(designQ)?.id ?? Number(designQ)) : 1;

// ------------------------------------------------------------------ multidão instanciada com itens
const N = Number(q.get('n') ?? 200);
const crowd = new CrowdRenderer(Math.max(1, N), true);
scene.add(crowd.group);
const props = new PropInstancer(Math.max(1, N));
scene.add(props.group);
const agents: CrowdAgent[] = [];
const cols = Math.ceil(Math.sqrt(N * 2));
for (let i = 0; i < N; i++) {
  const r = i % cols, c = Math.floor(i / cols);
  const a = createAgent({
    x: (r - cols / 2) * 1.6 + Math.sin(i * 7.1) * 0.4, z: Number(q.get('z0') ?? 35) + c * 2.2 + Math.cos(i * 3.3) * 0.5,
    heading: Math.PI + Math.sin(i) * 0.5, body: i % CROWD_BODIES.length, speed: i % 3 === 0 ? 1.1 : 0,
    top: [0x2f6f8f, 0xc8102e, 0xf2c230, 0x1d3557, 0xffffff, 0x0b6e4f][i % 6], lod: 3, tier: 1,
  });
  qaCrowdProp(a, q.get('props') === '0' ? 0 : 1);
  agents.push(a);
}

// ------------------------------------------------------------------ cenário: bandeira grande e faixa
const flags: SceneFlag[] = [];
if (q.get('big') !== '0') {
  const f = createBigFlag({ design });
  f.object.position.set(4, 0, 6);
  scene.add(f.object);
  flags.push(f);
  const f2 = createBigFlag({ design: 31 === design ? 1 : 30, poleHeight: 6, flagW: 4.5 });
  f2.object.position.set(-6, 0, 12);
  scene.add(f2.object);
  flags.push(f2);
  const b = createStaticBanner({ design: 5, width: 6 });
  b.object.position.set(-2, 0, 20);
  scene.add(b.object);
  flags.push(b);
}

// ------------------------------------------------------------------ personagem segurando um item
const heldKind = q.get('held') as PropKind | null;
let held: HumanCharacter | null = null;
if (heldKind && PROP_BY_KIND.get(heldKind)) {
  held = new HumanCharacter(DEFAULT_PLAYER_APPEARANCE.homem, { lod: 0 });
  held.root.rotation.y = Number(q.get('yaw') ?? 0.4);
  scene.add(held.root);
  await held.ready;
  held.setSocial({ ...EMPTY_SOCIAL, prop: PROP_BY_KIND.get(heldKind)!.id, design });
}

await crowd.init();
let last = performance.now();
const frameTimes: number[] = [];
function render(dt: number) {
  renderer.info.reset();
  crowd.draw(agents, dt);
  props.draw(agents);
  if (held) { held.animator?.update(0, true, dt); applyHoldPose(held, heldKind!); held.updateProps(dt); }
  for (const f of flags) f.update(dt, cam);
  renderer.render(scene, cam);
}
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  frameTimes.push(now - last);
  if (frameTimes.length > 240) frameTimes.shift();
  last = now;
  render(dt);
  requestAnimationFrame(frame);
}
frame();

/** custo: renderiza com e sem cada grupo e devolve a diferença (draw calls/triângulos) + memória de textura */
function measure() {
  const snap = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles });
  const vis = (o: THREE.Object3D | null | undefined, v: boolean) => { if (o) o.visible = v; };
  const heldProps = held ? held.root.children.filter((c) => c.name.startsWith('prop_')) : [];
  const set = (on: { inst: boolean; held: boolean; flags: boolean }) => {
    vis(props.group, on.inst);
    heldProps.forEach((p) => vis(p, on.held));
    flags.forEach((f) => vis(f.object, on.flags));
  };
  const run = (on: { inst: boolean; held: boolean; flags: boolean }) => { set(on); render(0); return snap(); };
  const all = run({ inst: true, held: true, flags: true });
  const noInst = run({ inst: false, held: true, flags: true });
  const noHeld = run({ inst: true, held: false, flags: true });
  const noFlags = run({ inst: true, held: true, flags: false });
  set({ inst: true, held: true, flags: true });
  let texBytes = 0, geoBytes = 0;
  const seenT = new Set<THREE.Texture>(), seenG = new Set<THREE.BufferGeometry>();
  for (const e of assetManager.reportEntries()) {
    if (e.category !== PROP_CATEGORY) continue;
    const ts = e.texture ? [e.texture] : e.material ? Object.values(e.material).filter((v) => (v as THREE.Texture)?.isTexture) as THREE.Texture[] : [];
    for (const t of ts) {
      if (seenT.has(t)) continue;
      seenT.add(t);
      const im = t.image as { width: number; height: number };
      texBytes += im.width * im.height * 4 * 1.333;
    }
    if (e.geometry && !seenG.has(e.geometry)) {
      seenG.add(e.geometry);
      for (const a of Object.values(e.geometry.attributes)) geoBytes += (a as THREE.BufferAttribute).array?.byteLength ?? 0;
      geoBytes += e.geometry.index?.array.byteLength ?? 0;
    }
  }
  const ft = [...frameTimes].sort((a, b) => a - b);
  return {
    all, instancedProps: { calls: all.calls - noInst.calls, tris: all.tris - noInst.tris, agents: props.stats.drawn, instances: props.stats.instances },
    heldProp: { calls: all.calls - noHeld.calls, tris: all.tris - noHeld.tris },
    sceneFlags: { calls: all.calls - noFlags.calls, tris: all.tris - noFlags.tris },
    propTexturesMB: +(texBytes / 1048576).toFixed(2), propGeometryMB: +(geoBytes / 1048576).toFixed(2), designMaterials: designMaterialStats(),
    frameMsMedian: +ft[Math.floor(ft.length / 2)].toFixed(2),
  };
}
(window as any).__props = { measure, agents, props, held };
(window as any).__humanReady = true;
