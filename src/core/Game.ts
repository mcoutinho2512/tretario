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
import { openCharacterEditor } from '../ui/editorBridge';
import { ChatPanel } from '../ui/ChatPanel';
import { DebugPanel } from '../debug/DebugPanel';
import { HudShell } from '../ui/hud/HudShell';
import { loadZoneFile } from '../world/zoneTracker';
import type { ZoneDefinition } from '../world/zones';
import { DEFAULT_COMBAT_RULES, type CombatRules } from '../combat/policy';
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
import { RIDEABLE_DEFS, RideableSystem, seatWorld, stepRideable, type RideableInstance, type RideableKind } from '../vehicles/Rideable';
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
import type { IdentityJoinOptions } from '../identity/types';
// rodada 9 — itens de confronto no mundo, MÃOS, efeitos (proteção/desorientação), queda por status (agente B)
import { ItemsClient } from '../items/ItemsClient';
import { HandIndicator } from '../ui/hud/HandIndicator';
import { ActionBar } from '../ui/hud/ActionBar';
import { nearbyVehicles } from '../ui/hud/actionBarState';
import { DisorientOverlay } from '../combat/fxVisuals';
import { FX } from '../combat/types';
import { hitNpcs, type NpcTarget } from '../combat/npcHits';
import { RULES } from '../net/rules';
import { Ragdoll } from '../physics/Ragdoll';

