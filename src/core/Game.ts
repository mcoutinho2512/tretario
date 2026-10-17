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
import { BOXED_KINDS, EVENT_VEHICLE_KINDS, boxesOverlap, impactAllowed, pushOutOfBox, vehicleBlock, type Mode, type VehicleKind } from '../net/rules';
import { HumanCharacter } from '../characters/human/HumanCharacter';
import { registerCampaigns, DESIGN_BY_KEY } from '../social/designs';
import { SocialController } from '../social/SocialController';
import { RallyCrowd } from '../social/RallyCrowd';
import { rallyPoints } from '../social/rally';
import { ActionWheel } from '../ui/ActionWheel';
import { NET_TICK_HZ } from '../net/protocol';
import { ACTION_BY_KEY, ACTION_BY_ID } from '../social/actions';
import { PROP_BY_KIND, type PropKind } from '../social/props';
import { FrameGovernor } from './frameGovernor';
import { deviceProfile } from './settings';
import { loadClips, loadLod, preloadCrowd } from '../characters/human/HumanAssets';
import { DEFAULT_PLAYER_APPEARANCE as DEFAULT_APPS, type CharacterAppearance } from '../characters/bodyTypes';
const DEFAULT_PLAYER_APPEARANCE_LOCAL = DEFAULT_APPS.homem;
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { InputManager } from '../input/InputManager';
import { TouchControls } from '../ui/TouchControls';
import { mountChat, type ChatPanel } from '../ui/ChatPanel';
import { DebugPanel } from '../debug/DebugPanel';
import { Minimap } from '../debug/Minimap';
import { createLandmarkMaterials, loadLandmarkTextures } from '../world/landmarks/arch';
import { buildCentral, type LandmarkInstance } from '../world/landmarks/central';
import { buildCandelaria } from '../world/landmarks/candelaria';
import { buildModelBuilding } from '../world/landmarks/models';
import { PedestrianSystem } from '../npc/PedestrianSystem';
import { CrowdDirector } from '../characters/crowd/CrowdDirector';
import { ClosureDressing } from '../world/closure';
import { loadVehicleModels } from '../traffic/vehicleModels';
import { SignalController } from '../traffic/SignalController';
import { worldClock } from '../net/clock';
import { MonumentSystem } from '../world/Monuments';
import { BillboardSystem } from '../events/Billboards';
import { EventManager } from '../events/EventManager';
import { RideableSystem, seatWorld, stepRideable, type RideableInstance } from '../vehicles/Rideable';
// ---- rodada 7: veículos de evento (trio elétrico, carro de som) e cenário (caminhões, telões, palco)
import { EventScenery } from '../world/eventScenery';
import { TrioRider } from '../vehicles/trioRider';
import { TRIO, exitPoints, localToWorld } from '../vehicles/platform';
import { screenFeed } from '../events/screenFeed';
import { InteractionController } from '../interaction/InteractionMode';
import type { KnockMsg } from '../net/NetworkClient';
import { preloadRagdoll } from '../physics/Ragdoll';
import type { NetworkClient } from '../net/NetworkClient';
import type { PropRec, BuildingRec } from '../world/types';
import { distToPolyline } from '../geo/polyline';
import { memoryReport } from '../debug/memoryReport';
import { GraffitiSystem } from '../graffiti/GraffitiSystem';
import type { TrafficData } from '../world/types';

export { DEFAULT_PLAYER_APPEARANCE } from '../characters/bodyTypes';

export type ProgressFn = (fraction: number, label: string) => void;

/** Poses de câmera para validação/screenshots (?shot=...) */
export const SHOTS: Record<string, { key: string; along: number; side: number; yawTo?: string; yawAlong?: number; pitch: number; dist: number }> = {
  central: { key: 'LANDMARK_CENTRAL', along: 0, side: 0, pitch: 0.12, dist: 6 },
};

