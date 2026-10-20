/**
 * Rodada 12 — DIRETOR DO MUNDO DINÂMICO (docs/DYNAMIC_WORLD.md). Eventos que NASCEM do estado do mundo — não da agenda:
 * concentração, caminhada, manifestação, encontro de torcidas, festa, corrida improvisada, discussão, briga e briga
 * generalizada. Sem Colyseus e sem LLM: lê a `AutonomousWorldView` (server/src/autonomous/types.ts, implementada pelo
 * sistema de autônomos) em ritmo LENTO e distribuído e só PROPÕE objetivos (`view.propose`) — o cérebro de cada
 * autônomo aceita conforme a personalidade. Nunca cria gente: toda multidão é feita de quem já estava por perto.
 *
 *  ritmo        sondas (probesPerS, ~2/s) em pontos perto dos humanos ou do eixo; cada evento vivo reavaliado a ~1 Hz
 *               (focos de briga a ~1,25 Hz) com fase própria — nunca "tudo no mesmo tick"
 *  reuniões     núcleo pequeno (coreMin livres, sociáveis) → convites a quem está perto (≤ invitePerEval por avaliação,
 *               MEET_GROUP/FOLLOW_SUPPORTERS/JOIN_CROWD/WATCH_EVENT pela personalidade) → pico → alguns saem → fim.
 *               Reclassifica pela composição: MANIFESTACAO (muitos MANIFESTANTE) → pode virar CAMINHADA (centro anda
 *               pelo eixo); ENCONTRO_TORCIDAS (≥ 2 torcidas diferentes presentes); FESTA (uma torcida/sociáveis)
 *  escalada     CALMO → TENSAO (DISCUSSAO: 2 pessoas, gestos/aproximação) → CONFRONTO (BRIGA: empurrão → soco;
 *               amigos se aproximam; uns entram, outros olham, fogem ou ignoram) → GENERALIZADO (BRIGA_GENERALIZADA:
 *               só por ADESÕES graduais, ≤ maxJoinPerEval por avaliação). Um nível por vez, com tempo mínimo em cada;
 *               desce por cansaço (o cérebro larga JOIN_FIGHT), dispersão ou tempo máximo
 *  orçamento    por tipo/hora, intervalo global entre focos, intervalo por REGIÃO (grade de regions.sizeM), máximo
 *               simultâneo e distância mínima — tudo em public/gameplay/dynamic_world.json
 *  torcidas     tensão entre pessoas de torcidas DIFERENTES só multiplica a CHANCE (differentSupMult) — comparação por
 *               igualdade do índice `sup`; nunca combate automático; trocar os grupos dá o mesmo resultado
 *  humanos      nunca recebem proposta; só viram lado de um foco se AGREDIREM um autônomo (onAggression)
 *  saída        `dyn` (sinais para áudio/HUD), agenda "acontecendo agora" e concentrações (`evt_pts`) pelo EventRuntime
 *               existente (ganchos extraAgenda/extraRallies) — sem agenda paralela
 *
 * Contrato para o cérebro (AGENTE C): `roleOf(id)` diz o papel do autônomo no evento (ARGUE: gesticular/aproximar do
 * `opponent`; FIGHT: confronto com `opponent` — empurrão até `pushUntil`, soco depois, sempre pelo CombatSystem; WATCH:
 * olhar de perto; FLEE: afastar; CORE/JOIN: ficar na reunião; RACE: correr até o destino do objetivo).
 */
import type { AutonomousWorldView, DynamicEventKind, DynamicEventState, Escalation, Goal, GoalKind, Personality } from '../autonomous/types';
import type { AgendaEntry, DynamicSignalWire } from '../../../src/events/schedule';
import type { EventRallyPoint } from '../events/runner';
import { pointOnAxis, projectOnAxis } from '../../../src/world/zones';
import { DYNAMIC_DEFAULTS, type DynamicWorldConfig } from './dynamicConfig';

export type DynRole = 'CORE' | 'JOIN' | 'WATCH' | 'ARGUE' | 'FIGHT' | 'FLEE' | 'IGNORE' | 'RACE';
export type Reaction = 'join' | 'watch' | 'flee' | 'ignore';
type Family = 'gathering' | 'race' | 'conflict';
type Phase = 'GROW' | 'PEAK' | 'WALK' | 'DRAIN' | 'RUN' | 'LIVE' | 'DISPERSE';

export interface RoleInfo {
  eventId: string;
  role: DynRole;
  /** lado no foco de briga (0/1); -1 fora de briga */
  side: number;
  /** quem discute/briga com ele (autônomo ou humano agressor) */
  opponent?: string;
  /** briga: só empurrão até aqui (ms do servidor); depois soco */
  pushUntil?: number;
  since: number;
  sup: number;
  group?: string;
  personality: Personality;
}

/** amostra lida da WorldView (o mesmo formato de `near`) */
export interface NearAgent { id: string; x: number; z: number; personality: Personality; sup: number; goal: GoalKind; group?: string }

export interface DirectorSink {
  /** mensagem para todas as conexões (jogadores + espectadores) */
  broadcast(type: string, msg: unknown): void;
  /** zona em (x, z) para a agenda (id de zona; '' fora) */
  zoneAt?(x: number, z: number): string;
  log?(msg: string): void;
}

export interface DirectorOptions {
  clock?: () => number;
  /** aleatório (testes: semente fixa) */
  rng?: () => number;
  /** eixo da avenida (manifest.pvAxis) — caminhada/corrida andam por ele; sondas sem humanos também */
  axis?: readonly [number, number][];
}

/** linha do histórico (QA/testes): nascimento, mudança de tipo, de nível, de fase e fim */
export interface DynHistory { at: number; id: string; ev: 'start' | 'kind' | 'level' | 'end' | 'react'; kind: DynamicEventKind; level: Escalation; n: number; detail?: string }

interface Dyn extends DynamicEventState {
  family: Family;
  phase: Phase;
  phaseUntil: number;
  nextEval: number;
  levelSince: number;
  /** membros (papel); um autônomo está em no máximo um evento */
  members: Map<string, RoleInfo>;
  /** QA: tipo forçado (não reclassifica; ignora orçamento) */
  forced: DynamicEventKind | null;
  forcedUntil: number;
  /** foco sem ninguém (QA num mundo vazio): só os sinais andam */
  ghost: boolean;
  dest: { x: number; z: number } | null;
  /** humano que provocou (lado 1 do foco) */
  human: string | null;
  hitAt: number;
  domSup: number;
  heat: { combatants: number; crowd: number; hitsPerMin: number };
  /** quem já decidiu (reagiu) neste foco — não pergunta de novo */
  decided: Set<string>;
  endsAtEst: number;
  /** contagem de chegados (dentro do raio) na última avaliação */
  arrived: number;
  dispStepAt: number;
  /** último "perguntar de novo" à plateia (reaskS) */
  reaskAt: number;
  dead: boolean;
  /** reclassificação com histerese: candidato e quantas avaliações seguidas ele se manteve */
  kindCand: DynamicEventKind | null;
  kindStreak: number;
}

const LEVELS: readonly Escalation[] = ['CALMO', 'TENSAO', 'CONFRONTO', 'GENERALIZADO'];
const LEVEL_KIND: Record<Escalation, DynamicEventKind> = { CALMO: 'DISCUSSAO', TENSAO: 'DISCUSSAO', CONFRONTO: 'BRIGA', GENERALIZADO: 'BRIGA_GENERALIZADA' };
const KIND_LEVEL: Partial<Record<DynamicEventKind, Escalation>> = { DISCUSSAO: 'TENSAO', BRIGA: 'CONFRONTO', BRIGA_GENERALIZADA: 'GENERALIZADO' };
const KIND_STREAK = 4;
const FAMILY: Record<DynamicEventKind, Family> = {
  CONCENTRACAO: 'gathering', CAMINHADA: 'gathering', MANIFESTACAO: 'gathering', ENCONTRO_TORCIDAS: 'gathering', FESTA: 'gathering',
  CORRIDA_IMPROVISADA: 'race', DISCUSSAO: 'conflict', BRIGA: 'conflict', BRIGA_GENERALIZADA: 'conflict',
};
/** objetivos que significam "saiu" do evento (o cérebro largou) */
const LEFT: ReadonlySet<GoalKind> = new Set(['WANDER', 'TRAVEL', 'LEAVE_AREA', 'AVOID_FIGHT', 'USE_VEHICLE']);