/** rodada 8: como entrar no mundo compartilhado (tela inicial → jogo). `mp` = endereço do servidor (ws://…) */
export interface GameStartOptions extends IdentityJoinOptions {
  mp?: string;
  /** ticket pedido só na hora de conectar (vale 60 s; o carregamento pode demorar mais que isso) */
  getTicket?: () => Promise<string | undefined>;
}
import type { TrafficData } from '../world/types';
import type { SpectatorMode } from '../spectator/SpectatorMode';
import type { CellImpostors } from '../spectator/CellImpostors';
import { ReconnectBadge } from '../net/ReconnectBadge';
import { gameEndpoint } from '../net/endpoint'; // rodada 9.1 — mesma origem em produção
import { noticeForJoinError } from '../ui/netNotice'; // rodada 9.1 — versão nova / sala cheia
import { ProgressionUI } from '../ui/progress/ProgressionUI'; // rodada 9 — progressão
import { AudioWorld } from '../audio/AudioWorld'; // rodada 10 — áudio
import { mountAgendaDebate, type AgendaDebate } from '../ui/agendaDebateMount'; // rodada 9 — agenda/debate/telões
// rodada 9 — confronto (src/combat; carregado com o multiplayer)
import type { CombatClient } from '../combat/CombatClient';

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
  /** casca do HUD (rodada 8): minimapa, zonas, ajustes, encaixes de chat/espectador/perfil — src/ui/hud */
  hudShell!: HudShell;
  private zones: ZoneDefinition[] = [];
  /** regras gerais de confronto da raiz de zones.json (consentimento, áreas derivadas) — as mesmas do servidor */
  private combatRules: CombatRules = DEFAULT_COMBAT_RULES;
  private input: InputManager;
  private player!: PlayerState;
  private avatar: AvatarVisual;
  private cam!: ThirdPersonCamera;
  private debug = new DebugPanel();
  private hud: HTMLDivElement;
  private toast: HTMLDivElement;
  private clock = new THREE.Clock();
  private time = 0;
  private simOffsetMs = 0;
  private lastSunUpdate = -1e9;
  private intro = { active: true, t: 0, fromYaw: 0, toYaw: 0 };
  private nearestVP: ValidationPoint | null = null;
  private running = false;

  /** modo espectador (src/spectator) — null jogando */
  private spec: SpectatorMode | null = null;
  /** espectador aéreo (rodada 8.1): impostores das células agregadas (FAR/AGGREGATE do servidor) */
  private cells: CellImpostors | null = null;
  /** camada do servidor é FAR/AGGREGATE: pedestres e concentração locais param (o ambiente vem das células) */
  private get aerial() { const t = this.net?.specTier; return !!this.spec && (t === 'FAR' || t === 'AGGREGATE'); }
  private layerAcc = 0;
  private linkBadge = new ReconnectBadge();
  /** rodada 9 — confronto: pulo/golpes/esquiva (só intenção; resultado do servidor) e controles de toque */
  private combat: CombatClient | null = null;
  private touchCtl: TouchControls | null = null;
  get spectator() { return this.startOpts.role === 'spectator'; }

  constructor(private container: HTMLElement, private preset: QualityPreset, appearance?: CharacterAppearance, private startOpts: GameStartOptions = {}) {
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
    this.avatar.root.visible = !this.spectator; // espectador não tem corpo
    // personagens: animações, LOD do próprio avatar e LODs baratos de todos os corpos antes de começar
    progress(0.7, 'Carregando personagens');
    const bodies = ['homem', 'mulher', 'idoso', 'idosa'] as const;
    // o LOD0 do próprio avatar NÃO bloqueia o início (1,2–1,6 MB): começa no LOD3 e troca sem reiniciar a animação
    await Promise.all([loadClips(), ...bodies.map((b) => loadLod(b, 3))]).catch((e) => console.warn('[personagens]', e));
    this.peds = new PedestrianSystem(this.collision, this.preset.pedestrians);
    this.peds.radius = this.preset.pedestrianRadius;
    this.peds.shadowDistance = this.preset.npcShadowDistance;
    // no início, NPCs/remotos no máximo LOD1: o LOD0 (1,2–1,6 MB por corpo) não disputa banda com o mundo
    // (BAIXO: LOD1 só para os 2 mais próximos — teto no orçamento da multidão, crowdBudget.ts)
    const npcDetail = this.preset.level === 'low' || this.preset.level === 'medium' ? 1 : 0;
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
    this.rallyCrowd.shadowDistance = this.preset.npcShadowDistance;
    this.scene.add(this.rallyCrowd.group); // esqueletos dos membros mais próximos (rodada 9.1)
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
    for (const it of this.rideables.eventItems()) this.scenery.addScreens(it.model, it.state.id);
    this.scene.add(this.scenery.group);
    screenFeed().info = () => ({ time: this.simTime.toTimeString().slice(0, 5), players: (this.spectator ? 0 : 1) + (this.net?.remoteCount ?? 0) + (this.net?.farCount ?? 0) });
    this.cam = new ThirdPersonCamera(this.camera, this.collision);
    // intro: começa olhando a Central, depois gira para a avenida (direção da Candelária)
    const central = this.manifest.landmarks.find((l) => l.key === 'LANDMARK_CENTRAL')!;
    const toC = Math.atan2(central.center[0] - spawn.p[0], central.center[1] - spawn.p[1]);
    this.intro = { active: true, t: 0, fromYaw: toC, toYaw: heading };
    this.cam.yaw = toC;
    this.cam.pitch = -0.32; // olhando para cima: torre inteira no quadro
    if (this.spectator) {
      // espectador: câmeras próprias (livre limitada, pontos fixos, trio/palco, aérea) — src/spectator
      const { SpectatorMode } = await import('../spectator/SpectatorMode');
      this.spec = await SpectatorMode.create({
        base, camera: this.camera, canvas: this.canvas, input: this.input, bounds: this.manifest.bounds as [number, number, number, number],
        manifest: { pvAxis: this.manifest.pvAxis as [number, number][], landmarks: this.manifest.landmarks, eventSpots: this.manifest.eventSpots },
        ground: (x, z) => this.collision.groundHeight(x, z),
        follow: () => { const it = this.rideables.eventItems().find((i) => i.def.kind === 'trio'); return it ? { x: it.state.x, z: it.state.z, heading: it.state.heading } : null; },
      });
      this.spec.cam.occlusion = (ax, ay, az, bx, by, bz) => this.collision.raycast(ax, ay, az, bx, by, bz);
      // células agregadas → impostores (mesmo teste de prédio da concentração: círculo empurrado = dentro de parede)
      const { CellImpostors } = await import('../spectator/CellImpostors');
      this.cells = new CellImpostors((x, z) => this.collision.groundHeight(x, z), (x, z) => { const q = { x, y: 0, z }; this.collision.resolveCircle(q, 0.3, 1.7); return Math.hypot(q.x - x, q.z - z) > 0.05; });
      this.cells.setGroupColors(this.events.current?.groups);
      this.scene.add(this.cells.group);
      this.intro.active = false;
      const f = this.spec.cam.focus;
      this.player.x = f.x; this.player.z = f.z; this.player.y = f.y;
      this.avatar.root.position.set(f.x, f.y, f.z);
      spawnXZ.set(f.x, f.z);
    }

    // construir chunks próximos antes de mostrar
    progress(0.72, 'Montando ruas, calçadas e edifícios');
    const camXZ = this.spec ? spawnXZ.clone() : new THREE.Vector2(spawn.p[0], spawn.p[1]);
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
    if (this.spec) this.spec.cam.update(1 / 60);
    else this.cam.update(new THREE.Vector3(this.player.x, this.player.y, this.player.z), 1 / 60);
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
    const zf = await loadZoneFile(base).catch((e) => { console.warn('zonas não carregadas', e); return { zones: [], rules: DEFAULT_COMBAT_RULES }; });
    this.zones = zf.zones; this.combatRules = zf.rules;
    progress(1, 'Pronto');
    this.mountHud();
    this.audioAttach(); // rodada 10 — áudio
    await this.connectMultiplayer();
    this.applyShotFromUrl();
  }

  private mountHud() {
    let touch: TouchControls | null = null;
    if (this.input.isTouch) { touch = this.touchCtl = new TouchControls(this.input); this.hud.appendChild(touch.el); } // embaixo de tudo
    const shell = (this.hudShell = new HudShell(this.hud, this.manifest, this.zones, { touch: this.input.isTouch, level: this.preset.level }));
    // PERFIL/PERSONAGEM do menu abre o editor da conta (src/ui/editorBridge.ts — registrado pela tela inicial)
    shell.hooks.openCharacterEditor = () => { if (!openCharacterEditor()) shell.flash('Entre na sua conta para editar o personagem'); };
    if (touch) shell.attachTouch(touch);
    // minimapa: no alto (espectador FAR/AGGREGATE) o calor vem das CÉLULAS já recebidas — sem amostrar a multidão
    shell.attachCrowd({ requestSample: (fn) => {
      if (!this.aerial || !this.cells) { this.crowd.requestSample(fn); return; }
      const pts: { x: number; z: number }[] = [];
      this.cells.forEachPoint((x, z) => pts.push({ x, z }));
      this.net?.forEachRemotePos((x, z) => pts.push({ x, z }));
      fn(pts);
    } });
    shell.setEvent(this.events.current?.name);
    void shell.prefs.syncFromServer();
    this.hud.appendChild(this.debug.el);
    this.hud.appendChild(this.toast);
    const attr = document.createElement('div');
    attr.className = 'attribution';
    attr.innerHTML = '<span class="beta-tag" title="Versão beta pública">BETA</span>Dados do mapa © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL)';
    this.hud.appendChild(attr);
    const lock = document.createElement('div');
    lock.className = 'lock-hint';
    lock.textContent = 'Clique para controlar a câmera';
    this.hud.appendChild(lock);
    // roda/menu/ajustes abertos: solta o mouse para clicar; fechados: volta a controlar a câmera
    const relock = (open: boolean) => { if (open) document.exitPointerLock?.(); else if (!this.input.isTouch && !this.wheel?.open && !shell.anyModal) this.input.requestLock(); };
    shell.onModal = relock;
    if (!this.spectator) { // espectador não tem ações sociais
      this.wheel = new ActionWheel(this.social);
      this.wheel.onToggle = (open) => { shell.poke(); relock(open); };
      shell.onActions = () => this.input.queueToggle('wheel');
      this.hud.appendChild(this.wheel.el);
    }
    this.hud.appendChild(this.linkBadge.el);
    this.r9bMount(); // rodada 9 — MÃOS / ITEM ATUAL, véu de desorientação
    this.mountActionBar(shell); // rodada 9.1 — barra de ações (só jogador)
    if (this.spec) {
      // seletor de câmeras no encaixe do HUD (HudShell.mountSpectator); zona/minimapa seguem o foco da câmera
      const spec = this.spec;
      spec.onLabel = (t) => shell.setMode(t, false);
      spec.mountInSlot((el) => shell.mountSpectator({ el }));
      shell.setFocusProvider(() => spec.cam.focus);
      this.hud.classList.add('spectating');
    }
    this.mountRound9(shell, relock); // rodada 9 — agenda/debate/telões
    this.container.appendChild(this.hud);
    window.addEventListener('resize', () => { this.onResize(); shell.minimap.resize(); });
  }

  // rodada 9.1 — barra de ações: cada botão chama o MESMO caminho da tecla/roda (src/ui/hud/ActionBar.ts) ------------
  actionBar: ActionBar | null = null;
  private mountActionBar(shell: HudShell) {
    if (this.spectator) return; // espectador fica com a barra de câmeras
    const near = () => !!(this.riding || this.trio.active || this.rideables.nearest(this.player.x, this.player.z) || this.rideables.nearestLadder(this.player.x, this.player.z));
    this.actionBar = new ActionBar({
      touch: this.input.isTouch,
      social: this.social,
      extraProps: () => this.items?.wheelExtra ?? [],
      // o texto da ação contextual já calculado em updateMovement (E — USAR…, SUBIR NO TRIO, DESCER…)
      vehiclePrompt: () => (near() && !this.pendingEnter && !this.pendingBoard ? shell.prompt : ''),
      vehicles: () => nearbyVehicles(this.rideables.items.map((i) => ({ id: i.state.id, kind: i.def.kind, x: i.state.x, z: i.state.z, free: i.netState !== 2 && (i.def.kind === 'trio' || !i.state.occupant) })), this.player.x, this.player.z),
      vehicleLabel: (k) => (k === 'trio' ? 'Trio elétrico (escada)' : RIDEABLE_DEFS[k as RideableKind]?.label ?? k),
      use: () => this.input.queueToggle('use'),
      showTarget: (x, z, label, d) => {
        shell.minimap.setTarget({ x, z, label });
        shell.toggleMap(true);
        shell.flash(`${label}: ${d < 6 ? 'aqui do lado' : `${Math.round(d / 5) * 5} m daqui`} — siga o anel no mapa`, 4000);
      },
      pichar: () => {
        if (this.riding || this.trio.active) { this.flash('Desça do veículo para pichar'); return true; }
        return this.graffiti.tryOpen(this.player);
      },
      press: (k) => this.input.queueToggle(k),
      combatState: () => this.combatHud?.state ?? null,
      openCharacterEditor: () => shell.openCharacterEditor(),
      toggleMap: () => shell.toggleMap(),
      flash: (m) => this.flash(m),
    });
    shell.mountActionBar(this.actionBar);
  }

  // rodada 9 — agenda, "Acontecendo agora", palco de debate e telões (lógica em src/ui/agendaDebateMount.ts) ----------
  r9: AgendaDebate | null = null;
  private mountRound9(shell: HudShell, relock: (open: boolean) => void) {
    this.r9 = mountAgendaDebate({
      shell, manifest: this.manifest, zones: this.zones, isTouch: this.input.isTouch, input: this.input, now: () => worldClock.now(),
      heightAt: (x, z) => this.collision.groundHeight(x, z), scene: this.scene, rallyCrowd: this.rallyCrowd,
      billboards: this.billboards, scenery: this.scenery, playerPos: () => this.player, flash: (m, ms) => shell.flash(m, ms),
      onModal: relock, base: import.meta.env.BASE_URL,
    });
    (window as any).__pvR9 = this.r9; // QA (tools/qa/debate_mp.mjs, agenda_shots.mjs)
  }
  // fim rodada 9 -------------------------------------------------------------------------------------------------------

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

  /** rodada 8: visual novo vindo do editor de personagem (já salvo no servidor) — avatar local + aviso à sala */
  setAppearance(app: CharacterAppearance) {
    this.appearance = app;
    this.avatar.setAppearance(app);
    this.net?.sendAppearance(app);
  }
  /** rodada 8: designs sugeridos pelo grupo do evento (bandeira/cartaz/faixa) — só a escolha padrão do item */
  setPreferredDesigns(ids: number[]) { this.social.preferredDesigns = ids.slice(0, 16); }

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
    setTimeout(() => { if (!this.spectator) this.avatar.setDetail(0); preloadCrowd(['homem', 'mulher', 'idoso', 'idosa']); }, 1500);
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
    if (this.input.consumeToggle('map')) this.hudShell.toggleMap();
    if (this.input.consumeToggle('controls')) this.hudShell.toggleHelp();
    if (this.input.consumeToggle('wheel')) this.wheel?.toggle();
    // H ou P: HUD limpo (só o cenário)
    if (this.input.consumeToggle('help') || this.input.consumeToggle('photo')) this.hudShell.toggleClean();
    this.hud.classList.toggle('locked', this.input.pointerLocked || this.input.isTouch);

    const T: [string, number][] = [['início', performance.now()]];
    const mark = (n: string) => T.push([n, performance.now()]);
    if (this.spec) this.spectatorFrame(dt);
    else {
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
      // andar cancela ação incompatível; caído/veículo encerram (mesmas regras do servidor: deslocamento por mensagem
      // de movimento = velocidade / NET_TICK_HZ)
      this.social.update(Math.abs(this.player.speed) / NET_TICK_HZ, this.avatar.isDown || !!this.riding);
      this.r9bFrame(); // rodada 9 — itens (R/X), efeitos do próprio
      this.cam.update(this.avatar.root.position, dt);
    }
    mark('movimento');
    const ppos = this.avatar.root.position;
    // (matriz atualizada já: o frustum da multidão neste quadro usa a câmera livre, não a da 3ª pessoa)
    if (this.freeCam) { this.camera.position.set(...this.freeCam.p); this.camera.lookAt(...this.freeCam.t); this.camera.updateMatrixWorld(); }
    this.signals.setTime(worldClock.seconds());
    if (this.net) {
      this.net.update(dt, this.player, this.riding ? this.riding.state.id : null, this.camera, { w: this.canvas.clientWidth, h: this.canvas.clientHeight });
      this.rideables.smooth(dt, this.net.sessionId);
    }
    this.graffiti.update(dt, this.camera.position, this.player);
    mark('rede');
    // espectador no alto: o ambiente vem das células (impostores) — pedestres/concentração locais não duplicam
    const aerial = this.aerial;
    this.peds.group.visible = !aerial;
    if (this.rallyCrowd) this.rallyCrowd.group.visible = !aerial;
    if (!aerial) { this.peds.update(dt, this.camera, this.player); this.rallyCrowd?.update(dt); }
    if (this.cells && this.net) this.cells.update(dt, this.net.specCells, this.net.specCellsVersion, aerial, this.spec!.cam.altitude, (fn) => this.net!.forEachRemotePos(fn));
    mark('pedestres');
    this.crowd.end(this.camera, dt);
    this.audioWorld.update(dt); // rodada 10 — áudio (ouvinte, passos, veículos, multidão agregada)
    mark('multidão');
    this.closure.update(this.camera.position);
    this.scenery.update(dt, this.camera.position, this.env.night);
    this.r9?.update(dt); // rodada 9 — palco de debate
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
    const focus = this.freeCam ? this.camera.position : this.player;
    this.hudShell.frame(tCpu, { x: focus.x, z: focus.z, heading: this.player.heading, camYaw: this.spec ? this.spec.cam.pose.yaw : this.cam.yaw, moving: Math.abs(this.player.speed) > 0.6 });
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

  /** espectador: câmera em vez de corpo; o "jogador" local é só o foco (chunks, NPCs, minimapa e grafites seguem a câmera) */
  private spectatorFrame(dt: number) {
    const f = this.spec!.frame(dt);
    this.player.x = f.x; this.player.y = f.y; this.player.z = f.z; this.player.speed = 0;
    this.avatar.root.position.set(f.x, f.y, f.z);
    if (this.net) this.net.spectatorFocus = { x: f.x, z: f.z, alt: this.spec!.cam.altitude };
    // camada no rótulo do espectador (1 Hz): o que está sendo desenhado e quantas pessoas
    if ((this.layerAcc += dt) > 1 && this.net) {
      this.layerAcc = 0;
      const t = this.net.specTier;
      let p = 0, e = 0;
      for (const c of this.net.specCells.values()) { p += c.players; e += c.env; }
      this.spec!.setLayer(t === 'AGGREGATE' ? `avenida inteira · ${p} ${p === 1 ? 'jogador' : 'jogadores'}` : t === 'FAR' ? `vista do alto · ${p} ${p === 1 ? 'jogador' : 'jogadores'}` : '');
    }
    this.rideables.sync(this.camera.position);
    this.hudShell.setPrompt('');
  }

  /** Multiplayer: ?mp=1 conecta no servidor padrão (dev: ws://<host>:2567; produção: wss://<host>/game — src/net/endpoint.ts); ?mp=ws://… usa outro servidor. Espectador sempre conecta. */
  private async connectMultiplayer() {
    const q = new URLSearchParams(location.search);
    const mp = this.startOpts.mp ?? q.get('mp') ?? (this.spectator ? '1' : null); // espectador sempre conecta
    if (!mp) return;
    const endpoint = mp === '1' ? gameEndpoint() : mp;
    const { NetworkClient } = await import('../net/NetworkClient');
    this.net = new NetworkClient(endpoint, this.hud);
    this.net.namesMode = this.hudShell.prefs.value.names;
    this.hudShell.prefs.onChange((p) => { if (this.net) this.net.namesMode = p.names; });
    this.net.crowd = this.peds.crowd;
    this.graffiti.attachNet(this.net);
    // chat (src/ui/ChatPanel): painel + botão CHAT no toque; digitar não move o jogador
    // chat (agente C) no espaço do HUD (agente E): o botão CHAT do toque é o do HUD (chama toggle())
    const chat = (this.chat = new ChatPanel({ isTouch: false, input: this.input, onToggle: (open) => { if (open) document.exitPointerLock?.(); } }));
    chat.attach(this.net);
    this.hudShell.mountChat(chat);
    // rodada 9 — progressão: rastreador de missão, avisos, PROGRESSO (menu ☰) e boas-vindas — só exibe o que o servidor
    // manda (`prog`/`prog_ev`); handlers registrados ANTES de conectar. QA: __pvProg (tp = teleporte do servidor de teste)
    if (!this.spectator) {
      const prog = new ProgressionUI(this.hudShell, this.net, import.meta.env.BASE_URL);
      (window as any).__pvProg = { ui: prog, notices: this.hudShell.noticeLog, tp: (x: number, z: number) => this.net?.send('test_tp', { x, z }) };
    }
    this.r9?.attach(this.net); // rodada 9 — agenda/debate/telões
    // quem fala ganha prioridade de nome acima da cabeça por alguns segundos (LOD de nomes)
    this.net.on('chat', (m: { nid: number }) => { const id = this.net?.idByNid(m.nid); if (id) this.net!.markSpeaking(id); });
    this.scene.add(this.net.group);
    (window as any).__pvRemotes = () => this.net?.remotesInfo();
    // rodada 9 — eventos: agenda, concentrações (NPCs simulados), corrida/caminhada/confronto (src/events/EventClient.ts)
    {
      const { EventClient } = await import('../events/EventClient');
      const evc = new EventClient(this.net, this.scene, this.hud, (m) => this.flash(m), this.hudShell.minimap);
      (window as any).__pvEvents = evc;
      evc.groupName = (k) => this.events.current?.groups?.find((g) => g.id === k)?.name ?? k;
      // QA (tools/qa/events_mp.mjs): aponta o veículo em uso para (x,z); o roteiro dirige com W (o servidor valida o resto)
      (evc as unknown as { qaAim: (x: number, z: number) => boolean }).qaAim = (x, z) => { const v = this.riding; if (!v) return false; v.state.heading = Math.atan2(x - v.state.x, z - v.state.z); return true; };
    }
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
    this.net.onKnock = (k, isSelf, refine) => { if (isSelf) this.onSelfKnock(k, refine); };
    this.r9bNet(this.net); // rodada 9 — itens no mundo, queda por status
    this.net.onNotice = (m) => this.flash(m);
    this.net.onSelfSocial = () => this.social.fromServer(this.net!.self.social);
    // rodada 8: reconexão (mesma entidade: volta para a posição do servidor) e sessão substituída
    this.net.ticketProvider = this.startOpts.getTicket ?? null; // entrada NOVA depois da graça: ticket novo
    this.net.onLink = (st) => this.linkBadge.set(st);
    this.net.onJoinRefused = (code) => { this.linkBadge.set('CONNECTED'); noticeForJoinError(code); }; // rodada 9.1
    this.net.onResume = (r) => {
      if (this.spectator) return;
      if (!this.riding && !this.trio.active && Math.hypot(r.x - this.player.x, r.z - this.player.z) > 0.5) { this.player.x = r.x; this.player.z = r.z; this.player.y = this.collision.groundHeight(r.x, r.z); }
      this.flash('Reconectado');
    };
    this.net.onSocialDenied = (_k, reason) => this.social.denied(reason, this.net!.self.social);
    this.net.onEvent = (id) => {
      if (this.events.current?.id !== id) void this.events.load(id).then(() => { this.hudShell.setEvent(this.events.current?.name); this.interaction.setPolicy(this.events.current?.interaction); this.peds.setSocialConfig(this.events.current?.social); this.rallyCrowd?.setConfig(this.events.current?.social, RallyCrowd.presetScale(this.crowd.budget.total)); this.scenery.applyEvent(this.events.current); this.cells?.setGroupColors(this.events.current?.groups); });
    };
    void preloadRagdoll().catch(() => { /* fallback procedural */ });
    if (!this.spectator) await this.setupCombat(); // rodada 9 — confronto (handlers antes de entrar na sala)
    try {
      const sp = q.get('spawn')?.split(',').map(Number);
      const f = this.spec?.cam.focus;
      if (f) this.net.spectatorFocus = { x: f.x, z: f.z };
      await this.net.connect(this.appearance ?? DEFAULT_PLAYER_APPEARANCE_LOCAL, q.get('name') ?? (this.playerName || `Visitante ${Math.floor(Math.random() * 900 + 100)}`), sp && sp.length === 2 && sp.every(Number.isFinite) ? { x: sp[0], z: sp[1] } : undefined,
        { ticket: this.startOpts.ticket ?? await this.startOpts.getTicket?.(), role: this.startOpts.role ?? (q.get('spectate') === '1' ? 'spectator' : undefined), ...(f ? { specCam: { x: f.x, z: f.z } } : {}), ...(q.get('testUser') ? { testUser: q.get('testUser')! } : {}) });
      this.flash(`Multiplayer conectado (${endpoint})`);
    } catch (e) {
      // rodada 9.1 — recusa com decisão (versão nova, sala cheia): aviso claro em vez de erro misterioso
      if (!noticeForJoinError((e as { code?: number })?.code)) this.flash(`Multiplayer indisponível: ${(e as Error).message ?? e}`);
      console.warn('[mp] falha ao conectar', e);
    }
  }

  // ------------------------------------------------------------------ interação (modos, empurrão)
  private get mpOnline() { return !!this.net && this.net.status === 'online'; }

  private updateInteraction(dt: number) {
    this.interaction.update(dt);
    this.combat?.update(dt, this.player, !!this.riding || this.trio.active || this.graffiti.editing || this.avatar.isDown); // rodada 9
    if (this.input.consumeToggle('mode')) {
      if (this.mpOnline) {
        // multiplayer: o SERVIDOR decide o modo (política do evento)
        this.net!.requestMode(this.net!.self.interaction === 'interacao' ? 'pacifico' : 'interacao');
      } else this.flash(this.interaction.toggle().message);
    }
    if (this.mpOnline) this.interaction.mode = this.net!.self.interaction === 'interacao' ? 'interacao' : 'pacifico';
    if (this.input.consumeToggle('action') && !this.avatar.isDown && !this.riding) {
      if (this.combatRules.combatConsent === 'both' && this.interaction.mode !== 'interacao') { this.flash('Modo pacífico: aperte K para alternar (se o evento permitir)'); return; }
      const target = this.net?.pickTarget(this.player.x, this.player.z, this.player.heading) ?? null;
      this.avatar.playPush(); // só a animação é local; o resultado vem do servidor
      if (target && this.mpOnline) this.net!.requestPush(target);
      else if (!(this.combat ? this.combat.npcPush(this.player) > 0 : this.peds.pushNear(this.player.x, this.player.z, this.player.heading))) this.flash('Ninguém ao alcance');
    }
  }

  /** queda do jogador local (decidida pelo servidor) */
  private onSelfKnock(k: KnockMsg, refine = false) {
    if (this.riding) this.dismountLocal();
    const walls = this.collision.walls.near(this.player.x, this.player.z, 6);
    // `refine`: a queda já começou pela mudança de status (rodada 9) — só a posição de repouso
    if (!refine) void this.avatar.knockdown({ dirX: k.dx, dirZ: k.dz, strength: k.strength, groundY: this.player.y, walls, downMs: k.downMs, getupMs: k.getupMs });
    // posição de repouso é do servidor
    this.player.x = k.rx; this.player.z = k.rz; this.player.vx = this.player.vz = 0;
    this.flash(k.kind === 'impact' ? 'Você foi atingido por um carro! (sem dano — levante-se)' : k.kind === 'combat' ? 'Você caiu! (sem dano — levante-se)' : 'Você foi empurrado!');
  }

  // ------------------------------------------------------------------ rodada 9 — itens de confronto, efeitos, queda por status
  private items: ItemsClient | null = null;
  private hand: HandIndicator | null = null;
  private disorient: DisorientOverlay | null = null;
  /** QA: a proteção de retorno chegou a aparecer no próprio personagem (bit + brilho) */
  private r9bSeenProtected = false;

  private r9bMount() {
    if (this.spectator) return;
    const hand = (this.hand = new HandIndicator(this.input.isTouch));
    hand.onChange = () => this.hudShell.poke();
    hand.onTap = () => this.input.queueToggle('item');
    this.hudShell.mountHand(hand);
    this.disorient = new DisorientOverlay(this.hud);
    if (this.wheel) this.wheel.extraProps = () => this.items?.wheelExtra ?? [];
  }

  private r9bNet(net: NetworkClient) {
    if (this.spectator || !this.hand) return;
    const items = (this.items = new ItemsClient((x, z) => this.collision.groundHeight(x, z), this.hand, (m) => this.flash(m)));
    items.attach(net);
    this.scene.add(items.view.group);
    void items.loadRacks(import.meta.env.BASE_URL, this.manifest.pvAxis as [number, number][]);
    // queda sem `knock` (decidida por outro sistema): para trás, tempos das regras
    net.onSelfStatusFall = () => {
      if (this.riding) this.dismountLocal();
      const h = this.player.heading, walls = this.collision.walls.near(this.player.x, this.player.z, 6);
      void this.avatar.knockdown({ dirX: -Math.sin(h), dirZ: -Math.cos(h), strength: 0.8, groundY: this.player.y, walls, downMs: RULES.downMs, getupMs: RULES.getupMs });
    };
  }

  private r9bFrame() {
    const net = this.net;
    if (this.items && net) {
      this.items.update(this.player.x, this.player.z, this.social.prop);
      if (this.input.consumeToggle('item') && !this.avatar.isDown) { if (this.mpOnline) this.items.pickOrDrop(this.social.prop, (id) => this.social.requestProp(id)); }
      if (this.input.consumeToggle('drop') && !this.avatar.isDown && this.mpOnline) this.items.drop(this.social.prop, (id) => this.social.requestProp(id));
      if (this.input.consumeToggle('stow') && !this.avatar.isDown) this.items.stowToggle(this.social.prop, (id) => this.social.requestProp(id));
    } else { this.input.consumeToggle('item'); this.input.consumeToggle('drop'); this.input.consumeToggle('stow'); }
    const fx = net?.self.fx ?? 0;
    this.avatar.setFx(fx);
    if (fx & FX.PROTECTED && this.avatar.fxDebug.aura) this.r9bSeenProtected = true;
    this.avatar.setPhys(net?.self.status ?? 0);
    this.disorient?.set(!!(fx & FX.DISORIENTED), this.hudShell.prefs.value.reduceEffects);
  }

  // rodada 10 — áudio: o AudioWorld lê o que o jogo já tem (câmera, jogador, veículos, multidão, rede, eventos)
  private readonly audioWorld = new AudioWorld();
  private audioAttach() {
    const aw = this.audioWorld;
    this.crowd.audioTap = aw.crowdTap;
    aw.attach({
      camera: this.camera, player: this.player, avatarPos: () => this.avatar.root.position, isDown: () => this.avatar.isDown,
      ridingId: () => this.riding?.state.id ?? null, onPlatform: () => this.trio.active, rideables: this.rideables,
      surfaceAt: (x, z) => this.collision.surfaceAt(x, z), net: () => this.net, spectator: this.spectator, aerial: () => this.aerial,
      event: () => this.events.current ?? null, specCells: () => this.net?.specCells.values() ?? null, baseUrl: import.meta.env.BASE_URL,
      eventZones: () => {
        const evc = (window as unknown as { __pvEvents?: { points: { inst: string; x: number; z: number; radius: number }[]; list: { inst: string; format: string }[] } }).__pvEvents;
        return evc ? evc.points.map((p) => ({ x: p.x, z: p.z, r: p.radius, type: evc.list.find((e) => e.inst === p.inst)?.format ?? 'evento' })) : [];
      },
    });
    (window as unknown as { __pvAudio: () => unknown }).__pvAudio = () => aw.qa();
  }

  /** QA (rodada 9): itens, efeitos e quedas */
  private r9bQa() {
    return {
      r9b: () => ({ items: this.items?.info() ?? null, fx: this.avatar.fxDebug, disorient: this.disorient?.state ?? null, statusFalls: this.net?.statusFalls ?? 0, seenProtected: this.r9bSeenProtected, fxSeen: this.net?.selfFxSeen ?? 0, ragdollsLive: Ragdoll.live, self: this.net ? { fx: this.net.self.fx, status: this.net.self.status, prop: this.net.self.social.prop ?? 0 } : null, reduceEffects: this.hudShell.prefs.value.reduceEffects }),
      /** toca um clipe de confronto; `holdAt` (s) prende a fase (captura); null encerra */
      r9bClip: (name: string | null, holdAt?: number) => (name ? this.avatar.playCombatClip(name, holdAt) : (this.avatar.stopCombatClip(), true)),
      r9bPrefs: (o: { reduceEffects?: boolean }) => { if (o.reduceEffects !== undefined) this.hudShell.prefs.set({ reduceEffects: o.reduceEffects }); return this.hudShell.prefs.value; },
    };
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
      this.hudShell.setPrompt('Caído… levantando em instantes');
    } else if (this.trio.active) {
      // em cima do trio: anda no piso (posição LOCAL); o mundo vem da pose do trio
      const it = this.rideables.byId.get(this.trio.state!.id);
      if (!it) this.leaveTrioLocal();
      else {
        this.input.consumeJump();
        this.trio.step(this.player, it.state, fx * ax.y + -Math.cos(this.cam.yaw) * ax.x, fz * ax.y + Math.sin(this.cam.yaw) * ax.x, this.input.running(), dt);
        if (this.net) this.net.platform = this.trio.state;
        this.avatar.update(this.player, dt);
        this.hudShell.setPrompt(this.pendingBoard ? 'Aguardando o servidor…' : 'E — DESCER DO TRIO · WASD andar em cima');
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
          ...(this.net?.remotesForObstacles() ?? []).filter((r) => !r.vehicle && !r.platform && !((kind === 'car' || kind === 'moto') && impactAllowed(this.interaction.mode, r.interaction as Mode, this.combatRules.combatConsent) && r.status === 0)),
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
      this.hudShell.setPrompt(RIDE_HELP[v.def.kind]);
    } else {
      const held = this.combat?.locked ? 0 : 1; // rodada 9: cambaleando (golpe sofrido) não anda
      const intent = {
        dirX: (fx * ax.y + -Math.cos(this.cam.yaw) * ax.x) * held,
        dirZ: (fz * ax.y + Math.sin(this.cam.yaw) * ax.x) * held,
        run: this.input.running() || !!this.autopilotRun,
        jump: this.jumpIntent(),
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
      this.hudShell.setPrompt(this.pendingEnter || this.pendingBoard ? 'Aguardando o servidor…' : ladder ? 'E — SUBIR NO TRIO' : near ? (near.def.kind === 'trio' ? 'E — DIRIGIR O TRIO ELÉTRICO' : `E — USAR ${near.def.label.toUpperCase()}`) : this.graffiti.promptText());
    }
    this.rideables.sync(this.camera.position);
    // sem consentimento (decisão do dono 2026-10-18): o modo K não protege ninguém — o rótulo diz a regra real
    if (this.combatRules.combatConsent === 'none') this.hudShell.setMode('Confronto liberado', true);
    else this.hudShell.setMode(this.interaction.mode === 'pacifico' ? 'Modo pacífico' : 'Modo interação', this.interaction.mode === 'interacao');
  }

  // ------------------------------------------------------------------ rodada 9 — confronto (src/combat, docs/COMBAT.md)
  private combatHud: import('../combat/CombatHud').CombatHud | null = null;
  private async setupCombat() {
    try {
      const [{ CombatClient }, { CombatHud }, { loadCombatTable }] = await Promise.all([import('../combat/CombatClient'), import('../combat/CombatHud'), import('../combat/data')]);
      const hud = (this.combatHud = new CombatHud());
      this.hudShell.mountCombat(hud, hud.peaceEl);
      this.combat = new CombatClient({
        net: this.net!, table: await loadCombatTable(import.meta.env.BASE_URL), avatar: this.avatar, input: this.input, collision: this.collision, scene: this.scene,
        zone: () => this.hudShell.zones.current, flash: (m) => this.flash(m), touch: this.touchCtl, hud,
        consent: this.combatRules.combatConsent,
        // NPCs de ambiente são locais: o golpe neles não vai ao servidor (src/combat/npcHits.ts)
        // NPC é local (sem latência): sem folga de alcance — só a do arco
        npcHit: (x, z, h, def) => hitNpcs([this.peds, this.rallyCrowd], { x, z, h }, def, { rangeSlackM: 0, arcSlackDeg: 10 }),
        aimTargets: (x, z, r, out) => {
          this.net?.forEachRemotePos((rx, rz) => { if ((rx - x) ** 2 + (rz - z) ** 2 <= r * r) out.push({ x: rx, z: rz }); });
          const npcs: NpcTarget[] = [];
          this.peds.npcTargetsNear(x, z, r, npcs); this.rallyCrowd?.npcTargetsNear(x, z, r, npcs);
          for (const n of npcs) out.push({ x: n.x, z: n.z });
        },
      });
    } catch (e) { console.warn('[confronto] indisponível', e); }
  }

  /** Espaço/PULAR: com servidor, o pulo é pedido (cooldown igual ao do servidor); negado → corta a subida */
  private jumpIntent(): boolean {
    if (this.combat?.jumpDenied) { this.combat.jumpDenied = false; this.player.vy = Math.min(this.player.vy, 0); }
    if (!this.input.consumeJump()) return false;
    return this.combat ? this.combat.tryJump(this.player) : true;
  }

  /** piloto automático para testes reproduzíveis (anda até um ponto usando o movimento normal) */
  private autopilot: { x: number; z: number } | null = null;
  private autopilotRun = false;

  /** mensagem curta no selo de modo */
  private flash(msg: string) {
    this.hudShell?.flash(msg);
  }

  private updateValidation() {
    let best: ValidationPoint | null = null, bd = Infinity;
    for (const v of this.manifest.validation) {
      const d = Math.hypot(v.p[0] - this.player.x, v.p[1] - this.player.z);
      if (d < v.radius && d < bd) { bd = d; best = v; }
    }
    // pontos de validação do mapa: aviso só com o painel de debug (F3) — o jogador vê o aviso de zona
    if (!this.debug.visible) best = null;
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
      /** QA rodada 8: aplica um visual (já salvo no servidor) ao avatar local e avisa a sala */
      setAppearance: (a: CharacterAppearance) => this.setAppearance(a),
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
      portrait: (dist = 3, yaw = Math.PI) => { this.cam.yaw = this.player.heading + yaw; this.cam.pitch = 0.08; this.cam.zoom(Math.log(dist / this.cam.distance)); this.intro.active = false; },
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
      rallyCrowd: () => ({ ...this.rallyCrowd?.stats, near: this.rallyCrowd?.qaNear(this.player.x, this.player.z), rally: rallyPoints.all().map((p) => ({ id: p.id, kind: p.kind, x: Math.round(p.x), z: Math.round(p.z), strength: p.strength })) }),
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
      // rodada 9 — confronto (QA: tools/qa/combat_mp.mjs)
      combat: () => (this.combat ? { ...this.combat.qa(), context: this.combat.context(this.player), policy: this.combat.policyAt(this.player.x, this.player.z), touch: this.touchCtl?.combatVisible ?? null } : null),
      cbt: (k: 'cbt_punch' | 'cbt_kick' | 'cbt_dodge') => this.combat?.press(k),
      /** NPCs de ambiente perto (QA do golpe em NPC): posição, distância e reação em curso */
      npcs: (r = 12) => {
        const out: { x: number; z: number; d: number; src: string }[] = [];
        const add = (src: string) => (t: { x: number; z: number }[]) => { for (const c of t) out.push({ x: +c.x.toFixed(2), z: +c.z.toFixed(2), d: +Math.hypot(c.x - this.player.x, c.z - this.player.z).toFixed(2), src }); };
        const a: import('../combat/npcHits').NpcTarget[] = [], b: import('../combat/npcHits').NpcTarget[] = [];
        this.peds.npcTargetsNear(this.player.x, this.player.z, r, a); this.rallyCrowd?.npcTargetsNear(this.player.x, this.player.z, r, b);
        add('ped')(a); add('rally')(b);
        return { list: out.sort((p, q) => p.d - q.d), reacting: this.peds.reacting(), peds: { hits: this.peds.stats.hits, reacting: this.peds.stats.reacting, down: this.peds.stats.down }, rally: { hits: this.rallyCrowd?.stats.hits ?? 0, reacting: this.rallyCrowd?.stats.reacting ?? 0 } };
      },
      jump: () => this.input.queueJump(),
      /** QA (rodada 9.1): queda local do próprio avatar (para trás, tempos das regras) — folhas de movimento */
      fall: () => { const h = this.player.heading; void this.avatar.knockdown({ dirX: -Math.sin(h), dirZ: -Math.cos(h), strength: 0.8, groundY: this.player.y, walls: this.collision.walls.near(this.player.x, this.player.z, 6), downMs: RULES.downMs, getupMs: RULES.getupMs }); },
      face: (yaw: number) => { this.player.heading = yaw; },
      // rodada 8: espectador e reconexão (QA)
      // espectador aéreo (rodada 8.1): camada, células recebidas (resumo + assinatura) e impostores desenhados
      specCells: () => {
        if (!this.net) return null;
        const list = [...this.net.specCells.values()].sort((a, b) => a.cz - b.cz || a.cx - b.cx);
        let h = 0x811c9dc5;
        for (const c of list) for (const v of [c.cx, c.cz, c.players, c.env, c.seed, ...c.activity, ...Object.entries(c.groups).flatMap(([k, n]) => [k.length, n])]) h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
        return { tier: this.net.specTier, cells: list.length, players: list.reduce((a, c) => a + c.players, 0), env: list.reduce((a, c) => a + c.env, 0), digest: h.toString(16), stats: { ...this.net.specCellStats }, impostors: this.cells ? { ...this.cells.stats, visible: this.cells.visible } : null, pedsVisible: this.peds.group.visible, rally: this.rallyCrowd?.stats.submitted ?? 0, aerial: this.aerial,
          list: list.map((c) => ({ cx: c.cx, cz: c.cz, players: c.players, env: c.env, groups: c.groups })) };
      },
      spectator: () => (this.spec ? { mode: this.spec.cam.mode, focus: this.spec.cam.focus, altitude: +this.spec.cam.altitude.toFixed(1), camera: { x: +this.camera.position.x.toFixed(1), y: +this.camera.position.y.toFixed(1), z: +this.camera.position.z.toFixed(1) }, avatarVisible: this.avatar.root.visible } : null),
      specSelect: (m: string) => this.spec?.select(m as Parameters<SpectatorMode['select']>[0]),
      /** pose completa da câmera livre (QA aéreo: altitude = sen(pitch) × dist, presa à faixa) */
      specPose: (x: number, z: number, yaw: number, pitch: number, dist: number, snap = false) => { if (!this.spec) return; this.spec.select('livre'); Object.assign(this.spec.cam.target, { x, z, yaw, pitch, dist }); if (snap) this.spec.cam.snap(); },
      toggleMap: () => this.hudShell.toggleMap(),
      specGoto: (x: number, z: number, dist?: number, snap = false) => { if (!this.spec) return; this.spec.cam.goTo(x, z, dist); this.spec.select('livre'); if (snap) this.spec.cam.snap(); },
      netDrop: () => this.net?.dropConnectionForTest(),
      netAutoReconnect: (on: boolean) => this.net?.setAutoReconnect(on),
      netSend: (type: string, payload?: unknown) => this.net?.send(type, payload),
      mp: () => (this.net ? { session: this.net.sessionId, role: this.net.role, link: this.net.link, replaced: this.net.replaced, reconnects: this.net.reconnects, rejoins: this.net.rejoins, status: this.net.status, capDenials: [...this.net.capDenials], self: { ...this.net.self }, remotes: this.net.remotesInfo(), bandwidth: this.net.bandwidth, interpDelay: this.net.interpDelay, rtt: worldClock.rtt, clockOffset: worldClock.offsetMs, corrections: this.net.corrections, correctionReasons: this.net.correctionReasons, policy: this.net.policy, vehiclesInView: this.net.vehiclesInView() } : null),
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
      /** QA do HUD (rodada 8): estado/custo e controle (limpo, mapa expandido, ajustes, menu, preferências) */
      hudInfo: () => ({ ...this.hudShell.info(), labels: this.net?.labelStats ?? null }),
      /** QA (rodada 9.1): barra de ações — popover, botões (caixas), itens do popover, dica, contadores */
      actionBar: () => this.actionBar?.qa() ?? null,
      hudSet: (o: { clean?: boolean; map?: boolean; settings?: boolean; menu?: boolean; help?: boolean; names?: 'TODOS' | 'PROXIMOS' | 'NENHUM'; autoHide?: boolean; poke?: boolean }) => {
        const h = this.hudShell;
        if (o.clean !== undefined) h.toggleClean(o.clean);
        if (o.map !== undefined) h.toggleMap(o.map);
        if (o.settings !== undefined) h.settings.toggle(o.settings);
        if (o.menu !== undefined) h.toggleMenu(o.menu);
        if (o.help !== undefined) h.toggleHelp(o.help);
        if (o.names) h.prefs.set({ names: o.names });
        if (o.autoHide !== undefined) h.prefs.set({ hudAutoHide: o.autoHide });
        if (o.poke) h.poke();
        return h.info();
      },
      ...this.r9bQa(), // rodada 9 — itens/efeitos/quedas
      audio: () => this.audioWorld.qa(), // rodada 10 — áudio (vozes, nós vivos, células, CPU)
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
