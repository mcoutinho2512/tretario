/** Página de desenvolvimento: queda (ragdoll Rapier) do personagem humano via AvatarVisual. /dev/knock.html?t=1.2 */
import * as THREE from 'three';
import { AvatarVisual } from '../src/player/AvatarVisual';
import { createPlayerState } from '../src/player/PlayerState';
import { preloadRagdoll } from '../src/physics/Ragdoll';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8796a4);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(3, 6, 4);
sun.castShadow = true;
scene.add(sun, new THREE.HemisphereLight(0xcfe0ff, 0x4a4036, 1.0));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x9a9a96 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 100);
cam.position.set(2.6, 1.6, 2.6);
cam.lookAt(0, 0.5, -0.6);
const av = new AvatarVisual(undefined, { lod: 0 });
scene.add(av.root);
const st = createPlayerState('t', 0, 0, 0, 0);
await preloadRagdoll();
await new Promise((r) => setTimeout(r, 2500));
for (let i = 0; i < 30; i++) av.update(st, 1 / 60);
// rodada 10: &dir=back|front|side (empurrado para trás → cai de costas; para a frente → de bruços) e &tl=1 (passos
// fixos chamados pelo QA: __knock.step(dt, n) devolve a altura mínima/máxima de pés e cabeça para medir "pernas para o ar")
const dirQ = q.get('dir') ?? 'back';
const kd = dirQ === 'front' ? [0, 1] : dirQ === 'side' ? [1, 0] : [0, -1];
if (q.get('cam') === 'side') { cam.position.set(7, 2.0, 0); cam.lookAt(0, 0.35, 0); }
if (q.get('tl') === '1') {
  const h = (av as any).human;
  const y = (n: string) => h.bones.get(n).getWorldPosition(new THREE.Vector3()).y;
  (window as any).__knock = { av,
    knock: () => av.knockdown({ dirX: kd[0], dirZ: kd[1], strength: 1.4, groundY: 0, walls: [], downMs: 2600, getupMs: 1400 }),
    step: (dt: number, n = 1) => {
      let feetMax = -1, headMin = 9, pelvisMax = -1;
      for (let k = 0; k < n; k++) {
        av.update(st, dt);
        feetMax = Math.max(feetMax, y('foot_l'), y('foot_r'));
        headMin = Math.min(headMin, y('head'));
        pelvisMax = Math.max(pelvisMax, y('pelvis'));
      }
      renderer.render(scene, cam);
      return { feetMax: +feetMax.toFixed(3), headMin: +headMin.toFixed(3), pelvisMax: +pelvisMax.toFixed(3), down: av.isDown, yaw: +av.root.rotation.y.toFixed(3) };
    },
  };
  (window as any).__humanReady = true;
  const loop = () => { renderer.render(scene, cam); requestAnimationFrame(loop); };
  loop();
} else {
void av.knockdown({ dirX: kd[0], dirZ: kd[1], strength: 1.4, groundY: 0, walls: [], downMs: 2600, getupMs: 1400 });
await new Promise((r) => setTimeout(r, 100));
const until = Number(q.get('t') ?? 1.2);
for (let t = 0; t < until; t += 1 / 60) av.update(st, 1 / 60);
renderer.render(scene, cam);
(window as any).__humanReady = true;
(window as any).__human = { info: () => { const h = (av as any).human; const a = h.animator; return { isDown: av.isDown, w: a.w, pelvis: h.bones.get('pelvis').quaternion.toArray().map((v: number) => +v.toFixed(2)), ua: h.bones.get('upperarm_l').quaternion.toArray().map((v: number) => +v.toFixed(2)), sp1: h.bones.get('spine_01').quaternion.toArray().map((v: number) => +v.toFixed(2)), pelvisPos: h.bones.get('pelvis').position.toArray().map((v: number) => +v.toFixed(2)), armRot: h.armature.rotation.x, rootRot: h.bones.get('Root').quaternion.toArray() }; } };
}
