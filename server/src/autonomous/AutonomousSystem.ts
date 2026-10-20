/**
 * Rodada 12 — PERSONAGENS AUTÔNOMOS do mundo (docs/AUTONOMOUS_CHARACTERS.md). Server-authoritative, sem Colyseus aqui:
 * a sala liga pelo `AutonomousHost` (host.ts) e chama `tick`/`onCombat`/`onSelfMessage`.
 *
 *  população   persistente na sessão do mundo (ids `ac:<n>`, NetPlayer.kind = AUTÔNOMO); só os perto de algum humano
 *              existem em `state.players` (AOI/multidão como qualquer jogador); longe de todos = DORMANT (sem estado
 *              sincronizado, sem custo). Densidade cresce/esvazia pelos objetivos (chegam andando, vão embora andando)
 *  cérebro     utility AI (brain.ts) + personalidade (pesos) + memória curta; decisões DISTRIBUÍDAS (fase aleatória por
 *              pessoa, intervalo sorteado, reação a evento com atraso individual) — nunca "todos no mesmo tick"
 *  LOD         NEAR (movimento a 10 Hz, desvio, social, combate, veículo) · MID (passo a ~3 Hz, decisões espaçadas) ·
 *              FAR (passo a 1 Hz, sem desvio/gesto) · DORMANT — orçamentos explícitos (autonomous.json)
 *  movimento   steering.ts (aceleração, curva, antecipação, espaço pessoal, desvio suavizado, espera)
 *  social      rodas de 2–5 em círculo (cada um num ângulo, de frente para o centro), quem fala gesticula, os outros olham
 *  combate     CombatSystem pelo host (mesmas regras); reação a briga pela personalidade; humano só com motivo
 *  visão       implementa AutonomousWorldView (types.ts) para o DIRETOR de eventos (agente E)
 */
import type { AutonomousWorldView, Goal, GoalKind, Personality, ShortMemory, SimLod } from './types';
import type { AgentLook, AutonomousHost, Hotspot, HumanView, VehicleView } from './host';
import { autonomousConfig, combatMoves, rewardTitles, PERSONALITIES, type AutonomousConfig, type CombatMove, type VehicleUseKind } from './config';
import { PROFILES, proposalAffinity, type PersonalityProfile } from './personality';
import { chooseGoal, GOAL_MS, type BrainContext } from './brain';
import { Rng } from './rng';
import { NameGenerator, nicknameKey, releaseNickname, reserveNickname } from './names';
import { BODY, createBodyIndex, constrainStep, type BodyRef } from './bodies';
import { faceToward, headingTo, makeKin, steer, type Kin, type NeighborRef } from './steering';
import { Axis } from './axis';
import { randomAppearance, type CharacterAppearance } from '../../../src/characters/bodyTypes';
import { supporterOutfit, supIndex } from '../../../src/supporters/data';
import type { SupporterData } from '../../../src/supporters/types';
import { ACTION_BY_KEY, ACTION_BY_ID } from '../../../src/social/actions';
import { PROP_BY_ID } from '../../../src/social/props';

export const AUTONOMOUS_ID_PREFIX = 'ac:';
export const isAutonomousId = (sid: string | undefined | null) => !!sid && sid.startsWith(AUTONOMOUS_ID_PREFIX);

export const ACTIVITIES = ['idle', 'walk', 'run', 'social', 'event', 'vehicle', 'fight', 'watch', 'leave'] as const;
export type Activity = (typeof ACTIVITIES)[number];

const act = (k: string) => ACTION_BY_KEY.get(k)?.id ?? 0;
const A = {
  wave: act('wave'), clap: act('clap'), point: act('point'), cheer: act('cheer'), armUp: act('arm_up'), armsUp: act('arms_up'), thumbs: act('thumbs_up'),
  talk: act('talk'), sit: act('sit'), jumpCheer: act('jump_cheer'), phone: act('phone'), signRaise: act('sign_raise'), signWave: act('sign_wave'),
  flagRaise: act('flag_raise'), flagWave: act('flag_wave'), megaphone: act('megaphone'), rhythm: act('rhythm_clap'), fist: act('fist_up'), drum: act('drum'), whistle: act('whistle'),
  dances: ['dance_simple', 'dance_lively', 'dance_arms', 'dance_party'].map(act).filter((x) => x > 0),
};
const PROP = { flagS: 1, flagL: 2, signS: 3, signL: 4, megaphone: 7, whistle: 8, umbrella: 9, drum: 10 } as const;

interface Group {
  id: string; members: Agent[]; cx: number; cz: number; base: number;
  speaker: number; speakerUntil: number; createdAt: number;
  /** caminhando juntos (MEET_GROUP): o líder anda, os outros acompanham ao lado */
  walking: boolean;
}

interface Fight { x: number; z: number; startAt: number; lastAt: number; hits: number; nids: Map<number, number>; spontaneous: boolean }

/** plano de execução do objetivo atual (o passo de movimento só lê isto) */
interface Plan {
  mode: 'walk' | 'stand' | 'follow' | 'drive' | 'fight' | 'board';
  tx: number; tz: number; arriveR: number;
  /** multiplicador de velocidade (pressa) e correr? */
  hurry: number; run: boolean;
  /** de pé: encarar este ponto (ou a entidade `faceId`) */
  fx?: number; fz?: number; faceId?: string;
  /** ao chegar: ficar parado até (ms) e então novo ponto (WANDER) */
  pauseUntil: number;
  /** destino longo ao longo do eixo (TRAVEL/LEAVE/viagem de veículo): s e faixa lateral */
  axisS?: number; lane?: number;
  /** veículo-alvo (USE_VEHICLE) */
  vehicle?: string;
  /** ponto de concentração escolhido */
  hotspot?: string;
  arrivedAt: number;
  /** contornando um obstáculo: o alvo do eixo não é reposto até aqui (ms) */
  detourUntil?: number;
}

interface Agent {
  id: string; idx: number; name: string; nameKey: string; tag: number;
  personality: Personality; prof: PersonalityProfile; sup: number; app: CharacterAppearance; title: string; lvl: number;
  prop: number; design: number;
  /** variação individual */
  walk: number; runV: number; turn: number; accel: number; space: number; gestureRate: number; phase: number; reactMul: number; vehicleAffinity: VehicleUseKind | null;
  k: Kin;
  nid: number; materialized: boolean; lod: SimLod; dHuman: number;
  goal: Goal; mem: ShortMemory; plan: Plan;
  nextThink: number; lastStep: number; lastFeel: number; nextGesture: number; actUntil: number; act: number; lookNid: number; nextLook: number;
  group: Group | null; slot: number;
  vehicleId: string;
  /** confronto em curso; `dir` = coordenado pelo diretor (estágio vem do papel ARGUE/FIGHT + pushUntil) */
  fight: { target: string; stage: 0 | 1 | 2; until: number; nextAttack: number; combo: number; escalateAt: number; pushes: number; dir: boolean; tiredSince: number } | null;
  stamina: number; condition: number;
  bornAt: number; leaveAt: number; downSince: number;
  /** levantou/apareceu em (ms): proteção de retorno do CombatSystem até gotUpAt + protectMs — quem briga espera */
  gotUpAt: number;
  /** humanização (métricas) */
  st: { activity: Activity; moving: boolean; pathStart: { x: number; z: number } | null; pathLen: number; hSample: number; hAt: number; avoiding: boolean; waiting: boolean };
  seq: number;
  vx: number; vz: number;
  /** último movimento enviado (pula reenvio parado) e tipo do veículo em uso */
  sent: { speed: number; h: number };
  vehKind: string;
  /** item guardado para brigar de mão livre */
  stowed: { prop: number; design: number } | null;
  /** a última ameaça já teve reação */
  threatHandled: boolean;
  /** correções de parede seguidas no alvo atual */
  stuck: number;
  /** chegou (relocate) em — métricas */
  arrival: number;
}

export interface AutonomousOptions {
  /** quantos personagens na população (padrão: population.maxActive dos dados) */
  population?: number;
  seed?: number;
  config?: AutonomousConfig;
  supporters?: SupporterData | null;
  titles?: string[];
  /** papel do autônomo num evento do DIRETOR (agente E: DynamicWorldDirector.roleOf) — ARGUE/FIGHT/WATCH/FLEE/CORE/JOIN/RACE */
  roleOf?: (id: string) => DirectorRole | null;
}

/** o que o cérebro lê do diretor (subconjunto estrutural de RoleInfo, server/src/world/DynamicWorldDirector.ts) */
export interface DirectorRole { eventId: string; role: string; opponent?: string; pushUntil?: number }

/** contadores de custo (ms acumulados por janela) e de decisões — /metrics */
export interface AutonomousCost { aiMs: number; decideMs: number; moveMs: number; socialMs: number; lodMs: number; ticks: number; decisions: number; maxTickMs: number }

/** métricas de HUMANIZAÇÃO (tools autonomous_report.ts / testes) */
export class HumanizationStats {
  timeMs: Record<Activity, number> = Object.fromEntries(ACTIVITIES.map((a) => [a, 0])) as Record<Activity, number>;
  walkStarts = 0; walkStartsCrowded = 0; walkStartsMaxTick = 0;
  actStarts = 0; actStartsCrowded = 0; actStartsMaxTick = 0;
  sameActSameTick = 0;
  speedSum = 0; speedN = 0; movingMs = 0; stoppedMs = 0; dirChanges = 0;
  paths: number[] = [];
  avoidInterventions = 0; waits = 0; decisions = 0; wallRepaths = 0; giveUps = 0;
  arrivals = 0; attacks = 0; attacksDenied = 0; vehicleRides = 0; groupsFormed = 0; groupHeadingSpread: number[] = [];
  perAgentWalk: number[] = [];
  correctionsBy: Record<string, number> = {};
  private tickWalk = 0; private tickAct = 0; private tickActIds = new Map<number, number>();
  ticks = 0; walkStartsMaxAt = 0; walkStartsMaxSteady = 0;
  endTick() {
    this.ticks++;
    if (this.tickWalk >= 3) this.walkStartsCrowded += this.tickWalk;
    if (this.tickWalk > this.walkStartsMaxTick) { this.walkStartsMaxTick = this.tickWalk; this.walkStartsMaxAt = this.ticks; }
    // depois do aquecimento (30 s: todos aparecem juntos quando o primeiro humano chega)
    if (this.ticks > 300) this.walkStartsMaxSteady = Math.max(this.walkStartsMaxSteady, this.tickWalk);
    if (this.tickAct >= 3) this.actStartsCrowded += this.tickAct;
    this.actStartsMaxTick = Math.max(this.actStartsMaxTick, this.tickAct);
    for (const n of this.tickActIds.values()) if (n >= 2) this.sameActSameTick += n;
    this.tickWalk = 0; this.tickAct = 0; this.tickActIds.clear();
  }
  walkStart() { this.walkStarts++; this.tickWalk++; }
  actStart(id: number) { this.actStarts++; this.tickAct++; this.tickActIds.set(id, (this.tickActIds.get(id) ?? 0) + 1); }
}

const PERSONAL_KINDS: readonly VehicleUseKind[] = ['bicycle', 'scooter', 'moto', 'car'];
const VEH_SPEED: Record<string, [number, number]> = { bicycle: [3.8, 5.6], scooter: [3.2, 4.6], moto: [5.5, 7.6], car: [4.5, 7.2] };
const FIGHT_VIEW_M = 28;
/** STATUS.STAGGER (src/net/rules.ts) — cambaleio curto, não é queda */
const STAGGER = 3;

export class AutonomousSystem implements AutonomousWorldView {
  readonly agents: Agent[] = [];
  private byId = new Map<string, Agent>();
  private byNid = new Map<number, Agent>();
  private groups = new Set<Group>();
  private groupSeq = 0;
  private bodies = createBodyIndex(4);
  private allGrid = createBodyIndex(16);
  private gridRefs: (BodyRef & { a: Agent })[] = [];
  private nb: NeighborRef[] = [];
  private nbPool: NeighborRef[] = [];
  private tmp: BodyRef[] = [];
  private humanList: readonly HumanView[] = [];
  /** pessoas com corpo (sem as câmeras de espectador) */
  private people: HumanView[] = [];
  private humanByNid = new Map<number, HumanView>();
  private humanById = new Map<string, HumanView>();
  private fights: Fight[] = [];
  private hitLog: { x: number; z: number; at: number }[] = [];
  private tickN = 0;
  private rng: Rng;
  readonly cfg: AutonomousConfig;
  readonly axis: Axis;
  readonly names: NameGenerator;
  readonly stats = new HumanizationStats();
  readonly cost: AutonomousCost = { aiMs: 0, decideMs: 0, moveMs: 0, socialMs: 0, lodMs: 0, ticks: 0, decisions: 0, maxTickMs: 0 };
  private moves = combatMoves();
  private vehScratch: VehicleView[] = [];
  private hotspotCache: readonly Hotspot[] = [];
  private lastOnCombatAct = new Map<number, number>();
  /** contagem por LOD (atualizada no passe de LOD) */
  readonly lodCount: Record<SimLod, number> = { NEAR: 0, MID: 0, FAR: 0, DORMANT: 0 };
  private disposed = false;

  private roleOf: (id: string) => DirectorRole | null;
  constructor(private host: AutonomousHost, opts: AutonomousOptions = {}) {
    this.roleOf = opts.roleOf ?? (() => null);
    this.cfg = opts.config ?? autonomousConfig();
    this.rng = new Rng(opts.seed ?? 20261019);
    this.axis = new Axis(host.axis);
    this.names = new NameGenerator(this.cfg.names, new Rng((opts.seed ?? 20261019) ^ 0x5bd1e995), (k) => !!host.nameTaken?.(k));
    const n = Math.max(0, Math.round(opts.population ?? this.cfg.population.maxActive));
    this.hotspotCache = host.hotspots();
    const titles = opts.titles ?? rewardTitles();
    for (let i = 0; i < n; i++) this.agents.push(this.create(i, opts.supporters ?? null, titles));
    for (const a of this.agents) { this.byId.set(a.id, a); reserveNickname(a.nameKey); }
  }

