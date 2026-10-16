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
import type { CharacterAppearance } from '../characters/bodyTypes';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../ui/TouchControls';
import { DebugPanel } from '../debug/DebugPanel';
import { Minimap } from '../debug/Minimap';
import { createLandmarkMaterials } from '../world/landmarks/arch';
import { buildCentral, type LandmarkInstance } from '../world/landmarks/central';
import { buildCandelaria } from '../world/landmarks/candelaria';
import { PedestrianSystem } from '../npc/PedestrianSystem';
import { TrafficSystem } from '../traffic/TrafficSystem';
import { SignalController } from '../traffic/SignalController';
import { MonumentSystem } from '../world/Monuments';
import { BillboardSystem } from '../events/Billboards';
import { EventManager } from '../events/EventManager';
import { RideableSystem, stepRideable, type RideableInstance } from '../vehicles/Rideable';
import { InteractionController } from '../interaction/InteractionMode';
import type { PropRec } from '../world/types';
import { distToPolyline } from '../geo/polyline';
import type { TrafficData } from '../world/types';

export { DEFAULT_PLAYER_APPEARANCE } from '../characters/bodyTypes';

export type ProgressFn = (fraction: number, label: string) => void;

/** Poses de câmera para validação/screenshots (?shot=...) */
export const SHOTS: Record<string, { key: string; along: number; side: number; yawTo?: string; yawAlong?: number; pitch: number; dist: number }> = {
  central: { key: 'LANDMARK_CENTRAL', along: 0, side: 0, pitch: 0.12, dist: 6 },
};

export class Game {
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
  private peds!: PedestrianSystem;
  private traffic!: TrafficSystem;
  private signals!: SignalController;
  private monuments!: MonumentSystem;
  private billboards!: BillboardSystem;
  readonly events!: EventManager;
  private rideables!: RideableSystem;
  private riding: RideableInstance | null = null;
  readonly interaction = new InteractionController();
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
    this.avatar = new AvatarVisual(appearance);
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
    this.chunks = new ChunkManager(this.manifest, base, lib, buildingMat, this.collision, this.props, this.preset);
    this.scene.add(this.chunks.group);

    const spawn = this.manifest.spawn;
    const spawnXZ = new THREE.Vector2(spawn.p[0], spawn.p[1]);
    progress(0.15, 'CARREGANDO CENTRO DO RIO');
    await this.chunks.preload(spawnXZ, this.preset.lodDistances[2], (d, t) => progress(0.15 + 0.5 * (d / t), `Baixando quarteirões ${d}/${t}`));

    progress(0.68, 'Construindo Central do Brasil e Candelária');
    await nextFrame();
    const archMats = createLandmarkMaterials(lib.noise);
    for (const lm of this.manifest.landmarks) {
      const inst = lm.key === 'LANDMARK_CENTRAL' ? buildCentral(lm, buildingMat, archMats) : buildCandelaria(lm, archMats);
      this.scene.add(inst.group);
      for (const c of inst.colliders) this.collision.addPolygon(c.poly, c.minHeight ?? 0, c.height);
      this.landmarks.push(inst);
    }

