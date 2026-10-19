/**
 * Rodada 11 — PRÉVIA 3D REUTILIZÁVEL do avatar (editor de personagem e inventário; contrato `AvatarPreviewHandle` em
 * src/inventory/types.ts). Ver docs/INVENTORY.md "Prévia 3D" e docs/CHARACTERS.md.
 *
 * Arquitetura (custo medido em docs/bench/round11_preview.json):
 *  - UM WebGLRenderer de prévia por página (singleton com contagem de uso): o canvas é MOVIDO para o contêiner do
 *    handle ativo; cena de estúdio (luzes, ambiente, chão de sombra) é única e compartilhada por todos os handles.
 *  - Cada handle tem só o seu personagem (HumanCharacter LOD0, mesmo do jogo) e o seu estado de câmera; as malhas,
 *    texturas e clipes vêm do cache de HumanAssets (compartilhado com o jogo) e NUNCA são descartados aqui —
 *    `dispose()` libera só materiais/esqueletos próprios do personagem (HumanCharacter.dispose) e os ouvintes.
 *  - Sem handles, o renderer fica ocioso por PREVIEW_IDLE_MS (abrir/fechar o editor não recria contexto) e então é
 *    descartado com forceContextLoss; `disposeSharedPreview()` libera na hora (ao entrar no jogo).
 *  - Contexto perdido (Safari em segundo plano, GPU reiniciada, limite de contextos): o renderer é recriado com um
 *    canvas novo na próxima oportunidade e o personagem ativo volta a ser desenhado (os dados estão na CPU/cache).
 *  - Por que não desenhar no renderer do jogo: na tela inicial ele não existe; no jogo, levar a prévia ao DOM exigiria
 *    copiar pixels a cada quadro (render target + readPixels, medido em `benchReadback`) ou recortar o canvas do jogo
 *    por baixo do editor (acoplado ao pós-processamento). O 2º contexto custa a criação (uma vez por sessão do editor)
 *    e a reenvio das texturas do personagem — medido e documentado.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterAppearance } from '../../characters/bodyTypes';
import { HumanCharacter } from '../../characters/human/HumanCharacter';
import type { ShowPose } from '../../characters/human/HumanAnimator';
import { validateAppearance } from '../../characters/validateAppearance';
import type { AvatarPreviewHandle } from '../../inventory/types';
import { memoryReport } from '../../debug/memoryReport';

export type PreviewPose = ShowPose;
/** tempo ocioso (sem handles) antes de descartar o renderer da prévia */
export const PREVIEW_IDLE_MS = 15_000;
/** ângulo de repouso: três quartos de frente; costas = +π */
const FRONT_YAW = -0.35;

/** prévia: mostra itens bloqueados também ("experimentar"); quem decide o que é salvo é o validador com os direitos */
const PREVIEW_ENT = { items: { has: () => true } as unknown as ReadonlySet<string> };

export interface PreviewInfo {
  /** renderers de prévia criados desde o carregamento da página (perda de contexto recria) */
  renderersCreated: number;
  /** renderer vivo agora (0/1) */
  renderersLive: number;
  contextsLost: number;
  handlesLive: number;
  handlesCreated: number;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  triangles: number;
}

export interface SharedPreviewHandle extends AvatarPreviewHandle {
  /** personagem atual carregado (LOD0 visível) */
  readonly ready: Promise<void>;
  setPose(p: PreviewPose): void;
  /** gira (rad, acumulativo) */
  rotate(by: number): void;
  /** aproxima (+)/afasta (−); `to` fixa (0 corpo inteiro … 1 rosto) */
  zoom(by: number, to?: number): void;
  readonly zoomLevel: number;
  /** retratos (cabeça e ombros) como data URLs — mesmo renderer (tools/qa/make_portraits.mjs) */
  portraits(apps: CharacterAppearance[], size?: number): Promise<string[]>;
  info(): PreviewInfo;
}

// ------------------------------------------------------------------ núcleo compartilhado (um por página)
interface Core {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  own: { dispose(): void }[];
  raf: number;
  last: number;
  lost: boolean;
}
let core: Core | null = null;
const handles: Handle[] = [];
let idleTimer = 0;
const stats = { renderersCreated: 0, contextsLost: 0, handlesCreated: 0 };

function studio(c: Core) {
  const pm = new THREE.PMREMGenerator(c.renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  c.scene.environment = env;
  c.scene.environmentIntensity = 0.45;
  c.own.push(env);
  c.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 0.7));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
  key.position.set(2.2, 4.2, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.5, far: 12 });
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  c.own.push({ dispose: () => key.shadow.dispose() });
  const rim = new THREE.DirectionalLight(0xffc27a, 1.8);
  rim.position.set(-2.5, 2.4, -2.8);
  const groundGeo = new THREE.CircleGeometry(1.6, 48), groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'pv-preview-ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  c.own.push(groundGeo, groundMat);
  c.scene.add(key, rim, ground);
}