  get population() { return this.agents.length; }
  get active() { return this.lodCount.NEAR + this.lodCount.MID + this.lodCount.FAR; }
  has(id: string) { return this.byId.has(id); }
  nameOf(id: string) { return this.byId.get(id)?.name; }
  /** autônomo por nid (painel da pessoa, denúncia/silenciar recusados) */
  isAutonomousNid(nid: number) { return this.byNid.has(nid); }
  /** id (autônomo ou pessoa) pelo nid de rede */
  idOfNid(nid: number): string | null { return this.byNid.get(nid)?.id ?? this.humanByNid.get(nid)?.id ?? null; }

  /** a população alvo: menos autônomos quando há muitos humanos (perHumanReduction), nunca abaixo de minActive */
  targetActive(humans = this.humanList.length) {
    const P = this.cfg.population;
    return Math.min(this.agents.length, Math.max(Math.min(P.minActive, this.agents.length), Math.round(P.maxActive - P.perHumanReduction * humans)));
  }

  // ------------------------------------------------------------------------------------------------ criação
  private create(i: number, sup: SupporterData | null, titles: string[]): Agent {
    const r = this.rng, cfg = this.cfg;
    const personality = r.weighted(cfg.personalities) as Personality;
    const prof = PROFILES[personality] ?? PROFILES.SOCIAL;
    // torcida pelos DADOS (fração por id); TORCEDOR quase sempre tem uma
    let supId: string | null = null;
    const shares = { ...cfg.supporters };
    if (personality === 'TORCEDOR' && sup) { const neutral = sup.neutralId; if (neutral in shares) shares[neutral] = shares[neutral] * 0.1; }
    if (Object.keys(shares).length) supId = r.weighted(shares);
    const supWire = sup && supId ? supIndex(sup, supId) : 0;
    const app = randomAppearance(r.int(1, 2 ** 31), undefined, { football: 0.12 });
    const g = supWire > 0 && sup ? sup.groups[supWire - 1] : null;
    if (g && (personality === 'TORCEDOR' || r.chance(0.65))) { const o = supporterOutfit(g); app.shirtDesign = o.shirtDesign; app.top = o.top; app.topStyle = 'camiseta'; if (o.bottom !== undefined && r.chance(0.5)) app.bottom = o.bottom; if (o.shoes !== undefined && r.chance(0.4)) app.shoes = o.shoes; }
    // item na mão coerente com a personalidade (bandeira da torcida pelos dados; cartaz/megafone para manifestante)
    let prop = 0, design = 0;
    if (g && (personality === 'TORCEDOR' ? r.chance(0.6) : r.chance(0.12))) { prop = r.chance(0.75) ? PROP.flagS : PROP.flagL; design = g.flagSet.length ? r.pick(g.flagSet) : 0; }
    else if (personality === 'MANIFESTANTE') { const x = r.next(); prop = x < 0.4 ? PROP.signS : x < 0.6 ? PROP.signL : x < 0.68 ? PROP.megaphone : x < 0.76 ? PROP.whistle : x < 0.8 ? PROP.drum : 0; }
    else if (r.chance(0.03)) prop = PROP.umbrella;
    const hasTitle = titles.length > 0 && r.chance(cfg.titles.share);
    const lvl = hasTitle ? r.int(4, 16) : (r.chance(0.7) ? r.int(1, 9) : 0);
    const walk = Math.max(1.0, Math.min(1.85, (1.38 + r.gauss() * 0.12) * prof.speed));
    const vehicleAffinity = r.chance(cfg.vehicles.share * (personality === 'EXPLORADOR' ? 2.2 : 1)) ? r.weighted(cfg.vehicles.kinds) : null;
    const name = this.names.next();
    const p = this.initialPosition(r);
    const now = this.host.now();
    const stay = r.range(prof.stayMin[0], prof.stayMin[1]) * 60_000;
    return {
      id: `${AUTONOMOUS_ID_PREFIX}${i + 1}`, idx: i, name, nameKey: nicknameKey(name), tag: r.chance(cfg.nametag.share) ? 1 : 2, // NetPlayer.tag: 1 sempre com nome · 2 nunca (sorteio pela fração dos dados)
      personality, prof, sup: supWire, app, title: hasTitle ? r.pick(titles) : '', lvl, prop, design,
      walk, runV: Math.max(3.2, Math.min(5.4, 4.3 + r.gauss() * 0.35)), turn: r.range(2.4, 3.6), accel: r.range(1.1, 1.8), space: BODY.personalSpace * prof.space * r.range(0.9, 1.15),
      gestureRate: Math.max(0.3, prof.gestures * r.range(0.55, 1.5)), phase: r.range(0, Math.PI * 2), reactMul: r.range(0.7, 1.5), vehicleAffinity,
      k: makeKin(p.x, p.z, r.range(-Math.PI, Math.PI)),
      nid: 0, materialized: false, lod: 'DORMANT', dHuman: Infinity,
      goal: { kind: 'IDLE', until: 0, source: 'self' }, mem: {}, plan: this.standPlan(p.x, p.z),
      nextThink: 0, lastStep: now, lastFeel: 0, nextGesture: now + r.range(2000, 20000), actUntil: 0, act: 0, lookNid: 0, nextLook: 0,
      group: null, slot: 0, vehicleId: '', fight: null, stamina: this.moves.staminaMax, condition: 100,
      bornAt: now, leaveAt: now + stay, downSince: 0, gotUpAt: 0,
      st: { activity: 'idle', moving: false, pathStart: null, pathLen: 0, hSample: 0, hAt: 0, avoiding: false, waiting: false }, seq: 0, vx: 0, vz: 0,
      sent: { speed: -1, h: 0 }, vehKind: '', stowed: null, threatHandled: false, stuck: 0, arrival: 0,
    };
  }

  /** espalhada: ~45 % perto dos pontos de concentração, o resto ao longo do eixo, em faixas livres de parede */
  private initialPosition(r: Rng): { x: number; z: number } {
    const hs = this.hotspotCache.filter((h) => !h.moving);
    for (let i = 0; i < 12; i++) {
      if (hs.length && r.chance(0.45)) {
        const h = r.pick(hs), a = r.range(0, Math.PI * 2), d = r.range(h.inner + 1, h.radius + 12);
        const p = { x: h.x + Math.sin(a) * d, z: h.z + Math.cos(a) * d };
        if (this.inBounds(p.x, p.z) && this.host.clear(h.x, h.z, p.x, p.z)) return p;
      } else if (this.axis.ok) {
        const q = this.axis.at(r.range(0, this.axis.len), 0), lat = r.range(-24, 24);
        const p = this.axis.at(this.axis.project(q.x, q.z).s, lat);
        if (this.inBounds(p.x, p.z) && this.host.clear(q.x, q.z, p.x, p.z)) return { x: p.x, z: p.z };
      }
    }
    const q = this.axis.ok ? this.axis.at(r.range(0, this.axis.len), 0) : { x: 0, z: 0 };
    return { x: q.x, z: q.z };
  }

  private inBounds(x: number, z: number) { const b = this.host.bounds; return x > b[0] + 5 && z > b[1] + 5 && x < b[2] - 5 && z < b[3] - 5; }

  private lookOf(a: Agent): AgentLook { return { name: a.name, appearance: a.app, sup: a.sup, title: a.title, lvl: a.lvl, tag: a.tag, prop: a.prop, design: a.design }; }

  // ------------------------------------------------------------------------------------------------ tick
  tick(_dtMs = 100) {
    if (this.disposed) return;
    const t0 = performance.now();
    const now = this.host.now();
    this.tickN++;
    this.humanList = this.host.humans();
    this.humanByNid.clear(); this.humanById.clear();
    this.people.length = 0;
    for (const h of this.humanList) { if (h.spectator) continue; this.people.push(h); this.humanByNid.set(h.nid, h); this.humanById.set(h.id, h); }
    // passe de LOD/materialização a 2 Hz (ordenado pela distância ao humano mais próximo; orçamentos)
    if (this.tickN % 5 === 1) { const tl = performance.now(); this.lodPass(now); this.cost.lodMs += performance.now() - tl; }
    if (this.tickN % 20 === 7) this.relocate(now);
    if (this.tickN % 10 === 3) { this.hotspotCache = this.host.hotspots(); this.expireFights(now); }
    if (this.active === 0) { this.finishTick(t0); return; }
    // corpos (humanos a pé + autônomos materializados) com velocidade — antecipação
    this.rebuildBodies();
    if (this.tickN % 5 === 2) this.rebuildAllGrid();
    // decisões: cada um na sua hora (fase/intervalo individuais); orçamento por tick contra picos
    const td = performance.now();
    let budget = Math.max(12, Math.ceil(this.active / 6));
    for (const a of this.agents) {
      if (!a.materialized || now < a.nextThink) continue;
      if (budget-- <= 0) { a.nextThink = now + 50 + (a.idx % 7) * 30; continue; }
      this.think(a, now);
    }
    this.cost.decideMs += performance.now() - td;
    // movimento pelo LOD (fatias desencontradas pelo índice: MID a ~3 Hz, FAR a 1 Hz)
    const tm = performance.now();
    for (const a of this.agents) {
      if (!a.materialized) continue;
      const busy = a.fight !== null || a.goal.kind === 'AVOID_FIGHT' || a.vehicleId !== '';
      const every = a.lod === 'NEAR' || (busy && a.lod === 'MID') ? 1 : a.lod === 'MID' ? 3 : 10;
      if ((this.tickN + a.idx) % every !== 0) continue;
      this.step(a, now);
    }
    this.cost.moveMs += performance.now() - tm;
    const ts = performance.now();
    this.socialTick(now);
    this.cost.socialMs += performance.now() - ts;
    this.stats.endTick();
    this.finishTick(t0);
  }

  private finishTick(t0: number) {
    const ms = performance.now() - t0;
    this.cost.aiMs += ms; this.cost.ticks++; this.cost.maxTickMs = Math.max(this.cost.maxTickMs, ms);
  }

  /** zera a janela de custo (consumidor: /metrics) e devolve a anterior */
  takeCost(): AutonomousCost {
    const c = { ...this.cost };
    Object.assign(this.cost, { aiMs: 0, decideMs: 0, moveMs: 0, socialMs: 0, lodMs: 0, ticks: 0, decisions: 0, maxTickMs: 0 });
    return c;
  }

  // ------------------------------------------------------------------------------------------------ LOD e população
  private order: Agent[] = [];
  private lodPass(now: number) {
    const H = this.humanList, P = this.cfg.population;
    for (const a of this.agents) {
      let best = Infinity;
      for (const h of H) { const d = (h.x - a.k.x) ** 2 + (h.z - a.k.z) ** 2; if (d < best) best = d; }
      a.dHuman = Math.sqrt(best);
    }
    const order = this.order;
    order.length = 0;
    for (const a of this.agents) order.push(a);
    order.sort((p, q) => p.dHuman - q.dHuman);
    const target = this.targetActive(H.length);
    let active = 0, near = 0, mid = 0;
    for (const a of order) {
      const d = a.dHuman;
      if (a.materialized) {
        // sai do estado sincronizado: longe de todos, ou acima do orçamento (só os já longe — nada some na frente)
        if (d > P.dormantM || (active >= target && d > P.mid.radius) || (active >= target + 20)) { this.dematerialize(a); continue; }
      } else if (d <= P.materializeM && active < target && a.downSince === 0) {
        if (!this.materialize(a, now)) continue;
      } else { a.lod = 'DORMANT'; continue; }
      active++;
      const prev = a.lod;
      if (d <= P.near.radius && near < P.near.max) { a.lod = 'NEAR'; near++; }
      else if (d <= P.mid.radius && mid < P.mid.max) { a.lod = 'MID'; mid++; }
      else a.lod = 'FAR';
      // mudou de faixa: a próxima decisão vem no ritmo novo (com fase própria, sem sincronizar)
      if (prev !== a.lod && prev !== 'DORMANT') { const band = this.band(a.lod); a.nextThink = Math.min(a.nextThink, now + this.rng.range(200, band[0])); }
    }
    this.lodCount.NEAR = near; this.lodCount.MID = mid; this.lodCount.FAR = active - near - mid; this.lodCount.DORMANT = this.agents.length - active;
  }

  private band(l: SimLod): [number, number] {
    const P = this.cfg.population;
    return l === 'NEAR' ? P.near.thinkMs : l === 'MID' ? P.mid.thinkMs : P.far.thinkMs;
  }

  private materialize(a: Agent, now: number): boolean {
    // humano com o mesmo apelido entrou: troca o apelido antes de aparecer
    if (this.host.nameTaken?.(a.nameKey)) this.rename(a);
    const nid = this.host.spawn(a.id, this.lookOf(a), a.k.x, a.k.z, a.k.heading);
    if (!nid) return false;
    a.nid = nid; a.materialized = true; a.lod = 'FAR'; a.lastStep = now; a.gotUpAt = now; a.act = 0; a.lookNid = 0; a.vehicleId = ''; a.vehKind = ''; a.fight = null; a.k.speed = 0; a.sent.speed = -1;
    this.byNid.set(nid, a);
    // fase própria: a primeira decisão cai num instante sorteado (nunca "todos ao entrar")
    a.nextThink = now + this.rng.range(150, 4500);
    a.nextGesture = now + this.rng.range(1500, 60_000 / a.gestureRate);
    return true;
  }

