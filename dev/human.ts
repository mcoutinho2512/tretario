/**
 * Página de desenvolvimento (não entra no build): visualiza o personagem humano, LODs e animações.
 * /dev/human.html?body=homem&lod=0&speed=1.4&pose=walk&cam=close|full|lods|side|back|hands
 * Ações sociais: &act=<ActionDefinition.key>&prop=<PropKind>&var=<0..7>&t=<s> (t congela o instante)
 * &proxy=1 desenha um item aproximado (cartaz/mastro/faixa) entre as mãos — conferir a pegada.
 * Design do item: &design=<chave ou id>; vento das bandeiras: &wind=0..1
 * Folha de contatos (variedade): ?sheet=random&n=24&seed=7&football=0.2&lod=0 · ?sheet=football&lod=0 (um design por
 * pessoa, corpos alternados) · ?sheet=styles&body=homem (cada peça variante do corpo)
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HumanCharacter } from '../src/characters/human/HumanCharacter';
import { DEFAULT_PLAYER_APPEARANCE, randomAppearance, type BodyType, type CharacterAppearance } from '../src/characters/bodyTypes';
import { BODY_GARMENTS, GARMENT_SLOTS, SLOT_FIELD } from '../src/characters/garments';
import { shirtDesigns } from '../src/characters/human/garmentShader';
import type { Lod } from '../src/characters/human/HumanAssets';
import { ACTIONS, ACTION_BY_KEY } from '../src/social/actions';
import { PROPS, PROP_BY_KIND, type PropKind } from '../src/social/props';
import type { SocialState } from '../src/social/types';
import { specFor } from '../src/characters/human/proceduralClips';
import { CROWD_ACTION_FRAMES, CROWD_BODIES, CrowdRenderer } from '../src/characters/crowd/CrowdRenderer';
import { createAgent, type CrowdAgent } from '../src/characters/crowd/crowdBudget';
import { DESIGN_BY_KEY } from '../src/social/designs';
import { setPropWind } from '../src/social/props/propMaterials';

const q = new URLSearchParams(location.search);
import { HumanAnimator } from '../src/characters/human/HumanAnimator';
if (q.get('sprintmix')) HumanAnimator.sprintShare = Number(q.get('sprintmix'));
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
const grid = new THREE.GridHelper(10, 20, 0x333333, 0x666666); grid.position.y = 0.001; scene.add(grid);
const cam = new THREE.PerspectiveCamera(q.get('cam') === 'close' ? 22 : 35, innerWidth / innerHeight, 0.05, 100);
const mode = q.get('cam') ?? 'full';
if (mode === 'close') { cam.position.set(0.25, 1.62, 1.35); cam.lookAt(0, 1.55, 0); }
else if (mode === 'lods') { cam.position.set(0, 1.4, 7.5); cam.lookAt(0, 0.9, 0); }
else if (mode === 'wide') { cam.position.set(2.4, 1.9, 5.6); cam.lookAt(0, 1.45, 0); }
else if (mode === 'front') { cam.position.set(0.3, 1.5, 3.4); cam.lookAt(0, 1.2, 0); }
else if (mode === 'side') { cam.position.set(3.2, 0.9, 0); cam.lookAt(0, 0.85, 0); }
else if (mode === 'back') { cam.position.set(-1.0, 1.25, -3.6); cam.lookAt(0, 0.95, 0); }
else if (mode === 'hands') { cam.position.set(-0.6, 1.4, 1.2); cam.lookAt(-0.2, 1.2, 0.25); }
else if (mode === 'sheet') { cam.position.set(0, 1.2, 4.3); cam.lookAt(0, 1.05, 0); }
else if (mode === 'upper') { cam.position.set(0.35, 1.5, 2.3); cam.lookAt(0, 1.38, 0); }
else if (mode === 'torso') { cam.position.set(0.3, 1.5, 1.6); cam.lookAt(0, 1.32, 0); }
else if (mode === 'shoulder') { cam.position.set(-0.5, 1.55, 0.8); cam.lookAt(-0.17, 1.45, 0); }
else { cam.position.set(1.4, 1.25, 3.6); cam.lookAt(0, 0.9, 0); }

if (q.get('inflate')) HumanCharacter.shirtInflate = Number(q.get('inflate'));
if (q.get('nocull')) HumanCharacter.skinCull = false;
const body = (q.get('body') ?? 'homem') as BodyType;
const app = { ...DEFAULT_PLAYER_APPEARANCE[body], accessory: (q.get('acc') ?? 'nenhum') as never, acc: 0x2b4a7a };
if (q.get('top')) app.top = parseInt(q.get('top')!, 16);
if (q.get('skin')) app.skin = parseInt(q.get('skin')!, 16);
// variantes de peça e camisa com design: ?ts=regata&bs=bermuda&ss=chinelo&hs=afro&design=200
Object.assign(app, { topStyle: q.get('ts') ?? undefined, bottomStyle: q.get('bs') ?? undefined, shoeStyle: q.get('ss') ?? undefined, hairStyle: q.get('hs') ?? undefined, shirtDesign: Number(q.get('design') ?? 0) });
const chars: HumanCharacter[] = [];
const sheet = q.get('sheet');
if (sheet) {
  // folha de contatos: grade de personagens (variedade de avatares / camisas de futebol / peças de um corpo)
  const bodies: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];
  const seed = Number(q.get('seed') ?? 1);
  let apps: CharacterAppearance[] = [];
  if (sheet === 'football') {
    apps = shirtDesigns().filter((d) => d.family === 'football').flatMap((d, i) => [0, 1].map((k) => {
      const a = randomAppearance(seed * 97 + i * 13 + k, bodies[(i + k) % 2], { football: 0 });
      return { ...a, topStyle: 'camiseta' as const, shirtDesign: d.id, accessory: 'nenhum' as const };
    }));
  } else if (sheet === 'styles') {
    const b = body;
    apps.push({ ...app, accessory: 'nenhum' });
    for (const slot of GARMENT_SLOTS) for (const st of [...BODY_GARMENTS[b][slot].pieces, ...(BODY_GARMENTS[b][slot].bare ?? [])]) {
      apps.push({ ...app, accessory: 'nenhum', [SLOT_FIELD[slot]]: st });
    }
  } else {
    const n = Number(q.get('n') ?? 24);
    apps = Array.from({ length: n }, (_, i) => randomAppearance(seed * 1000 + i * 7919, bodies[i % 4], { football: Number(q.get('football') ?? 0.2) }));
  }
  const cols = Math.ceil(Math.sqrt(apps.length * 2.2));
  const rows = Math.ceil(apps.length / cols);
  apps.forEach((a, i) => {
    const h = new HumanCharacter(a, { lod: Number(q.get('lod') ?? 0) as Lod });
    const r = Math.floor(i / cols), c = i % cols;
    h.root.position.set((c - (cols - 1) / 2) * 0.78 + (r % 2) * 0.2, 0, -r * 1.1);
    h.root.rotation.y = Number(q.get('yaw') ?? 0.15);
    scene.add(h.root);
    chars.push(h);
  });
  const w = cols * 0.78;
  cam.fov = 30;
  cam.position.set(0, 1.3 + rows * 0.45, 0.8 + w * 0.95 + rows * 0.3);
  cam.lookAt(0, 0.55, -(rows - 1) * 0.55);
  cam.updateProjectionMatrix();
  sun.shadow.camera.left = sun.shadow.camera.bottom = -w;
  sun.shadow.camera.right = sun.shadow.camera.top = w;
  sun.shadow.camera.updateProjectionMatrix();
} else {
  const lods: Lod[] = mode === 'lods' ? [0, 1, 2, 3] : [Number(q.get('lod') ?? 0) as Lod];
  lods.forEach((l, i) => {
    const h = new HumanCharacter(app, { lod: l });
    h.root.position.x = mode === 'lods' ? (i - 1.5) * 1.1 : 0;
    h.root.rotation.y = Number(q.get('yaw') ?? 0.3);
    scene.add(h.root);
    chars.push(h);
  });
}
// design do item: ?design=brasil (chave ou id); vento: ?wind=0..1
const designQ = q.get('design');
const designId = designQ ? (DESIGN_BY_KEY.get(designQ)?.id ?? (Number(designQ) || 0)) : 0;
if (q.get('wind')) setPropWind(0.8, 0.6, Number(q.get('wind')));
let speed = Number(q.get('speed') ?? 0);
const pose = q.get('pose');
let t0 = performance.now();
await Promise.all(chars.map((c) => c.ready));
// LOD0/1 e peças avulsas chegam depois do LOD3 inicial
await new Promise((r) => setTimeout(r, sheet ? 2500 : 400));

/** item aproximado (só QA): cartaz/faixa entre as mãos, mastro passando pela mão direita */
const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xf1e7c8, roughness: 0.8 }));
proxy.castShadow = true;
proxy.visible = false;
scene.add(proxy);
let propKind: PropKind | null = null;
function updateProxy() {
  const c = chars[0];
  const def = propKind ? PROP_BY_KIND.get(propKind) : undefined;
  proxy.visible = !!def && q.get('proxy') === '1';
  if (!proxy.visible || !def) return;
  const hr = c.bones.get('hand_r')!.getWorldPosition(new THREE.Vector3());
  const hl = c.bones.get('hand_l')!.getWorldPosition(new THREE.Vector3());
  const mr = c.bones.get('middle_01_r')!.getWorldPosition(new THREE.Vector3());
  const ml = c.bones.get('middle_01_l')!.getWorldPosition(new THREE.Vector3());
  const [w, h, d] = def.size;
  if (def.designSlot === 'sign' || def.designSlot === 'banner') {
    // pegada nas bordas laterais (palmas: ponto médio entre punho e base dos dedos)
    const pr = hr.clone().lerp(mr, 0.6), pl = hl.clone().lerp(ml, 0.6);
    const across = pl.clone().sub(pr).normalize();
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(across, -across.y).normalize();
    const fwd = across.clone().cross(up);
    proxy.scale.set(w, h, d);
    proxy.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, fwd));
    // cartaz: pegada a 25 % da altura a partir de baixo · faixa: pelas pontas da borda de cima (pendurada)
    // carregando (sem ação): pegada no meio da altura, cartaz junto ao peito
    const lift = def.designSlot === 'banner' ? -h * 0.45 : chars[0].social.act ? h * 0.25 : 0;
    proxy.position.copy(pr).lerp(pl, 0.5).addScaledVector(up, lift);
  } else if (def.kind === 'drum') {
    // tambor na altura da cintura, abaixo das baquetas
    proxy.scale.set(w, h, d);
    proxy.quaternion.copy(c.root.quaternion);
    proxy.position.copy(hr).lerp(hl, 0.5).add(new THREE.Vector3(0, -0.2, 0));
  } else if (def.kind === 'megaphone' || def.kind === 'whistle') {
    proxy.visible = false;
  } else {
    // mastro (bandeira, guarda-chuva, taco…) pela mão direita; com as duas mãos, alinhado à esquerda
    const pr = hr.clone().lerp(mr, 0.6), pl = hl.clone().lerp(ml, 0.6);
    const two = def.grip === 'two_hand' || (def.designSlot === 'flag' && actT !== null && !!chars[0].social.act);
    const dir = two && pl.distanceTo(pr) > 0.15 ? pr.clone().sub(pl).normalize() : new THREE.Vector3(0, 1, 0);
    if (dir.y < 0) dir.negate();
    const len = def.kind === 'bat' ? 0.85 : def.designSlot === 'flag' ? def.size[1] + 0.3 : 0.8;
    proxy.scale.set(0.03, len, 0.03);
    proxy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), def.kind === 'bat' ? dir.clone().negate() : dir);
    proxy.position.copy(pr).addScaledVector(def.kind === 'bat' ? dir.clone().negate() : dir, len * (def.kind === 'bat' ? 0.4 : 0.35));
  }
}