/** aleatório reprodutível (mulberry32) */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** WorldView vazia (mundo sem autônomos ainda): o diretor roda, mas nada nasce sozinho */
export const EMPTY_WORLD_VIEW: AutonomousWorldView = {
  near: () => 0,
  humans: () => [],
  propose: () => false,
  heat: () => ({ combatants: 0, crowd: 0, hitsPerMin: 0 }),
};

const d2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
const round2 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;

export class DynamicWorldDirector {
  private events = new Map<string, Dyn>();
  private roles = new Map<string, RoleInfo>();
  private seq = 0;
  private probeAcc = 0;
  private lastTick = -1;
  private humanIdx = 0;
  private humansCache: { id: string; x: number; z: number }[] = [];
  private humansAt = -1e15;
  /** orçamento: inícios por tipo (janela de 1 h), intervalo por região/família e global */
  private starts = new Map<string, number[]>();
  private regionUntil = new Map<string, number>();
  private conflictAt = -1e15;
  private gatheringAt = -1e15;
  private fightAt = -1e15;
  private humanProvAt = new Map<string, number>();
  private sendAt = -1e15;
  private sendSig = '';
  private wire: DynamicSignalWire[] = [];
  private readonly clock: () => number;
  private readonly rng: () => number;
  private readonly axis: readonly [number, number][];
  private readonly sample: NearAgent[];
  private readonly axisMut: [number, number][];
  history: DynHistory[] = [];
  stats = { ticks: 0, probes: 0, evals: 0, nearCalls: 0, proposals: 0, accepted: 0, started: 0, ended: 0, sends: 0, msTotal: 0, msMax: 0, reactions: { join: 0, watch: 0, flee: 0, ignore: 0 } as Record<Reaction, number>,
    /** funil do nascimento de discussões (calibração — docs/bench/round12_calibration.json) */
    seed: { probes: 0, few: 0, noPair: 0, budget: 0, roll: 0, refused: 0, started: 0, expected: 0 } };

  constructor(readonly cfg: DynamicWorldConfig = DYNAMIC_DEFAULTS, private view: AutonomousWorldView = EMPTY_WORLD_VIEW, private sink: DirectorSink = { broadcast: () => {} }, opts: DirectorOptions = {}) {
    this.clock = opts.clock ?? Date.now;
    this.rng = opts.rng ?? Math.random;
    this.axis = opts.axis ?? [];
    this.axisMut = this.axis.map(([x, z]) => [x, z] as [number, number]);
    const n = Math.max(8, Math.floor(cfg.director.maxNearSample));
    this.sample = Array.from({ length: n }, () => ({ id: '', x: 0, z: 0, personality: 'SOCIAL' as Personality, sup: 0, goal: 'IDLE' as GoalKind }));
  }

  /** rodada 12 — ligar à WorldView do AGENTE C (a sala troca a vista vazia pela real quando o sistema de autônomos sobe) */
  setView(view: AutonomousWorldView) { this.view = view; }