  private dematerialize(a: Agent) {
    if (!a.materialized) return;
    this.leaveGroup(a, false);
    this.host.despawn(a.id);
    this.byNid.delete(a.nid);
    a.materialized = false; a.nid = 0; a.lod = 'DORMANT'; a.vehicleId = ''; a.fight = null; a.act = 0; a.k.speed = 0; a.stowed = null;
    this.endPath(a);
    // quem estava indo embora "foi": volta outro dia (novo tempo de permanência quando reaparecer)
    if (a.goal.kind === 'LEAVE_AREA') { a.goal = { kind: 'IDLE', until: 0, source: 'self' }; a.leaveAt = this.host.now() + this.rng.range(a.prof.stayMin[0], a.prof.stayMin[1]) * 60_000; }
  }

  private rename(a: Agent) {
    releaseNickname(a.nameKey);
    this.names.forget(a.name);
    a.name = this.names.next(); a.nameKey = nicknameKey(a.name);
    reserveNickname(a.nameKey);
  }

  /** confere os apelidos contra as CONTAS do banco (assíncrono, antes de aparecerem) — colisão → novo apelido */
  async screenNames(taken: (key: string) => Promise<boolean>) {
    for (const a of this.agents) {
      if (this.disposed) return;
      for (let i = 0; i < 5 && !a.materialized; i++) {
        let hit = false;
        try { hit = await taken(a.nameKey); } catch { return; }
        if (!hit) break;
        this.rename(a);
      }
    }
  }

  /**
   * densidade ORGÂNICA perto de CADA humano (rodada 12, agente G): quem tem menos de `want` autônomos a ≤ local.radiusM
   * recebe gente que "chega" — alguém DORMANT (ou materializado bem longe de todos, fora da vista) passa a vir andando de
   * fora da faixa de atenção até perto dele. No eixo: aparece a local.arriveM pelo eixo; LONGE do eixo (vagas a ~270 m,
   * ruas laterais): por uma linha livre de parede a local.offAxisM do humano — as ruas fecham a vista. Nada surge na
   * frente de ninguém; o teto de população (targetActive) continua valendo.
   */
  private relocate(now: number) {
    const H = this.humanList;
    if (!H.length || !this.axis.ok) return;
    const P = this.cfg.population, L = P.local;
    const nh = Math.min(H.length, 8);
    const want = Math.min(L.max, Math.max(L.min, Math.round(L.share * this.targetActive(H.length) / nh)));
    const r2 = L.radiusM * L.radiusM;
    let budget = L.perPass * 3;
    for (let hi = 0; hi < nh && budget > 0; hi++) {
      const h = H[(this.relocN + hi) % H.length];
      let local = 0;
      for (const a of this.agents) if (a.materialized && (a.k.x - h.x) ** 2 + (a.k.z - h.z) ** 2 <= r2) local++;
      for (let k = 0; k < L.perPass && local < want && budget > 0; k++) {
        const cand = this.arrivalCandidate();
        if (!cand) return;
        const q = this.arrivalPoint(h);
        if (!q) break;
        if (cand.materialized) this.dematerialize(cand);
        cand.k.x = q.x; cand.k.z = q.z; cand.k.heading = headingTo(q.tx - q.x, q.tz - q.z);
        // chega andando até perto do humano e então vive ali (passeio, roda, concentração — o cérebro decide)
        cand.goal = { kind: 'WANDER', until: now + this.rng.range(45_000, 120_000), source: 'self' };
        cand.plan = { ...this.walkPlan(q.tx, q.tz, 1.02), arriveR: 1.2 };
        cand.dHuman = Math.hypot(q.x - h.x, q.z - h.z);
        cand.arrival = now;
        local++; budget--; this.stats.arrivals++;
      }
    }
    this.relocN++;
  }
  private relocN = 0;

  /** quem pode "chegar": DORMANT longe de todos, ou materializado a mais de mid+20 m de qualquer humano e sem compromisso */
  private arrivalCandidate(): Agent | null {
    const P = this.cfg.population;
    const n = this.agents.length;
    const off = this.rng.int(0, Math.max(0, n - 1));
    let fallback: Agent | null = null;
    for (let i = 0; i < n; i++) {
      const a = this.agents[(off + i) % n];
      if (a.downSince) continue;
      if (!a.materialized) { if (a.dHuman > P.dormantM + 30 || a.dHuman === Infinity) return a; continue; }
      if (!fallback && a.lod === 'FAR' && a.dHuman > P.mid.radius + 20 && !a.fight && !a.group && !a.vehicleId && !this.roleOf(a.id) && a.goal.source !== 'director') fallback = a;
    }
    return fallback;
  }

  /** ponto de chegada para perto do humano `h` (ponto de surgir x,z e alvo de caminhada tx,tz) */
  private arrivalPoint(h: HumanView): { x: number; z: number; tx: number; tz: number } | null {
    const L = this.cfg.population.local;
    const pr = this.axis.project(h.x, h.z);
    if (Math.abs(pr.lat) <= 35) {
      for (let i = 0; i < 4; i++) {
        const side = this.rng.chance(0.5) ? 1 : -1;
        const s = Math.max(5, Math.min(this.axis.len - 5, pr.s + side * this.rng.range(L.arriveM[0], L.arriveM[1])));
        const lane = this.rng.range(-20, 20);
        const c = this.axis.at(s, 0), p = this.axis.at(s, lane);
        if (!this.inBounds(p.x, p.z) || !this.host.clear(c.x, c.z, p.x, p.z)) continue;
        const t = this.axis.at(pr.s + side * this.rng.range(-10, 30), this.rng.range(-18, 18));
        return { x: p.x, z: p.z, tx: t.x, tz: t.z };
      }
      return null;
    }
    // longe do eixo: por uma rua livre (linha sem parede) que chega até o humano
    for (let i = 0; i < 10; i++) {
      const ang = this.rng.range(-Math.PI, Math.PI), d = this.rng.range(L.offAxisM[0], L.offAxisM[1]);
      const x = h.x + Math.sin(ang) * d, z = h.z + Math.cos(ang) * d;
      if (!this.inBounds(x, z) || !this.host.clear(h.x, h.z, x, z)) continue;
      const back = this.rng.range(5, 18);
      return { x, z, tx: h.x + Math.sin(ang) * back + this.rng.range(-2, 2), tz: h.z + Math.cos(ang) * back + this.rng.range(-2, 2) };
    }
    return null;
  }

  /** alguém (humano a pé) a ≤ r m — fora do eixo, o passeio fica onde há gente */
  private nearPerson(x: number, z: number, r: number) {
    for (const h of this.people) if ((h.x - x) ** 2 + (h.z - z) ** 2 <= r * r) return true;
    return false;
  }

  // ------------------------------------------------------------------------------------------------ corpos
  private rebuildBodies() {
    this.bodies.clear();
    let n = 0;
    const take = (): NeighborRef => (this.nbPool[n] ??= { id: '', x: 0, z: 0, r: BODY.radius, vx: 0, vz: 0 });
    for (const h of this.people) {
      if (h.vehicle) continue;
      const b = take(); n++;
      b.id = h.id; b.x = h.x; b.z = h.z; b.r = BODY.radius; b.vx = Math.sin(h.heading) * h.speed; b.vz = Math.cos(h.heading) * h.speed; b.fixed = h.status !== 0;
      this.bodies.add(b);
    }
    for (const a of this.agents) {
      if (!a.materialized || a.vehicleId) continue;
      const b = take(); n++;
      b.id = a.id; b.x = a.k.x; b.z = a.k.z; b.r = BODY.radius; b.vx = a.vx; b.vz = a.vz; b.fixed = a.downSince > 0;
      this.bodies.add(b);
    }
  }

  private rebuildAllGrid() {
    this.allGrid.clear();
    let n = 0;
    for (const a of this.agents) {
      const r = (this.gridRefs[n] ??= { id: '', x: 0, z: 0, r: BODY.radius, a });
      r.id = a.id; r.x = a.k.x; r.z = a.k.z; r.a = a; n++;
      this.allGrid.add(r);
    }
  }

  private neighbors(a: Agent, r: number): NeighborRef[] {
    this.bodies.near(a.k.x, a.k.z, r, this.tmp);
    this.nb.length = 0;
    for (const b of this.tmp) if (b.id !== a.id) this.nb.push(b as NeighborRef);
    return this.nb;
  }

  // ------------------------------------------------------------------------------------------------ decisão
  private think(a: Agent, now: number) {
    this.cost.decisions++; this.stats.decisions++;
    a.nextThink = now + this.rng.range(...this.band(a.lod));
    const s = this.host.state(a.id);
    if (!s) { a.materialized = false; return; }
    if (s.status !== 0) { a.nextThink = now + this.rng.range(250, 700); return; } // caído/cambaleando: decide logo que puder
    // fui atacado: reação pessoal imediata (revidar, fugir ou reclamar) — antes de qualquer outra coisa
    if (a.mem.threat && !a.threatHandled && now - a.mem.threat.at < 5000 && !a.fight) { a.threatHandled = true; if (this.reactToThreat(a, a.mem.threat.id, now)) return; }
    // briga em curso: o executor cuida (fim, escalada) — só reavalia quando acaba
    if (a.fight && now < a.fight.until) return;
    // montado com destino: segue até chegar (ninguém desce do veículo a cada decisão)
    if (a.vehicleId && now < a.goal.until && a.plan.mode === 'drive') return;
    const live = now < a.goal.until;
    // pedido aceito do diretor vale até expirar — salvo AMEAÇA recente (fui atacado: reajo por conta própria)
    const threatened = !!a.mem.threat && now - a.mem.threat.at < 4000;
    if (a.goal.source === 'director' && live && !threatened) return;
    const ctx = this.context(a, now, live);
    const kind = chooseGoal(ctx, this.rng);
    if (kind !== a.goal.kind || !live) this.startGoal(a, kind, now, 'self');
  }

  private context(a: Agent, now: number, live: boolean): BrainContext {
    let socialNear = 0, sameSup = 0;
    this.allGrid.near(a.k.x, a.k.z, a.sup ? 120 : 14, this.tmp);
    for (const b of this.tmp) {
      const o = (b as BodyRef & { a: Agent }).a;
      if (!o || o === a || !o.materialized) continue;
      const d2 = (o.k.x - a.k.x) ** 2 + (o.k.z - a.k.z) ** 2;
      if (d2 < 196 && !o.fight && !o.vehicleId && (!o.group || o.group.members.length < 5) && (o.goal.kind === 'WANDER' || o.goal.kind === 'IDLE' || o.goal.kind === 'SOCIALIZE')) socialNear++;
      if (a.sup && o.sup === a.sup) sameSup++;
    }
    const hs = this.bestHotspot(a, 260);
    const f = this.nearestFight(a.k.x, a.k.z, FIGHT_VIEW_M, now);
    const fightCtx = f ? { d: Math.hypot(f.x - a.k.x, f.z - a.k.z), age: now - f.lastAt, friendInvolved: this.friendInFight(a, f) } : (a.mem.fightSeen && now - a.mem.fightSeen.at < 15_000 ? { d: Math.hypot(a.mem.fightSeen.x - a.k.x, a.mem.fightSeen.z - a.k.z), age: now - a.mem.fightSeen.at, friendInvolved: false } : null);
    let humanNear = false;
    for (const h of this.people) if (Math.abs(h.x - a.k.x) < 8 && Math.abs(h.z - a.k.z) < 8) { humanNear = true; break; }
    let vehicleNear = false;
    if (a.vehicleAffinity && a.lod !== 'FAR') vehicleNear = this.freeVehicle(a, 30) !== null;
    return {
      personality: a.personality, now, current: a.goal.kind, currentLive: live, socialNear, inGroup: !!a.group,
      hotspot: hs ? { d: hs.d, weight: hs.w, moving: !!hs.h.moving, dance: hs.h.kind === 'trio' || hs.h.kind === 'soundcar' || hs.h.kind === 'stage' } : null,
      fight: fightCtx, sameSupNear: sameSup, hasSup: a.sup > 0, vehicleNear, vehicleAffinity: !!a.vehicleAffinity, humanNear,
      overstay: now > a.leaveAt, threatened: !!a.mem.threat && now - a.mem.threat.at < 12_000,
    };
  }

  /** ponto de concentração mais atraente (peso × prova social ÷ distância) */
  private bestHotspot(a: Agent, maxD: number): { h: Hotspot; d: number; w: number } | null {
    let best: { h: Hotspot; d: number; w: number } | null = null, bestScore = 0;
    for (const h of this.hotspotCache) {
      const d = Math.hypot(h.x - a.k.x, h.z - a.k.z);
      if (d > maxD) continue;
      const crowd = this.countNear(h.x, h.z, h.radius + 4);
      const w = h.weight * (1 + Math.min(1, crowd / 30) * 0.6) * (crowd > 80 ? 0.6 : 1);
      const score = w / (1 + d / 60);
      if (score > bestScore) { bestScore = score; best = { h, d, w }; }
    }
    return best;
  }

  private countNear(x: number, z: number, r: number) {
    this.allGrid.near(x, z, r, this.tmp);
    let n = 0;
    for (const b of this.tmp) if ((b as BodyRef & { a: Agent }).a?.materialized) n++;
    for (const h of this.people) if ((h.x - x) ** 2 + (h.z - z) ** 2 <= r * r) n++;
    return n;
  }