function makeCore(): Core {
  const canvas = document.createElement('canvas');
  canvas.className = 'pv-preview-canvas';
  canvas.setAttribute('aria-label', 'Personagem em 3D — arraste para girar, role para aproximar');
  canvas.tabIndex = -1;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const c: Core = { renderer, canvas, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(28, 1, 0.1, 50), own: [], raf: 0, last: performance.now(), lost: false };
  studio(c);
  stats.renderersCreated++;
  // contexto perdido: descarta este núcleo e recria (canvas novo) — não confia na restauração parcial do three.js
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (core !== c || c.lost) return;
    c.lost = true;
    stats.contextsLost++;
    teardown(c, false);
    core = null;
    window.setTimeout(() => { if (!core && handles.length) mountActive(); }, 250);
  });
  return c;
}

function teardown(c: Core, loseContext: boolean) {
  cancelAnimationFrame(c.raf);
  c.raf = 0;
  for (const h of handles) h.holder.removeFromParent();
  c.own.forEach((o) => o.dispose());
  c.own = [];
  c.renderer.dispose();
  if (loseContext && !c.lost) c.renderer.forceContextLoss();
  c.canvas.remove();
}

/** núcleo vivo (cria/recria sob demanda) */
function acquire(): Core {
  clearTimeout(idleTimer);
  idleTimer = 0;
  if (!core || core.lost) core = makeCore();
  return core;
}

/** libera o renderer da prévia AGORA (ex.: ao entrar no jogo); handles vivos o recriam se voltarem a desenhar */
export function disposeSharedPreview() {
  clearTimeout(idleTimer);
  idleTimer = 0;
  if (core) { teardown(core, true); core = null; }
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => { if (!handles.length) disposeSharedPreview(); }, PREVIEW_IDLE_MS);
}

const active = () => handles[handles.length - 1] ?? null;

/** põe o canvas e o personagem do handle do topo no lugar e liga o laço */
function mountActive() {
  const h = active();
  if (!h) return;
  const c = acquire();
  if (c.canvas.parentElement !== h.container) h.container.appendChild(c.canvas);
  for (const o of handles) if (o !== h) o.holder.removeFromParent();
  if (h.holder.parent !== c.scene) c.scene.add(h.holder);
  h.resize();
  if (!c.raf) { c.last = performance.now(); c.raf = requestAnimationFrame(loop); }
}

function loop() {
  const c = core;
  if (!c) return;
  const h = active();
  if (!h) { c.raf = 0; return; }
  c.raf = requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - c.last) / 1000);
  c.last = now;
  if (document.hidden || !h.container.isConnected || !h.container.clientWidth) return;
  h.step(dt);
  c.renderer.render(c.scene, c.camera);
}

// ------------------------------------------------------------------ handle (um por tela que mostra a prévia)
class Handle implements SharedPreviewHandle {
  readonly holder = new THREE.Group();
  private human: HumanCharacter | null = null;
  private app: CharacterAppearance | null = null;
  private yaw = FRONT_YAW;
  private yawTarget = FRONT_YAW;
  private yawVel = 0;
  private drag: { x: number; t: number } | null = null;
  private pose: PreviewPose = 'parado';
  private zoomT = 0;
  private zoomCur = 0;
  private fit = 1;
  private pts = new Map<number, [number, number]>();
  private pinchD = 0;
  private ac = new AbortController();
  private ro: ResizeObserver;
  private disposed = false;
  private tmp = new THREE.Vector3();