  // ================================================================ ciclo
  tick(now = this.clock()) {
    const t0 = performance.now();
    const dt = this.lastTick < 0 ? 0 : Math.min(1000, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    this.stats.ticks++;
    this.probeAcc += (dt / 1000) * this.cfg.director.probesPerS;
    while (this.probeAcc >= 1) { this.probeAcc -= 1; this.probe(now); }
    for (const e of this.events.values()) if (!e.dead && now >= e.nextEval) this.evaluate(e, now);
    for (const [id, e] of this.events) if (e.dead) this.events.delete(id);
    if (this.humanProvAt.size > 512) for (const [h, at] of this.humanProvAt) if (now - at > this.cfg.conflict.provocation.cooldownPerHumanS * 1000) this.humanProvAt.delete(h);
    this.send(now);
    const ms = performance.now() - t0;
    this.stats.msTotal += ms;
    if (ms > this.stats.msMax) this.stats.msMax = ms;
  }

  private near(x: number, z: number, r: number): number {
    this.stats.nearCalls++;
    const n = this.view.near(x, z, r, this.sample);
    return Math.min(n, this.sample.length);
  }

  private propose(id: string, goal: Omit<Goal, 'source'>, weight: number): boolean {
    this.stats.proposals++;
    const ok = this.view.propose(id, goal, Math.max(0, Math.min(1, weight)));
    if (ok) this.stats.accepted++;
    return ok;
  }

  private pick<T>(a: readonly T[]): T { return a[Math.floor(this.rng() * a.length) % a.length]; }
  private range([a, b]: readonly [number, number]) { return a + (b - a) * this.rng(); }
  private regionKey(fam: Family, x: number, z: number) { const s = Math.max(1, this.cfg.regions.sizeM); return `${fam}:${Math.floor(x / s)},${Math.floor(z / s)}`; }

  private recentStarts(kind: string, now: number): number {
    const a = this.starts.get(kind);
    if (!a) return 0;
    while (a.length && now - a[0] > 3_600_000) a.shift();
    return a.length;
  }
  private spend(kind: string, now: number) { const a = this.starts.get(kind) ?? []; a.push(now); this.starts.set(kind, a); }

  private count(fam: Family) { let n = 0; for (const e of this.events.values()) if (e.family === fam && !e.dead) n++; return n; }
  private nearestOf(fam: Family, x: number, z: number): number {
    let best = Infinity;
    for (const e of this.events.values()) if (e.family === fam) best = Math.min(best, d2(e.x, e.z, x, z));
    return Math.sqrt(best);
  }

  // ================================================================ sondas (nascimento)
  private humansList(now: number) {
    if (now - this.humansAt > 1000) { this.humansAt = now; this.humansCache = [...this.view.humans()]; }
    return this.humansCache;
  }

  private probePoint(now: number): { x: number; z: number } | null {
    const hs = this.humansList(now);
    const D = this.cfg.director;
    if (hs.length && this.rng() < D.probeNearHumanShare) {
      const h = hs[this.humanIdx++ % hs.length];
      const a = this.rng() * Math.PI * 2, r = this.rng() * D.probeHumanOffsetM;
      return { x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r };
    }
    if (this.axisMut.length >= 2) { const p = pointOnAxis(this.axisMut, this.rng(), (this.rng() - 0.5) * 40); return { x: p.x, z: p.z }; }
    if (hs.length) { const h = this.pick(hs); return { x: h.x, z: h.z }; }
    return null;
  }

  /** livres na última amostra (fora de qualquer evento) */
  private freeIdx: number[] = [];
  /** pessoas na última sonda (aperto) */
  private sampleN = 0;
  private collectFree(n: number, gatheringToo = false, watchersOf?: Dyn) {
    this.freeIdx.length = 0;
    for (let i = 0; i < n; i++) {
      const r = this.roles.get(this.sample[i].id);
      // briga por perto também chama quem está numa REUNIÃO (é a plateia natural: encontro de torcidas, festa) e quem
      // já está OLHANDO esta briga (a plateia pode entrar quando ela esquenta)
      if (!r || (gatheringToo && this.events.get(r.eventId)?.family === 'gathering') || (watchersOf && r.eventId === watchersOf.id && r.role === 'WATCH')) this.freeIdx.push(i);
    }
    return this.freeIdx;
  }
  /** sai de outro evento (reunião) antes de entrar neste foco — um autônomo está em no máximo um evento */
  private leaveOther(id: string, e: Dyn) {
    const r = this.roles.get(id);
    if (!r || r.eventId === e.id) return;
    this.events.get(r.eventId)?.members.delete(id);
    this.roles.delete(id);
  }

  private probe(now: number) {
    this.stats.probes++;
    const p = this.probePoint(now);
    if (!p) return;
    const D = this.cfg.director;
    let n = this.near(p.x, p.z, D.probeRadiusM);
    // ponto vazio: a sonda "encosta" numa pessoa sorteada por perto (≤ probeSnapM) — discussão nasce onde há gente,
    // não no asfalto vazio (rodada 12, agente G: 86 % das sondas caíam onde não havia 2 pessoas livres)
    if (n < 2 && D.probeSnapM > 0) {
      const m = this.near(p.x, p.z, D.probeSnapM);
      if (m > 0) { const s = this.sample[Math.floor(this.rng() * m) % m]; const sx = s.x, sz = s.z; n = this.near(sx, sz, D.probeRadiusM); }
    }
    this.stats.seed.probes++;
    if (n < 2) { this.stats.seed.few++; return; }
    this.sampleN = n;
    // discussão também nasce DENTRO de uma reunião (esbarrão na multidão — e a plateia já está lá); corrida e reunião
    // nova só com quem está livre
    const pool = this.collectFree(n, true).slice();
    if (pool.length >= 2 && this.trySeedConflict(pool, now)) return;
    const free = this.collectFree(n);
    if (free.length < 2) { this.stats.seed.few++; return; }
    if (this.trySeedRace(free, now)) return;
    this.trySeedGathering(free, now);
  }

  /**
   * chance (por sonda) de uma DISCUSSÃO nascer entre `a` e `b` — exportada para os testes de neutralidade: depende só
   * da personalidade (temperamento), de as torcidas serem DIFERENTES (igualdade do índice; 0 = sem torcida) e do calor
   */
  tensionChance(a: Pick<NearAgent, 'personality' | 'sup'>, b: Pick<NearAgent, 'personality' | 'sup'>, heated = false, crowd = 0): number {
    const C = this.cfg.conflict;
    const temper = (C.temper[a.personality] + C.temper[b.personality]) / 2;
    const rival = a.sup > 0 && b.sup > 0 && a.sup !== b.sup ? C.differentSupMult : 1;
    // aperto: mais gente em volta = mais esbarrão (e plateia para a briga crescer); simétrico, sem grupo
    const press = 1 + C.crowdMult * Math.max(0, Math.min(C.crowdCap, crowd - 2));
    return C.seedChance * temper * rival * (heated ? C.heatMult : 1) * press;
  }

  /** orçamento de um início/escalada de foco de briga */
  conflictAllowed(kind: DynamicEventKind, x: number, z: number, now: number, fresh: boolean): boolean {
    const B = this.cfg.budget.conflict;
    const cap = (B.perHour as Record<string, number>)[kind] ?? 0;
    if (this.recentStarts(kind, now) >= cap) return false;
    if (!fresh) return true;
    if (this.count('conflict') >= B.maxConcurrent) return false;
    if (now - this.conflictAt < B.globalCooldownS * 1000) return false;
    if ((this.regionUntil.get(this.regionKey('conflict', x, z)) ?? 0) > now) return false;
    if (this.nearestOf('conflict', x, z) < B.minSpacingM) return false;
    return true;
  }

  private trySeedConflict(free: number[], now: number): boolean {
    const C = this.cfg.conflict;
    const a = this.sample[free[Math.floor(this.rng() * free.length) % free.length]];
    let b: NearAgent | null = null, best = C.pairRadiusM * C.pairRadiusM;
    for (const i of free) { const s = this.sample[i]; if (s === a) continue; const dd = d2(a.x, a.z, s.x, s.z); if (dd <= best) { best = dd; b = s; } }
    const S = this.stats.seed;
    if (!b) { S.noPair++; return false; }
    if (!this.conflictAllowed('DISCUSSAO', a.x, a.z, now, true)) { S.budget++; return false; }
    const heated = this.view.heat(a.x, a.z, C.fight.reactRadiusM).combatants > 0;
    const ch = this.tensionChance(a, b, heated, this.sampleN);
    S.expected += ch;
    if (this.rng() >= ch) { S.roll++; return false; }
    const ok = !!this.startConflict(a, b, (a.x + b.x) / 2, (a.z + b.z) / 2, now, null);
    if (ok) S.started++; else S.refused++;
    return ok;
  }

  private trySeedRace(free: number[], now: number): boolean {
    const R = this.cfg.race, B = this.cfg.budget.race;
    if (this.count('race') >= B.maxConcurrent || this.recentStarts('CORRIDA_IMPROVISADA', now) >= B.perHour) return false;
    const racers = free.filter((i) => R.racer[this.sample[i].personality] >= 0.5);
    if (racers.length < R.racersMin) return false;
    const s0 = this.sample[racers[0]];
    if ((this.regionUntil.get(this.regionKey('race', s0.x, s0.z)) ?? 0) > now) return false;
    if (this.rng() >= R.seedChance) return false;
    return !!this.startRace(racers.slice(0, R.racersMax).map((i) => ({ ...this.sample[i] })), now, null);
  }

  private trySeedGathering(free: number[], now: number): boolean {
    const G = this.cfg.gathering, B = this.cfg.budget.gathering;
    if (this.count('gathering') >= B.maxConcurrent || this.recentStarts('gathering', now) >= B.perHour) return false;
    // espaçadas no tempo: sem o intervalo global, o teto por hora inteiro saía nos primeiros 20 min e depois nada
    if (now - this.gatheringAt < B.globalCooldownS * 1000) return false;
    const anchor = this.sample[free[Math.floor(this.rng() * free.length) % free.length]];
    if (this.nearestOf('gathering', anchor.x, anchor.z) < B.minSpacingM) return false;
    if ((this.regionUntil.get(this.regionKey('gathering', anchor.x, anchor.z)) ?? 0) > now) return false;
    const r2 = G.coreRadiusM * G.coreRadiusM;
    const core = free.map((i) => this.sample[i]).filter((s) => d2(s.x, s.z, anchor.x, anchor.z) <= r2 && G.attract[s.personality] >= 0.3);
    if (core.length < G.coreMin) return false;
    if (this.rng() >= G.seedChance) return false;
    // núcleo PEQUENO: os mais próximos da âncora (o resto pode chegar depois, por convite)
    core.sort((p, q) => d2(p.x, p.z, anchor.x, anchor.z) - d2(q.x, q.z, anchor.x, anchor.z));
    return !!this.startGathering(core.slice(0, G.coreMin + 2).map((s) => ({ ...s })), anchor.x, anchor.z, now, null);
  }

  // ================================================================ criação
  private newEvent(kind: DynamicEventKind, x: number, z: number, r: number, now: number, forced: DynamicEventKind | null): Dyn {
    const id = `dyn${++this.seq}`;
    const fam = FAMILY[kind];
    const e: Dyn = {
      id, kind, x, z, r, escalation: fam === 'conflict' ? 'TENSAO' : 'CALMO', startedAt: now, participants: 0, watchers: 0,
      family: fam, phase: fam === 'conflict' ? 'LIVE' : fam === 'race' ? 'RUN' : 'GROW', phaseUntil: now, levelSince: now,
      nextEval: now + Math.floor(this.rng() * 400) + 200, members: new Map(), forced, forcedUntil: forced ? now + this.cfg.qa.forcedMinS * 1000 : 0, ghost: false,
      dest: null, human: null, hitAt: 0, domSup: 0, heat: { combatants: 0, crowd: 0, hitsPerMin: 0 }, decided: new Set(), endsAtEst: now + 5 * 60_000, arrived: 0, dispStepAt: 0, reaskAt: now, dead: false, kindCand: null, kindStreak: 0,
    };
    this.events.set(id, e);
    this.stats.started++;
    return e;
  }

  private addMember(e: Dyn, a: Pick<NearAgent, 'id' | 'sup' | 'group' | 'personality'>, role: DynRole, now: number, side = -1, opponent?: string): RoleInfo {
    const info: RoleInfo = { eventId: e.id, role, side, since: now, sup: a.sup, personality: a.personality, ...(a.group ? { group: a.group } : {}), ...(opponent ? { opponent } : {}) };
    e.members.set(a.id, info);
    this.roles.set(a.id, info);
    return info;
  }
  private dropMember(e: Dyn, id: string) { e.members.delete(id); if (this.roles.get(id)?.eventId === e.id) this.roles.delete(id); }

  private log(e: Dyn, ev: DynHistory['ev'], now: number, detail?: string) {
    this.history.push({ at: now, id: e.id, ev, kind: e.kind, level: e.escalation, n: e.participants, ...(detail ? { detail } : {}) });
    if (this.history.length > 2000) this.history.splice(0, this.history.length - 1500);
  }

  private startGathering(core: NearAgent[], x: number, z: number, now: number, forced: DynamicEventKind | null): Dyn | null {
    const G = this.cfg.gathering;
    const e = this.newEvent(forced ?? 'CONCENTRACAO', x, z, G.radiusM, now, forced);
    for (const a of core) if (this.propose(a.id, { kind: 'JOIN_CROWD', x, z, eventId: e.id, until: now + 120_000 }, 1)) this.addMember(e, a, 'CORE', now);
    if (e.members.size < 2 && !forced) { this.discard(e); return null; }
    e.phaseUntil = now + this.range(G.growS) * 1000;
    e.participants = e.members.size;
    if (!forced) { this.spend('gathering', now); this.gatheringAt = now; this.regionUntil.set(this.regionKey('gathering', x, z), now + this.cfg.budget.gathering.regionCooldownS * 1000); }
    // QA: caminhada forçada junta gente primeiro (~25 s de convites) e só então sai andando — antes saía com 1–2
    if (forced === 'CAMINHADA') e.phaseUntil = now + 25_000;
    e.ghost = e.members.size === 0;
    this.log(e, 'start', now);
    return e;
  }

  private startRace(racers: NearAgent[], now: number, forced: DynamicEventKind | null, at?: { x: number; z: number }): Dyn | null {
    const R = this.cfg.race;
    const c = at ?? { x: racers[0]?.x ?? 0, z: racers[0]?.z ?? 0 };
    const e = this.newEvent('CORRIDA_IMPROVISADA', c.x, c.z, 20, now, forced);
    e.dest = this.alongAxis(c.x, c.z, this.range(R.lengthM));
    for (const a of racers) if (this.propose(a.id, { kind: 'TRAVEL', x: e.dest.x, z: e.dest.z, eventId: e.id, until: now + R.maxS * 1000 }, R.racer[a.personality])) this.addMember(e, a, 'RACE', now);
    if (e.members.size < R.racersMin && !forced) { this.discard(e); return null; }
    e.phaseUntil = now + R.maxS * 1000;
    e.endsAtEst = e.phaseUntil;
    e.participants = e.members.size;
    if (!forced) { this.spend('CORRIDA_IMPROVISADA', now); this.regionUntil.set(this.regionKey('race', c.x, c.z), now + this.cfg.budget.race.regionCooldownS * 1000); }
    e.ghost = e.members.size === 0;
    this.log(e, 'start', now);
    return e;
  }

  /** DISCUSSÃO entre dois (b pode ser um humano que provocou: `human`) */
  private startConflict(a: NearAgent | null, b: NearAgent | null, x: number, z: number, now: number, forced: DynamicEventKind | null, human: string | null = null, origin?: string): Dyn | null {
    const e = this.newEvent('DISCUSSAO', x, z, 8, now, forced);
    e.human = human;
    const T = this.cfg.conflict.tension;
    const until = now + T.maxS * 1000 + 10_000;
    if (a && this.propose(a.id, { kind: 'SOCIALIZE', target: human ?? b?.id, x, z, eventId: e.id, until }, 1)) { this.leaveOther(a.id, e); this.addMember(e, a, 'ARGUE', now, 0, human ?? b?.id); }
    if (b && this.propose(b.id, { kind: 'SOCIALIZE', target: a?.id, x, z, eventId: e.id, until }, 1)) { this.leaveOther(b.id, e); this.addMember(e, b, 'ARGUE', now, 1, a?.id); }
    const need = human ? 1 : 2;
    if (e.members.size < need && !forced) { this.discard(e); return null; }
    e.ghost = e.members.size === 0;
    if (!forced && !human) {
      this.spend('DISCUSSAO', now);
      this.conflictAt = now;
      this.regionUntil.set(this.regionKey('conflict', x, z), now + this.cfg.budget.conflict.regionCooldownS * 1000);
    }
    e.participants = e.members.size + (human ? 1 : 0);
    this.log(e, 'start', now, human ? 'provocado' : origin);
    return e;
  }

  private discard(e: Dyn) {
    for (const id of [...e.members.keys()]) this.dropMember(e, id);
    this.events.delete(e.id);
    this.stats.started--;
  }

  private end(e: Dyn, now: number, why: string) {
    if (e.dead) return;
    for (const id of [...e.members.keys()]) this.dropMember(e, id);
    e.dead = true;
    e.participants = 0; e.watchers = 0;
    this.stats.ended++;
    this.log(e, 'end', now, why);
  }

  /** ponto a `len` m pelo eixo a partir de (x, z), no sentido sorteado (sem eixo: em linha reta) */
  private alongAxis(x: number, z: number, len: number): { x: number; z: number } {
    if (this.axisMut.length < 2) { const a = this.rng() * Math.PI * 2; return { x: x + Math.cos(a) * len, z: z + Math.sin(a) * len }; }
    let total = 0;
    for (let i = 0; i < this.axisMut.length - 1; i++) total += Math.hypot(this.axisMut[i + 1][0] - this.axisMut[i][0], this.axisMut[i + 1][1] - this.axisMut[i][1]);
    const t0 = projectOnAxis(this.axisMut, x, z).t;
    let dir = this.rng() < 0.5 ? -1 : 1;
    if (t0 + dir * len / total > 1 || t0 + dir * len / total < 0) dir = -dir;
    const p = pointOnAxis(this.axisMut, t0 + dir * len / (total || 1), (this.rng() - 0.5) * 10);
    return { x: p.x, z: p.z };
  }

  // ================================================================ avaliação
  private evaluate(e: Dyn, now: number) {
    this.stats.evals++;
    const D = this.cfg.director;
    const speed = e.forced ? Math.max(1, this.cfg.qa.forcedSpeedup) : 1;
    e.nextEval = now + (e.family === 'conflict' ? D.conflictEvalMs : D.eventEvalMs) / (e.family === 'conflict' ? speed : 1);
    if (e.family === 'gathering') this.evalGathering(e, now);
    else if (e.family === 'race') this.evalRace(e, now);
    else this.evalConflict(e, now, speed);
  }

  /** lê a vizinhança do evento: atualiza/poda membros; devolve n da amostra */
  private refresh(e: Dyn, r: number, now: number, keepGoal?: (role: DynRole, g: GoalKind) => boolean): number {
    const n = this.near(e.x, e.z, r);
    const seen = this.seen; seen.clear();
    let arrived = 0, watchers = 0;
    const ar2 = (e.r * 1.3) * (e.r * 1.3);
    for (let i = 0; i < n; i++) {
      const a = this.sample[i];
      const m = e.members.get(a.id);
      if (!m) continue;
      seen.add(a.id);
      const stay = keepGoal ? keepGoal(m.role, a.goal) : !LEFT.has(a.goal);
      if (!stay) { this.dropMember(e, a.id); continue; }
      this.pos.set(a.id, a.x, a.z);
      if (m.role === 'WATCH') { watchers++; continue; }
      if (d2(a.x, a.z, e.x, e.z) <= ar2) arrived++;
    }
    // amostra cheia (multidão densa): quem não coube não é dado como "saiu"
    if (n < this.sample.length) for (const id of [...e.members.keys()]) if (!seen.has(id)) this.dropMember(e, id);
    e.arrived = arrived;
    e.watchers = watchers;
    void now;
    return n;
  }
  private seen = new Set<string>();
  private pos = new PosCache();

  // ---------------------------------------------------------------- reuniões
  private evalGathering(e: Dyn, now: number) {
    const G = this.cfg.gathering;
    const n = this.refresh(e, G.attractRadiusM + 5, now);
    // composição de quem CHEGOU (para reclassificar) e centro (deriva até o centróide, exceto caminhando)
    let cx = 0, cz = 0, k = 0, manif = 0, social = 0;
    const supCount = this.supCount; supCount.clear();
    const ar2 = (e.r * 1.3) * (e.r * 1.3);
    for (let i = 0; i < n; i++) {
      const a = this.sample[i];
      const m = e.members.get(a.id);
      if (!m || m.role === 'WATCH' || d2(a.x, a.z, e.x, e.z) > ar2) continue;
      cx += a.x; cz += a.z; k++;
      if (a.personality === 'MANIFESTANTE') manif++;
      if (a.personality === 'SOCIAL' || a.personality === 'TORCEDOR') social++;
      if (a.sup > 0) supCount.set(a.sup, (supCount.get(a.sup) ?? 0) + 1);
    }
    if (k && e.phase !== 'WALK') { e.x += (cx / k - e.x) * 0.15; e.z += (cz / k - e.z) * 0.15; }
    let dom = 0, domN = 0, sides = 0;
    for (const [s, c] of supCount) { if (c > domN) { dom = s; domN = c; } if (c >= G.torcidas.minPerSide) sides++; }
    e.domSup = dom;
    e.participants = [...e.members.values()].filter((m) => m.role !== 'WATCH').length;
    e.r = Math.min(G.maxRadiusM, Math.max(G.radiusM, G.radiusM * Math.sqrt(Math.max(1, k) / 8)));
    // tipo pela composição (forçado não muda)
    if (!e.forced && e.kind !== 'CAMINHADA') {
      let kind: DynamicEventKind = 'CONCENTRACAO';
      if (sides >= 2) kind = 'ENCONTRO_TORCIDAS';
      else if (k >= G.festa.minSize && (domN / k >= G.festa.supShare || social / k >= G.festa.socialShare)) kind = 'FESTA';
      else if (k >= G.manifest.minSize && manif / k >= G.manifest.share) kind = 'MANIFESTACAO';
      // histerese: o tipo novo precisa se manter KIND_STREAK avaliações; nunca volta a CONCENTRACAO (é o que ela virou)
      if (kind === e.kind || kind === 'CONCENTRACAO') { e.kindCand = null; e.kindStreak = 0; }
      else if (kind === e.kindCand) { if (++e.kindStreak >= KIND_STREAK) { e.kind = kind; e.kindCand = null; e.kindStreak = 0; this.log(e, 'kind', now); } }
      else { e.kindCand = kind; e.kindStreak = 1; }
    }
    // fases pelo tempo
    if (e.phase === 'GROW' && (now >= e.phaseUntil || e.participants >= G.maxSize)) {
      e.phase = 'PEAK'; e.phaseUntil = now + this.range(G.peakS) * 1000;
      if (e.forced === 'CAMINHADA' || (e.kind === 'MANIFESTACAO' && this.rng() < G.manifest.walkChance)) this.beginWalk(e, now);
    } else if (e.phase === 'PEAK' && now >= e.phaseUntil) { e.phase = 'DRAIN'; e.phaseUntil = now + this.range(G.drainS) * 1000; }
    if (e.phase === 'WALK') this.walkStep(e, now);
    // convites (crescimento orgânico) — só a quem já está perto
    const rate = e.phase === 'GROW' || e.phase === 'WALK' ? 1 : e.phase === 'PEAK' ? 0.25 : 0;
    if (rate > 0 && e.participants < G.maxSize) this.invite(e, n, rate * (1 - e.participants / G.maxSize), now);
    // ENCONTRO DE TORCIDAS: chance (por minuto) de uma discussão entre torcedores de torcidas diferentes
    if (e.kind === 'ENCONTRO_TORCIDAS' && this.rng() < G.torcidas.tensionPerMin * (this.cfg.director.eventEvalMs / 60_000) * (e.forced ? 3 : 1)) this.torcidasTension(e, n, now);
    // esvaziando: alguns saem a cada avaliação
    if (e.phase === 'DRAIN') {
      const ids = [...e.members.keys()];
      const out = Math.max(1, Math.round(ids.length * G.leaveShare));
      for (let i = 0; i < out && ids.length; i++) {
        const id = ids.splice(Math.floor(this.rng() * ids.length) % ids.length, 1)[0];
        this.propose(id, { kind: 'WANDER', until: now + 60_000 }, 1);
        this.dropMember(e, id);
      }
      e.participants = [...e.members.values()].filter((m) => m.role !== 'WATCH').length;
    }
    e.endsAtEst = e.phase === 'DRAIN' ? e.phaseUntil : e.phaseUntil + 120_000;
    const keep = e.forced && now < e.forcedUntil;
    if (!keep && (e.phase === 'DRAIN' && (e.participants <= G.endBelow || now >= e.phaseUntil))) this.end(e, now, 'esvaziou');
    else if (!keep && e.phase !== 'DRAIN' && e.participants < 2 && now - e.startedAt > 30_000) this.end(e, now, 'não pegou');
  }
  private supCount = new Map<number, number>();

  private invite(e: Dyn, n: number, rate: number, now: number) {
    const G = this.cfg.gathering;
    let slots = 0;
    for (let i = 0; i < G.invitePerEval; i++) if (this.rng() < rate) slots++;
    if (!slots) return;
    const free = this.collectFree(n);
    for (let tries = 0; slots > 0 && free.length && tries < 6; tries++) {
      const j = Math.floor(this.rng() * free.length) % free.length;
      const a = this.sample[free[j]];
      free.splice(j, 1);
      if (this.rng() < G.watchShare[a.personality]) {
        if (this.propose(a.id, { kind: 'WATCH_EVENT', x: e.x, z: e.z, eventId: e.id, until: now + 90_000 }, G.watchShare[a.personality])) { this.addMember(e, a, 'WATCH', now); slots--; }
        continue;
      }
      const same = e.domSup > 0 && a.sup === e.domSup;
      const chance = G.attract[a.personality] * (same ? G.sameSupMult : 1);
      if (this.rng() >= chance) continue;
      let friends = false;
      if (a.group) for (const m of e.members.values()) if (m.group !== undefined && m.group === a.group) { friends = true; break; }
      const kind: GoalKind = e.phase === 'WALK' ? 'FOLLOW_EVENT' : friends ? 'MEET_GROUP' : same ? 'FOLLOW_SUPPORTERS' : 'JOIN_CROWD';
      if (this.propose(a.id, { kind, x: e.x, z: e.z, eventId: e.id, until: now + 180_000 }, chance)) { this.addMember(e, a, 'JOIN', now); slots--; }
    }
  }

  private beginWalk(e: Dyn, now: number) {
    const M = this.cfg.gathering.manifest;
    e.kind = 'CAMINHADA';
    e.phase = 'WALK';
    e.dest = this.alongAxis(e.x, e.z, this.range(M.walkLengthM));
    e.phaseUntil = now + (Math.hypot(e.dest.x - e.x, e.dest.z - e.z) / Math.max(0.2, M.paceMS)) * 1000 + 30_000;
    this.log(e, 'kind', now, 'caminhada');
  }

  private walkStep(e: Dyn, now: number) {
    const M = this.cfg.gathering.manifest;
    if (!e.dest) { e.phase = 'DRAIN'; return; }
    const dx = e.dest.x - e.x, dz = e.dest.z - e.z, d = Math.hypot(dx, dz);
    const step = M.paceMS * (this.cfg.director.eventEvalMs / 1000);
    if (d <= step || now >= e.phaseUntil) { e.x = e.dest.x; e.z = e.dest.z; e.phase = 'DRAIN'; e.phaseUntil = now + this.range(this.cfg.gathering.drainS) * 1000; return; }
    e.x += (dx / d) * step; e.z += (dz / d) * step;
    // acompanhar: atualiza o ponto para poucos por avaliação (rodízio), nunca todos de uma vez
    let i = 0;
    for (const [id, m] of e.members) {
      if (m.role === 'WATCH' || (this.seq + i++) % 4 !== Math.floor(now / 1000) % 4) continue;
      // ponto um pouco À FRENTE do centro: quem acompanha não para no lugar velho e fica para trás (anda junto)
      this.propose(id, { kind: 'FOLLOW_EVENT', x: e.x + (dx / d) * 6, z: e.z + (dz / d) * 6, eventId: e.id, until: now + 60_000 }, 0.9);
    }
  }

  private torcidasTension(e: Dyn, n: number, now: number) {
    const C = this.cfg.conflict;
    const ms: NearAgent[] = [];
    for (let i = 0; i < n; i++) { const a = this.sample[i]; const m = e.members.get(a.id); if (m && m.role !== 'WATCH' && a.sup > 0) ms.push({ ...a }); }
    if (ms.length < 2) return;
    const a = this.pick(ms);
    let b: NearAgent | null = null, best = (C.pairRadiusM * 2) ** 2;
    for (const s of ms) { if (s.sup === a.sup) continue; const dd = d2(a.x, a.z, s.x, s.z); if (dd <= best) { best = dd; b = s; } }
    if (!b || !this.conflictAllowed('DISCUSSAO', a.x, a.z, now, true)) return;
    // a chance já foi rolada (tensionPerMin); o temperamento decide se a provocação pega
    const temper = (C.temper[a.personality] + C.temper[b.personality]) / 2;
    if (!e.forced && this.rng() >= temper) return;
    this.dropMember(e, a.id); this.dropMember(e, b.id);
    this.startConflict(a, b, (a.x + b.x) / 2, (a.z + b.z) / 2, now, null, null, 'torcidas');
  }

  // ---------------------------------------------------------------- corrida improvisada
  private evalRace(e: Dyn, now: number) {
    const R = this.cfg.race;
    const n = this.refresh(e, 60, now, (role, g) => (role === 'RACE' ? g === 'TRAVEL' || g === 'USE_VEHICLE' : !LEFT.has(g)));
    let cx = 0, cz = 0, k = 0, arrived = 0;
    for (const [id, m] of e.members) {
      if (m.role !== 'RACE') continue;
      const p = this.pos.get(id);
      if (!p) continue;
      cx += p.x; cz += p.z; k++;
      if (e.dest && d2(p.x, p.z, e.dest.x, e.dest.z) < 64) arrived++;
    }
    if (k) { e.x = cx / k; e.z = cz / k; }
    e.participants = k;
    // quem está perto assiste (poucos por avaliação)
    let left = R.watchPerEval;
    if (left > 0) {
      const free = this.collectFree(n);
      for (const i of free) {
        if (left <= 0) break;
        const a = this.sample[i];
        if (d2(a.x, a.z, e.x, e.z) > 30 * 30 || this.rng() >= this.cfg.gathering.watchShare[a.personality]) continue;
        if (this.propose(a.id, { kind: 'WATCH_EVENT', x: e.x, z: e.z, eventId: e.id, until: now + 45_000 }, 0.7)) { this.addMember(e, a, 'WATCH', now); left--; }
      }
    }
    const keep = e.forced && now < e.forcedUntil;
    if (!keep && (k === 0 || arrived > 0 || now >= e.phaseUntil)) this.end(e, now, arrived ? 'chegada' : 'fim');
  }

  // ---------------------------------------------------------------- focos de briga
  private fightersOf(e: Dyn): number { let f = 0; for (const m of e.members.values()) if (m.role === 'FIGHT') f++; return f + (e.human && e.escalation !== 'TENSAO' ? 1 : 0); }

  private setLevel(e: Dyn, lv: Escalation, now: number) {
    if (lv === e.escalation) return;
    e.escalation = lv;
    e.levelSince = now;
    // o tipo acompanha a SUBIDA (BRIGA fica BRIGA enquanto se dispersa; o nível desce)
    if (LEVELS.indexOf(lv) > LEVELS.indexOf(KIND_LEVEL[e.kind] ?? 'CALMO')) e.kind = LEVEL_KIND[lv];
    this.log(e, 'level', now);
  }

  private evalConflict(e: Dyn, now: number, speed: number) {
    const C = this.cfg.conflict;
    const lv = e.escalation;
    const reactR = lv === 'GENERALIZADO' ? C.general.reactRadiusM : lv === 'CONFRONTO' ? C.fight.reactRadiusM : C.tension.reactRadiusM;
    const n = this.refresh(e, reactR + 6, now, (role, g) => {
      if (role === 'FIGHT') return g === 'JOIN_FIGHT'; // largou a briga: cansaço/stamina (o cérebro decide)
      if (role === 'ARGUE') return g === 'SOCIALIZE' || g === 'JOIN_FIGHT';
      if (role === 'WATCH') return g === 'WATCH_FIGHT' || g === 'WATCH_EVENT';
      return true;
    });
    // centro: entre quem discute/briga
    let cx = 0, cz = 0, k = 0;
    for (const [id, m] of e.members) if (m.role === 'FIGHT' || m.role === 'ARGUE') { const p = this.pos.get(id); if (p) { cx += p.x; cz += p.z; k++; } }
    if (k) { e.x = cx / k; e.z = cz / k; }
    e.heat = this.view.heat(e.x, e.z, reactR);
    const t = (now - e.levelSince) / 1000 * speed;
    const arguers = [...e.members.values()].filter((m) => m.role === 'ARGUE').length;
    const fighters = this.fightersOf(e);
    const keep = e.forced && now < e.forcedUntil;
    e.r = Math.max(8, Math.min(reactR, 6 + fighters * 1.5));
    if (e.phase === 'DISPERSE') { this.disperse(e, now, speed); this.counts(e); return; }

    if (lv === 'TENSAO') {
      const pair = arguers + (e.human ? 1 : 0);
      if (pair < 2 && !keep && !e.ghost) { this.calm(e, now, 'separaram'); return; }
      this.react(e, n, now, C.tension.watchersPerEval, 0, C.tension.reactRadiusM);
      const minS = e.human ? Math.min(1.5, C.tension.minS) : C.tension.minS;
      if (t >= minS) {
        const temper = this.pairTemper(e);
        const hit = e.heat.hitsPerMin > 0 && e.heat.combatants > 0 || (e.human !== null && now - e.hitAt < 5000);
        const pushed = e.forced === 'BRIGA' || e.forced === 'BRIGA_GENERALIZADA';
        // plateia esquenta: com gente em volta a discussão escala mais (mesmo fator de aperto do nascimento)
        const press = 1 + C.crowdMult * Math.max(0, Math.min(C.crowdCap, e.heat.crowd - 2));
        const want = pushed || hit || (e.forced !== 'DISCUSSAO' && this.rng() < C.tension.escalateChance * temper * this.pairRival(e) * press);
        // provocado por HUMANO: o revide não depende do orçamento espontâneo (nem o gasta) — quem agrediu começou
        // brigas espontâneas espaçadas (fightCooldownS): sem isso o teto por hora saía todo nos primeiros 20 min
        const spaced = now - this.fightAt >= this.cfg.budget.conflict.fightCooldownS * 1000;
        if (want && (pushed || e.human !== null || (spaced && this.conflictAllowed('BRIGA', e.x, e.z, now, false)))) this.toConfront(e, now);
        else if (!keep && (t >= C.tension.maxS || this.rng() < C.tension.calmChance * Math.max(0.1, 1.2 - temper))) this.calm(e, now, 'acalmaram');
      }
    } else if (lv === 'CONFRONTO') {
      if (fighters < 2 && !keep && !e.ghost) { this.startDisperse(e, now, 'parou'); return; }
      this.retarget(e);
      this.reask(e, now);
      this.react(e, n, now, C.fight.decisionsPerEval, C.fight.maxJoinPerEval, C.fight.reactRadiusM);
      const f2 = this.fightersOf(e);
      const canGen = (f2 >= C.fight.generalizeAt || (e.ghost && e.forced === 'BRIGA_GENERALIZADA')) && t >= C.fight.minS;
      if (canGen && (e.forced === 'BRIGA_GENERALIZADA' || (!e.forced && this.conflictAllowed('BRIGA_GENERALIZADA', e.x, e.z, now, false)))) {
        if (!e.forced) this.spend('BRIGA_GENERALIZADA', now);
        this.setLevel(e, 'GENERALIZADO', now);
        e.decided.clear();
      } else if (t >= C.fight.maxS && !keep) this.startDisperse(e, now, 'cansaço');
    } else if (lv === 'GENERALIZADO') {
      if (fighters < C.general.stepDownBelow && !keep && !e.ghost) { this.setLevel(e, 'CONFRONTO', now); if (fighters < 2) this.startDisperse(e, now, 'esvaziou'); this.counts(e); return; }
      this.retarget(e);
      this.reask(e, now);
      // teto de quem briga: as vagas restantes limitam as adesões; o resto só observa/foge/ignora
      this.react(e, n, now, C.general.decisionsPerEval, Math.max(0, Math.min(C.general.maxJoinPerEval, C.general.maxFighters - fighters)), C.general.reactRadiusM);
      if (t >= C.general.maxS && !keep) this.startDisperse(e, now, 'cansaço');
    }
    this.counts(e);
    e.endsAtEst = now + 60_000;
  }

  /** quem está OLHANDO pode mudar de ideia com a briga rolando: a cada reaskS volta a ser perguntado */
  private reask(e: Dyn, now: number) {
    // QA (foco forçado, acelerado): re-pergunta no mesmo ritmo acelerado do resto do foco
    if (now - e.reaskAt < this.cfg.conflict.fight.reaskS * 1000 / (e.forced ? Math.max(1, this.cfg.qa.forcedSpeedup) : 1)) return;
    e.reaskAt = now;
    for (const [id, m] of e.members) if (m.role === 'WATCH') e.decided.delete(id);
  }

  /** quem briga com alguém que largou a briga passa para o adversário mais perto do outro lado (ninguém persegue quem saiu) */
  private retarget(e: Dyn) {
    for (const [id, m] of e.members) {
      if (m.role !== 'FIGHT' || !m.opponent || m.opponent === e.human) continue;
      const o = e.members.get(m.opponent);
      if (o && o.role === 'FIGHT') continue;
      const p = this.pos.get(id);
      const opp = p ? this.nearestFighter(e, 1 - m.side, p.x, p.z) : null;
      if (opp && opp !== id) m.opponent = opp;
    }
  }

  private counts(e: Dyn) {
    let p = 0, w = 0;
    for (const m of e.members.values()) { if (m.role === 'WATCH') w++; else if (m.role === 'FIGHT' || m.role === 'ARGUE') p++; }
    e.participants = p + (e.human ? 1 : 0);
    e.watchers = w;
  }

  private pairTemper(e: Dyn): number {
    const C = this.cfg.conflict;
    let s = 0, k = 0;
    for (const m of e.members.values()) if (m.role === 'ARGUE') { s += C.temper[m.personality]; k++; }
    return k ? s / k : 0.5;
  }
  private pairRival(e: Dyn): number {
    const sups = [...e.members.values()].filter((m) => m.role === 'ARGUE').map((m) => m.sup);
    return sups.length === 2 && sups[0] > 0 && sups[1] > 0 && sups[0] !== sups[1] ? this.cfg.conflict.differentSupMult : 1;
  }

  private toConfront(e: Dyn, now: number) {
    const C = this.cfg.conflict;
    if (!e.forced && !e.human) { this.spend('BRIGA', now); this.fightAt = now; }
    this.setLevel(e, 'CONFRONTO', now);
    // discussão virou briga: a plateia decide DE NOVO (quem ignorou um bate-boca pode entrar numa briga) — antes a
    // TENSÃO gastava todo mundo em volta e nenhuma briga recebia adesão (rodada 12, agente G)
    e.decided.clear();
    const pushUntil = now + C.fight.pushFirstS * 1000;
    for (const [id, m] of e.members) {
      if (m.role !== 'ARGUE') continue;
      if (this.propose(id, { kind: 'JOIN_FIGHT', target: m.opponent, x: e.x, z: e.z, eventId: e.id, until: now + C.general.maxS * 1000 }, 1)) { m.role = 'FIGHT'; m.pushUntil = pushUntil; }
      else { this.propose(id, { kind: 'AVOID_FIGHT', target: m.opponent, x: e.x, z: e.z, until: now + 30_000 }, 1); this.dropMember(e, id); } // não quis brigar: se afasta
    }
  }

  private calm(e: Dyn, now: number, why: string) {
    this.setLevel(e, 'CALMO', now);
    for (const id of [...e.members.keys()]) { this.propose(id, { kind: 'WANDER', until: now + 30_000 }, 1); this.dropMember(e, id); }
    this.end(e, now, why);
  }

  private startDisperse(e: Dyn, now: number, why: string) {
    e.phase = 'DISPERSE';
    e.dispStepAt = now;
    this.log(e, 'react', now, `dispersão: ${why}`);
  }

  /** desescalada: um nível a cada stepS; poucos saem por avaliação; fim em CALMO sem ninguém */
  private disperse(e: Dyn, now: number, speed: number) {
    const Dp = this.cfg.conflict.dispersal;
    if ((now - e.dispStepAt) / 1000 * speed >= Dp.stepS) {
      e.dispStepAt = now;
      const i = LEVELS.indexOf(e.escalation);
      if (i > 0) this.setLevel(e, LEVELS[i - 1], now);
    }
    let k = 0;
    for (const [id, m] of [...e.members]) {
      if (k >= Dp.perEval) break;
      this.propose(id, m.role === 'FIGHT' ? { kind: 'LEAVE_AREA', x: e.x, z: e.z, until: now + 30_000 } : { kind: 'WANDER', until: now + 30_000 }, 1);
      this.dropMember(e, id); k++;
    }
    if (e.escalation === 'CALMO' && e.members.size === 0) this.end(e, now, 'dispersou');
  }

  /**
   * reações de quem está perto (≤ `decisions` por avaliação; ≤ `maxJoin` entram): pesos da PERSONALIDADE (dados);
   * amigos (mesmo grupo ou mesma torcida de quem briga — igualdade) entram mais; quem já decidiu não é perguntado de novo
   */
  private react(e: Dyn, n: number, now: number, decisions: number, maxJoin: number, radius: number) {
    const C = this.cfg.conflict;
    const free = this.collectFree(n, true, e);
    const r2 = radius * radius;
    let joined = 0;
    for (let tries = 0; decisions > 0 && free.length && tries < decisions * 3; tries++) {
      const j = Math.floor(this.rng() * free.length) % free.length;
      const a = this.sample[free[j]];
      free.splice(j, 1);
      if (e.decided.has(a.id) || d2(a.x, a.z, e.x, e.z) > r2) continue;
      decisions--;
      e.decided.add(a.id);
      const side = this.friendSide(e, a);
      const w = C.reactions[a.personality];
      const joinW = maxJoin > 0 ? w.join * (side >= 0 ? C.friendJoinMult : C.strangerJoinMult) * (e.forced === 'BRIGA_GENERALIZADA' ? 3 : 1) : 0;
      let r: Reaction = this.roll(joinW, w.watch, w.flee, w.ignore);
      if (r === 'join' && joined >= maxJoin) r = 'watch'; // adesão GRADUAL: o excedente fica olhando
      this.stats.reactions[r]++;
      if (r === 'join') {
        const s = side >= 0 ? side : this.rng() < 0.5 ? 0 : 1;
        const opp = this.nearestFighter(e, 1 - s, a.x, a.z);
        // o sorteio acima JÁ foi a decisão pela personalidade: o pedido vai com peso cheio (antes ia com joinW de novo —
        // a chance era elevada ao quadrado e quase ninguém entrava; o cérebro ainda pesa o compromisso atual)
        if (opp && this.propose(a.id, { kind: 'JOIN_FIGHT', target: opp, x: e.x, z: e.z, eventId: e.id, until: now + C.general.maxS * 1000 }, 1)) {
          this.leaveOther(a.id, e);
          const m = this.addMember(e, a, 'FIGHT', now, s, opp);
          m.pushUntil = now + C.fight.pushFirstS * 1000;
          joined++;
        }
      } else if (r === 'watch') {
        if (this.propose(a.id, { kind: 'WATCH_FIGHT', x: e.x, z: e.z, eventId: e.id, until: now + 60_000 }, 0.9)) { this.leaveOther(a.id, e); this.addMember(e, a, 'WATCH', now); }
      } else if (r === 'flee') {
        if (this.propose(a.id, { kind: 'AVOID_FIGHT', x: e.x, z: e.z, eventId: e.id, until: now + 30_000 }, 1)) this.leaveOther(a.id, e);
      }
      // ignore: segue a vida (nenhuma proposta)
    }
  }

  private roll(join: number, watch: number, flee: number, ignore: number): Reaction {
    const tot = join + watch + flee + ignore;
    if (tot <= 0) return 'ignore';
    let x = this.rng() * tot;
    if ((x -= join) < 0) return 'join';
    if ((x -= watch) < 0) return 'watch';
    if ((x -= flee) < 0) return 'flee';
    return 'ignore';
  }

  /** lado do qual `a` é amigo (mesmo grupo ou mesma torcida — só igualdade); -1 = de ninguém; ambos = sorteio */
  private friendSide(e: Dyn, a: NearAgent): number {
    let s0 = false, s1 = false;
    for (const m of e.members.values()) {
      if (m.role !== 'FIGHT' && m.role !== 'ARGUE') continue;
      const friend = (a.group !== undefined && m.group !== undefined && a.group === m.group) || (a.sup > 0 && a.sup === m.sup);
      if (!friend) continue;
      if (m.side === 0) s0 = true; else if (m.side === 1) s1 = true;
    }
    if (s0 && s1) return this.rng() < 0.5 ? 0 : 1;
    return s0 ? 0 : s1 ? 1 : -1;
  }

  private nearestFighter(e: Dyn, side: number, x: number, z: number): string | null {
    let best: string | null = null, bd = Infinity;
    for (const [id, m] of e.members) {
      if ((m.role !== 'FIGHT' && m.role !== 'ARGUE') || m.side !== side) continue;
      const p = this.pos.get(id);
      const dd = p ? d2(p.x, p.z, x, z) : 1e9;
      if (dd < bd) { bd = dd; best = id; }
    }
    if (!best && e.human && side === 1) return e.human;
    return best;
  }

  // ================================================================ ganchos externos
  /**
   * um HUMANO agrediu (golpe/empurrão/derrubada) um autônomo: só então ele vira lado de um foco. O alvo reage pela
   * personalidade (revida = discussão que escala logo; foge; ignora). Não gasta o orçamento espontâneo.
   */
  onAggression(attacker: string, target: string, x: number, z: number, now = this.clock()) {
    const cur = this.roles.get(target);
    if (cur) {
      const e = this.events.get(cur.eventId);
      if (e && e.family === 'conflict') { if (cur.opponent === attacker || e.human === attacker) e.hitAt = now; return; }
      // estava numa reunião/corrida: apanhar é mais forte que o evento — sai dele e reage (antes: a agressão era
      // ignorada para quem estava numa concentração, ~metade das pessoas)
      if (e) this.dropMember(e, target); else this.roles.delete(target);
    }
    if (now - (this.humanProvAt.get(attacker) ?? -1e15) < this.cfg.conflict.provocation.cooldownPerHumanS * 1000) return;
    this.humanProvAt.set(attacker, now);
    const n = this.near(x, z, 4);
    let a: NearAgent | null = null;
    for (let i = 0; i < n; i++) if (this.sample[i].id === target) { a = { ...this.sample[i] }; break; }
    if (!a) return;
    const w = this.cfg.conflict.reactions[a.personality];
    // apanhou: revidar pesa como entre amigos (é pessoal); fugir/ignorar pela personalidade
    const r = this.roll(w.join * this.cfg.conflict.friendJoinMult, 0, w.flee, w.ignore + w.watch);
    this.stats.reactions[r]++;
    if (r === 'flee') { this.propose(a.id, { kind: 'AVOID_FIGHT', target: attacker, x, z, until: now + 30_000 }, w.flee); return; }
    if (r !== 'join') return;
    const e = this.startConflict(a, null, x, z, now, null, attacker);
    if (e) e.hitAt = now;
  }

  /**
   * QA (servidor de teste, PV_TEST): força um evento em (x, z). Ignora orçamento/cooldown, mas a dinâmica é a mesma:
   * reuniões crescem por convites; briga passa por TENSÃO → CONFRONTO (→ GENERALIZADO) em ordem, mais rápido
   * (qa.forcedSpeedup), com adesões graduais. Sem ninguém por perto: foco "fantasma" só para os sinais.
   */
  force(kind: DynamicEventKind, x: number, z: number, now = this.clock()): string | null {
    if (!(kind in FAMILY)) return null;
    const fam = FAMILY[kind];
    const n = this.near(x, z, fam === 'conflict' ? 15 : this.cfg.gathering.coreRadiusM * 2);
    const free = this.collectFree(n).map((i) => ({ ...this.sample[i] })).sort((p, q) => d2(p.x, p.z, x, z) - d2(q.x, q.z, x, z));
    let e: Dyn | null;
    if (fam === 'gathering') e = this.startGathering(free.slice(0, this.cfg.gathering.coreMin + 2), x, z, now, kind);
    else if (fam === 'race') e = this.startRace(free.slice(0, this.cfg.race.racersMax), now, kind, { x, z });
    else {
      e = this.startConflict(free[0] ?? null, free[1] ?? null, x, z, now, kind === 'DISCUSSAO' ? 'DISCUSSAO' : kind);
      if (e && e.members.size === 0) e.ghost = true;
    }
    if (e) this.sink.log?.(`mundo dinâmico: QA forçou ${kind} em ${Math.round(x)},${Math.round(z)} (${e.id}, ${e.members.size} perto)`);
    return e?.id ?? null;
  }

  // ================================================================ consultas e saída
  /** papel do autônomo num evento dinâmico (cérebro do AGENTE C) */
  roleOf(id: string): Readonly<RoleInfo> | null { return this.roles.get(id) ?? null; }
  get(id: string): DynamicEventState | undefined { const e = this.events.get(id); return e ? this.snap(e) : undefined; }
  list(): DynamicEventState[] { return [...this.events.values()].filter((e) => !e.dead).map((e) => this.snap(e)); }
  private snap(e: Dyn): DynamicEventState { return { id: e.id, kind: e.kind, x: e.x, z: e.z, r: e.r, escalation: e.escalation, startedAt: e.startedAt, participants: e.participants, watchers: e.watchers }; }
  /** QA/testes: retrato interno pequeno (fase, membros por papel, calor) */
  debug(id: string) {
    const e = this.events.get(id);
    if (!e) return null;
    const roles: Record<string, number> = {};
    for (const m of e.members.values()) roles[m.role] = (roles[m.role] ?? 0) + 1;
    return { phase: e.phase, roles, heat: e.heat, ghost: e.ghost, forced: e.forced, human: e.human, dest: e.dest, arrived: e.arrived, family: e.family };
  }
  /** custo médio por tick (ms) */
  get avgMs() { return this.stats.ticks ? this.stats.msTotal / this.stats.ticks : 0; }

  /** sinais para áudio/HUD (formato `dyn`, src/events/schedule.ts DynamicSignalWire) */
  signals(): DynamicSignalWire[] {
    const S = this.cfg.signals;
    const out: DynamicSignalWire[] = [];
    for (const e of this.events.values()) {
      if (e.dead) continue;
      const crowd = e.participants + e.watchers;
      const ci = Math.min(1, crowd / Math.max(1, S.crowdFull));
      const ch = (S.cheer[e.kind] ?? 0) * Math.min(1, (e.family === 'conflict' ? e.watchers : crowd) / 10 + (e.ghost ? 0.5 : 0));
      const cb = e.family === 'conflict' ? Math.max(S.combatFloor[e.escalation] ?? 0, Math.min(1, e.heat.combatants / 12 + e.heat.hitsPerMin / 120)) : 0;
      out.push({ id: e.id, k: e.kind, x: Math.round(e.x), z: Math.round(e.z), r: Math.round(e.r), e: LEVELS.indexOf(e.escalation), n: e.participants, w: e.watchers, ci: round2(ci), ch: round2(ch), cb: round2(cb) });
    }
    return out;
  }

  private send(now: number) {
    if (now - this.sendAt < this.cfg.director.sendMinMs) return;
    const list = this.signals();
    const sig = JSON.stringify(list);
    if (sig === this.sendSig) return;
    this.sendSig = sig;
    this.sendAt = now;
    this.wire = list;
    this.stats.sends++;
    this.sink.broadcast('dyn', { list });
  }

  /** conexão nova: lista atual (o cliente pode ignorar enquanto não tem ouvinte; a próxima mudança reenvia) */
  hello(send: (type: string, msg: unknown) => void) { if (this.wire.length) send('dyn', { list: this.wire }); }

  /** entradas "acontecendo agora" na MESMA agenda do EventRuntime (formato 'dinamico': sem inscrição) */
  agenda(now = this.clock()): AgendaEntry[] {
    const P = this.cfg.presentation;
    const out: AgendaEntry[] = [];
    for (const e of this.events.values()) {
      if (e.dead || !P.agenda.includes(e.kind) || (e.participants < P.agendaMin && !e.forced)) continue;
      out.push({ id: `dinamico_${e.kind.toLowerCase()}`, inst: e.id, format: 'dinamico', name: P.labels[e.kind] ?? e.kind, zone: this.sink.zoneAt?.(e.x, e.z) ?? '', state: 'ACTIVE', startsAt: e.startedAt, endsAt: Math.ceil(Math.max(now + 30_000, e.endsAtEst) / 60_000) * 60_000, count: e.participants, capacity: 0 }); // fim estimado em minutos cheios (menos reenvio da agenda)
    }
    return out;
  }

  /** concentrações dos eventos dinâmicos de reunião → `evt_pts` (minimapa) e ambiente do espectador; nenhum NPC reservado */
  rallies(): EventRallyPoint[] {
    const P = this.cfg.presentation;
    const out: EventRallyPoint[] = [];
    for (const e of this.events.values()) {
      if (e.dead || !P.rally.includes(e.kind) || (e.participants < 3 && !e.forced)) continue;
      out.push({ id: `dyn_${e.id}`, x: e.x, z: e.z, inner: Math.round(e.r * 0.4), radius: Math.round(e.r), strength: 0.35, crowd: 0, label: P.labels[e.kind] ?? e.kind, ...(e.kind === 'FESTA' && e.domSup > 0 ? { sup: e.domSup } : {}) });
    }
    return out;
  }
}

/** posições vistas por último (por id) sem alocar objeto por leitura */
class PosCache {
  private m = new Map<string, { x: number; z: number }>();
  set(id: string, x: number, z: number) { const p = this.m.get(id); if (p) { p.x = x; p.z = z; } else { if (this.m.size > 4096) this.m.clear(); this.m.set(id, { x, z }); } }
  get(id: string) { return this.m.get(id); }
}
