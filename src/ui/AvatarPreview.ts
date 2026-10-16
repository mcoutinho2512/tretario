/**
 * Prévia 3D do avatar na tela inicial: o MESMO personagem humano do jogo (src/characters/human), LOD0,
 * com estúdio de luz próprio, arrastar para girar e poses (parado, andando, acenando, dançando).
 * Carregado sob demanda (chunk com three.js, compartilhado com o jogo) e descartado ao entrar no jogo.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BodyType, CharacterAppearance } from '../characters/bodyTypes';
import { HumanCharacter } from '../characters/human/HumanCharacter';
import type { ShowPose } from '../characters/human/HumanAnimator';

export type PreviewPose = ShowPose;

function studio(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadow: boolean) {
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pm.dispose();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 0.7));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
  key.position.set(2.2, 4.2, 3.2);
  if (shadow) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.5, far: 12 });
    key.shadow.radius = 4;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  const rim = new THREE.DirectionalLight(0xffc27a, 1.8);
  rim.position.set(-2.5, 2.4, -2.8);
  scene.add(key, rim);
}

export class AvatarPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private holder = new THREE.Group();
  private human: HumanCharacter | null = null;
  private yaw = -0.35;
  private yawTarget = -0.35;
  private yawVel = 0;
  private drag: { x: number; t: number } | null = null;
  private pose: PreviewPose = 'parado';
  private raf = 0;
  private last = performance.now();
  private ro: ResizeObserver;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, app: CharacterAppearance) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    studio(this.scene, this.renderer, true);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
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

  /** pronto quando o personagem atual terminou de carregar */
  get ready(): Promise<void> { return this.human?.ready ?? Promise.resolve(); }

  /** cores e acessório mudam no lugar; tipo de corpo troca o personagem */
  setAppearance(app: CharacterAppearance) {
    if (this.human && this.human.body === app.body) { this.human.setAppearance(app); return; }
    this.human?.dispose();
    this.human = new HumanCharacter(app, { lod: 0, castShadow: true });
    this.holder.add(this.human.root);
    const h = this.human;
    void h.ready.then(() => { if (h === this.human) h.animator?.setShow(this.pose); });
  }

  setPose(p: PreviewPose) { this.pose = p; this.human?.animator?.setShow(p); }
  rotate(by: number) { this.yawTarget += by; this.yawVel = 0; }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // enquadra o corpo inteiro tanto em retrato (celular) quanto em paisagem (pés acima da barra de poses)
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
    this.human?.animator?.update(0, true, dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** retratos (cabeça e ombros) de cada aparência, como data URLs; contexto WebGL pequeno e reutilizado */
  private shots: { r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; chars: Map<BodyType, HumanCharacter> } | null = null;
  async portraits(apps: CharacterAppearance[], size = 192): Promise<string[]> {
    if (!this.shots) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setSize(size, size, false);
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      studio(scene, r, false);
      this.shots = { r, scene, cam: new THREE.PerspectiveCamera(22, 1, 0.05, 20), chars: new Map() };
    }
    const { r, scene, cam, chars } = this.shots;
    const out: string[] = [];
    for (const app of apps) {
      let c = chars.get(app.body);
      if (!c) {
        c = new HumanCharacter(app, { lod: 0, castShadow: false, clips: ['idle'] });
        chars.set(app.body, c);
      }
      await c.ready;
      // o LOD0 chega depois do LOD3 provisório: espera o detalhado para o retrato
      for (let i = 0; i < 100 && !c.hasLod(0); i++) await new Promise((r) => setTimeout(r, 50));
      if (this.disposed || !this.shots) return [];
      c.setAppearance(app);
      for (const o of chars.values()) o.root.visible = o === c;
      if (!c.root.parent) scene.add(c.root);
      c.root.rotation.y = -0.25;
      c.animator?.update(0, true, 0.016);
      c.root.updateMatrixWorld(true);
      const head = c.bones.get('head')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 1.6, 0);
      cam.position.set(head.x + 0.12, head.y + 0.02, head.z + 1.5);
      cam.lookAt(head.x, head.y - 0.08, head.z);
      r.render(scene, cam);
      out.push(r.domElement.toDataURL('image/png'));
    }
    return out;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.human?.dispose();
    if (this.shots) {
      this.shots.chars.forEach((c) => c.dispose());
      this.shots.r.dispose();
      this.shots.r.forceContextLoss();
      this.shots = null;
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