  constructor(readonly container: HTMLElement) {
    stats.handlesCreated++;
    this.holder.name = 'pv-preview-holder';
    const sig = { signal: this.ac.signal };
    container.style.touchAction = 'pan-y';
    container.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.drag = { x: e.clientX, t: performance.now() };
      this.pts.set(e.pointerId, [e.clientX, e.clientY]);
      try { container.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
      container.classList.add('dragging');
    }, sig);
    container.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(-e.deltaY * 0.0015); }, { ...sig, passive: false });
    container.addEventListener('pointermove', (e) => {
      if (this.pts.has(e.pointerId)) this.pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pts.size >= 2) {
        const [a, b] = [...this.pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (this.pinchD) this.zoom((d - this.pinchD) * 0.004);
        this.pinchD = d;
        return;
      }
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, now = performance.now();
      const d = dx * 0.012;
      this.yawTarget += d;
      this.yawVel = d / Math.max(1, now - this.drag.t) * 16;
      this.drag = { x: e.clientX, t: now };
    }, sig);
    const up = (e: PointerEvent) => { this.drag = null; this.pts.delete(e.pointerId); this.pinchD = 0; container.classList.remove('dragging'); };
    container.addEventListener('pointerup', up, sig);
    container.addEventListener('pointercancel', up, sig);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    handles.push(this);
    mountActive();
  }

  get ready(): Promise<void> {
    const h = this.human;
    if (!h) return Promise.resolve();
    return h.ready.then(async () => { for (let i = 0; i < 100 && !this.disposed && h === this.human && !h.hasLod(0); i++) await new Promise((r) => setTimeout(r, 50)); });
  }

  show(raw: unknown) {
    if (this.disposed) return;
    const app = validateAppearance(raw, this.app, PREVIEW_ENT);
    if (!app) return;
    this.app = app;
    if (this.human && this.human.body === app.body) this.human.setAppearance(app);
    else {
      this.human?.dispose();
      const h = (this.human = new HumanCharacter(app, { lod: 0, castShadow: true, warmup: false }));
      this.holder.add(h.root);
      void h.ready.then(() => { if (h === this.human) h.animator?.setShow(this.pose); });
    }
    if (active() !== this) { handles.splice(handles.indexOf(this), 1); handles.push(this); }
    mountActive();
  }

  view(side: 'front' | 'back') {
    const base = side === 'back' ? FRONT_YAW + Math.PI : FRONT_YAW;
    // o caminho mais curto até o lado pedido (o ângulo acumula com o arrasto)
    const turns = Math.round((this.yawTarget - base) / (2 * Math.PI));
    this.yawTarget = base + turns * 2 * Math.PI;
    this.yawVel = 0;
  }
  setPose(p: PreviewPose) { this.pose = p; this.human?.animator?.setShow(p); }
  rotate(by: number) { this.yawTarget += by; this.yawVel = 0; }
  zoom(by: number, to?: number) { this.zoomT = Math.max(0, Math.min(1, to ?? this.zoomT + by)); }
  get zoomLevel() { return this.zoomT; }
  get yawNow() { return this.yaw; }

  resize() {
    const c = core;
    if (!c || active() !== this) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    c.renderer.setSize(w, h, false);
    c.canvas.style.width = '100%';
    c.canvas.style.height = '100%';
    c.camera.aspect = w / h;
    this.fit = Math.max(1, 0.62 / c.camera.aspect);
    this.placeCamera(c.camera);
    c.camera.updateProjectionMatrix();
  }

  private placeCamera(cam: THREE.PerspectiveCamera) {
    const k = this.zoomCur;
    const headY = (this.human?.bones.get('head')?.getWorldPosition(this.tmp).y ?? 1.55) + 0.02;
    const e = k * k * (3 - 2 * k);
    const fullZ = 5.6 * this.fit, faceZ = 2.4 * Math.min(1.3, this.fit);
    cam.position.set(0, 1.05 + (headY - 0.1 - 1.05) * e, fullZ + (faceZ - fullZ) * e);
    cam.lookAt(0, 0.8 + (headY - 0.22 - 0.8) * e, 0);
  }

  step(dt: number) {
    if (!this.drag) { this.yawTarget += this.yawVel; this.yawVel *= Math.exp(-dt * 4); }
    this.yaw += (this.yawTarget - this.yaw) * (1 - Math.exp(-dt * 12));
    this.holder.rotation.y = this.yaw;
    this.zoomCur += (this.zoomT - this.zoomCur) * (1 - Math.exp(-dt * 10));
    if (core) this.placeCamera(core.camera);
    this.human?.animator?.update(0, true, dt);
  }

  async portraits(apps: CharacterAppearance[], size = 192): Promise<string[]> {
    const c = acquire();
    const scene = new THREE.Scene();
    scene.environment = c.scene.environment;
    scene.environmentIntensity = 0.45;
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6); key.position.set(2.2, 4.2, 3.2);
    const rim = new THREE.DirectionalLight(0xffc27a, 1.8); rim.position.set(-2.5, 2.4, -2.8);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 0.7), key, rim);
    const cam = new THREE.PerspectiveCamera(22, 1, 0.05, 20);
    const rt = new THREE.WebGLRenderTarget(size, size, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
    const px = new Uint8Array(size * size * 4);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    const out: string[] = [];
    const chars: HumanCharacter[] = [];
    try {
      for (const app of apps) {
        const ch = new HumanCharacter(app, { lod: 0, castShadow: false, clips: ['idle'], warmup: false });
        chars.push(ch);
        await ch.ready;
        for (let i = 0; i < 100 && !ch.hasLod(0); i++) await new Promise((r) => setTimeout(r, 50));
        if (core !== c) return [];
        scene.add(ch.root);
        ch.root.rotation.y = -0.25;
        ch.animator?.update(0, true, 0.016);
        ch.root.updateMatrixWorld(true);
        const head = ch.bones.get('head')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 1.6, 0);
        cam.position.set(head.x + 0.12, head.y + 0.02, head.z + 1.5);
        cam.lookAt(head.x, head.y - 0.08, head.z);
        c.renderer.setRenderTarget(rt);
        c.renderer.setClearColor(0x000000, 0);
        c.renderer.clear();
        c.renderer.render(scene, cam);
        c.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
        c.renderer.setRenderTarget(null);
        const img = ctx.createImageData(size, size);
        // o render target tem a origem embaixo: vira as linhas
        for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
        ctx.putImageData(img, 0, 0);
        out.push(cv.toDataURL('image/png'));
        ch.root.removeFromParent();
      }
    } finally {
      chars.forEach((ch) => ch.dispose());
      rt.dispose();
      key.dispose(); rim.dispose();
    }
    return out;
  }

  info(): PreviewInfo { return previewInfo(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ac.abort();
    this.ro.disconnect();
    this.human?.dispose();
    this.human = null;
    this.holder.removeFromParent();
    const i = handles.indexOf(this);
    if (i >= 0) handles.splice(i, 1);
    if (core && core.canvas.parentElement === this.container) core.canvas.remove();
    this.container.classList.remove('dragging');
    if (handles.length) mountActive();
    else { if (core) { cancelAnimationFrame(core.raf); core.raf = 0; } scheduleIdle(); }
  }
}