let actT: number | null = null;
/** estado social pendente: aplicado no próximo quadro, depois de assentar a locomoção */
let pending: SocialState | null = null;
/** ação social de QA: chave da ação, tipo de item, instante e variação */
function setAct(act: string | null, prop: string | null, t: number | null, variation = 0) {
  const def = act ? ACTION_BY_KEY.get(act) : undefined;
  propKind = (prop as PropKind) || null;
  const p = propKind ? PROP_BY_KIND.get(propKind) : undefined;
  actT = t;
  pending = { act: def?.id ?? 0, phase: t ?? 0, variation, prop: p?.id ?? 0, design: p ? designId : 0 };
}
setAct(q.get('act'), q.get('prop'), q.get('t') !== null && (q.get('act') || q.get('prop')) ? Number(q.get('t')) : null, Number(q.get('var') ?? 0));

const freezeLoco = q.get('t') ? Number(q.get('t')) : null;
(window as any).__human = {
  chars,
  actions: ACTIONS.map((a) => ({ key: a.key, label: a.label, mode: a.mode, duration: a.duration ?? specFor(a.clip)?.dur ?? 2, needs: a.needs, layer: a.layer })),
  props: PROPS.map((p) => p.kind),
  /** gira o personagem (frente/costas na folha de contato) */
  yaw: (y: number) => { for (const c of chars) c.root.rotation.y = y; },
  info: () => chars.map((c) => ({ cull: HumanCharacter.lastSkinCull, lod: c.lod, natural: c.animator?.naturalSpeeds, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, social: c.animator?.socialDebug })),
  /** troca a ação sem recarregar a página (folha de contato) */
  setAct: (act: string | null, prop: string | null, t: number | null, variation = 0, sp = 0) => { speed = sp; setAct(act, prop, t, variation); },
  /** pé mais baixo / pelve acima do chão (m) */
  ground: () => chars.map((c) => {
    const y = (n: string) => c.bones.get(n)!.getWorldPosition(new THREE.Vector3()).y;
    return { foot: Math.min(y('ball_l'), y('ball_r'), y('foot_l'), y('foot_r')), pelvis: y('pelvis'), handR: y('hand_r'), head: y('head') };
  }),
};
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - t0) / 1000);
  t0 = now;
  for (const c of chars) {
    if (pose && !c.userData) { c.animator?.setShow(pose as never); (c as any).userData = 1; }
    const a = c.animator;
    if (!a) continue;
    if (pending) {
      // limpa a ação anterior, assenta os pesos da locomoção e só então liga a nova (instante exato)
      c.setSocial({ act: 0, phase: 0, variation: 0, prop: 0, design: 0 });
      for (let k = 0; k < 120; k++) a.update(speed, true, 1 / 60);
      c.setSocial(pending);
    }
    if (actT !== null || freezeLoco !== null) {
      if (!pending && actT === null) for (let k = 0; k < 120; k++) a.update(speed, true, 1 / 60);
      a.mixer.setTime(freezeLoco ?? 0);
      if (actT !== null) a.seekSocial(actT);
      a.update(speed, true, 0);
    } else a.update(speed, true, dt);
    c.updateProps(dt);
  }
  pending = null;
  updateProxy();
  crowd?.draw(crowdAgents, dt);
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}

