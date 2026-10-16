/**
 * Orquestrador: cria renderer/cena, carrega o mundo (com progresso real), posiciona o jogador na
 * Central do Brasil e executa o loop (input → simulação → câmera → streaming/LOD → render → HUD).
 */
import * as THREE from 'three';
import type { QualityPreset } from './settings';
import { isTouchDevice } from './settings';
import { GameRenderer } from '../renderer/Renderer';
import { Environment } from '../renderer/Environment';
import { createMaterialLibrary } from '../renderer/materials';
import { createBuildingMaterial } from '../world/builders/buildings';
import { PropSystem } from '../world/builders/props';
import { ChunkManager } from '../world/ChunkManager';
import { CollisionWorld } from '../physics/CollisionWorld';
import type { WorldManifest, ValidationPoint } from '../world/types';
import { worldProjection, WORLD_ORIGIN } from '../geo/projection';
import { createPlayerState, type PlayerState } from '../player/PlayerState';
import { stepPlayer } from '../player/PlayerController';
import { AvatarVisual } from '../player/AvatarVisual';
import { HumanCharacter } from '../characters/human/HumanCharacter';
import { FrameGovernor } from './frameGovernor';
import { deviceProfile } from './settings';
import { loadClips, loadLod, preloadCrowd } from '../characters/human/HumanAssets';
import { DEFAULT_PLAYER_APPEARANCE as DEFAULT_APPS, type CharacterAppearance } from '../characters/bodyTypes';
const DEFAULT_PLAYER_APPEARANCE_LOCAL = DEFAULT_APPS.homem;
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../ui/TouchControls';
import { DebugPanel } from '../debug/DebugPanel';
import { Minimap } from '../debug/Minimap';
import { createLandmarkMaterials, loadLandmarkTextures } from '../world/landmarks/arch';
import { buildCentral, type LandmarkInstance } from '../world/landmarks/central';
import { buildCandelaria } from '../world/landmarks/candelaria';
import { buildModelBuilding } from '../world/landmarks/models';
import { PedestrianSystem } from '../npc/PedestrianSystem';
import { CrowdDirector } from '../characters/crowd/CrowdDirector';
import { TrafficSystem } from '../traffic/TrafficSystem';
import { loadVehicleModels } from '../traffic/vehicleModels';
import { SignalController } from '../traffic/SignalController';
import { worldClock } from '../net/clock';
import { MonumentSystem } from '../world/Monuments';
import { BillboardSystem } from '../events/Billboards';
import { EventManager } from '../events/EventManager';
import { RideableSystem, stepRideable, type RideableInstance } from '../vehicles/Rideable';
import { InteractionController } from '../interaction/InteractionMode';
import type { KnockMsg } from '../net/NetworkClient';
import { preloadRagdoll } from '../physics/Ragdoll';
import type { NetworkClient } from '../net/NetworkClient';
import type { PropRec, BuildingRec } from '../world/types';
import { distToPolyline } from '../geo/polyline';
import { memoryReport } from '../debug/memoryReport';
import type { TrafficData } from '../world/types';

export { DEFAULT_PLAYER_APPEARANCE } from '../characters/bodyTypes';

export type ProgressFn = (fraction: number, label: string) => void;

/** Poses de câmera para validação/screenshots (?shot=...) */
export const SHOTS: Record<string, { key: string; along: number; side: number; yawTo?: string; yawAlong?: number; pitch: number; dist: number }> = {
  central: { key: 'LANDMARK_CENTRAL', along: 0, side: 0, pitch: 0.12, dist: 6 },
};

export class Game {
  /** nome escolhido na tela inicial (multiplayer); `?name=` tem prioridade */
  playerName = '';
  readonly canvas: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private gr: GameRenderer;
  private env!: Environment;
  private manifest!: WorldManifest;
  private chunks!: ChunkManager;
  private collision!: CollisionWorld;
  private props!: PropSystem;
  private landmarks: LandmarkInstance[] = [];
  /** câmera livre só para automação (capturas de landmarks): posição + alvo */
  private freeCam: { p: [number, number, number]; t: [number, number, number] } | null = null;
  private peds!: PedestrianSystem;
  /** orçamento único de humanos (remotos + multidão da rede + NPCs) e multidão instanciada — docs/CROWDS.md */
  private crowd!: CrowdDirector;
  private traffic!: TrafficSystem;
  private signals!: SignalController;
  private monuments!: MonumentSystem;
  private billboards!: BillboardSystem;
  readonly events!: EventManager;
  private rideables!: RideableSystem;
  private riding: RideableInstance | null = null;
  readonly interaction = new InteractionController();
  private net: NetworkClient | null = null;
  private appearance: CharacterAppearance | undefined;
  private prompt!: HTMLDivElement;
  private modeBadge!: HTMLDivElement;
  private messageTimer = 0;
  private input: InputManager;
  private player!: PlayerState;
  private avatar: AvatarVisual;
  private cam!: ThirdPersonCamera;
  private debug = new DebugPanel();
  private minimap!: Minimap;
  private hud: HTMLDivElement;
  private toast: HTMLDivElement;
  private clock = new THREE.Clock();
  private time = 0;
  private simOffsetMs = 0;
  private lastSunUpdate = -1e9;
  private intro = { active: true, t: 0, fromYaw: 0, toYaw: 0 };
  private nearestVP: ValidationPoint | null = null;
  private running = false;
  private photoMode = false;