/** cria a prévia dentro de `container` (posição relativa/absoluta; o canvas ocupa 100%). Contrato da rodada 11. */
export function createSharedPreview(container: HTMLElement): SharedPreviewHandle {
  return new Handle(container);
}

export function previewInfo(): PreviewInfo {
  const i = core?.renderer.info;
  return {
    renderersCreated: stats.renderersCreated, renderersLive: core ? 1 : 0, contextsLost: stats.contextsLost,
    handlesLive: handles.length, handlesCreated: stats.handlesCreated,
    geometries: i?.memory.geometries ?? 0, textures: i?.memory.textures ?? 0, programs: i?.programs?.length ?? 0,
    calls: i?.render.calls ?? 0, triangles: i?.render.triangles ?? 0,
  };
}

// ------------------------------------------------------------------ QA (tools/qa/editor_preview.mjs)
const qa = {
  info: previewInfo,
  /** relatório de memória (docs/MEMORY.md) da cena de prévia no renderer da prévia */
  memoryReport: () => (core ? memoryReport(core.renderer, core.scene, { duplicates: false }) : null),
  /** simula perda de contexto (Safari/GPU): o núcleo deve ser recriado e voltar a desenhar */
  loseContext: () => { const ext = core?.renderer.getContext().getExtension('WEBGL_lose_context'); ext?.loseContext(); return !!ext; },
  dispose: disposeSharedPreview,
  /**
   * custo por quadro de desenhar a prévia (a) direto no canvas e (b) num render target + readPixels + putImageData
   * (o que seria necessário para usar o renderer do JOGO e levar a imagem ao DOM). Média em ms.
   */
  benchReadback: (frames = 60) => {
    const c = core;
    const h = active();
    if (!c || !h) return null;
    const gl = c.renderer.getContext();
    const one = new Uint8Array(4);
    const size = c.renderer.getDrawingBufferSize(new THREE.Vector2());
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
    sync();
    let t = performance.now();
    for (let i = 0; i < frames; i++) { c.renderer.render(c.scene, c.camera); sync(); }
    const direct = (performance.now() - t) / frames;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { colorSpace: THREE.SRGBColorSpace });
    const px = new Uint8Array(size.x * size.y * 4);
    const cv = document.createElement('canvas'); cv.width = size.x; cv.height = size.y;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(size.x, size.y);
    t = performance.now();
    for (let i = 0; i < frames; i++) {
      c.renderer.setRenderTarget(rt);
      c.renderer.render(c.scene, c.camera);
      c.renderer.readRenderTargetPixels(rt, 0, 0, size.x, size.y, px);
      c.renderer.setRenderTarget(null);
      img.data.set(px);
      ctx.putImageData(img, 0, 0);
    }
    const readback = (performance.now() - t) / frames;
    rt.dispose();
    return { width: size.x, height: size.y, directMs: +direct.toFixed(2), renderTargetReadbackMs: +readback.toFixed(2) };
  },
};
(window as unknown as { __pvPreview?: typeof qa }).__pvPreview = qa;