  private startGoal(a: Agent, kind: GoalKind, now: number, source: Goal['source'], g?: Omit<Goal, 'source'>) {
    const [m0, m1] = GOAL_MS[kind];
    const prev = a.goal.kind;
    a.goal = { kind, until: g?.until ?? now + this.rng.range(m0, m1), source, ...(g?.x !== undefined ? { x: g.x, z: g.z } : {}), ...(g?.target ? { target: g.target } : {}), ...(g?.eventId ? { eventId: g.eventId } : {}) };
    const social = kind === 'SOCIALIZE' || kind === 'MEET_GROUP';
    if (a.group && !social) this.leaveGroup(a, true);
    if (a.vehicleId && kind !== 'USE_VEHICLE' && kind !== 'TRAVEL' && kind !== 'LEAVE_AREA') { this.host.exit(a.id); a.vehicleId = ''; a.mem.vehicle = undefined; }
    if (kind !== 'JOIN_FIGHT' && a.fight) { a.fight = null; this.unstowProp(a); }
    if (prev !== kind && a.act && kind !== 'CHEER' && kind !== 'JOIN_CROWD') this.stopAct(a, now);
    const x = a.k.x, z = a.k.z, r = this.rng;
    switch (kind) {
      case 'WANDER': { const p = this.pointNear(x, z, 12, 55); a.plan = this.walkPlan(p.x, p.z, 1); break; }
      case 'IDLE': { a.plan = this.standPlan(x, z); const hs = this.bestHotspot(a, 60); if (hs) { a.plan.fx = hs.h.x; a.plan.fz = hs.h.z; } else { a.plan.fx = x + Math.sin(a.k.heading + r.range(-1, 1)) * 5; a.plan.fz = z + Math.cos(a.k.heading + r.range(-1, 1)) * 5; } break; }
      case 'TRAVEL': case 'LEAVE_AREA': {
        // destino dado (diretor: corrida improvisada RACE / ida a um ponto): vai direto, correndo se for corrida
        if (kind === 'TRAVEL' && g?.x !== undefined && g.z !== undefined) {
          const race = this.roleOf(a.id)?.role === 'RACE';
          a.plan = { ...this.walkPlan(g.x, g.z, race ? 1.2 : 1.05), run: race || r.chance(a.prof.run * 0.3), arriveR: 1.5 };
          break;
        }
        let s = this.axis.project(x, z).s;
        if (kind === 'LEAVE_AREA') {
          // vai embora pelo lado do eixo com menos humanos
          let ahead = 0, behind = 0;
          for (const h of this.humanList) { const hs = this.axis.project(h.x, h.z).s; if (hs > s) ahead++; else behind++; }
          s += (ahead <= behind ? 1 : -1) * r.range(320, 520);
        } else {
          // viagem: metade das vezes para perto de alguém que está jogando NO eixo (é lá que a avenida está viva)
          const hp = this.people.length && r.chance(0.5) ? r.pick(this.people) : null;
          const hq = hp ? this.axis.project(hp.x, hp.z) : null;
          if (hq && Math.abs(hq.lat) <= 35 && Math.abs(hq.s - s) > 60) s = hq.s + r.range(-40, 40);
          else s += (r.chance(0.5) ? 1 : -1) * r.range(110, 420);
        }
        s = Math.max(10, Math.min(this.axis.len - 10, s));
        a.plan = { ...this.walkPlan(x, z, kind === 'LEAVE_AREA' ? 1.04 : 1.06), axisS: s, lane: r.range(-20, 20), run: r.chance(a.prof.run * 0.5) };
        // viagem longa e veículo livre perto: vai de veículo (mesmo caminho dos jogadores)
        // quem gosta de veículo procura um a ≤ 30 m; qualquer um, às vezes, pega um que está bem do lado (≤ 12 m)
        const casual = !a.vehicleAffinity && kind === 'TRAVEL' && r.chance(0.1);
        if (casual) { const v = this.freeVehicle(a, 12); if (v) { a.goal.kind = 'USE_VEHICLE'; a.plan = { ...this.walkPlan(v.x, v.z, 1.05), mode: 'board', vehicle: v.id, axisS: s, lane: a.plan.lane, arriveR: 1.0 }; } }
        if (a.vehicleAffinity && kind === 'TRAVEL') {
          const v = this.freeVehicle(a, 30);
          if (v) { a.goal.kind = 'USE_VEHICLE'; a.plan = { ...this.walkPlan(v.x, v.z, 1.05), mode: 'board', vehicle: v.id, axisS: s, lane: a.plan.lane, arriveR: 1.0 }; }
          // sem veículo do mundo por perto: às vezes o PRÓPRIO (gancho do veículo pessoal — mesmas validações; só o dono usa)
          else if (this.host.personalVehicle && r.chance(0.5)) {
            const id = this.host.personalVehicle(a.id, a.vehicleAffinity, { x, z });
            const st = id ? this.host.state(a.id) : undefined;
            if (id && st?.vehicle === id) {
              a.vehicleId = id; a.mem.vehicle = id; a.vehKind = a.vehicleAffinity; a.sent.speed = -1; a.k.speed = 0; this.stats.vehicleRides++;
              a.goal.kind = 'USE_VEHICLE'; a.goal.until = Math.max(a.goal.until, now + 60_000);
              a.plan = { ...this.walkPlan(x, z, 1), mode: 'drive', axisS: s, lane: a.plan.lane, vehicle: id };
            }
          }
        }
        break;
      }
      case 'USE_VEHICLE': {
        const v = this.freeVehicle(a, 30);
        const s = Math.max(10, Math.min(this.axis.len - 10, this.axis.project(x, z).s + (r.chance(0.5) ? 1 : -1) * r.range(150, 450)));
        if (v) a.plan = { ...this.walkPlan(v.x, v.z, 1.05), mode: 'board', vehicle: v.id, axisS: s, lane: r.range(-18, 18), arriveR: 1.0 };
        else this.startGoal(a, 'TRAVEL', now, source);
        break;
      }
      case 'SOCIALIZE': case 'MEET_GROUP': this.joinOrFormGroup(a, now, kind === 'MEET_GROUP'); break;
      case 'JOIN_CROWD': case 'WATCH_EVENT': case 'CHEER': case 'DANCE': case 'FOLLOW_EVENT': {
        const hs = g?.x !== undefined ? null : this.bestHotspot(a, 260);
        const cx = g?.x ?? hs?.h.x ?? x, cz = g?.z ?? hs?.h.z ?? z;
        const inner = hs?.h.inner ?? 3, radius = hs?.h.radius ?? 14;
        const watch = kind === 'WATCH_EVENT';
        const p = this.spotAround(cx, cz, inner + (watch ? 3 : 0.5), radius * (watch ? 1.1 : 0.85), hs?.h.kind === 'stage' ? hs.h.heading : undefined);
        a.plan = { ...this.walkPlan(p.x, p.z, 1), fx: cx, fz: cz, hotspot: hs?.h.id, mode: kind === 'FOLLOW_EVENT' && hs?.h.moving ? 'follow' : 'walk', arriveR: 0.6 };
        break;
      }
      case 'FOLLOW_SUPPORTERS': {
        const c = this.supCentroid(a, 120);
        const p = c ? this.spotAround(c.x, c.z, 1.2, 5 + Math.min(8, c.n * 0.6)) : this.pointNear(x, z, 8, 25);
        a.plan = { ...this.walkPlan(p.x, p.z, 1.02), fx: c?.x, fz: c?.z, arriveR: 0.7 };
        break;
      }
      case 'WATCH_FIGHT': {
        const f = this.nearestFight(x, z, FIGHT_VIEW_M + 6, now) ?? (a.mem.fightSeen ? { x: a.mem.fightSeen.x, z: a.mem.fightSeen.z } : null);
        if (!f) { this.startGoal(a, 'WANDER', now, source); return; }
        const p = this.spotAround(f.x, f.z, 4.5, 8.5);
        a.plan = { ...this.walkPlan(p.x, p.z, 1.05), fx: f.x, fz: f.z, arriveR: 0.7 };
        a.goal.until = Math.min(a.goal.until, now + 30_000);
        break;
      }
      case 'AVOID_FIGHT': {
        const f = (g?.x !== undefined && g.z !== undefined ? { x: g.x, z: g.z } : null) ?? this.nearestFight(x, z, FIGHT_VIEW_M + 6, now) ?? a.mem.fightSeen ?? (a.mem.threat ? this.posOf(a.mem.threat.id) : null);
        const fx = f?.x ?? x, fz = f?.z ?? z;
        const d = Math.max(0.5, Math.hypot(x - fx, z - fz)), ux = (x - fx) / d, uz = (z - fz) / d;
        const far = r.range(16, 30), ang = r.range(-0.6, 0.6);
        const tx = fx + (ux * Math.cos(ang) - uz * Math.sin(ang)) * (d + far), tz = fz + (uz * Math.cos(ang) + ux * Math.sin(ang)) * (d + far);
        const p = this.host.clear(x, z, tx, tz) ? { x: tx, z: tz } : this.pointNear(x, z, 14, 26);
        a.plan = { ...this.walkPlan(p.x, p.z, 1.15), run: d < 10 || r.chance(a.prof.run) };
        break;
      }
      case 'JOIN_FIGHT': {
        const target = g?.target ?? this.fightTarget(a, now);
        if (!target || !this.posOf(target)) { this.startGoal(a, 'WATCH_FIGHT', now, source); return; }
        this.beginFight(a, target, now, source === 'director' ? 1 : 2);
        break;
      }
    }
  }

  private standPlan(x: number, z: number): Plan { return { mode: 'stand', tx: x, tz: z, arriveR: 0.4, hurry: 1, run: false, pauseUntil: 0, arrivedAt: 0 }; }
  private walkPlan(x: number, z: number, hurry: number): Plan { return { mode: 'walk', tx: x, tz: z, arriveR: 0.8, hurry, run: false, pauseUntil: 0, arrivedAt: 0 }; }

  /** ponto livre de parede a [rMin, rMax] m, dentro do mapa e perto do eixo da avenida */
  private pointNear(x: number, z: number, rMin: number, rMax: number): { x: number; z: number } {
    for (let i = 0; i < 8; i++) {
      const a = this.rng.range(-Math.PI, Math.PI), d = this.rng.range(rMin, rMax);
      const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d;
      if (!this.inBounds(px, pz)) continue;
      if (this.axis.ok && Math.abs(this.axis.project(px, pz).lat) > 30 && !this.nearPerson(px, pz, 90)) continue;
      if (this.host.clear(x, z, px, pz)) return { x: px, z: pz };
    }
    // sem saída: volta para perto do eixo
    if (this.axis.ok) { const q = this.axis.project(x, z), p = this.axis.at(q.s + this.rng.range(-15, 15), this.rng.range(-8, 8)); return { x: p.x, z: p.z }; }
    return { x, z };
  }

  /** lugar em volta de um centro, desocupado (≥ 0,7 m de outro corpo), sem parede no caminho do centro */
  private spotAround(cx: number, cz: number, inner: number, outer: number, frontHeading?: number): { x: number; z: number } {
    let best = { x: cx + inner, z: cz }, bestFree = -1;
    for (let i = 0; i < 7; i++) {
      const a = frontHeading !== undefined ? frontHeading + this.rng.range(-1.1, 1.1) : this.rng.range(-Math.PI, Math.PI);
      const d = Math.sqrt(this.rng.range(inner * inner, Math.max(inner * inner + 1, outer * outer)));
      const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
      if (!this.inBounds(x, z) || !this.host.clear(cx, cz, x, z)) continue;
      this.bodies.near(x, z, 1.2, this.tmp);
      let free = 1.2;
      for (const b of this.tmp) free = Math.min(free, Math.hypot(b.x - x, b.z - z));
      if (free >= 0.75) return { x, z };
      if (free > bestFree) { bestFree = free; best = { x, z }; }
    }
    return best;
  }

  private supCentroid(a: Agent, r: number): { x: number; z: number; n: number } | null {
    this.allGrid.near(a.k.x, a.k.z, r, this.tmp);
    let sx = 0, sz = 0, n = 0;
    for (const b of this.tmp) { const o = (b as BodyRef & { a: Agent }).a; if (o && o !== a && o.materialized && o.sup === a.sup) { sx += o.k.x; sz += o.k.z; n++; } }
    return n >= 2 ? { x: sx / n, z: sz / n, n } : null;
  }

  private freeVehicle(a: Agent, r: number): VehicleView | null {
    const vs = this.host.vehiclesNear(a.k.x, a.k.z, r, this.vehScratch);
    let best: VehicleView | null = null, bestS = -Infinity;
    for (const v of vs) {
      if (v.occupant || v.state !== 0 || v.owner || !PERSONAL_KINDS.includes(v.kind as VehicleUseKind)) continue;
      // ninguém já indo até ele
      if (this.agents.some((o) => o !== a && o.plan.vehicle === v.id && o.plan.mode === 'board')) continue;
      const pref = a.vehicleAffinity && v.kind === a.vehicleAffinity ? 2 : (this.cfg.vehicles.kinds[v.kind as VehicleUseKind] ?? 0.1);
      const s = pref - Math.hypot(v.x - a.k.x, v.z - a.k.z) / 20;
      if (s > bestS) { bestS = s; best = v; }
    }
    return best;
  }

  private posOf(id: string): { x: number; z: number } | null {
    const o = this.byId.get(id);
    if (o) return o.materialized ? { x: o.k.x, z: o.k.z } : null;
    const h = this.humanById.get(id);
    return h ? { x: h.x, z: h.z } : null;
  }