  constructor(private container: HTMLElement, private preset: QualityPreset, appearance?: CharacterAppearance) {
    // começa no LOD3 (barato) e sobe para o LOD0 depois de jogável: o detalhado não disputa banda com o mundo
    this.avatar = new AvatarVisual(appearance, { lod: 3 });
    this.appearance = appearance;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);
    this.gr = new GameRenderer(this.canvas, preset);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, preset.cameraFar);
    this.input = new InputManager(this.canvas, isTouchDevice());
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    this.toast = document.createElement('div');
    this.toast.className = 'vp-toast';
    // horário REAL do Rio de Janeiro (relógio do sistema; o fuso é tratado em UTC−3 no cálculo solar).
    // ?time=HH:MM (hora do Rio) força um horário apenas para testes/screenshots.
    this.simOffsetMs = 0;
    const t = new URLSearchParams(location.search).get('time');
    if (t && /^\d{1,2}:\d{2}$/.test(t)) {
      const [h, m] = t.split(':').map(Number);
      const now = new Date();
      // data atual no Rio
      const rio = new Date(now.getTime() - 3 * 3600_000);
      const forced = Date.UTC(rio.getUTCFullYear(), rio.getUTCMonth(), rio.getUTCDate(), h + 3, m, 0);
      this.simOffsetMs = forced - now.getTime();
    }
  }

  /** data/hora do mundo = data/hora real (opcionalmente deslocada por ?time=) */
  get simTime(): Date {
    return new Date(Date.now() + this.simOffsetMs);
  }

  async load(progress: ProgressFn) {
    const base = `${import.meta.env.BASE_URL}world/`;
    progress(0.02, 'Lendo manifesto do mapa');
    const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest.json não encontrado — rode `npm run map`');
    this.manifest = (await res.json()) as WorldManifest;

    progress(0.05, 'Gerando materiais (asfalto, pedra portuguesa…)');
    const lib = await createMaterialLibrary((label) => progress(0.08, `Gerando textura: ${label}`));
    const buildingMat = createBuildingMaterial(lib.noise);

    this.env = new Environment(this.gr.renderer, this.scene, this.preset);
    this.env.setTime(this.simTime, WORLD_ORIGIN.lat, WORLD_ORIGIN.lon);

    this.collision = new CollisionWorld(this.manifest.chunkSize, this.manifest.bounds);
    this.props = new PropSystem(lib.noise);
    this.scene.add(this.props.group);
    progress(0.1, 'Plantando oitis e amendoeiras');
    await this.props.loadVegetation(this.gr.renderer, this.preset.vegetationDensity);
    this.chunks = new ChunkManager(this.manifest, base, lib, buildingMat, this.collision, this.props, this.preset);
    this.scene.add(this.chunks.group);

    const spawn = this.manifest.spawn;
    const spawnXZ = new THREE.Vector2(spawn.p[0], spawn.p[1]);
    progress(0.15, 'CARREGANDO CENTRO DO RIO');
    await this.chunks.preload(spawnXZ, this.preset.lodDistances[2], (d, t) => progress(0.15 + 0.5 * (d / t), `Baixando quarteirões ${d}/${t}`));

    progress(0.68, 'Construindo Central do Brasil e Candelária');
    await nextFrame();
    const lmTex = await loadLandmarkTextures(`${import.meta.env.BASE_URL}landmarks/tex/`).catch(() => undefined);
    const archMats = createLandmarkMaterials(lib.noise, lmTex);
    for (const lm of this.manifest.landmarks) {
      const inst = lm.key === 'LANDMARK_CENTRAL' ? buildCentral(lm, archMats) : buildCandelaria(lm, archMats);
      this.scene.add(inst.group);
      for (const c of inst.colliders) this.collision.addPolygon(c.poly, c.minHeight ?? 0, c.height);
      this.landmarks.push(inst);
    }
    // edifícios com modelo dedicado (data/overrides/buildings.json → campo `model`), também os de chunks carregados depois
    const addModel = (b: BuildingRec) => {
      const inst = buildModelBuilding(b, archMats, this.manifest.pvAxis);
      if (inst) { this.scene.add(inst.group); this.landmarks.push(inst); }
    };
    for (const b of this.chunks.modelBuildings()) addModel(b);
    this.chunks.onModelBuilding = addModel;

    // jogador
    const heading = Math.atan2(Math.cos(spawn.yaw), Math.sin(spawn.yaw));
    this.player = createPlayerState('local', spawn.p[0], this.collision.groundHeight(spawn.p[0], spawn.p[1]), spawn.p[1], heading);
    this.scene.add(this.avatar.root);
    // personagens: animações, LOD do próprio avatar e LODs baratos de todos os corpos antes de começar
    progress(0.7, 'Carregando personagens');
    const bodies = ['homem', 'mulher', 'idoso', 'idosa'] as const;
    // o LOD0 do próprio avatar NÃO bloqueia o início (1,2–1,6 MB): começa no LOD3 e troca sem reiniciar a animação
    await Promise.all([loadClips(), ...bodies.map((b) => loadLod(b, 3))]).catch((e) => console.warn('[personagens]', e));
    this.peds = new PedestrianSystem(this.collision, this.preset.pedestrians);
    this.peds.radius = this.preset.pedestrianRadius;
    this.peds.shadowDistance = this.preset.npcShadowDistance;
    // no início, NPCs/remotos no máximo LOD1: o LOD0 (1,2–1,6 MB por corpo) não disputa banda com o mundo
    const npcDetail = this.preset.level === 'low' ? 2 : this.preset.level === 'medium' ? 1 : 0;
    this.peds.maxDetail = Math.max(1, npcDetail) as 1 | 2;
    AvatarVisual.maxRemoteDetail = this.peds.maxDetail;
    this.deferredDetail = npcDetail as 0 | 1 | 2;
    this.crowd = new CrowdDirector(this.preset.level, this.scene);
    this.crowd.detailFloor = this.peds.maxDetail; // mesmo adiamento do LOD0 (liberado aos 6 s)
    // ?crowd=0 desliga o orçamento (todo humano com esqueleto, como antes) — só para comparação em QA
    if (new URLSearchParams(location.search).get('crowd') !== '0') this.peds.crowd = this.crowd;
    this.scene.add(this.peds.group);
    let tdata: TrafficData = { lanes: [], junctions: [], crossings: [] };
    if (this.manifest.traffic) {
      try {
        const tr = await fetch(`${base}${this.manifest.traffic}`);
        if (tr.ok) {
          const d = (await tr.json()) as Partial<TrafficData>;
          tdata = { lanes: d.lanes ?? [], junctions: d.junctions ?? [], crossings: d.crossings ?? [] };
        }
      } catch { /* trânsito é opcional */ }
    }
    this.signals = new SignalController(tdata.junctions);
    await loadVehicleModels(); // modelos GLB dos veículos (reserva procedural se falhar)
    this.traffic = new TrafficSystem(tdata.lanes, this.preset.vehicles);
    this.traffic.signals = this.signals;
    this.peds.setCrossings(tdata.crossings, this.signals);
    this.scene.add(this.traffic.group);
    {
      const ax = this.manifest.pvAxis;
      const pvDir = Math.atan2(ax[ax.length - 1][1] - ax[0][1], ax[ax.length - 1][0] - ax[0][0]);
      this.monuments = new MonumentSystem(this.manifest.monuments ?? [], this.manifest.streetSigns ?? [], (x, z) => this.collision.groundHeight(x, z), pvDir);
      this.scene.add(this.monuments.group);
    }
    // painéis de LED + evento ativo (?event=id; padrão em public/events/index.json)
    this.billboards = new BillboardSystem(this.manifest.billboards ?? []);
    this.billboards.drawDistance = this.preset.billboardDistance;
    this.scene.add(this.billboards.group);
    const pvAxis = this.manifest.pvAxis;
    (this as { events: EventManager }).events = new EventManager(
      `${import.meta.env.BASE_URL}events/`,
      this.billboards,
      () => {
        const out: PropRec[] = [];
        this.chunks.forEachProp((p) => { if (p.k === 'lamp' && distToPolyline(p.p, pvAxis) < 48) out.push(p); });
        return out;
      },
      (x, z) => this.collision.groundHeight(x, z),
      (pal) => this.peds.setGroupPalettes(pal),
    );
    this.scene.add(this.events.decorations);
    try {
      await this.events.load(new URLSearchParams(location.search).get('event') ?? undefined);
    } catch (e) { console.warn('evento não carregado', e); }
    this.interaction.setPolicy(this.events.current?.interaction);
    // veículos utilizáveis nas estações reais de bicicleta compartilhada
    const kinds = (this.events.current?.vehicles ?? [{ kind: 'bicycle' }, { kind: 'scooter' }, { kind: 'car' }]).map((v) => v.kind);
    this.rideables = new RideableSystem(this.manifest.vehicleSpawns ?? [], (x, z) => this.collision.groundHeight(x, z), kinds);
    this.scene.add(this.rideables.group);
    this.cam = new ThirdPersonCamera(this.camera, this.collision);
    // intro: começa olhando a Central, depois gira para a avenida (direção da Candelária)
    const central = this.manifest.landmarks.find((l) => l.key === 'LANDMARK_CENTRAL')!;
    const toC = Math.atan2(central.center[0] - spawn.p[0], central.center[1] - spawn.p[1]);
    this.intro = { active: true, t: 0, fromYaw: toC, toYaw: heading };
    this.cam.yaw = toC;
    this.cam.pitch = -0.32; // olhando para cima: torre inteira no quadro

    // construir chunks próximos antes de mostrar
    progress(0.72, 'Montando ruas, calçadas e edifícios');
    const camXZ = new THREE.Vector2(spawn.p[0], spawn.p[1]);
    let guard = 0;
    this.chunks.update(camXZ, 0);
    const total = Math.max(1, this.chunks.pending);
    while (this.chunks.pending > 0 && guard++ < 400) {
      this.chunks.update(camXZ, 40);
      progress(0.72 + 0.2 * (1 - this.chunks.pending / total), 'Montando ruas, calçadas e edifícios');
      await nextFrame();
    }

    progress(0.94, 'Compilando shaders');
    this.onResize();
    this.cam.update(new THREE.Vector3(this.player.x, this.player.y, this.player.z), 1 / 60);
    this.gr.setup(this.scene, this.camera);
    try {
      await this.gr.renderer.compileAsync(this.scene, this.camera);
      HumanCharacter.warmup = (obj) => this.gr.renderer.compileAsync(obj, this.camera, this.scene).then(() => undefined);
    } catch { /* compileAsync opcional */ }
    progress(1, 'Pronto');
    this.mountHud();
    await this.connectMultiplayer();
    this.applyShotFromUrl();
  }

  private mountHud() {
    this.minimap = new Minimap(this.manifest);
    this.hud.appendChild(this.minimap.el);
    this.hud.appendChild(this.debug.el);
    this.hud.appendChild(this.toast);
    const help = document.createElement('div');
    help.className = 'help';
    help.innerHTML = this.input.isTouch
      ? 'Joystick: andar · Arraste: câmera · Pinça: zoom'
      : '<b>WASD</b> andar · <b>Shift</b> correr · <b>Espaço</b> pular · <b>Mouse</b> câmera · <b>Roda</b> zoom · <b>E</b> usar bicicleta/patinete · <b>K</b> modo · <b>M</b> mapa · <b>F3</b> debug · <b>H</b> ajuda · <b>Esc</b> soltar mouse';
    this.hud.appendChild(help);
    this.prompt = document.createElement('div');
    this.prompt.className = 'use-prompt';
    this.hud.appendChild(this.prompt);
    this.modeBadge = document.createElement('div');
    this.modeBadge.className = 'mode-badge';
    this.hud.appendChild(this.modeBadge);
    const evb = document.createElement('div');
    evb.className = 'event-badge';
    evb.textContent = this.events.current ? `Evento: ${this.events.current.name}` : '';
    this.hud.appendChild(evb);
    const attr = document.createElement('div');
    attr.className = 'attribution';
    attr.innerHTML = 'Dados do mapa © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL)';
    this.hud.appendChild(attr);
    const lock = document.createElement('div');
    lock.className = 'lock-hint';
    lock.textContent = 'Clique para controlar a câmera';
    this.hud.appendChild(lock);
    if (this.input.isTouch) this.hud.appendChild(new TouchControls(this.input).el);
    this.container.appendChild(this.hud);
    setTimeout(() => help.classList.add('faded'), 12000);
    window.addEventListener('resize', () => this.onResize());
  }

  /** Para validação/screenshots: ?shot=central|avenue|mid|candelaria */
  private applyShotFromUrl() {
    const shot = new URLSearchParams(location.search).get('shot');
    if (!shot) return;
    this.setShot(shot);
  }

  setShot(name: string) {
    const lmC = this.manifest.landmarks.find((l) => l.key === 'LANDMARK_CENTRAL')!;
    const lmK = this.manifest.landmarks.find((l) => l.key === 'LANDMARK_CANDELARIA')!;
    const axis = this.manifest.pvAxis;
    const pointAlong = (frac: number): [number, number] => {
      // ponto ao longo do eixo da PV (fração 0..1 entre o ponto mais próximo da Central e da Candelária)
      const proj = (p: [number, number]) => {
        let best = 0, bd = Infinity, acc = 0, bestS = 0;
        for (let i = 0; i < axis.length - 1; i++) {
          const a = axis[i], b = axis[i + 1];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l)));
          const d = Math.hypot(a[0] + (b[0] - a[0]) * t - p[0], a[1] + (b[1] - a[1]) * t - p[1]);
          if (d < bd) { bd = d; best = i; bestS = acc + t * l; }
          acc += l;
        }
        void best;
        return bestS;
      };
      const s0 = proj(lmC.center as [number, number]), s1 = proj(lmK.center as [number, number]);
      let target = s0 + (s1 - s0) * frac, acc = 0;
      for (let i = 0; i < axis.length - 1; i++) {
        const a = axis[i], b = axis[i + 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (acc + l >= target) {
          const t = (target - acc) / l;
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        acc += l;
      }
      target = 0;
      return axis[axis.length - 1];
    };
    const yawTo = (from: [number, number], to: [number, number]) => Math.atan2(to[0] - from[0], to[1] - from[1]);
    let pos: [number, number], yaw: number, pitch = 0.08, dist = 6;
    switch (name) {
      case 'central': {
        pos = pointAlong(0.06);
        yaw = yawTo(pos, lmC.center as [number, number]);
        pitch = 0.02; dist = 5;
        break;
      }
      case 'avenue': {
        pos = pointAlong(0.08);
        yaw = yawTo(pos, lmK.center as [number, number]);
        pitch = 0.06;
        break;
      }
      case 'mid': {
        pos = pointAlong(0.5);
        yaw = yawTo(pos, lmK.center as [number, number]);
        pitch = 0.06;
        break;
      }
      case 'candelaria': {
        pos = pointAlong(0.86);
        yaw = yawTo(pos, lmK.center as [number, number]);
        pitch = 0.0; dist = 4.5;
        break;
      }
      default: return;
    }
    this.player.x = pos[0];
    this.player.z = pos[1];
    this.player.y = this.collision.groundHeight(pos[0], pos[1]);
    this.player.heading = yaw;
    this.cam.yaw = yaw;
    this.cam.pitch = pitch;
    this.cam.distance = dist;
    this.cam.zoom(Math.log(dist / 5.2));
    this.intro.active = false;
  }

  onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gr.resize(w, h);
  }

  /** limite de FPS e resolução dinâmica pelo aparelho (src/core/frameGovernor.ts) */
  private governor!: FrameGovernor;
  private deferredDetail: 0 | 1 | 2 = 1;
  /** intervalos (ms) entre quadros RENDERIZADOS (benchmark) */
  private frameLog: number[] = [];

  start() {
    this.running = true;
    this.clock.start();
    this.governor = new FrameGovernor(this.preset.targetFps ?? 60, this.preset.dynamicResolution ?? false);
    let last = performance.now(), first = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const now = performance.now();
      if (!this.governor.shouldRender(now)) return;
      const interval = now - last;
      last = now;
      if (this.frameLog.length < 4000) this.frameLog.push(interval);
      this.frame();
      if (first) { first = false; performance.mark('pv:world-visible'); }
      const sc = this.governor.onFrame(interval, this.gr.gpuMs);
      if (sc !== null) this.gr.setResolutionScale(sc);
    };
    requestAnimationFrame(loop);
    performance.mark('pv:playable');
    setTimeout(() => { this.avatar.setDetail(0); preloadCrowd(['homem', 'mulher', 'idoso', 'idosa']); }, 1500);
    setTimeout(() => { this.peds.maxDetail = this.deferredDetail; AvatarVisual.maxRemoteDetail = this.deferredDetail; this.crowd.detailFloor = this.deferredDetail; }, 6000);
    (window as any).__pvReady = true;
  }

  private cpuMs = 0;

  private frame() {
    const tCpu = performance.now();
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    this.debug.tick();

    // toggles
    if (this.input.consumeToggle('debug')) this.debug.toggle();
    if (this.input.consumeToggle('map')) this.minimap.toggleExpanded();
    if (this.input.consumeToggle('help')) this.hud.querySelector('.help')?.classList.toggle('faded');
    if (this.input.consumeToggle('photo')) { this.photoMode = !this.photoMode; this.hud.classList.toggle('photo', this.photoMode); }
    this.hud.classList.toggle('locked', this.input.pointerLocked || this.input.isTouch);

    // câmera: olhar/zoom
    const look = this.input.consumeLook();
    if (look.dx || look.dy) this.cam.rotate(look.dx, look.dy);
    const z = this.input.consumeZoom();
    if (z) this.cam.zoom(z);

    // intro (gira da Central para a avenida)
    if (this.intro.active) {
      this.intro.t += dt;
      if (this.input.hasActivity() || this.intro.t > 6.5) this.intro.active = false;
      else if (this.intro.t > 2.8) {
        const k = THREE.MathUtils.smoothstep(this.intro.t, 2.8, 6.2);
        let d = this.intro.toYaw - this.intro.fromYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.cam.yaw = this.intro.fromYaw + d * k;
        this.cam.pitch = -0.32 + 0.5 * k;
      }
    }

    this.updateInteraction(dt);
    this.updateMovement(dt);
    const ppos = this.avatar.root.position;
    this.cam.update(ppos, dt);
    if (this.freeCam) { this.camera.position.set(...this.freeCam.p); this.camera.lookAt(...this.freeCam.t); }
    this.signals.setTime(worldClock.seconds());
    if (this.net) {
      this.net.update(dt, this.player, this.riding ? this.riding.state.id : null, this.camera, { w: this.canvas.clientWidth, h: this.canvas.clientHeight });
      this.rideables.smooth(dt, this.net.sessionId);
    }
    this.peds.update(dt, this.camera, this.player);
    this.crowd.end(this.camera, dt);
    this.traffic.obstacles = [
      ...this.peds.crossingPositions(),
      ...(this.net ? this.net.remotesForObstacles().map((r) => ({ x: r.x, z: r.z, r: r.vehicle.startsWith('car') ? 1.6 : 0.9 })) : []),
      ...this.rideables.items.filter((it) => it.def.kind === 'car' && it !== this.riding).map((it) => ({ x: it.state.x, z: it.state.z, r: 1.6 })),
      ...(this.riding?.def.kind === 'car' ? [{ x: this.player.x, z: this.player.z, r: 1.6 }] : []),
    ];
    this.traffic.update(dt, this.camera, this.player);
    this.props.updateSignals((j, ph) => this.signals.state(j, ph));

    // mundo
    const camXZ = new THREE.Vector2(this.camera.position.x, this.camera.position.z);
    this.chunks.update(camXZ, 5);
    this.props.update(this.time, this.camera.position);
    this.props.updateNightLights(this.camera.position, this.env.night);
    const sim = this.simTime;
    for (const lm of this.landmarks) lm.update(sim, this.camera.position);
    this.monuments.update(dt, sim);
    this.billboards.update(dt, this.camera.position);
    this.events.update(this.time);
    if (this.time - this.lastSunUpdate > 30) {
      this.lastSunUpdate = this.time;
      this.env.setTime(sim, WORLD_ORIGIN.lat, WORLD_ORIGIN.lon);
    }
    this.env.update(this.camera, ppos, this.time);

    this.gr.render(this.scene, this.camera);
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - tCpu) * 0.1;

    // HUD
    this.updateValidation();
    if (!this.photoMode) this.minimap.draw(this.player.x, this.player.z, this.player.heading, this.cam.yaw);
    const ll = worldProjection.toLatLon(this.player.x, this.player.z);
    const ck = this.chunks.chunkKeyAt(this.player.x, this.player.z);
    const lod = this.chunks.lodAt(this.player.x, this.player.z);
    const st = this.chunks.stats;
    this.debug.update(this.gr.renderer, {
      x: this.player.x, y: this.player.y, z: this.player.z, lat: ll.lat, lon: ll.lon,
      chunk: ck, lod: lod === null ? '—' : ['FULL', 'MEDIUM', 'FAR', 'oculto'][lod],
      nearest: this.nearestVP ? `${this.nearestVP.key}` : '—',
      quality: this.preset.level.toUpperCase(),
      chunks: `${st.visible} vis (F${st.full}/M${st.medium}/L${st.far}) · ${st.loaded} baixados`,
      props: this.props.instanceCount, heading: this.player.heading, locomotion: this.player.locomotion,
      npcs: `${this.net ? `MP ${this.net.status} · remotos ${this.net.remoteCount} · correções ${this.net.corrections} · ↓${(this.net.bandwidth.inBps / 1024).toFixed(1)} KB/s ↑${(this.net.bandwidth.outBps / 1024).toFixed(1)} KB/s · RTT ${worldClock.rtt === Infinity ? '—' : worldClock.rtt.toFixed(0)} ms · interp ${this.net.interpDelay.toFixed(0)} ms<br>` : ''}pedestres ${this.peds.stats.visible}/${this.peds.stats.active} (atravessando ${this.peds.stats.crossing}) · humanos ${this.crowd.stats.skinned} esqueleto + ${this.crowd.stats.drawnInstanced} instanciados (${this.crowd.stats.instancedCalls} draws) · veículos ${this.traffic.stats.active} (parados no vermelho ${this.traffic.stats2.stoppedAtRed})`,
    });
  }

  /** Multiplayer opcional (desenvolvimento): ?mp=1 conecta em ws://<host>:2567; ?mp=ws://… usa outro servidor. */
  private async connectMultiplayer() {
    const q = new URLSearchParams(location.search);
    const mp = q.get('mp');
    if (!mp) return;
    const endpoint = mp === '1' ? `ws://${location.hostname}:2567` : mp;
    const { NetworkClient } = await import('../net/NetworkClient');
    this.net = new NetworkClient(endpoint, this.hud);
    this.net.crowd = this.peds.crowd;
    this.scene.add(this.net.group);
    (window as any).__pvRemotes = () => this.net?.remotesInfo();
    this.net.onSpawn = (sp) => {
      this.player.x = sp.x; this.player.z = sp.z; this.player.y = this.collision.groundHeight(sp.x, sp.z);
      this.interaction.setPolicy(this.net!.policy === 'pacifico' ? 'pacifico' : 'opcional');
    };
    this.net.onCorrect = (dx, dz, abs, reason) => {
      // reconciliação: aplica o erro medido no seq corrigido sobre a posição atual (preserva o movimento posterior)
      const big = Math.hypot(dx, dz) > 4 || (!dx && !dz);
      if (big) { this.player.x = abs.x; this.player.z = abs.z; } else { this.player.x += dx; this.player.z += dz; }
      if (this.riding) { this.riding.state.x = this.player.x; this.riding.state.z = this.player.z; if (reason === 'collision') this.riding.state.speed = 0; }
      this.player.y = Math.max(abs.y, this.collision.groundHeight(this.player.x, this.player.z));
    };
    this.net.onTraffic = (buf) => this.traffic.applySnapshot(buf);
    this.net.onVehicle = (id, v) => this.rideables.applyServer(id, v.x, v.y, v.z, v.heading, v.occupant, this.net!.sessionId);
    this.net.onEnter = (ok, d) => {
      const it = this.rideables.byId.get(d.id);
      if (ok && it) { it.state.x = d.x ?? it.state.x; it.state.z = d.z ?? it.state.z; it.state.heading = d.heading ?? it.state.heading; this.mountLocal(it); this.flash(it.def.kind === 'car' ? 'Você está dirigindo (servidor confirmou)' : 'Montado'); }
      else this.flash(d.reason === 'ocupado' ? 'Esse veículo já está sendo usado por outro jogador' : `Não foi possível entrar (${d.reason})`);
      this.pendingEnter = null;
    };
    this.net.onExit = (pos) => this.dismountLocal(pos);
    this.net.onKnock = (k, isSelf) => { if (isSelf) this.onSelfKnock(k); };
    this.net.onNotice = (m) => this.flash(m);
    this.net.onEvent = (id) => {
      if (this.events.current?.id !== id) void this.events.load(id).then(() => this.interaction.setPolicy(this.events.current?.interaction));
    };
    void preloadRagdoll().catch(() => { /* fallback procedural */ });
    try {
      const sp = q.get('spawn')?.split(',').map(Number);
      await this.net.connect(this.appearance ?? DEFAULT_PLAYER_APPEARANCE_LOCAL, q.get('name') ?? (this.playerName || `Visitante ${Math.floor(Math.random() * 900 + 100)}`), sp && sp.length === 2 && sp.every(Number.isFinite) ? { x: sp[0], z: sp[1] } : undefined);
      this.flash(`Multiplayer conectado (${endpoint})`);
    } catch (e) {
      this.flash(`Multiplayer indisponível: ${(e as Error).message ?? e}`);
      console.warn('[mp] falha ao conectar', e);
    }
  }

  // ------------------------------------------------------------------ interação (modos, empurrão)
  private get mpOnline() { return !!this.net && this.net.status === 'online'; }

  private updateInteraction(dt: number) {
    this.interaction.update(dt);
    if (this.input.consumeToggle('mode')) {
      if (this.mpOnline) {
        // multiplayer: o SERVIDOR decide o modo (política do evento)
        this.net!.requestMode(this.net!.self.interaction === 'interacao' ? 'pacifico' : 'interacao');
      } else this.flash(this.interaction.toggle().message);
    }
    if (this.mpOnline) this.interaction.mode = this.net!.self.interaction === 'interacao' ? 'interacao' : 'pacifico';
    if (this.input.consumeToggle('action') && !this.avatar.isDown && !this.riding) {
      if (this.interaction.mode !== 'interacao') { this.flash('Modo pacífico: aperte K para alternar (se o evento permitir)'); return; }
      const target = this.net?.pickTarget(this.player.x, this.player.z, this.player.heading) ?? null;
      this.avatar.playPush(); // só a animação é local; o resultado vem do servidor
      if (target && this.mpOnline) this.net!.requestPush(target);
      else if (!this.peds.pushNear(this.player.x, this.player.z, this.player.heading)) this.flash('Ninguém ao alcance');
    }
  }

  /** queda do jogador local (decidida pelo servidor) */
  private onSelfKnock(k: KnockMsg) {
    if (this.riding) this.dismountLocal();
    const walls = this.collision.walls.near(this.player.x, this.player.z, 6);
    void this.avatar.knockdown({ dirX: k.dx, dirZ: k.dz, strength: k.strength, groundY: this.player.y, walls, downMs: k.downMs, getupMs: k.getupMs });
    // posição de repouso é do servidor
    this.player.x = k.rx; this.player.z = k.rz; this.player.vx = this.player.vz = 0;
    this.flash(k.kind === 'impact' ? 'Você foi atingido por um carro! (sem dano — levante-se)' : 'Você foi empurrado!');
  }

  // ------------------------------------------------------------------ movimento e veículos
  private mountLocal(v: RideableInstance) {
    this.riding = v;
    v.state.occupant = this.net?.sessionId || this.player.id;
    v.state.speed = 0;
    this.player.x = v.state.x; this.player.z = v.state.z;
    this.cam.setProfile(v.def.kind);
  }

  private dismountLocal(pos?: { x: number; z: number }) {
    const v = this.riding;
    if (!v) return;
    v.state.occupant = null;
    v.state.speed = 0;
    if (pos) { this.player.x = pos.x; this.player.z = pos.z; }
    else { this.player.x = v.state.x + Math.cos(v.state.heading) * (v.def.kind === 'car' ? -1.6 : 0.9); this.player.z = v.state.z - Math.sin(v.state.heading) * (v.def.kind === 'car' ? -1.6 : 0.9); }
    this.player.y = this.collision.groundHeight(this.player.x, this.player.z);
    this.player.heading = v.state.heading;
    this.riding = null;
    this.cam.setProfile('foot');
  }

  private pendingEnter: string | null = null;

  private updateMovement(dt: number) {
    const ax = this.input.moveAxis();
    const [fx, fz] = this.cam.forward();
    if (this.autopilot) {
      const dx = this.autopilot.x - this.player.x, dz = this.autopilot.z - this.player.z;
      if (Math.hypot(dx, dz) < 0.8) this.autopilot = null;
      else {
        // direção-alvo em linha reta (o roteiro de teste monta cenas sem obstáculos no caminho)
        const l = Math.hypot(dx, dz);
        const ddx = dx / l, ddz = dz / l;
        ax.y = ddx * fx + ddz * fz;
        ax.x = ddx * -Math.cos(this.cam.yaw) + ddz * Math.sin(this.cam.yaw);
      }
    }
    if (this.input.consumeToggle('use') && !this.avatar.isDown) {
      if (this.riding) {
        if (this.mpOnline) this.net!.requestExit();
        else this.dismountLocal();
      } else {
        const near = this.rideables.nearest(this.player.x, this.player.z);
        if (near) {
          if (this.mpOnline) { this.pendingEnter = near.state.id; this.net!.requestEnter(near.state.id); this.flash(`Entrando… (aguardando o servidor)`); }
          else this.mountLocal(near);
        }
      }
    }
    if (this.avatar.isDown) {
      // caído: sem controle; o servidor decide quando levanta
      this.input.consumeJump();
      this.player.speed = 0;
      this.player.locomotion = 'idle';
      this.avatar.update(this.player, dt);
      this.prompt.textContent = 'Caído… levantando em instantes';
    } else if (this.riding) {
      const v = this.riding;
      const prev = { x: v.state.x, z: v.state.z };
      stepRideable(v.state, v.def, { throttle: ax.y, steer: -ax.x, boost: this.input.running() }, dt, this.collision);
      if (v.def.kind === 'car') {
        // colisão simples com o trânsito
        const p = { x: v.state.x, z: v.state.z };
        this.traffic.pushOut(p, 1.25);
        if (Math.hypot(p.x - v.state.x, p.z - v.state.z) > 1e-3) { v.state.x = p.x; v.state.z = p.z; v.state.speed *= 0.3; }
        // jogadores pacíficos (ou eu pacífico) bloqueiam o carro; impacto só entre jogadores em modo interação (servidor decide)
        for (const r of this.net?.remotesForObstacles() ?? []) {
          if (r.vehicle) continue;
          const eligible = r.interaction === 'interacao' && this.interaction.mode === 'interacao' && r.status === 0;
          if (eligible) continue;
          const fx2 = Math.sin(v.state.heading), fz2 = Math.cos(v.state.heading);
          const dx = r.x - v.state.x, dz = r.z - v.state.z;
          if (Math.abs(dx * fx2 + dz * fz2) < 2.6 && Math.abs(dx * fz2 - dz * fx2) < 1.3) { v.state.x = prev.x; v.state.z = prev.z; v.state.speed = 0; }
        }
      }
      this.input.consumeJump();
      this.player.x = v.state.x; this.player.z = v.state.z; this.player.y = v.state.y;
      this.player.heading = v.state.heading; this.player.speed = Math.abs(v.state.speed);
      this.player.locomotion = 'walk';
      this.avatar.updateRiding(v.state.x, v.state.y, v.state.z, v.state.heading, v.def.pose, v.state.speed, v.def.seatHeight, dt);
      let dyaw = v.state.heading - this.cam.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      if (Math.abs(v.state.speed) > 1) this.cam.yaw += dyaw * Math.min(1, dt * (v.def.kind === 'car' ? 2.2 : 1.5));
      this.prompt.textContent = v.def.kind === 'car'
        ? 'E — sair do carro · W acelerar · S frear/ré · A/D volante · Shift turbo'
        : `E — descer da ${v.def.label.toLowerCase()} · W/S acelerar/frear · A/D virar · Shift mais rápido`;
    } else {
      const intent = {
        dirX: fx * ax.y + -Math.cos(this.cam.yaw) * ax.x,
        dirZ: fz * ax.y + Math.sin(this.cam.yaw) * ax.x,
        run: this.input.running() || !!this.autopilotRun,
        jump: this.input.consumeJump(),
        speedFactor: this.avatar.speedFactor,
      };
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < steps; i++) stepPlayer(this.player, intent, dt / steps, this.collision);
      this.traffic.pushOut(this.player);
      for (const it of this.rideables.items) if (it.def.kind === 'car' && it !== this.riding) {
        // carros estacionados são sólidos
        const fx2 = Math.sin(it.state.heading), fz2 = Math.cos(it.state.heading);
        const dx = this.player.x - it.state.x, dz = this.player.z - it.state.z;
        const lz = dx * fx2 + dz * fz2, lx = dx * fz2 - dz * fx2;
        const hx = 0.9 + 0.35, hz = 2.2 + 0.35;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
          if (hx - Math.abs(lx) < hz - Math.abs(lz)) { const nlx = Math.sign(lx || 1) * hx; this.player.x = it.state.x + lz * fx2 + nlx * fz2; this.player.z = it.state.z + lz * fz2 - nlx * fx2; }
          else { const nlz = Math.sign(lz || 1) * hz; this.player.x = it.state.x + nlz * fx2 + lx * fz2; this.player.z = it.state.z + nlz * fz2 - lx * fx2; }
        }
      }
      this.avatar.update(this.player, dt);
      const near = this.rideables.nearest(this.player.x, this.player.z);
      this.prompt.textContent = this.pendingEnter ? 'Aguardando o servidor…' : near ? (near.def.kind === 'car' ? 'E — entrar no carro' : `E — usar ${near.def.label.toLowerCase()}`) : '';
    }
    this.rideables.sync(this.camera.position);
    this.prompt.classList.toggle('show', !!this.prompt.textContent);
    this.messageTimer -= dt;
    if (this.messageTimer <= 0) this.modeBadge.textContent = this.interaction.mode === 'pacifico' ? 'Modo pacífico' : 'Modo interação';
    this.modeBadge.classList.toggle('combat', this.interaction.mode === 'interacao');
  }

  /** piloto automático para testes reproduzíveis (anda até um ponto usando o movimento normal) */
  private autopilot: { x: number; z: number } | null = null;
  private autopilotRun = false;

  /** mensagem curta no selo de modo */
  private flash(msg: string) {
    this.modeBadge.textContent = msg;
    this.messageTimer = 2.5;
  }

  private updateValidation() {
    let best: ValidationPoint | null = null, bd = Infinity;
    for (const v of this.manifest.validation) {
      const d = Math.hypot(v.p[0] - this.player.x, v.p[1] - this.player.z);
      if (d < v.radius && d < bd) { bd = d; best = v; }
    }
    if (best !== this.nearestVP) {
      this.nearestVP = best;
      if (best) {
        this.toast.innerHTML = `<span>${best.key}</span>${best.label}`;
        this.toast.classList.add('show');
      } else this.toast.classList.remove('show');
    }
  }

  /** métricas para testes automatizados de performance */
  metrics() {
    const r = this.gr.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      fps: this.debug.fps, frameMs: this.debug.frameMs, worstMs: this.debug.worstMs,
      cpuMs: +this.cpuMs.toFixed(3), gpuMs: this.gr.gpuMs === null ? null : +this.gr.gpuMs.toFixed(3),
      heapMB: mem ? +(mem.usedJSHeapSize / 1e6).toFixed(1) : null,
      bandwidth: this.net?.bandwidth ?? null,
      calls: r.render.calls, triangles: r.render.triangles, textures: r.memory.textures, geometries: r.memory.geometries,
      governor: this.governor?.stats ?? null, targetFps: this.preset.targetFps ?? 60, device: deviceProfile().label,
      quality: this.preset.level, chunks: { ...this.chunks.stats }, props: this.props.instanceCount,
      net: this.net ? { status: this.net.status, remotes: this.net.remoteCount, corrections: this.net.corrections, error: this.net.lastError } : null,
      pedestrians: { ...this.peds.stats }, crowd: { ...this.crowd.stats, farNet: this.net?.farCount ?? 0 }, vehicles: this.traffic.stats.active, stoppedAtRed: this.traffic.stats2.stoppedAtRed,
      player: { x: this.player.x, y: this.player.y, z: this.player.z },
    };
  }

  /** acesso para automação (screenshots/validação) */
  debugApi() {
    return {
      setShot: (n: string) => this.setShot(n),
      /** QA: intervalos dos quadros renderizados desde a última chamada */
      takeFrames: () => this.frameLog.splice(0),
      /** QA: número de pedestres (medir o custo dos personagens) */
      peds: (n: number) => this.peds.setMax(n),
      metrics: () => this.metrics(),
      /** QA: relatório de memória por categoria (docs/MEMORY.md); dup=false pula a busca de duplicatas */
      memoryReport: (dup = true) => memoryReport(this.gr.renderer, this.scene, { duplicates: dup }),
      teleport: (x: number, z: number, yaw?: number) => {
        this.player.x = x; this.player.z = z; this.player.y = this.collision.groundHeight(x, z);
        if (yaw !== undefined) { this.cam.yaw = yaw; this.player.heading = yaw; }
        this.intro.active = false;
      },
      camera: (yaw: number, pitch: number, dist: number) => { this.cam.maxDistance = Math.max(16, dist); this.cam.yaw = yaw; this.cam.pitch = pitch; this.cam.zoom(Math.log(dist / this.cam.distance)); this.intro.active = false; },
      /** QA: câmera livre (x,y,z) olhando para (tx,ty,tz); sem argumentos volta à câmera do jogador */
      lookFrom: (x?: number, y?: number, z?: number, tx = 0, ty = 0, tz = 0) => { this.freeCam = x === undefined ? null : { p: [x, y!, z!], t: [tx, ty, tz] }; this.intro.active = false; },
      portrait: (dist = 3) => { this.cam.yaw = this.player.heading + Math.PI; this.cam.pitch = 0.08; this.cam.zoom(Math.log(dist / this.cam.distance)); this.intro.active = false; },
      /** teste: vai até a estação de bicicleta mais próxima e monta */
      ride: () => {
        const st = (this.manifest.bikeStations ?? []).slice().sort((a, b) => Math.hypot(a.p[0] - this.player.x, a.p[1] - this.player.z) - Math.hypot(b.p[0] - this.player.x, b.p[1] - this.player.z))[0];
        if (!st) return false;
        this.player.x = st.p[0]; this.player.z = st.p[1] + 1.2; this.intro.active = false;
        this.input.queueToggle('use');
        return true;
      },
      press: (code: string, ms = 1000) => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), ms); },
      riding: () => this.riding?.def.kind ?? null,
      ridingId: () => this.riding?.state.id ?? null,
      carHeading: () => this.riding?.state.heading ?? null,
      /** anda até (x,z) usando o movimento normal (aceito pelo servidor) */
      walkTo: (x: number, z: number, run = true) => { this.autopilot = { x, z }; this.autopilotRun = run; this.intro.active = false; },
      arrived: () => !this.autopilot,
      stopWalk: () => { this.autopilot = null; },
      /** TESTE DE TRAPAÇA: envia ao servidor uma posição arbitrária sem passar pela colisão local */
      cheatMove: (x: number, z: number) => this.net?.sendRawMove(x, z),
      /** TESTE: cliente modificado pede para entrar num veículo ignorando o estado local */
      rawEnter: (id: string) => this.net?.requestEnter(id),
      /** TESTE: cliente modificado pede empurrão em um alvo arbitrário */
      rawPush: (target: string) => this.net?.requestPush(target),
      lastDenial: () => this.net?.lastDenial ?? '',
      mp: () => (this.net ? { session: this.net.sessionId, self: { ...this.net.self }, remotes: this.net.remotesInfo(), bandwidth: this.net.bandwidth, interpDelay: this.net.interpDelay, rtt: worldClock.rtt, clockOffset: worldClock.offsetMs, corrections: this.net.corrections, correctionReasons: this.net.correctionReasons, policy: this.net.policy } : null),
      vehicles: () => this.rideables.items.filter((i) => i.def.kind === 'car').map((i) => ({ id: i.state.id, x: +i.state.x.toFixed(2), z: +i.state.z.toFixed(2), heading: +i.state.heading.toFixed(3), occupant: i.state.occupant })),
      signalState: (j: number, ph: number) => this.signals.state(j, ph),
      trafficIds: (x: number, z: number, r: number) => this.traffic.vehicles.filter((v) => Math.hypot(v.x - x, v.z - z) < r).map((v) => ({ id: v.id, x: +v.x.toFixed(1), z: +v.z.toFixed(1) })),
      key: (code: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code })), 60); },
      isDown: () => this.avatar.isDown,
      groundAt: (x: number, z: number) => this.collision.groundHeight(x, z),
      toggleDebug: () => this.debug.toggle(),
      /** identifica o objeto sob um pixel (coordenadas de tela) */
      pick: (px: number, py: number) => {
        const rc = new THREE.Raycaster();
        const r = this.canvas.getBoundingClientRect();
        rc.setFromCamera(new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1), this.camera);
        const pickable: THREE.Object3D[] = [];
        this.scene.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g?.attributes?.position?.array) pickable.push(o); });
        const hit = rc.intersectObjects(pickable, false).find((h) => h.object.visible && h.object.name !== 'clouds' && !(h.object as any).isSky);
        if (!hit) return null;
        const geo = (hit.object as THREE.Mesh).geometry as THREE.BufferGeometry;
        const f1 = geo.getAttribute('aFacade'), f2 = geo.getAttribute('aFacade2');
        const vi = hit.face?.a ?? 0;
        return {
          name: hit.object.name, parent: hit.object.parent?.name, point: hit.point.toArray(), normal: hit.face?.normal.toArray(),
          facade: f1 ? [f1.getX(vi), f1.getY(vi), f1.getZ(vi), f1.getW(vi)] : null, facade2: f2 ? [f2.getX(vi), f2.getY(vi), f2.getZ(vi), f2.getW(vi)] : null,
        };
      },
      hud: (v: boolean) => { this.hud.style.display = v ? '' : 'none'; },
      /** painéis de LED: conteúdo por painel ('*' = todos). Preparado para o backend. */
      billboard: (id: string, content: unknown) => this.billboards.setPanelContent(id, content as never),
      billboards: () => this.manifest.billboards ?? [],
      event: async (id: string) => { await this.events.load(id); return this.events.current?.name; },
      env: () => ({
        sunDir: this.env.sunDir.toArray(), sunI: this.env.sun.intensity, night: this.env.night,
        castShadow: this.env.sun.castShadow, shadowEnabled: this.gr.renderer.shadowMap.enabled,
        sunPos: this.env.sun.position.toArray(), target: this.env.sun.target.position.toArray(),
        exposure: this.gr.renderer.toneMappingExposure, sim: this.simTime.toISOString(),
        shadowUV: (() => {
          const v = new THREE.Vector4(this.player.x, this.player.y, this.player.z, 1).applyMatrix4(this.env.sun.shadow.matrix);
          return [v.x, v.y, v.z, v.w];
        })(),
        camPos: this.env.sun.shadow.camera.position.toArray(),
        mapSize: this.env.sun.shadow.mapSize.toArray(),
        hasMap: !!this.env.sun.shadow.map,
      }),
    };
  }
}

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}