/**
 * &crowd=2|3: multidão instanciada (VAT) atrás do personagem — uma coluna por clipe de ação assado
 * (CROWD_ACTION_FRAMES), uma linha por corpo; conferir os clipes de longe e a memória das texturas
 */
let crowd: CrowdRenderer | null = null;
const crowdAgents: CrowdAgent[] = [];
if (q.get('crowd')) {
  const lod = Number(q.get('crowd')) as 2 | 3;
  crowd = new CrowdRenderer(64, lod === 2);
  await crowd.init();
  scene.add(crowd.group);
  const acts = [0, ...Object.keys(CROWD_ACTION_FRAMES).map((n) => ACTIONS.find((a) => a.crowdClip === n)?.id ?? 0)];
  acts.forEach((act, col) => CROWD_BODIES.forEach((_, body) => crowdAgents.push(createAgent({
    x: (col - (acts.length - 1) / 2) * 0.9, z: -2 - body * 1.2, body, lod, act, actAt: performance.now() / 1000, heading: 0,
  }))));
  chars.forEach((c) => { c.root.visible = false; });
  cam.position.set(0, 3.2, 7.5); cam.lookAt(0, 0.6, -3.5);
  (window as any).__crowd = { stats: crowd.stats, acts };
}
frame();
(window as any).__humanReady = true;