/** controles exibidos enquanto se usa cada veículo */
const RIDE_HELP: Record<string, string> = {
  car: 'E — sair · W acelerar · S frear/ré · A/D volante · Shift mais rápido (limite urbano 30 km/h)',
  moto: 'E — sair · W acelerar · S frear · A/D guidão · Shift mais rápido (limite 30 km/h)',
  bicycle: 'E — descer · W pedalar · S frear · A/D guidão · Shift pedalar forte',
  scooter: 'E — descer · W acelerar · S frear · A/D guidão · Shift mais rápido (limite 20 km/h)',
  soundcar: 'E — sair · W acelerar · S frear/ré · A/D volante · passo de cortejo (até 15 km/h)',
  trio: 'E — sair · W andar · S frear/ré · A/D volante · trio elétrico: bem devagar (até 5 km/h)',
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
  private closure!: ClosureDressing;
  private signals!: SignalController;
  private monuments!: MonumentSystem;
  private billboards!: BillboardSystem;
  readonly events!: EventManager;
  private rideables!: RideableSystem;
  private riding: RideableInstance | null = null;
  /** pichação/grafite (src/graffiti): superfícies autorizadas, editor, decalques, moderação */
  private graffiti!: GraffitiSystem;
  /** cenário de evento e jogador local em cima do trio (rodada 7) */
  private scenery!: EventScenery;
  private trio = new TrioRider();
  private pendingBoard = false;
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
      } catch { /* dados de cruzamentos são opcionais */ }
    }
    // SEM trânsito NPC (rodada 7): a avenida está fechada para o evento. Os semáforos continuam no cenário e
    // ainda orientam a travessia dos pedestres NPC; os veículos são só os dos jogadores (estacionados até alguém usar).
    this.signals = new SignalController(tdata.junctions);
    await loadVehicleModels(); // modelos GLB dos veículos (reserva procedural se falhar)
    this.peds.setCrossings(tdata.crossings, this.signals);
    // cenário de avenida fechada: gradis nas pontas/cruzamentos e ônibus estacionados (não utilizáveis)
    this.closure = new ClosureDressing(this.manifest, (x: number, z: number) => this.collision.groundHeight(x, z), this.collision);
    this.scene.add(this.closure.group);
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
    this.peds.setSocialConfig(this.events.current?.social);
    // multidão de concentração (instanciada) ao redor do trio/carros de som/palco — quantidade pelo evento e preset
    this.rallyCrowd = new RallyCrowd(this.collision, this.crowd, this.events.current?.social ?? { activity: 0.25, propShare: 0.06 });
    this.rallyCrowd.setConfig(this.events.current?.social, RallyCrowd.presetScale(this.crowd.budget.total));
    // designs de campanha (DADOS, não código): mesmo arquivo que o servidor usa para validar
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}designs/campaigns.json`);
      if (r.ok) registerCampaigns(await r.json());
    } catch (e) { console.warn('designs de campanha não carregados', e); }
    this.interaction.setPolicy(this.events.current?.interaction);
    // veículos utilizáveis nas estações reais de bicicleta compartilhada
    const kinds = (this.events.current?.vehicles ?? [{ kind: 'bicycle' }, { kind: 'scooter' }, { kind: 'car' }, { kind: 'moto' }]).map((v) => v.kind);
    this.rideables = new RideableSystem(this.manifest.vehicleSpawns ?? [], (x, z) => this.collision.groundHeight(x, z), kinds);
    this.scene.add(this.rideables.group);
    this.graffiti = new GraffitiSystem(this.hud, this.input.isTouch, this.preset.level);
    this.graffiti.onNotice = (m) => this.flash(m);
    await this.graffiti.load(base, (x, z) => this.collision.groundHeight(x, z), (ring, b, t) => this.collision.addPolygon(ring, b, t));
    this.scene.add(this.graffiti.group);
    // cenário de evento (caminhões de campanha, telões, palco) + telão do trio no mesmo canal
    this.scenery = new EventScenery(this.manifest, (x, z) => this.collision.groundHeight(x, z), this.collision);
    this.scenery.applyEvent(this.events.current);
    for (const it of this.rideables.eventItems()) this.scenery.addScreens(it.model);
    this.scene.add(this.scenery.group);
    screenFeed().info = () => ({ time: this.simTime.toTimeString().slice(0, 5), players: 1 + (this.net?.remoteCount ?? 0) + (this.net?.farCount ?? 0) });
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
      // personagem detalhado novo: compila os shaders E sobe as texturas para a GPU, UMA por quadro, antes de aparecer.
      // Sem isso as 12–14 texturas de um corpo subiam todas no 1º quadro visível (travada de 50–100 ms correndo)
      const uploaded = new WeakSet<THREE.Texture>();
      const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      HumanCharacter.warmup = async (obj) => {
        await this.gr.renderer.compileAsync(obj, this.camera, this.scene);
        const texs = new Set<THREE.Texture>();
        obj.traverse((o) => {
          const mats = (o as THREE.Mesh).material;
          if (!mats) return;
          for (const m of Array.isArray(mats) ? mats : [mats]) {
            for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture && !uploaded.has(v as THREE.Texture)) texs.add(v as THREE.Texture);
          }
        });
        for (const t of texs) { uploaded.add(t); this.gr.renderer.initTexture(t); await nextFrame(); }
      };
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
      : '<b>WASD</b> andar · <b>Shift</b> correr · <b>Espaço</b> pular · <b>Mouse</b> câmera · <b>Roda</b> zoom · <b>E</b> usar veículo / subir no trio / pichar · <b>G</b> ações · <b>K</b> modo · <b>M</b> mapa · <b>F3</b> debug · <b>H</b> ajuda · <b>Esc</b> soltar mouse';
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
    this.wheel = new ActionWheel(this.social);
    // roda aberta: solta o mouse para clicar; fechada: volta a controlar a câmera
    this.wheel.onToggle = (open) => { if (open) document.exitPointerLock?.(); else if (!this.input.isTouch) this.input.requestLock(); };
    this.hud.appendChild(this.wheel.el);
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
    this.governor = new FrameGovernor(this.preset.targetFps ?? 60, this.preset.dynamicResolution ?? false, 0.55, new URLSearchParams(location.search).get('uncapped') === '1');
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
    if (new URLSearchParams(location.search).has('mem') || import.meta.env.DEV) (window as any).__pvScene = this.scene; // QA de memória
  }

  private cpuMs = 0;
  /** ações sociais / item na mão do jogador local (previsão + servidor) */
  private wheel: ActionWheel | null = null;
  private chat: ChatPanel | null = null;
  private rallyCrowd: RallyCrowd | null = null;
  readonly social = new SocialController((s) => this.avatar.setSocial(s), () => (this.mpOnline ? this.net! : null), (m) => this.flash(m));
  /** quadros longos (> 34 ms de CPU) com a divisão por etapa */
  private hitchLog: { t: number; ms: number; parts: Record<string, number>; novos: Record<string, number> }[] = [];

  private frame() {
    const tCpu = performance.now();
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    this.debug.tick();

    // toggles
    if (this.input.consumeToggle('debug')) this.debug.toggle();
    if (this.input.consumeToggle('map')) this.minimap.toggleExpanded();
    if (this.input.consumeToggle('help')) this.hud.querySelector('.help')?.classList.toggle('faded');
    if (this.input.consumeToggle('wheel')) this.wheel?.toggle();
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

    const T: [string, number][] = [['início', performance.now()]];
    const mark = (n: string) => T.push([n, performance.now()]);
    this.updateInteraction(dt);
    this.updateMovement(dt);
    // andar cancela ação incompatível; caído/veículo encerram (mesmas regras do servidor: deslocamento por mensagem
    // de movimento = velocidade / NET_TICK_HZ)
    this.social.update(Math.abs(this.player.speed) / NET_TICK_HZ, this.avatar.isDown || !!this.riding);
    mark('movimento');
    const ppos = this.avatar.root.position;
    this.cam.update(ppos, dt);
    if (this.freeCam) { this.camera.position.set(...this.freeCam.p); this.camera.lookAt(...this.freeCam.t); }
    this.signals.setTime(worldClock.seconds());
    if (this.net) {
      this.net.update(dt, this.player, this.riding ? this.riding.state.id : null, this.camera, { w: this.canvas.clientWidth, h: this.canvas.clientHeight });
      this.rideables.smooth(dt, this.net.sessionId);
    }
    this.graffiti.update(dt, this.camera.position, this.player);
    mark('rede');
    this.peds.update(dt, this.camera, this.player);
    this.rallyCrowd?.update(dt);
    mark('pedestres');
    this.crowd.end(this.camera, dt);
    mark('multidão');
    this.closure.update(this.camera.position);
    this.scenery.update(dt, this.camera.position, this.env.night);
    this.props.updateSignals((j, ph) => this.signals.state(j, ph));

    // mundo
    const camXZ = new THREE.Vector2(this.camera.position.x, this.camera.position.z);
    this.chunks.update(camXZ, 5);
    mark('chunks');
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
    mark('mundo');

    const ri = this.gr.renderer.info, before = { p: ri.programs?.length ?? 0, g: ri.memory.geometries, t: ri.memory.textures };
    this.gr.render(this.scene, this.camera);
    mark('render');
    if (T[T.length - 1][1] - tCpu > 34 && this.hitchLog.length < 200) {
      // quadro longo: guarda a divisão por etapa (QA de travadas: __pv.hitches())
      const parts: Record<string, number> = { antes: +(T[0][1] - tCpu).toFixed(1) };
      for (let i = 1; i < T.length; i++) parts[T[i][0]] = +(T[i][1] - T[i - 1][1]).toFixed(1);
      this.hitchLog.push({ t: +this.time.toFixed(2), ms: +(T[T.length - 1][1] - tCpu).toFixed(1), parts, novos: { programas: (ri.programs?.length ?? 0) - before.p, geometrias: ri.memory.geometries - before.g, texturas: ri.memory.textures - before.t } });
    }
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
      npcs: `${this.net ? `MP ${this.net.status} · remotos ${this.net.remoteCount} · correções ${this.net.corrections} · ↓${(this.net.bandwidth.inBps / 1024).toFixed(1)} KB/s ↑${(this.net.bandwidth.outBps / 1024).toFixed(1)} KB/s · RTT ${worldClock.rtt === Infinity ? '—' : worldClock.rtt.toFixed(0)} ms · interp ${this.net.interpDelay.toFixed(0)} ms<br>` : ''}pedestres ${this.peds.stats.visible}/${this.peds.stats.active} (atravessando ${this.peds.stats.crossing}) · humanos ${this.crowd.stats.skinned} esqueleto + ${this.crowd.stats.drawnInstanced} instanciados (${this.crowd.stats.instancedCalls} draws) · veículos de jogadores ${this.rideables.items.length} (${this.rideables.items.filter((it) => it.state.occupant).length} em uso) · sem trânsito NPC`,
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
    this.graffiti.attachNet(this.net);
    // chat (src/ui/ChatPanel): painel + botão CHAT no toque; digitar não move o jogador
    this.chat = mountChat(this.hud, this.net, { isTouch: this.input.isTouch, input: this.input, onToggle: (open) => { if (open) document.exitPointerLock?.(); } });
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
    this.net.onVehicle = (id, v) => this.rideables.applyServer(id, v.x, v.y, v.z, v.heading, v.occupant, this.net!.sessionId, v.state, v.design);
    // trio elétrico: passageiros presos à pose do trio COMO ESTE CLIENTE O DESENHA
    this.net.platformPose = (id) => { const it = this.rideables.byId.get(id); return it ? it.state : null; };
    this.net.onBoard = (ok, d) => {
      this.pendingBoard = false;
      if (ok) { this.trio.board(d.id, d.lx, d.lz); this.cam.setProfile('foot'); this.flash('Você subiu no trio elétrico (servidor confirmou)'); }
      else this.flash(d.reason === 'lotado' ? 'O trio está lotado' : `Não foi possível subir (${d.reason})`);
    };
    this.net.onUnboard = (pos) => this.leaveTrioLocal(pos);
    this.net.onPlatformCorrect = (lx, lz) => this.trio.correct(lx, lz);
    this.net.onEnter = (ok, d) => {
      const it = this.rideables.byId.get(d.id);
      if (ok && it) { it.state.x = d.x ?? it.state.x; it.state.z = d.z ?? it.state.z; it.state.heading = d.heading ?? it.state.heading; this.mountLocal(it); this.flash(it.def.kind === 'car' ? 'Você está dirigindo (servidor confirmou)' : `${it.def.label}: em uso (servidor confirmou)`); }
      else this.flash(d.reason === 'ocupado' ? 'Esse veículo já está sendo usado por outro jogador' : `Não foi possível entrar (${d.reason})`);
      this.pendingEnter = null;
    };
    this.net.onExit = (pos) => this.dismountLocal(pos);
    this.net.onKnock = (k, isSelf) => { if (isSelf) this.onSelfKnock(k); };
    this.net.onNotice = (m) => this.flash(m);
    this.net.onSelfSocial = () => this.social.fromServer(this.net!.self.social);
    this.net.onSocialDenied = (_k, reason) => this.social.denied(reason, this.net!.self.social);
    this.net.onEvent = (id) => {
      if (this.events.current?.id !== id) void this.events.load(id).then(() => { this.interaction.setPolicy(this.events.current?.interaction); this.peds.setSocialConfig(this.events.current?.social); this.rallyCrowd?.setConfig(this.events.current?.social, RallyCrowd.presetScale(this.crowd.budget.total)); this.scenery.applyEvent(this.events.current); });
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

  /** desce do trio (servidor confirmou, ou offline): pé da escada */
  private leaveTrioLocal(pos?: { x: number; z: number }) {
    const s = this.trio.state;
    this.trio.unboard();
    if (this.net) this.net.platform = null;
    if (!pos && s) { const it = this.rideables.byId.get(s.id); if (it) pos = localToWorld(it.state, TRIO.ladderFoot[0], TRIO.ladderFoot[1]); }
    if (pos) { this.player.x = pos.x; this.player.z = pos.z; }
    this.player.y = this.collision.groundHeight(this.player.x, this.player.z);
    this.pendingBoard = false;
  }

  private dismountLocal(pos?: { x: number; z: number }) {
    const v = this.riding;
    if (!v) return;
    v.state.occupant = null;
    v.state.speed = 0;
    if (!pos && EVENT_VEHICLE_KINDS.has(v.def.kind)) pos = exitPoints(v.def.kind, v.state)[0];
    if (pos) { this.player.x = pos.x; this.player.z = pos.z; }
    else { const side = v.def.kind === 'car' ? -1.6 : v.def.kind === 'moto' ? 1.0 : 0.9; this.player.x = v.state.x + Math.cos(v.state.heading) * side; this.player.z = v.state.z - Math.sin(v.state.heading) * side; }
    this.player.y = this.collision.groundHeight(this.player.x, this.player.z);
    this.player.heading = v.state.heading;
    this.riding = null;
    this.cam.setProfile('foot');
  }

  private pendingEnter: string | null = null;

  private updateMovement(dt: number) {
    const ax = this.graffiti.editing ? { x: 0, y: 0 } : this.input.moveAxis(); // desenhando: parado
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
      const ladder = !this.riding && !this.trio.active ? this.rideables.nearestLadder(this.player.x, this.player.z) : null;
      if (this.trio.active) {
        // em cima do trio: E desce pela escada
        if (this.mpOnline) { this.pendingBoard = true; this.net!.requestUnboard(); } else this.leaveTrioLocal();
      } else if (ladder) {
        if (this.mpOnline) { this.pendingBoard = true; this.net!.requestBoard(ladder.state.id); this.flash('Subindo… (aguardando o servidor)'); }
        else this.trio.board(ladder.state.id);
      } else if (this.riding) {
        if (this.mpOnline) this.net!.requestExit();
        else this.dismountLocal();
      } else {
        const near = this.rideables.nearest(this.player.x, this.player.z);
        if (near) {
          if (this.mpOnline) { this.pendingEnter = near.state.id; this.net!.requestEnter(near.state.id); this.flash(`Entrando… (aguardando o servidor)`); }
          else this.mountLocal(near);
        } else this.graffiti.tryOpen(this.player); // sem veículo perto: parede/tapume/chão autorizado
      }
    }
    if (this.avatar.isDown) {
      // caído: sem controle; o servidor decide quando levanta
      this.input.consumeJump();
      this.player.speed = 0;
      this.player.locomotion = 'idle';
      this.avatar.update(this.player, dt);
      this.prompt.textContent = 'Caído… levantando em instantes';
    } else if (this.trio.active) {
      // em cima do trio: anda no piso (posição LOCAL); o mundo vem da pose do trio
      const it = this.rideables.byId.get(this.trio.state!.id);
      if (!it) this.leaveTrioLocal();
      else {
        this.input.consumeJump();
        this.trio.step(this.player, it.state, fx * ax.y + -Math.cos(this.cam.yaw) * ax.x, fz * ax.y + Math.sin(this.cam.yaw) * ax.x, this.input.running(), dt);
        if (this.net) this.net.platform = this.trio.state;
        this.avatar.update(this.player, dt);
        this.prompt.textContent = this.pendingBoard ? 'Aguardando o servidor…' : 'E — DESCER DO TRIO · WASD andar em cima';
      }
    } else if (this.riding) {
      const v = this.riding;
      const prev = { x: v.state.x, z: v.state.z };
      stepRideable(v.state, v.def, { throttle: ax.y, steer: -ax.x, boost: this.input.running() }, dt, this.collision);
      {
        // MODO PACÍFICO (padrão): o veículo para antes de encostar em qualquer pessoa — mesma regra do servidor
        // (vehicleBlock). Atropelamento só existe entre jogadores em modo interação, com carro/moto (servidor decide).
        const kind = v.def.kind as VehicleKind;
        const blockers = [
          ...(this.net?.remotesForObstacles() ?? []).filter((r) => !r.vehicle && !r.platform && !((kind === 'car' || kind === 'moto') && impactAllowed(this.interaction.mode, r.interaction as Mode) && r.status === 0)),
          // NPCs de ambiente travariam o trio no meio da própria concentração: para veículos de evento eles abrem caminho
          ...(EVENT_VEHICLE_KINDS.has(kind) ? [] : this.peds.nearby(v.state.x, v.state.z, 8)),
        ];
        if (EVENT_VEHICLE_KINDS.has(kind)) this.peds.yieldTo({ x: v.state.x, z: v.state.z, heading: v.state.heading, kind });
        if (blockers.length) {
          const b = vehicleBlock(kind, prev, { x: v.state.x, z: v.state.z }, v.state.heading, blockers);
          if (b.blocked) { v.state.x = b.x; v.state.z = b.z; v.state.speed = 0; }
        }
        // trio/carro de som são sólidos para os outros veículos (e vice-versa) — mesma regra do servidor
        for (const o of this.rideables.items) {
          if (o === v || (!EVENT_VEHICLE_KINDS.has(kind) && !EVENT_VEHICLE_KINDS.has(o.def.kind))) continue;
          if (Math.hypot(o.state.x - v.state.x, o.state.z - v.state.z) > 20) continue;
          const os = { x: o.state.x, z: o.state.z, heading: o.state.heading, kind: o.def.kind };
          if (boxesOverlap({ x: v.state.x, z: v.state.z, heading: v.state.heading, kind }, os) && !boxesOverlap({ x: prev.x, z: prev.z, heading: v.state.heading, kind }, os)) { v.state.x = prev.x; v.state.z = prev.z; v.state.speed = 0; }
        }
      }
      this.input.consumeJump();
      this.player.x = v.state.x; this.player.z = v.state.z; this.player.y = v.state.y;
      this.player.heading = v.state.heading; this.player.speed = Math.abs(v.state.speed);
      this.player.locomotion = 'walk';
      const seat = seatWorld(v.def, v.state.x, v.state.z, v.state.heading);
      this.avatar.updateRiding(seat.x, v.state.y, seat.z, v.state.heading, v.def.pose, v.state.speed, v.def.seatHeight, dt);
      let dyaw = v.state.heading - this.cam.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      if (Math.abs(v.state.speed) > 1) this.cam.yaw += dyaw * Math.min(1, dt * (v.def.kind === 'car' ? 2.2 : 1.5));
      this.prompt.textContent = RIDE_HELP[v.def.kind];
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
      for (const it of this.rideables.items) if (BOXED_KINDS.has(it.def.kind) && it !== this.riding) {
        // carros, motos, carros de som e o trio (estacionados ou andando) são sólidos
        if (Math.hypot(this.player.x - it.state.x, this.player.z - it.state.z) > 10) continue;
        const o = pushOutOfBox(this.player.x, this.player.z, { x: it.state.x, z: it.state.z, heading: it.state.heading, kind: it.def.kind }, 0.35);
        if (o) { this.player.x = o.x; this.player.z = o.z; }
      }
      this.avatar.update(this.player, dt);
      const near = this.rideables.nearest(this.player.x, this.player.z);
      const ladder = this.rideables.nearestLadder(this.player.x, this.player.z);
      this.prompt.textContent = this.pendingEnter || this.pendingBoard ? 'Aguardando o servidor…' : ladder ? 'E — SUBIR NO TRIO' : near ? (near.def.kind === 'trio' ? 'E — DIRIGIR O TRIO ELÉTRICO' : `E — USAR ${near.def.label.toUpperCase()}`) : this.graffiti.promptText();
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
      pedestrians: { ...this.peds.stats }, crowd: { ...this.crowd.stats, farNet: this.net?.farCount ?? 0 }, npcVehicles: 0, playerVehicles: this.rideables.items.length,
      player: { x: this.player.x, y: this.player.y, z: this.player.z },
    };
  }

  /** acesso para automação (screenshots/validação) */
  debugApi() {
    return {
      setShot: (n: string) => this.setShot(n),
      /** QA: grafites conhecidos por este cliente (estado, autor, bytes, tile) e ganchos (superfícies próximas, editor…) */
      graffiti: () => this.graffiti.info(),
      gf: this.graffiti.qa,
      /** QA: chat (mensagens recebidas/visíveis, abrir, digitar, mutar, denunciar) */
      chat: () => this.chat?.qa ?? null,
      /** QA: intervalos dos quadros renderizados desde a última chamada */
      takeFrames: () => this.frameLog.splice(0),
      /** QA: altura do chão sob o jogador e alturas do personagem (contato com o chão) */
      avatarProbe: () => ({ ground: +this.collision.groundHeight(this.player.x, this.player.z).toFixed(4), playerY: +this.player.y.toFixed(4), speed: +this.player.speed.toFixed(2), grounded: this.player.grounded, ...this.avatar.probe() }),
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
      // ---- trio elétrico / veículos de evento (QA: tools/qa/trio_mp.mjs)
      /** em cima do trio? {id, lx, lz, lh} */
      platform: () => (this.trio.state ? { ...this.trio.state } : null),
      /** pose do trio (ou de qualquer veículo) como este cliente o desenha */
      vehiclePose: (id: string) => { const it = this.rideables.byId.get(id); return it ? { x: it.state.x, y: it.state.y, z: it.state.z, heading: it.state.heading, occupant: it.state.occupant, design: it.design } : null; },
      /** posição DESENHADA de cada remoto (para medir o erro relativo ao trio) */
      remoteDrawn: () => this.net?.remotesInfo() ?? [],
      /** cenário de evento (caminhões/telões/palco) e troca de arte por id → chave/id de design */
      eventScenery: () => this.scenery.items.map((i) => ({ id: i.spot.id, kind: i.spot.kind, x: i.spot.x, z: i.spot.z, heading: i.spot.heading, design: i.design })),
      setSceneryDesign: (id: string, design: string | number) => this.scenery.setDesign(id, design),
      /** QA local (sem servidor): arte dos painéis de um veículo de evento */
      setVehicleDesign: (id: string, design: number) => { const it = this.rideables.byId.get(id); if (!it) return false; this.rideables.applyServer(id, it.state.x, it.state.y, it.state.z, it.state.heading, it.state.occupant ?? '', this.net?.sessionId ?? '', it.netState, design); return true; },
      screenFeed: () => { const f = screenFeed(); return { draws: f.draws, slide: f.slideIndex, slides: f.playlist.length }; },
      /** QA de custo: mostra/esconde um objeto da cena pelo nome (medir draw calls/triângulos com e sem) */
      showObject: (name: string, visible: boolean) => { const o = this.scene.getObjectByName(name); for (const c of o?.children ?? []) c.visible = visible; return !!o; },
      ridingId: () => this.riding?.state.id ?? null,
      carHeading: () => this.riding?.state.heading ?? null,
      /** anda até (x,z) usando o movimento normal (aceito pelo servidor) */
      hitches: () => this.hitchLog.slice(),
      rallyCrowd: () => ({ ...this.rallyCrowd?.stats, rally: rallyPoints.all().map((p) => ({ id: p.id, kind: p.kind, x: Math.round(p.x), z: Math.round(p.z), strength: p.strength })) }),
      // ações sociais / itens (QA): chave ou id
      act: (k: string | number) => { const d = typeof k === 'number' ? ACTION_BY_ID.get(k) : ACTION_BY_KEY.get(k); this.social.requestAction(d?.id ?? 0); return this.social.state; },
      prop: (kind: string | null, design?: string) => { this.social.requestProp(kind ? PROP_BY_KIND.get(kind as PropKind)?.id ?? 0 : 0, design ? DESIGN_BY_KEY.get(design)?.id : undefined); return this.social.state; },
      social: () => ({ local: this.social.state, avatar: this.avatar.social, server: this.net?.self.social ?? null }),
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
      mp: () => (this.net ? { session: this.net.sessionId, self: { ...this.net.self }, remotes: this.net.remotesInfo(), bandwidth: this.net.bandwidth, interpDelay: this.net.interpDelay, rtt: worldClock.rtt, clockOffset: worldClock.offsetMs, corrections: this.net.corrections, correctionReasons: this.net.correctionReasons, policy: this.net.policy, vehiclesInView: this.net.vehiclesInView() } : null),
      /** veículos dos jogadores (todos os tipos); `kind` opcional filtra */
      vehicles: (kind = 'car') => this.rideables.items.filter((i) => kind === 'all' || i.def.kind === kind).map((i) => ({ id: i.state.id, kind: i.def.kind, x: +i.state.x.toFixed(2), z: +i.state.z.toFixed(2), heading: +i.state.heading.toFixed(3), occupant: i.state.occupant, state: i.netState })),
      signalState: (j: number, ph: number) => this.signals.state(j, ph),
      /** QA: não existe trânsito NPC (nenhum grupo de trânsito na cena, nenhuma mensagem "traffic" recebida) */
      npcTraffic: () => ({ group: !!this.scene.getObjectByName('traffic'), messages: this.net?.trafficMessages ?? 0 }),
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
