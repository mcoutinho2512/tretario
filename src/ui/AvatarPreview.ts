/**
 * Prévia 3D do avatar na tela inicial: o MESMO personagem esqueletal do jogo (src/characters),
 * com estúdio de luz próprio, arrastar para girar e poses (parado, andando, acenando, dançando).
 * Carregado sob demanda (chunk com three.js, compartilhado com o jogo) e descartado ao entrar no jogo.
 */
import * as THREE from 'three';
import { createCharacter, type CharacterRig } from '../characters/CharacterMesh';
import { CharacterAnimator } from '../characters/CharacterAnimator';
import { BODY_TYPES, type CharacterAppearance } from '../characters/bodyTypes';

export type PreviewPose = 'parado' | 'andando' | 'acenando' | 'dancando';

export class AvatarPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private holder = new THREE.Group();
  private rig: CharacterRig | null = null;
  private anim: CharacterAnimator | null = null;
  private rigKey = '';
  private hipsX = 0;
  private yaw = -0.35;
  private yawTarget = -0.35;
  private yawVel = 0;
  private drag: { x: number; t: number } | null = null;
  private pose: PreviewPose = 'parado';
  private poseT = 0;
  private raf = 0;
  private last = performance.now();
  private ro: ResizeObserver;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, app: CharacterAppearance) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // estúdio: céu/chão suaves, luz principal com sombra, contraluz quente
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.1));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.6);
    key.position.set(2.2, 4.2, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.5, far: 12 });
    key.shadow.radius = 4;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc27a, 1.6);
    rim.position.set(-2.5, 2.4, -2.8);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
    fill.position.set(-3, 1.2, 2);
    this.scene.add(fill);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: 0.32 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground, this.holder);

    this.setAppearance(app);

    // arrastar para girar (mouse e toque), com inércia
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, t: performance.now() }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, now = performance.now();
      const d = dx * 0.012;
      this.yawTarget += d;
      this.yawVel = d / Math.max(1, now - this.drag.t) * 16;
      this.drag = { x: e.clientX, t: now };
    });
    const up = () => { this.drag = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.loop();
  }

  /** cores mudam no lugar; tipo de corpo ou acessório recriam a malha */
  setAppearance(app: CharacterAppearance) {
    const key = `${app.body}:${app.accessory ?? 'nenhum'}`;
    if (this.rig && key === this.rigKey) { this.rig.setAppearance(app); return; }
    if (this.rig) { this.holder.remove(this.rig.mesh); this.rig.dispose(); }
    this.rig = createCharacter(app);
    this.anim = new CharacterAnimator(this.rig, 1.4, 4);
    this.rigKey = key;
    this.hipsX = this.rig.bones.Hips.position.x;
    this.holder.add(this.rig.mesh);
  }

  setPose(p: PreviewPose) { this.pose = p; this.poseT = 0; }
  rotate(by: number) { this.yawTarget += by; this.yawVel = 0; }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // enquadra o corpo inteiro tanto em retrato (celular) quanto em paisagem
    // (corpo ~57 % da altura útil, pés acima da barra de poses)
    const fit = Math.max(1, 0.62 / this.camera.aspect);
    this.camera.position.set(0, 1.05, 6.2 * fit);
    this.camera.lookAt(0, 0.8, 0);
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.drag) { this.yawTarget += this.yawVel; this.yawVel *= Math.exp(-dt * 4); }
    this.yaw += (this.yawTarget - this.yaw) * (1 - Math.exp(-dt * 12));
    this.holder.rotation.y = this.yaw;
    this.animate(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private animate(dt: number) {
    const rig = this.rig, anim = this.anim;
    if (!rig || !anim) return;
    this.poseT += dt;
    const t = this.poseT, b = rig.bones;
    const old = BODY_TYPES[rig.body].posture > 0.3;
    // pose de repouso = rotações zero (como no updateRiding); as poses extras mexem em eixos que o animador não zera
    for (const bone of Object.values(b)) bone.rotation.set(0, 0, 0);
    b.Hips.position.x = this.hipsX;
    if (this.pose === 'andando') { anim.update(1.4 * BODY_TYPES[rig.body].speedFactor, true, dt); return; }
    anim.update(0, true, dt);
    if (this.pose === 'acenando') {
      // braço direito levantado ao lado da cabeça, antebraço balançando
      const ramp = Math.min(1, t * 3);
      b.RightUpperArm.rotation.z = -2.45 * ramp;
      b.RightUpperArm.rotation.x = -0.25 * ramp;
      b.RightLowerArm.rotation.x = 0;
      b.RightLowerArm.rotation.z = (-0.35 + Math.sin(t * 9) * 0.45) * ramp;
      b.Head.rotation.z = Math.sin(t * 1.5) * 0.05;
      b.Chest.rotation.z = 0.06 * ramp;
    } else if (this.pose === 'dancando') {
      // passo lateral no ritmo (~110 bpm), quadril e braços em oposição; idosos dançam mais contidos
      const k = old ? 0.55 : 1;
      const beat = t * Math.PI * 1.85;
      const s = Math.sin(beat), c = Math.cos(beat * 2);
      b.Hips.position.x = this.hipsX + s * 0.06 * k;
      b.Hips.position.y += -Math.abs(c) * 0.035 * k;
      b.Hips.rotation.z = s * 0.1 * k;
      b.Hips.rotation.y = Math.sin(beat * 0.5) * 0.25 * k;
      b.Spine.rotation.z = -s * 0.14 * k;
      b.Chest.rotation.y = -Math.sin(beat * 0.5) * 0.2 * k;
      b.LeftUpperLeg.rotation.x = -Math.max(0, s) * 0.35 * k;
      b.LeftLowerLeg.rotation.x = Math.max(0, s) * 0.55 * k + 0.05;
      b.RightUpperLeg.rotation.x = -Math.max(0, -s) * 0.35 * k;
      b.RightLowerLeg.rotation.x = Math.max(0, -s) * 0.55 * k + 0.05;
      b.LeftUpperArm.rotation.z = (0.55 + s * 0.35) * k;
      b.LeftUpperArm.rotation.x = -0.6 * k;
      b.LeftLowerArm.rotation.x = -1.3 * k;
      b.RightUpperArm.rotation.z = (-0.55 + s * 0.35) * k;
      b.RightUpperArm.rotation.x = -0.6 * k;
      b.RightLowerArm.rotation.x = -1.3 * k;
      b.Head.rotation.z = s * 0.08 * k;
    }
  }

  /** retratos (cabeça e ombros) de cada aparência, como data URLs; um único contexto WebGL pequeno e reutilizado */
  private shots: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera } | null = null;
  portraits(apps: CharacterAppearance[], size = 192): string[] {
    if (!this.shots) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(size, size, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.3));
      const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
      key.position.set(1.5, 2.5, 3);
      const rim = new THREE.DirectionalLight(0xffc27a, 1.4);
      rim.position.set(-2, 2, -2);
      scene.add(key, rim);
      this.shots = { r, scene, cam: new THREE.PerspectiveCamera(24, 1, 0.1, 20) };
    }
    const { r, scene, cam } = this.shots;
    return apps.map((app) => {
      const rig = createCharacter(app);
      new CharacterAnimator(rig).update(0, true, 0.016);
      rig.mesh.rotation.y = -0.25;
      scene.add(rig.mesh);
      rig.mesh.updateMatrixWorld(true);
      const head = rig.bones.Head.getWorldPosition(new THREE.Vector3());
      cam.position.set(head.x + 0.12, head.y - 0.02, head.z + 1.55);
      cam.lookAt(head.x, head.y - 0.14, head.z);
      r.render(scene, cam);
      const url = r.domElement.toDataURL('image/png');
      scene.remove(rig.mesh);
      rig.dispose();
      return url;
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.rig?.dispose();
    if (this.shots) { this.shots.r.dispose(); this.shots.r.forceContextLoss(); this.shots = null; }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