  // ------------------------------------------------------------------------------------------------ rodas de conversa
  private joinOrFormGroup(a: Agent, now: number, walking: boolean) {
    this.allGrid.near(a.k.x, a.k.z, 14, this.tmp);
    let pick: Agent | null = null, bestS = -Infinity;
    for (const b of this.tmp) {
      const o = (b as BodyRef & { a: Agent }).a;
      if (!o || o === a || !o.materialized || o.fight || o.vehicleId || o.downSince) continue;
      if (o.group && (o.group.members.length >= 5 || o.group.walking !== walking)) continue;
      if (!o.group && o.goal.kind !== 'WANDER' && o.goal.kind !== 'IDLE' && o.goal.kind !== 'SOCIALIZE' && o.goal.kind !== 'MEET_GROUP') continue;
      const d = Math.hypot(o.k.x - a.k.x, o.k.z - a.k.z);
      // vínculo: mesma torcida aproxima (igualdade), grupo já formado atrai
      const s = -d / 6 + (o.sup && o.sup === a.sup ? 1 : 0) + (o.group ? 0.6 : 0) + this.rng.next() * 0.8;
      if (s > bestS) { bestS = s; pick = o; }
    }
    if (!pick) { this.startGoal(a, 'WANDER', now, 'self'); return; }
    let g = pick.group;
    if (!g) {
      const cx = (a.k.x + pick.k.x) / 2, cz = (a.k.z + pick.k.z) / 2;
      g = { id: `g${++this.groupSeq}`, members: [], cx, cz, base: this.rng.range(-Math.PI, Math.PI), speaker: 0, speakerUntil: now + this.rng.range(2500, 7000), createdAt: now, walking };
      this.groups.add(g);
      this.stats.groupsFormed++;
      this.addToGroup(pick, g, now);
      if (pick.goal.kind !== 'SOCIALIZE' && pick.goal.kind !== 'MEET_GROUP') pick.goal = { kind: walking ? 'MEET_GROUP' : 'SOCIALIZE', until: now + this.rng.range(...GOAL_MS.SOCIALIZE), source: 'self' };
    }
    this.addToGroup(a, g, now);
  }

  private addToGroup(a: Agent, g: Group, now: number) {
    if (a.group === g) return;
    if (a.group) this.leaveGroup(a, false);
    g.members.push(a); a.group = g;
    a.mem.groupId = g.id;
    this.layoutGroup(g);
    if (g.walking && g.members[0] === a) { const q = this.pointNear(a.k.x, a.k.z, 18, 50); a.plan = this.walkPlan(q.x, q.z, 0.92); }
    // cada um chega no seu tempo
    a.nextGesture = now + this.rng.range(1500, 6000);
  }

  /** ângulos na roda: espalhados com folga individual (nada de todos virados para o mesmo lado) */
  private layoutGroup(g: Group) {
    const n = g.members.length;
    const R = 0.62 + 0.2 * n;
    g.members.forEach((m, i) => {
      m.slot = g.base + (i / n) * Math.PI * 2 + Math.sin(m.phase * 3.1 + i) * 0.28;
      if (!g.walking) m.plan = { ...this.walkPlan(g.cx + Math.sin(m.slot) * R, g.cz + Math.cos(m.slot) * R, 0.9), fx: g.cx, fz: g.cz, arriveR: 0.3 };
    });
  }

  private leaveGroup(a: Agent, wave: boolean) {
    const g = a.group;
    if (!g) return;
    a.group = null; a.mem.groupId = undefined;
    g.members = g.members.filter((m) => m !== a);
    if (wave && a.materialized && this.rng.chance(0.35)) this.startAct(a, A.wave, this.host.now(), 0);
    if (g.members.length < 2) {
      for (const m of g.members) { m.group = null; m.mem.groupId = undefined; m.nextThink = Math.min(m.nextThink, this.host.now() + this.rng.range(600, 4000)); }
      this.groups.delete(g);
    } else { g.speaker = g.speaker % g.members.length; this.layoutGroup(g); }
  }