    // jogador
    const heading = Math.atan2(Math.cos(spawn.yaw), Math.sin(spawn.yaw));
    this.player = createPlayerState('local', spawn.p[0], this.collision.groundHeight(spawn.p[0], spawn.p[1]), spawn.p[1], heading);
    this.scene.add(this.avatar.root);
    this.peds = new PedestrianSystem(this.collision, this.preset.pedestrians);
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
    const kinds = (this.events.current?.vehicles ?? [{ kind: 'bicycle' }, { kind: 'scooter' }]).map((v) => v.kind).filter((k) => k !== 'car') as ('bicycle' | 'scooter')[];
    this.rideables = new RideableSystem(this.manifest.bikeStations ?? [], (x, z) => this.collision.groundHeight(x, z), kinds);
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
    } catch { /* compileAsync opcional */ }
    progress(1, 'Pronto');
    this.mountHud();
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

  start() {
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
    (window as any).__pvReady = true;
  }

  private frame() {
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

    // modo de interação / ações (pedidos — servidor será a autoridade)
    this.interaction.update(dt);
    if (this.input.consumeToggle('mode')) this.flash(this.interaction.toggle().message);
    if (this.input.consumeToggle('action')) {
      const r = this.interaction.request('empurrar', this.player.x, this.player.z, this.player.heading, this.time);
      if (r) { if (!this.peds.pushNear(r.x, r.z, r.dir)) this.flash('Ninguém ao alcance'); }
      else if (this.interaction.mode === 'pacifico') this.flash('Modo pacífico: aperte K para alternar (se o evento permitir)');
    }

    // usar/descer de veículo
    const ax = this.input.moveAxis();
    const [fx, fz] = this.cam.forward();
    if (this.input.consumeToggle('use')) {
      if (this.riding) {
        const v = this.riding;
        v.state.occupant = null;
        v.state.speed = 0;
        this.player.x = v.state.x + Math.cos(v.state.heading) * 0.9;
        this.player.z = v.state.z - Math.sin(v.state.heading) * 0.9;
        this.player.heading = v.state.heading;
        this.riding = null;
      } else {
        const near = this.rideables.nearest(this.player.x, this.player.z);
        if (near) { this.riding = near; near.state.occupant = this.player.id; near.state.heading = this.player.heading; }
      }
    }
    if (this.riding) {
      const v = this.riding;
      // A/D esterçam, W/S aceleram/freiam; câmera acompanha o rumo suavemente
      stepRideable(v.state, v.def, { throttle: ax.y, steer: -ax.x, boost: this.input.running() }, dt, this.collision);
      this.input.consumeJump();
      this.player.x = v.state.x; this.player.z = v.state.z; this.player.y = v.state.y;
      this.player.heading = v.state.heading; this.player.speed = Math.abs(v.state.speed);
      this.player.locomotion = 'walk';
      this.avatar.updateRiding(v.state.x, v.state.y, v.state.z, v.state.heading, v.def.pose, v.state.speed, v.def.seatHeight, dt);
      let dyaw = v.state.heading - this.cam.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      if (Math.abs(v.state.speed) > 1) this.cam.yaw += dyaw * Math.min(1, dt * 1.5);
      this.prompt.textContent = `E — descer da ${v.def.label.toLowerCase()} · W/S acelerar/frear · A/D virar · Shift mais rápido`;
    } else {
      // movimento a pé relativo à câmera
      const intent = {
        dirX: fx * ax.y + -Math.cos(this.cam.yaw) * ax.x,
        dirZ: fz * ax.y + Math.sin(this.cam.yaw) * ax.x,
        run: this.input.running(),
        jump: this.input.consumeJump(),
        speedFactor: this.avatar.speedFactor,
      };
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let i = 0; i < steps; i++) stepPlayer(this.player, intent, dt / steps, this.collision);
      this.traffic.pushOut(this.player);
      this.avatar.update(this.player, dt);
      const near = this.rideables.nearest(this.player.x, this.player.z);
      this.prompt.textContent = near ? `E — usar ${near.def.label.toLowerCase()}` : '';
    }
    this.rideables.sync(this.camera.position);
    this.prompt.classList.toggle('show', !!this.prompt.textContent);
    this.messageTimer -= dt;
    if (this.messageTimer <= 0) this.modeBadge.textContent = this.interaction.mode === 'pacifico' ? 'Modo pacífico' : 'Modo interação';
    this.modeBadge.classList.toggle('combat', this.interaction.mode === 'interacao');
    const ppos = this.avatar.root.position;
    this.cam.update(ppos, dt);
    this.signals.update(dt);
    this.peds.update(dt, this.camera, this.player);
    this.traffic.obstacles = this.peds.crossingPositions();
    this.traffic.update(dt, this.camera, this.player);
    this.props.updateSignals((j, ph) => this.signals.state(j, ph));

    // mundo
    const camXZ = new THREE.Vector2(this.camera.position.x, this.camera.position.z);
    this.chunks.update(camXZ, 5);
    this.props.update(this.time);
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
      npcs: `pedestres ${this.peds.stats.visible}/${this.peds.stats.active} (atravessando ${this.peds.stats.crossing}) · veículos ${this.traffic.stats.active} (parados no vermelho ${this.traffic.stats2.stoppedAtRed})`,
    });
  }

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
    return {
      fps: this.debug.fps, frameMs: this.debug.frameMs, worstMs: this.debug.worstMs,
      calls: r.render.calls, triangles: r.render.triangles, textures: r.memory.textures, geometries: r.memory.geometries,
      quality: this.preset.level, chunks: { ...this.chunks.stats }, props: this.props.instanceCount,
      pedestrians: { ...this.peds.stats }, vehicles: this.traffic.stats.active, stoppedAtRed: this.traffic.stats2.stoppedAtRed,
      player: { x: this.player.x, y: this.player.y, z: this.player.z },
    };
  }

  /** acesso para automação (screenshots/validação) */
  debugApi() {
    return {
      setShot: (n: string) => this.setShot(n),
      metrics: () => this.metrics(),
      teleport: (x: number, z: number, yaw?: number) => {
        this.player.x = x; this.player.z = z; this.player.y = this.collision.groundHeight(x, z);
        if (yaw !== undefined) { this.cam.yaw = yaw; this.player.heading = yaw; }
        this.intro.active = false;
      },
      camera: (yaw: number, pitch: number, dist: number) => { this.cam.maxDistance = Math.max(16, dist); this.cam.yaw = yaw; this.cam.pitch = pitch; this.cam.zoom(Math.log(dist / this.cam.distance)); this.intro.active = false; },
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
      toggleDebug: () => this.debug.toggle(),
      /** identifica o objeto sob um pixel (coordenadas de tela) */
      pick: (px: number, py: number) => {
        const rc = new THREE.Raycaster();
        const r = this.canvas.getBoundingClientRect();
        rc.setFromCamera(new THREE.Vector2((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1), this.camera);
        const hit = rc.intersectObjects(this.scene.children, true).find((h) => h.object.visible && h.object.name !== 'clouds' && !(h.object as any).isSky);
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