  /** rodízio de quem fala (cada roda no seu ritmo) e a roda andando junto */
  private socialTick(now: number) {
    for (const g of this.groups) {
      if (now >= g.speakerUntil) {
        // fala quem estava ouvindo; às vezes ninguém (pausa natural)
        g.speaker = this.rng.chance(0.18) ? -1 : (g.speaker + 1 + this.rng.int(0, Math.max(0, g.members.length - 2))) % g.members.length;
        g.speakerUntil = now + this.rng.range(2500, 9000);
      }
      if (g.walking) {
        const lead = g.members[0];
        if (lead) { g.cx = lead.k.x; g.cz = lead.k.z; }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ passo de movimento
  private step(a: Agent, now: number) {
    const dt = Math.min(1.2, Math.max(0.02, (now - a.lastStep) / 1000));
    a.lastStep = now;
    const s = this.host.state(a.id);
    if (!s) { a.materialized = false; a.lod = 'DORMANT'; return; }
    // a autoridade é a sala: queda, saída de veículo, correção de parede
    a.k.x = s.x; a.k.z = s.z;
    if (s.vehicle !== a.vehicleId) a.vehicleId = s.vehicle;
    a.act = s.act;
    if (s.status !== 0) {
      a.k.speed = 0; a.vx = 0; a.vz = 0;
      // cambalear (STAGGER, ~0,4 s de um soco) NÃO é cair: sem "levantou" depois (antes cada soco recebido sorteava a
      // fuga de quem briga e zerava a espera da proteção). Queda = chão/levantando/ragdoll
      if (!a.downSince && s.status !== STAGGER) { a.downSince = now; this.endPath(a); }
      this.tally(a, a.fight && s.status === STAGGER ? 'fight' : 'idle', dt);
      return;
    }
    if (a.downSince) { a.downSince = 0; this.afterGetUp(a, now); }
    if (a.fight) { this.fightStep(a, now, dt); return; }
    if (a.vehicleId) { this.driveStep(a, now, dt); return; }
    // passeio: chegou e a pausa acabou → próximo ponto
    if (a.plan.mode === 'walk' && a.plan.arrivedAt && now >= a.plan.pauseUntil && a.goal.kind === 'WANDER' && !a.group) { const q = this.pointNear(a.k.x, a.k.z, 10, 50); a.plan = this.walkPlan(q.x, q.z, 1); }
    // destinos que andam: roda caminhando, concentração que se move, centro da torcida
    if (a.group) this.groupTarget(a, now);
    if (a.plan.mode === 'follow') this.followTarget(a);
    if (a.plan.axisS !== undefined && a.plan.mode !== 'board') this.axisTarget(a);
    const p = a.plan;
    const moving = p.mode !== 'stand' && !(p.arrivedAt && (now < p.pauseUntil || p.mode === 'walk' && this.standsOnArrival(a)));
    let speed: number;
    if (moving) {
      const cruise = (p.run ? a.runV : a.walk * p.hurry) * (1 + 0.06 * Math.sin(now / 1000 * 0.7 + a.phase));
      const near = a.lod === 'FAR' ? [] : this.neighbors(a, 2.6 + cruise);
      const out = steer(a.k, p.tx, p.tz, { cruise, accel: p.run ? a.accel * 1.4 : a.accel, decel: 2.6, turnRate: p.run ? a.turn * 0.7 : a.turn, space: a.space, arriveR: p.arriveR, dt, now, selfId: a.id }, near);
      let nx = out.x, nz = out.z;
      if (out.avoiding && !a.st.avoiding) this.stats.avoidInterventions++;
      a.st.avoiding = out.avoiding;
      if (out.waiting && !a.st.waiting) this.stats.waits++;
      a.st.waiting = out.waiting;
      // corpos se tocando: sai devagar (progressivo)
      // corpos (colisão do agente A): não entra em ninguém, desliza em volta
      if (a.lod !== 'FAR' && near.length) { const c = constrainStep(a.id, a.k.x, a.k.z, nx, nz, near, dt); nx = c.x; nz = c.z; }
      // antena: parede logo à frente → novo destino (contorna em vez de esfregar)
      if (a.k.speed > 0.4 && now - a.lastFeel > 450) {
        a.lastFeel = now;
        const fx = a.k.x + Math.sin(a.k.heading) * 2.4, fz = a.k.z + Math.cos(a.k.heading) * 2.4;
        if (!this.host.clear(a.k.x, a.k.z, fx, fz)) { this.repath(a, now); }
      }
      if (out.arrived && !p.arrivedAt) this.arrive(a, now);
      speed = a.k.speed;
      this.commitMove(a, nx, nz, speed, now);
      if (p.mode === 'board' && p.vehicle && out.dist < 1.6) this.tryBoard(a, now);
    } else {
      // parado: encara o foco (centro da roda, palco, briga) — devagar
      const fx = a.group && !a.group.walking ? a.group.cx : p.fx, fz = a.group && !a.group.walking ? a.group.cz : p.fz;
      if (fx !== undefined && fz !== undefined) faceToward(a.k, fx, fz, dt, 1.6 + a.turn * 0.2);
      else a.k.speed = Math.max(0, a.k.speed - 3 * dt);
      // espaço pessoal parado: alguém encostou → um passinho para o lado
      let nx = a.k.x + Math.sin(a.k.heading) * a.k.speed * dt, nz = a.k.z + Math.cos(a.k.heading) * a.k.speed * dt;
      if (a.lod === 'NEAR') { const near = this.neighbors(a, 1.2); if (near.length) { const c = constrainStep(a.id, a.k.x, a.k.z, nx, nz, near, dt); nx = c.x; nz = c.z; } }
      speed = a.k.speed;
      this.commitMove(a, nx, nz, speed, now);
    }
    if (a.lod !== 'FAR') { this.gestures(a, now); this.lookAround(a, now); }
    this.tally(a, this.activityOf(a), dt);
  }

  /** objetivos em que se fica de pé ao chegar (concentração, roda, briga vista, torcida) */
  private standsOnArrival(a: Agent) {
    const k = a.goal.kind;
    return k === 'JOIN_CROWD' || k === 'WATCH_EVENT' || k === 'CHEER' || k === 'DANCE' || k === 'SOCIALIZE' || k === 'FOLLOW_SUPPORTERS' || k === 'WATCH_FIGHT' || k === 'IDLE' || (k === 'MEET_GROUP' && !!a.group && !a.group.walking);
  }

  private arrive(a: Agent, now: number) {
    const p = a.plan;
    p.arrivedAt = now;
    this.endPath(a);
    if (a.goal.kind === 'WANDER') p.pauseUntil = now + this.rng.range(1500, 14_000) * (a.personality === 'OBSERVADOR' ? 1.6 : 1);
    else if (a.goal.kind === 'TRAVEL' || a.goal.kind === 'LEAVE_AREA') { /* eixo: o alvo avança */ }
    else if (a.goal.kind === 'AVOID_FIGHT') { a.goal.until = Math.min(a.goal.until, now + this.rng.range(2000, 6000)); p.pauseUntil = now + 4000; }
    else p.pauseUntil = Infinity;
  }

  private giveUp(a: Agent, now: number) {
    this.stats.giveUps++;
    const p = a.plan;
    if (p.mode === 'board') { p.vehicle = undefined; p.mode = 'walk'; a.goal.until = Math.min(a.goal.until, now + 500); }
    // fica onde está (de pé, encarando o foco) e decide de novo daqui a pouco
    a.plan = { ...this.standPlan(a.k.x, a.k.z), fx: p.fx, fz: p.fz };
    a.nextThink = Math.min(a.nextThink, now + this.rng.range(1500, 5000));
    if (p.axisS !== undefined || a.goal.kind === 'WANDER') a.goal.until = Math.min(a.goal.until, now + 1000);
  }

  private repath(a: Agent, now: number) {
    this.stats.wallRepaths++;
    const p = a.plan;
    if (p.mode === 'stand') return;
    // desvia girando para um lado livre (mantém o lado por um tempo) ou escolhe outro ponto
    // viagem pelo eixo: troca de faixa (para o lado do centro da avenida) e contorna por um instante
    if (p.axisS !== undefined && p.lane !== undefined) p.lane = Math.max(-22, Math.min(22, p.lane + (p.lane > 0 ? -1 : 1) * this.rng.range(4, 10)));
    for (const ang of [0.7, -0.7, 1.3, -1.3, 2.0, -2.0, 2.8]) {
      const h = a.k.heading + ang * (a.k.side || 1), tx = a.k.x + Math.sin(h) * 6, tz = a.k.z + Math.cos(h) * 6;
      if (this.host.clear(a.k.x, a.k.z, tx, tz)) {
        if (p.axisS === undefined && a.goal.kind === 'WANDER') { const q = this.pointNear(a.k.x, a.k.z, 10, 40); p.tx = q.x; p.tz = q.z; }
        else { p.tx = tx; p.tz = tz; p.arrivedAt = 0; p.detourUntil = now + this.rng.range(1200, 2200); }
        return;
      }
    }
    const q = this.pointNear(a.k.x, a.k.z, 4, 20); p.tx = q.x; p.tz = q.z; p.arrivedAt = 0; p.detourUntil = now + 2500;
  }

  private commitMove(a: Agent, nx: number, nz: number, speed: number, now: number) {
    const loco = a.vehicleId ? 4 : speed < 0.25 ? 0 : speed < 2.8 ? 1 : 2;
    const px = a.k.x, pz = a.k.z;
    // parado e virado igual: nada a validar nem a sincronizar (economiza o caminho do movimento)
    const L = a.sent;
    let r: { x: number; z: number; ok: boolean };
    if (speed === 0 && L.speed === 0 && Math.abs(nx - px) < 0.01 && Math.abs(nz - pz) < 0.01 && Math.abs(a.k.heading - L.h) < 0.02) r = { x: px, z: pz, ok: true };
    else { r = this.host.move(a.id, nx, nz, a.k.heading, speed, loco); L.speed = speed; L.h = a.k.heading; }
    const d = Math.hypot(r.x - px, r.z - pz);
    a.k.x = r.x; a.k.z = r.z;
    a.vx = Math.sin(a.k.heading) * speed; a.vz = Math.cos(a.k.heading) * speed;
    if (!r.ok) { const k = `${a.goal.kind}:${a.plan.mode}:${a.lod}:${speed > 0.3 ? 'mov' : 'parado'}`; this.stats.correctionsBy[k] = (this.stats.correctionsBy[k] ?? 0) + 1; }
    if (!r.ok && a.plan.mode !== 'stand') {
      // empacado (várias correções seguidas): desiste deste alvo em vez de esfregar na parede
      if (++a.stuck >= 4) { a.stuck = 0; this.giveUp(a, now); } else this.repath(a, now);
      a.k.speed *= 0.5;
    } else if (r.ok && d > 0.05) a.stuck = 0;
    // humanização: inícios de caminhada, trajetos, mudanças de direção
    const movingNow = speed > 0.3;
    if (movingNow && !a.st.moving) { this.stats.walkStart(); a.st.pathStart = { x: px, z: pz }; a.st.pathLen = 0; }
    if (!movingNow && a.st.moving) this.endPath(a);
    a.st.moving = movingNow;
    if (movingNow) a.st.pathLen += d;
    if (now - a.st.hAt >= 1000) {
      if (movingNow && a.st.hAt && Math.abs(Math.atan2(Math.sin(a.k.heading - a.st.hSample), Math.cos(a.k.heading - a.st.hSample))) > 0.52) this.stats.dirChanges++;
      a.st.hSample = a.k.heading; a.st.hAt = now;
    }
  }

  private endPath(a: Agent) {
    if (a.st.moving && a.st.pathLen > 0.5) this.stats.paths.push(a.st.pathLen);
    a.st.moving = false; a.st.pathLen = 0; a.st.pathStart = null;
  }

  private groupTarget(a: Agent, now: number) {
    const g = a.group!;
    if (g.walking) {
      const lead = g.members[0];
      if (lead === a) {
        if (a.plan.arrivedAt && now >= a.plan.pauseUntil) { const q = this.pointNear(a.k.x, a.k.z, 18, 50); a.plan = this.walkPlan(q.x, q.z, 0.92); }
        return;
      }
      // ao lado/atrás do líder (cada um no seu lugar), ritmo do grupo
      const i = g.members.indexOf(a), side = i % 2 ? 1 : -1, back = Math.floor((i - 1) / 2) * 0.9 + 0.2;
      const h = lead.k.heading, lx = -Math.cos(h), lz = Math.sin(h);
      a.plan.mode = 'walk'; a.plan.arrivedAt = 0; a.plan.pauseUntil = 0;
      a.plan.tx = lead.k.x + lx * side * (0.85 + 0.15 * (i % 3)) - Math.sin(h) * back;
      a.plan.tz = lead.k.z + lz * side * (0.85 + 0.15 * (i % 3)) - Math.cos(h) * back;
      a.plan.hurry = Math.hypot(a.plan.tx - a.k.x, a.plan.tz - a.k.z) > 3 ? 1.25 : lead.k.speed > 0.3 ? Math.max(0.6, lead.k.speed / a.walk) : 0.6;
      a.plan.arriveR = 0.35;
      if (lead.k.speed < 0.2 && Math.hypot(a.plan.tx - a.k.x, a.plan.tz - a.k.z) < 0.6) { a.plan.mode = 'stand'; a.plan.fx = lead.k.x; a.plan.fz = lead.k.z; }
    }
  }

  private followTarget(a: Agent) {
    const h = this.hotspotCache.find((x) => x.id === a.plan.hotspot);
    if (!h) { a.plan.mode = 'walk'; return; }
    // acompanha a uma distância própria, num lado próprio (atrás/ao lado do veículo de evento)
    const off = 7 + (a.idx % 7) * 1.1, ang = (h.heading ?? 0) + Math.PI + Math.sin(a.phase) * 1.1;
    a.plan.tx = h.x + Math.sin(ang) * off; a.plan.tz = h.z + Math.cos(ang) * off;
    a.plan.fx = h.x; a.plan.fz = h.z; a.plan.arrivedAt = 0; a.plan.arriveR = 1.2;
  }

  /** viagem pelo eixo: o alvo é um ponto 25–40 m à frente na faixa própria (fica no aberto da avenida) */
  private axisTarget(a: Agent) {
    const p = a.plan;
    if (p.detourUntil && this.host.now() < p.detourUntil) return;
    const cur = this.axis.project(a.k.x, a.k.z);
    const dir = Math.sign(p.axisS! - cur.s) || 1;
    if (Math.abs(p.axisS! - cur.s) < 6) {
      // chegou na viagem: vira passeio/concentração na próxima decisão
      p.axisS = undefined; p.arrivedAt = 0;
      a.goal.until = Math.min(a.goal.until, this.host.now() + this.rng.range(500, 3000));
      if (a.goal.kind === 'LEAVE_AREA') a.goal.until = a.goal.until + 120_000; // continua indo embora até sumir
      return;
    }
    const s = cur.s + dir * Math.min(Math.abs(p.axisS! - cur.s), 32);
    const lane = p.lane ?? 0, lat = cur.lat + Math.max(-2, Math.min(2, lane - cur.lat));
    const q = this.axis.at(s, lat);
    if (Math.hypot(q.x - p.tx, q.z - p.tz) > 4 || p.arrivedAt) { p.tx = q.x; p.tz = q.z; p.arrivedAt = 0; p.arriveR = 1.5; }
  }

  // ------------------------------------------------------------------------------------------------ veículo
  private tryBoard(a: Agent, now: number) {
    const id = a.plan.vehicle!;
    if (this.host.enter(a.id, id)) {
      a.vehicleId = id; a.mem.vehicle = id; this.stats.vehicleRides++;
      a.plan = { ...this.walkPlan(a.k.x, a.k.z, 1), mode: 'drive', axisS: a.plan.axisS, lane: a.plan.lane, vehicle: id };
      a.goal.until = Math.max(a.goal.until, now + 60_000);
      const v = this.host.vehiclesNear(a.k.x, a.k.z, 6, this.vehScratch).find((x) => x.id === id);
      a.k.speed = 0; a.sent.speed = -1; if (v) { a.k.heading = v.heading; a.vehKind = v.kind; }
    } else { a.plan.vehicle = undefined; a.plan.mode = 'walk'; a.goal.until = Math.min(a.goal.until, now + 1000); }
  }

  private driveStep(a: Agent, now: number, dt: number) {
    const p = a.plan;
    const kind = a.vehKind || 'bicycle';
    if (p.axisS !== undefined) this.axisTarget(a);
    const sp = VEH_SPEED[kind] ?? [3, 4];
    let cruise = sp[0] + (sp[1] - sp[0]) * (0.5 + 0.5 * Math.sin(a.phase));
    // gente à frente: devagar (abaixo da velocidade de impacto) — nunca atropela
    const near = this.neighbors(a, 8);
    for (const o of near) {
      const rx = o.x - a.k.x, rz = o.z - a.k.z;
      if (rx * Math.sin(a.k.heading) + rz * Math.cos(a.k.heading) > 0) { cruise = Math.min(cruise, 1.9); break; }
    }
    const out = steer(a.k, p.tx, p.tz, { cruise, accel: 2.0, decel: 3.5, turnRate: kind === 'car' ? 0.9 : 1.4, space: 2.2, arriveR: 1.5, dt, now, selfId: a.id }, near);
    this.commitMove(a, out.x, out.z, a.k.speed, now);
    const done = p.axisS === undefined || now > a.goal.until;
    if (done && a.k.speed < 0.6) {
      this.host.exit(a.id); a.vehicleId = ''; a.mem.vehicle = undefined;
      a.goal.until = now + this.rng.range(300, 2000);
      a.plan = this.standPlan(a.k.x, a.k.z);
    }
    this.tally(a, 'vehicle', dt);
  }

  // ------------------------------------------------------------------------------------------------ gestos e olhar
  private startAct(a: Agent, id: number, now: number, durMs: number) {
    if (!id) return;
    const d = ACTION_BY_ID.get(id);
    if (!d) return;
    if (d.needs) { const p = PROP_BY_ID.get(a.prop); if (!p || !d.needs.includes(p.kind)) return; }
    if (this.host.act(a.id, id, this.rng.int(0, 7))) {
      a.act = id; a.actUntil = d.mode === 'loop' ? now + (durMs || this.rng.range(3500, 12_000)) : now + (d.duration ?? 2) * 1000;
      this.stats.actStart(id);
    }
  }
  private stopAct(a: Agent, now: number) { if (a.act && this.host.act(a.id, 0, 0)) { a.act = 0; a.actUntil = 0; } void now; }

  private gestures(a: Agent, now: number) {
    const moving = a.k.speed > 0.3;
    if (a.act) {
      const d = ACTION_BY_ID.get(a.act);
      if ((moving && d && !d.allowMove) || (d?.mode === 'loop' && now >= a.actUntil)) this.stopAct(a, now);
      // quem fala na roda gesticula enquanto é a vez dele
      if (a.act === A.talk && a.group && a.group.members[a.group.speaker] !== a) this.stopAct(a, now);
      return;
    }
    const g = a.group;
    if (g && !g.walking && !moving && a.plan.arrivedAt) {
      if (g.members[g.speaker] === a && now >= a.nextGesture - 4000) { this.startAct(a, A.talk, now, Math.max(1500, g.speakerUntil - now)); a.nextGesture = now + this.rng.range(2000, 6000); return; }
    }
    if (now < a.nextGesture) return;
    a.nextGesture = now + Math.min(60_000, Math.max(1500, -Math.log(1 - this.rng.next() * 0.98) * 60_000 / a.gestureRate));
    const k = a.goal.kind, hasFlag = a.prop === PROP.flagS || a.prop === PROP.flagL, hasSign = a.prop === PROP.signS || a.prop === PROP.signL;
    const pickW = (opts: [number, number][]) => { let t = 0; for (const o of opts) t += o[1]; let r = this.rng.next() * t; for (const [id, w] of opts) { r -= w; if (r < 0) return id; } return opts[0][0]; };
    let id = 0;
    if (g && !g.walking && !moving) id = pickW([[A.thumbs, 2], [A.point, 1.5], [A.phone, 1.5], [A.clap, 0.5], [0, 4]]);
    else if (k === 'DANCE' && !moving && a.plan.arrivedAt) id = A.dances.length ? this.rng.pick(A.dances) : A.clap;
    else if ((k === 'CHEER' || k === 'JOIN_CROWD' || k === 'FOLLOW_SUPPORTERS' || k === 'FOLLOW_EVENT') && (!moving || this.rng.chance(0.4))) {
      id = pickW([[A.clap, 3], [A.cheer, 2], [A.armsUp, 1.5], [A.armUp, 1], [A.fist, a.personality === 'MANIFESTANTE' ? 2 : 0.5], [A.rhythm, 1.5], [moving ? 0 : A.jumpCheer, 0.6],
        [hasFlag ? A.flagWave : 0, 4], [hasFlag ? A.flagRaise : 0, 1.5], [hasSign ? A.signWave : 0, 3], [hasSign ? A.signRaise : 0, 2],
        [a.prop === PROP.megaphone ? A.megaphone : 0, 3], [a.prop === PROP.drum ? A.drum : 0, 4], [a.prop === PROP.whistle ? A.whistle : 0, 3], [A.phone, 0.6]]);
    } else if (k === 'WATCH_EVENT' || k === 'WATCH_FIGHT') id = pickW([[A.phone, 3], [A.point, 1], [A.clap, k === 'WATCH_EVENT' ? 1 : 0], [0, 2]]);
    else if (k === 'IDLE' && !moving) id = pickW([[A.phone, 3], [A.sit, a.prof.speed < 1 ? 0.5 : 0.15], [0, 3]]);
    else if (moving) id = pickW([[A.phone, 0.6], [hasFlag ? A.flagRaise : 0, 0.6], [hasSign ? A.signRaise : 0, 0.6], [0, 6]]);
    if (id) this.startAct(a, id, now, 0);
  }

  private lookAround(a: Agent, now: number) {
    if (now < a.nextLook) return;
    a.nextLook = now + this.rng.range(900, 3500);
    let nid = 0;
    const g = a.group;
    if (g && !g.walking) { const sp = g.members[g.speaker]; if (sp && sp !== a && this.rng.chance(0.8)) nid = sp.nid; else if (this.rng.chance(0.5)) nid = this.rng.pick(g.members).nid; }
    if (a.fight) { const t = this.byId.get(a.fight.target); nid = t?.nid ?? this.humanById.get(a.fight.target)?.nid ?? 0; }
    // humano perto e de frente chama atenção (curiosidade); às vezes acena uma vez
    if (!nid && this.rng.chance(a.prof.curiosity)) {
      let best: HumanView | null = null, bd = 7;
      for (const h of this.people) { const d = Math.hypot(h.x - a.k.x, h.z - a.k.z); if (d < bd) { bd = d; best = h; } }
      if (best) {
        nid = best.nid;
        if (bd < 4 && !a.act && a.k.speed < 0.5 && this.rng.chance(0.08 * a.prof.curiosity)) this.startAct(a, A.wave, now, 0);
      }
    }
    if (nid !== a.lookNid) { a.lookNid = nid; this.host.look(a.id, nid); }
  }

  // ------------------------------------------------------------------------------------------------ confronto
  private fightTarget(a: Agent, now: number): string | null {
    // fui atacado: quem me atacou (humano ou não) — reação, não perseguição
    if (a.mem.threat && now - a.mem.threat.at < 12_000 && this.posOf(a.mem.threat.id)) return a.mem.threat.id;
    const f = this.nearestFight(a.k.x, a.k.z, 16, now);
    if (!f) return null;
    // amigo apanhando: quem bate nele; senão (briga entre autônomos) alguém que não é do meu lado
    for (const [nid] of f.nids) {
      const o = this.byNid.get(nid);
      if (o && o !== a && o.fight && this.isFriend(a, this.byId.get(o.fight.target) ?? null)) return o.id;
      const h = this.humanByNid.get(nid);
      if (h && a.mem.lastOpponent?.id === h.id) return h.id;
    }
    for (const [nid] of f.nids) { const o = this.byNid.get(nid); if (o && o !== a && !this.isFriend(a, o) && o.fight) return o.id; }
    return null;
  }

  /** revida (personalidade + pavio), foge, ou reclama (aponta e se afasta um passo) — true = decidiu */
  private reactToThreat(a: Agent, by: string, now: number): boolean {
    const P = a.prof, pos = this.posOf(by);
    if (!pos) return false;
    const r = this.rng.next();
    const back = Math.min(0.85, P.fight.join + P.temper * 0.6 + P.fight.defend * 0.25);
    const flee = P.fight.flee * (1 - back);
    if (r < back) { this.beginFight(a, by, now, 2); return true; }
    if (r < back + flee) { a.mem.fightSeen = { x: pos.x, z: pos.z, at: now }; this.startGoal(a, 'AVOID_FIGHT', now, 'self', { kind: 'AVOID_FIGHT', x: pos.x, z: pos.z, until: now + this.rng.range(8000, 16_000) }); return true; }
    // reclama: encara, aponta, dá um passo para trás e segue a vida
    a.plan = { ...this.standPlan(a.k.x, a.k.z), fx: pos.x, fz: pos.z };
    this.startAct(a, this.rng.chance(0.6) ? A.point : A.talk, now, 2500);
    a.goal = { kind: 'IDLE', until: now + this.rng.range(3000, 7000), source: 'self' };
    return true;
  }

  private isFriend(a: Agent, o: Agent | null) { return !!o && o !== a && ((!!a.group && a.group === o.group) || (a.sup > 0 && a.sup === o.sup && Math.hypot(a.k.x - o.k.x, a.k.z - o.k.z) < 12)); }

  private friendInFight(a: Agent, f: Fight) {
    for (const [nid] of f.nids) { const o = this.byNid.get(nid); if (o && this.isFriend(a, o)) return true; }
    return false;
  }

  /** estágio 0 = discussão (gestos), 1 = empurrão, 2 = golpes — escalada rara e com limite de tempo */
  private beginFight(a: Agent, target: string, now: number, stage: 0 | 1 | 2, dir = false, until?: number, eventId?: string) {
    if (a.group) this.leaveGroup(a, false);
    if (a.vehicleId) { this.host.exit(a.id); a.vehicleId = ''; }
    // golpe é de mão livre (como para o jogador): guarda a bandeira/cartaz e pega de volta depois
    if (stage > 0 || dir) this.stowProp(a);
    a.fight = { target, stage, until: until ?? now + this.rng.range(8000, 20_000), nextAttack: now + this.rng.range(400, 1400) * a.reactMul, combo: 0, escalateAt: now + this.rng.range(3500, 9000), pushes: 0, dir, tiredSince: 0 };
    // discussão do diretor (ARGUE) continua sendo SOCIALIZE (é o que ele confere); briga é JOIN_FIGHT
    a.goal = { kind: dir && stage === 0 ? 'SOCIALIZE' : 'JOIN_FIGHT', until: a.fight.until, source: dir ? 'director' : a.goal.source, target, ...(eventId ? { eventId } : {}) };
    a.mem.lastOpponent = { id: target, at: now };
    a.plan = { ...this.walkPlan(a.k.x, a.k.z, 1.1), mode: 'fight' };
  }

  private stowProp(a: Agent) {
    const s = this.host.state(a.id);
    if (s?.prop && this.host.prop(a.id, 0, 0)) a.stowed = { prop: a.prop, design: a.design };
  }
  private unstowProp(a: Agent) {
    if (!a.stowed) return;
    const st = a.stowed; a.stowed = null;
    if (this.host.state(a.id)?.prop === 0) this.host.prop(a.id, st.prop, st.design);
  }

  private fightStep(a: Agent, now: number, dt: number) {
    const F = a.fight!;
    const t = this.byId.get(F.target), h = this.humanById.get(F.target);
    // alvo CAÍDO (ou na proteção de retorno logo depois de levantar) não encerra a briga: quem bateu espera por perto,
    // encarando e gesticulando, e volta quando dá — antes o 1º empurrão (que derruba) acabava com toda briga
    const tp = t ? (t.materialized ? { x: t.k.x, z: t.k.z } : null) : h && !h.vehicle ? { x: h.x, z: h.z } : null;
    const tDown = t ? t.downSince > 0 || now - t.gotUpAt < this.moves.protectMs : !!h && h.status !== 0;
    const d = tp ? Math.hypot(tp.x - a.k.x, tp.z - a.k.z) : Infinity;
    // fim: tempo, alvo caiu/sumiu, humano se afastou (não persegue), cansado/machucado
    const limit = h ? 7 : 14;
    // cansaço: sem fôlego por um tempo → larga a briga (o diretor percebe e desescala)
    if (F.stage > 0 && a.stamina < 12) { if (!F.tiredSince) F.tiredSince = now; } else F.tiredSince = 0;
    const tired = F.tiredSince > 0 && now - F.tiredSince > 1500;
    // briga do diretor: o papel manda (ARGUE = discussão; FIGHT = empurrão até pushUntil, depois golpes); sem papel = acabou
    if (F.dir) {
      const role = this.roleOf(a.id);
      if (!role || (role.role !== 'ARGUE' && role.role !== 'FIGHT')) F.until = Math.min(F.until, now);
      else {
        if (role.opponent && role.opponent !== F.target && this.posOf(role.opponent)) F.target = role.opponent;
        const st: 0 | 1 | 2 = role.role === 'ARGUE' ? 0 : (role.pushUntil ?? 0) > now ? 1 : 2;
        if (st !== F.stage) { F.stage = st; if (st > 0 && a.goal.kind !== 'JOIN_FIGHT') a.goal = { ...a.goal, kind: 'JOIN_FIGHT' }; }
      }
    }
    if (now >= F.until || !tp || d > limit || a.condition < 30 || tired) {
      const lost = a.condition < 30 || tired;
      a.fight = null;
      this.unstowProp(a);
      a.mem.fightSeen = { x: a.k.x, z: a.k.z, at: now };
      this.startGoal(a, lost || this.rng.chance(a.prof.fight.flee) ? 'AVOID_FIGHT' : this.rng.chance(0.5) ? 'WATCH_FIGHT' : 'WANDER', now, 'self');
      this.tally(a, F.stage === 0 ? 'social' : 'fight', dt);
      return;
    }
    // escalada própria (fora do diretor; rara): discussão → empurrão → golpes
    if (!F.dir && now >= F.escalateAt && F.stage < 2) {
      F.escalateAt = now + this.rng.range(4000, 9000);
      if (this.rng.chance(0.25 + a.prof.temper * 0.5)) F.stage = (F.stage + 1) as 1 | 2;
      else if (F.stage === 0) F.until = Math.min(F.until, now + this.rng.range(1500, 4000)); // esfriou
    }
    const reach = (this.moves.punch?.range ?? 1.2) - 0.15;
    const hold = F.stage > 0 && tDown;
    const want = F.stage === 0 || hold ? 1.4 : reach;
    // já ao alcance do soco (alcance dos dados + folga do servidor): bate daqui — antes exigia ≤ 1,2 m e, com o recuo do
    // golpe (0,35 m) e a colisão entre corpos da sala, quem revidava ficava "se aproximando" a 1,25 m para sempre
    const inReach = F.stage > 0 && !hold && d <= (this.moves.punch?.range ?? 1.2) + 0.12;
    if (d > want + 0.15 && !inReach) {
      // aproxima (correndo se longe), sem atravessar ninguém
      a.plan.tx = tp.x; a.plan.tz = tp.z;
      const near = this.neighbors(a, 3);
      const out = steer(a.k, tp.x, tp.z, { cruise: d > 3 ? a.runV * 0.8 : a.walk, accel: a.accel * 1.5, decel: 3, turnRate: a.turn * 1.2, space: 0.7, arriveR: want, dt, now, selfId: a.id }, near.filter((n) => n.id !== F.target));
      this.commitMove(a, out.x, out.z, a.k.speed, now);
    } else {
      faceToward(a.k, tp.x, tp.z, dt, 5);
      this.commitMove(a, a.k.x, a.k.z, 0, now);
      if (hold) {
        // adversário no chão / levantando: encara, aponta, chama — sem golpe (ninguém bate em quem está caído)
        if (!a.act && now >= a.nextGesture) { this.startAct(a, this.rng.pick([A.point, A.armsUp, A.talk]), now, this.rng.range(1200, 2600)); a.nextGesture = now + this.rng.range(1500, 3500); }
        F.nextAttack = Math.max(F.nextAttack, now + this.rng.range(250, 900) * a.reactMul);
      } else if (F.stage === 0) {
        // discussão: aponta/gesticula, sem golpe
        if (!a.act && now >= a.nextGesture) { this.startAct(a, this.rng.chance(0.5) ? A.point : A.talk, now, this.rng.range(1500, 3500)); a.nextGesture = now + this.rng.range(1800, 4200); }
      } else if (now >= F.nextAttack) {
        if (a.act) this.stopAct(a, now);
        if (!a.stowed && this.host.state(a.id)?.prop) this.stowProp(a);
        const m = this.pickMove(a, F);
        if (m && a.stamina >= m.cost + 4) {
          const h0 = headingTo(tp.x - a.k.x, tp.z - a.k.z);
          const ok = this.host.combat(a.id, m.id, h0);
          if (ok) { this.stats.attacks++; a.stamina -= m.cost; if (m === this.moves.push) F.pushes++; }
          else this.stats.attacksDenied++;
          // ritmo humano: pausa entre golpes (nunca spam); às vezes emenda a sequência
          F.combo = ok && m === this.moves.punch && this.rng.chance(0.35) ? now + this.rng.range(260, 380) : 0;
          F.nextAttack = F.combo || now + Math.max(m.cooldownMs, this.rng.range(650, 1700) * a.reactMul);
        } else F.nextAttack = now + this.rng.range(700, 1500); // sem fôlego: espera
      }
    }
    if (a.lod !== 'FAR') this.lookAround(a, now);
    this.tally(a, F.stage === 0 ? 'social' : 'fight', dt);
  }

  private pickMove(a: Agent, F: NonNullable<Agent['fight']>): CombatMove | null {
    const M = this.moves;
    // sequência: pede o soco de novo dentro da janela — o servidor resolve o combo (combat.json comboFrom)
    if (F.combo && M.combo) return M.punch;
    if (F.stage === 1) return M.push;
    // troca de golpes: mais soco (empurrão e chute derrubam — cada queda são ~4 s no chão + 5 s de proteção)
    const r = this.rng.next();
    if (r < 0.74) return M.punch;
    if (r < 0.86) return M.push;
    if (r < 0.95 && a.stamina > 40) return M.kick ?? M.punch;
    return M.punch;
  }

  private afterGetUp(a: Agent, now: number) {
    // levantou: foge, observa ou volta (personalidade); nunca todos ao mesmo tempo
    a.gotUpAt = now;
    a.nextThink = now + this.rng.range(300, 1500) * a.reactMul;
    // derrubado por alguém: a reação (revidar/fugir/reclamar) conta a partir de AGORA — no chão ninguém reage, e a
    // janela de 5 s da ameaça já teria passado (rodada 12, agente G: revide de quem foi derrubado por humano)
    if (!a.fight && a.mem.threat && now - a.mem.threat.at < 15_000) { a.mem.threat.at = now; a.threatHandled = false; a.nextThink = now + this.rng.range(200, 900) * a.reactMul; }
    // no meio da briga: o cauteloso larga; o confrontador quase sempre volta (pesos da personalidade)
    if (a.fight && this.rng.chance(a.prof.fight.flee * 0.75 + 0.05)) { a.fight = null; this.unstowProp(a); this.startGoal(a, 'AVOID_FIGHT', now, 'self'); }
  }

  private nearestFight(x: number, z: number, r: number, now: number): Fight | null {
    let best: Fight | null = null, bd = r;
    for (const f of this.fights) { if (now - f.lastAt > 15_000) continue; const d = Math.hypot(f.x - x, f.z - z); if (d <= bd) { bd = d; best = f; } }
    return best;
  }

  private expireFights(now: number) {
    this.fights = this.fights.filter((f) => now - f.lastAt < 20_000);
    while (this.hitLog.length && now - this.hitLog[0].at > 60_000) this.hitLog.shift();
    for (const [nid, t] of this.lastOnCombatAct) if (now - t > 5000) this.lastOnCombatAct.delete(nid);
  }

  private entityPos(nid: number): { x: number; z: number; id: string } | null {
    const a = this.byNid.get(nid);
    if (a) return { x: a.k.x, z: a.k.z, id: a.id };
    const h = this.humanByNid.get(nid);
    return h ? { x: h.x, z: h.z, id: h.id } : null;
  }

  /**
   * a sala repassa o que o CombatSystem anunciou (cbt_act/cbt_hit, por nid): foco de briga, ameaça, reação dos vizinhos
   * com atraso INDIVIDUAL (ninguém reage no mesmo instante).
   */
  onCombat(kind: 'act' | 'hit', byNid: number, tgtNid: number, result: string, now = this.host.now()) {
    const by = this.entityPos(byNid);
    if (!by) return;
    if (kind === 'act') { this.lastOnCombatAct.set(byNid, now); this.dodgeIfTargeted(byNid, by, now); }
    const tg = tgtNid ? this.entityPos(tgtNid) : null;
    const x = tg ? (by.x + tg.x) / 2 : by.x, z = tg ? (by.z + tg.z) / 2 : by.z;
    let f = this.nearestFight(x, z, 8, now);
    if (!f) { f = { x, z, startAt: now, lastAt: now, hits: 0, nids: new Map(), spontaneous: false }; this.fights.push(f); }
    f.x = f.x * 0.8 + x * 0.2; f.z = f.z * 0.8 + z * 0.2; f.lastAt = now;
    f.nids.set(byNid, now); if (tgtNid) f.nids.set(tgtNid, now);
    if (kind === 'hit' && result === 'hit') { f.hits++; this.hitLog.push({ x, z, at: now }); }
    // alvo autônomo: lembra de quem bateu e decide logo (reação)
    const ta = tgtNid ? this.byNid.get(tgtNid) : undefined;
    if (ta && kind === 'hit' && result !== 'blocked') {
      ta.mem.threat = { id: by.id, at: now }; ta.mem.lastOpponent = { id: by.id, at: now }; ta.threatHandled = false;
      if (!ta.fight) ta.nextThink = Math.min(ta.nextThink, now + this.rng.range(150, 700) * ta.reactMul);
    }
    // vizinhos: veem a briga (memória) e reagem cada um no seu tempo
    this.allGrid.near(x, z, FIGHT_VIEW_M, this.tmp);
    let n = 0;
    for (const b of this.tmp) {
      const o = (b as BodyRef & { a: Agent }).a;
      if (!o || !o.materialized || o.fight || o.nid === byNid || o.nid === tgtNid || o.vehicleId) continue;
      o.mem.fightSeen = { x, z, at: now };
      const k = o.goal.kind;
      if (k === 'WATCH_FIGHT' || k === 'AVOID_FIGHT') continue;
      o.nextThink = Math.min(o.nextThink, now + this.rng.range(300, 1600) * o.reactMul * (o.personality === 'CAUTELOSO' ? 0.7 : 1));
      if (++n >= 30) break;
    }
  }

  /** golpe anunciado contra mim (perto, de frente): às vezes esquiva (custa stamina; mesmas regras) */
  private dodgeIfTargeted(byNid: number, by: { x: number; z: number; id: string }, now: number) {
    const M = this.moves.dodge;
    if (!M) return;
    this.bodies.near(by.x, by.z, 1.8, this.tmp);
    for (const b of this.tmp) {
      const a = this.byId.get(b.id);
      if (!a || !a.fight || a.nid === byNid || a.fight.target !== by.id || a.stamina < M.cost + 10) continue;
      if (!this.rng.chance(0.18 * (a.personality === 'CAUTELOSO' ? 1.5 : 1))) continue;
      const h = headingTo(a.k.x - by.x, a.k.z - by.z) + this.rng.range(-0.8, 0.8);
      if (this.host.combat(a.id, M.id, h)) { a.stamina -= M.cost; a.fight.nextAttack = Math.max(a.fight.nextAttack, now + 600); }
    }
  }

  /** mensagens que a sala manda para a "conexão" do autônomo (mesmas dos jogadores) */
  onSelfMessage(id: string, type: string, msg: unknown) {
    const a = this.byId.get(id);
    if (!a) return;
    if (type === 'cbt_self') { const m = msg as { st?: number; cd?: number }; if (typeof m?.st === 'number') a.stamina = m.st; if (typeof m?.cd === 'number') a.condition = m.cd; }
    else if (type === 'cbt_denied') { const r = (msg as { reason?: string })?.reason; if (a.fight && (r === 'zona_paz' || r === 'politica')) a.fight.until = Math.min(a.fight.until, this.host.now() + 800); if (a.fight && r === 'protegido') a.fight.nextAttack = this.host.now() + this.rng.range(1200, 2000); /* proteção é temporária: espera, não larga a briga */ if (a.fight && r === 'stamina') a.fight.nextAttack = this.host.now() + 1500; }
    else if (type === 'exit_ok') { a.vehicleId = ''; }
  }

  // ------------------------------------------------------------------------------------------------ métricas
  private activityOf(a: Agent): Activity {
    if (a.vehicleId) return 'vehicle';
    const k = a.goal.kind;
    if (a.fight) return a.fight.stage === 0 ? 'social' : 'fight';
    if (k === 'WATCH_FIGHT') return 'watch';
    if (k === 'LEAVE_AREA' && a.k.speed > 0.3) return 'leave';
    const moving = a.k.speed > 0.3;
    if (a.group && !a.group.walking && !moving) return 'social';
    if (a.group && a.group.walking) return moving ? 'walk' : 'social';
    if (!moving && (k === 'JOIN_CROWD' || k === 'WATCH_EVENT' || k === 'CHEER' || k === 'DANCE' || k === 'FOLLOW_SUPPORTERS' || k === 'FOLLOW_EVENT')) return 'event';
    if (moving) return a.k.speed > 2.8 ? 'run' : 'walk';
    return 'idle';
  }

  private tally(a: Agent, act: Activity, dt: number) {
    const ms = dt * 1000;
    this.stats.timeMs[act] += ms;
    a.st.activity = act;
    if (a.k.speed > 0.3) { this.stats.speedSum += a.k.speed * ms; this.stats.speedN += ms; this.stats.movingMs += ms; } else this.stats.stoppedMs += ms;
  }

  // ------------------------------------------------------------------------------------------------ AutonomousWorldView (diretor de eventos)
  near(x: number, z: number, r: number, out: { id: string; x: number; z: number; personality: Personality; sup: number; goal: GoalKind; group?: string }[]): number {
    if (this.tickN % 5 !== 2) this.rebuildAllGrid(); // o diretor pode consultar entre reconstruções
    this.allGrid.near(x, z, r, this.tmp);
    let n = 0;
    for (const b of this.tmp) {
      const a = (b as BodyRef & { a: Agent }).a;
      if (!a) continue;
      const o = (out[n] ??= { id: '', x: 0, z: 0, personality: 'SOCIAL', sup: 0, goal: 'IDLE' });
      o.id = a.id; o.x = a.k.x; o.z = a.k.z; o.personality = a.personality; o.sup = a.sup; o.goal = a.goal.kind; o.group = a.group?.id;
      n++;
    }
    out.length = n;
    return n;
  }

  humans(): Iterable<{ id: string; x: number; z: number }> { return this.humanList; }

  /**
   * o diretor PROPÕE; a pessoa aceita pela personalidade (não é script): afinidade × peso contra o compromisso atual.
   * JOIN_FIGHT contra HUMANO só com motivo (ele me atacou, ou é meu último adversário). Aceito → começa com um atraso
   * individual (cada um no seu tempo). Peso ≥ 0,8 em JOIN_FIGHT pula a discussão (escalada coordenada pelo diretor).
   */
  propose(id: string, goal: Omit<Goal, 'source'>, weight: number): boolean {
    const a = this.byId.get(id);
    if (!a || !a.materialized) return false;
    const now = this.host.now();
    const role = this.roleOf(id);
    const sameEvent = !!goal.eventId && a.goal.eventId === goal.eventId;
    // caído só aceita continuar a MESMA briga (volta quando levantar); o resto fica para depois
    if (a.downSince && !(goal.kind === 'JOIN_FIGHT' && sameEvent)) return false;
    // fim de evento (o diretor manda dispersar): sempre aceita — ninguém fica brigando sozinho
    const calmDown = !!a.fight && (goal.kind === 'WANDER' || goal.kind === 'LEAVE_AREA' || goal.kind === 'AVOID_FIGHT');
    if (a.fight && !calmDown && goal.kind !== 'JOIN_FIGHT') return false;
    const arguing = goal.kind === 'SOCIALIZE' && !!goal.target && goal.target !== a.id;
    if (goal.kind === 'JOIN_FIGHT' || arguing) {
      if (!goal.target || goal.target === a.id || !this.posOf(goal.target)) return false;
      // contra HUMANO só com motivo: ele me agrediu (ou é o lado do foco porque agrediu — onAggression no diretor)
      if (!this.byId.has(goal.target) && !(a.mem.threat?.id === goal.target || a.mem.lastOpponent?.id === goal.target || role?.opponent === goal.target)) return false;
    }
    let p: number;
    if (calmDown) p = 1;
    else {
      const P = PROFILES[a.personality];
      // discussão: quem foi escolhido pelo diretor quase sempre "compra" (o pavio decide o resto); briga: entrar pesa a
      // personalidade e o vínculo, e quem já estava discutindo no MESMO foco tende a escalar
      const aff = goal.kind === 'JOIN_FIGHT' ? 0.55 + P.fight.join + P.fight.defend * 0.5 + (sameEvent ? 0.3 + P.temper * 0.6 : 0) : arguing ? 0.9 + P.temper * 0.4 : 0.5 + proposalAffinity(a.personality, goal.kind);
      // briga do lado é URGENTE: o compromisso com a reunião/passeio pesa pouco (antes 0,6 para quem estava numa
      // concentração — a plateia natural de um encontro de torcidas nunca reagia)
      const urgent = goal.kind === 'JOIN_FIGHT' || goal.kind === 'WATCH_FIGHT' || goal.kind === 'AVOID_FIGHT' || arguing;
      const committed = now >= a.goal.until || sameEvent ? 0 : urgent ? (a.goal.source === 'director' ? 0.15 : 0.05) : a.goal.source === 'director' ? 0.6 : a.goal.kind === 'IDLE' || a.goal.kind === 'WANDER' ? 0.1 : 0.3;
      p = Math.max(0, Math.min(1, aff * Math.max(0, Math.min(1, weight)) - committed));
    }
    if (!this.rng.chance(p)) return false;
    // o diretor já decidiu a reação a quem me agrediu (revidar = discussão→briga; fugir) — não reage de novo
    if (a.mem.threat && (goal.target === a.mem.threat.id || goal.kind === 'AVOID_FIGHT')) a.threatHandled = true;
    const until = Math.max(now + 3000, goal.until);
    if (goal.kind === 'JOIN_FIGHT') this.beginFight(a, goal.target!, now, role?.role === 'FIGHT' && (role.pushUntil ?? 0) > now ? 1 : role ? 2 : weight >= 0.8 ? 2 : 1, true, until, goal.eventId);
    else if (arguing) this.beginFight(a, goal.target!, now, 0, true, until, goal.eventId);
    else { if (a.fight) { a.fight = null; this.unstowProp(a); } this.startGoal(a, goal.kind, now, 'director', { ...goal, until }); }
    a.goal.source = 'director';
    // reação individual: o próximo passo/decisão vem com atraso próprio
    a.nextThink = now + this.rng.range(300, 1500) * a.reactMul;
    if (a.fight) a.fight.nextAttack = Math.max(a.fight.nextAttack, now + this.rng.range(500, 1600));
    return true;
  }

  heat(x: number, z: number, r: number): { combatants: number; crowd: number; hitsPerMin: number } {
    const now = this.host.now();
    const seen = new Set<number>();
    for (const f of this.fights) {
      if (now - f.lastAt > 10_000 || Math.hypot(f.x - x, f.z - z) > r + 6) continue;
      for (const [nid, t] of f.nids) if (now - t < 10_000) seen.add(nid);
    }
    for (const a of this.agents) if (a.fight && a.fight.stage > 0 && a.materialized && Math.hypot(a.k.x - x, a.k.z - z) <= r) seen.add(a.nid);
    let hits = 0;
    for (const h of this.hitLog) if (now - h.at < 60_000 && Math.hypot(h.x - x, h.z - z) <= r) hits++;
    return { combatants: seen.size, crowd: this.countNear(x, z, r), hitsPerMin: hits };
  }

  /** QA/testes: estado resumido de um autônomo */
  debug(id: string) {
    const a = this.byId.get(id);
    return a ? { id: a.id, name: a.name, personality: a.personality, sup: a.sup, lod: a.lod, goal: a.goal.kind, source: a.goal.source, x: a.k.x, z: a.k.z, speed: a.k.speed, group: a.group?.id ?? null, groupSize: a.group?.members.length ?? 0, vehicle: a.vehicleId, fight: a.fight ? { ...a.fight } : null, activity: a.st.activity, act: a.act, tag: a.tag, title: a.title, nid: a.nid, materialized: a.materialized } : null;
  }
  list() { return this.agents.map((a) => this.debug(a.id)!); }
  groupsInfo() { return [...this.groups].map((g) => ({ id: g.id, n: g.members.length, walking: g.walking, cx: g.cx, cz: g.cz, headings: g.members.map((m) => m.k.heading), ids: g.members.map((m) => m.id) })); }
  /** QA/testes: põe um autônomo num ponto (não usado em produção) */
  place(id: string, x: number, z: number) { const a = this.byId.get(id); if (a) { a.k.x = x; a.k.z = z; } }
  /** QA/testes: força um objetivo (como o diretor, mas sem sorteio) */
  force(id: string, kind: GoalKind, g: Partial<Omit<Goal, 'source' | 'kind'>> = {}) {
    const a = this.byId.get(id);
    if (!a) return false;
    const now = this.host.now();
    if (kind === 'JOIN_FIGHT' && g.target) this.beginFight(a, g.target, now, 2);
    else this.startGoal(a, kind, now, 'director', { kind, until: g.until ?? now + 60_000, ...g });
    a.goal.source = 'director';
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const a of this.agents) { if (a.materialized) this.host.despawn(a.id); releaseNickname(a.nameKey); }
    this.byNid.clear();
  }
}

export { PERSONALITIES };
