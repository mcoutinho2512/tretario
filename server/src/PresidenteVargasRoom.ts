/**
 * Sala da Presidente Vargas — servidor AUTORITATIVO (desenvolvimento/local).
 *
 *  posição      cliente propõe; servidor valida velocidade por modo, limites e PAREDES (colisão 2D) e corrige
 *  veículos     registro no servidor; entrar/sair validados; 1 ocupante por veículo; posição vem do ocupante validado
 *  evento       carro de som e trio elétrico (veículos de evento, lentos e sempre pacíficos); passageiros EM CIMA do trio
 *               (NetPlayer.platform/plx/plz/plh): movimento LOCAL validado contra o polígono do piso; o servidor
 *               leva todos junto quando o trio anda (src/vehicles/platform.ts, docs/SHARED_WORLD.md)
 *  interação    modo por jogador (política do evento); empurrão e impacto de veículo validados aqui
 *  mundo        relógio global e semente. SEM trânsito NPC: a Pres. Vargas está fechada para o evento — só veículos
 *               de jogadores (carro, moto, bicicleta, patinete), estacionados até alguém usar
 *  interesse    grade espacial (SpatialGrid) + StateView por cliente: os AOI_MAX jogadores mais próximos a ≤ AOI_RADIUS
 *               com estado completo (20 Hz); o resto da área vai como multidão compacta ("crowd", 2 Hz). Veículos também pela grade
 *  grafite      server/src/graffiti: gf_new validado (superfície autorizada, alcance, conteúdo, cota), interesse por
 *               superfície, moderação e persistência (JSON local em dev) — docs/GRAFFITI.md
 *  chat         server/src/chat: GERAL / PROXIMIDADE (grade espacial) / GRUPO, anti-flood, mutar, denúncias — docs/CHAT.md
 *  rede adversa PV_JITTER / PV_LOSS (ms / 0–1) além de COLYSEUS_LATENCY (RTT nativo)
 *  rodada 8     espectadores (server/src/spectator: sem corpo, AOI pela câmera), reconexão com graça (PV_GRACE_S, 20 s),
 *               login duplicado (a sessão nova ASSUME a entidade), presença em memória e métricas públicas
 *               (server/src/presence) — docs/SPECTATOR.md, docs/SHARED_WORLD.md
 *  rodada 8.1   espectador AÉREO: camada pela altitude (spec_cam.alt), AOI por camada e, em FAR/AGGREGATE, células
 *               agregadas `spec_cells` (CrowdCellAggregator: UMA vez por período para todos; CellFeed por espectador).
 *               Jogador: nada muda (mesmo AOI, nunca recebe spec_cells)
 */
import { fileURLToPath } from 'node:url';
import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { WorldState, NetPlayer, NetVehicle } from './state.ts';
import { loadWorld, type ServerWorld } from './world.ts';
import { BODIES, MAX_SPEED, sanitizeName, type JoinOptions, type MoveMode } from '../../src/net/protocol.ts';
import { validateAppearance } from '../../src/characters/validateAppearance.ts';
import { DEFAULT_PLAYER_APPEARANCE, type CharacterAppearance } from '../../src/characters/bodyTypes.ts';
import { loadPlayerLook } from './identity/appearance.ts';
import { validateMoveInWorld } from '../../src/net/authority.ts';
import { RULES, STATUS, VEHICLE_BOX, VEHICLE_STATE, EVENT_VEHICLE_KINDS, boxesOverlap, canPush, canEnter, impactAllowed, knockdownOutcome, pushOutOfBox, shouldResetVehicle, vehicleBlock, vehicleImpact, unpackMove, type Actor, type Mode, type VehicleKind } from '../../src/net/rules.ts';
import { TRIO, canBoard, exitPoints, localToWorld, unpackPlatformMove, validatePlatformMove } from '../../src/vehicles/platform.ts';
import { DESIGN_BY_KEY } from '../../src/social/designs.ts';
import { metrics } from './metrics.ts';
import { SpatialGrid, selectInterest, selectInterestSlots, InterestScratch, makeSlotView, type SlotView } from '../../src/net/spatialGrid.ts';
import { CrowdTable } from '../../src/net/crowdCodec.ts';
import { GraffitiService, sanitizeClientId } from './graffiti/GraffitiService.ts';
import { JsonFileGraffitiStore, MemoryGraffitiStore } from './graffiti/store.ts';
import { ChatService } from './chat/ChatService.ts';
import { serverSecret } from './auth/service.ts';
import type { GfReportEvent } from './graffiti/GraffitiService.ts';
import { can, type Capability } from '../../src/access/policy.ts';
import { resolveIdentity, JoinRefused, type ConnectionIdentity } from './identity/resolve.ts';

/** identidade da conexão + marca de bot de carga (só servidor de teste) */
type RoomIdentity = ConnectionIdentity & { bot?: boolean };
import { services } from './services.ts';
import { recheckIdentities, IDENTITY_RECHECK_MS, CLOSE_BANNED, CLOSE_DOWNGRADED } from './identity/recheck.ts';

/** banco (DataStore) se os serviços foram iniciados (sala de teste sem initServices: sem gravação) */
const storeOrNull = () => { try { return services().store; } catch { return null; } };
import { ACTION_RULES, applyAction, applyProp, cancelsOnMove, onceFinished, validateAction, validateProp, type ActionActor } from '../../src/social/actionRules.ts';
import { SpectatorSessions, type SpectatorSession } from './spectator/SpectatorSession.ts';
import { CrowdCellAggregator, environmentCells, type CellPlayer, type CellSet, type EnvModel, type EnvRally } from './spectator/CrowdCellAggregator.ts';
import { encodeCells } from '../../src/spectator/cellCodec.ts';
import { CROWD_CELL } from '../../src/spectator/tiers.ts';
import { RALLY_SHAPE } from '../../src/social/rally.ts';
import { PresenceTracker } from './presence/PresenceTracker.ts';
import { PEDESTRIAN_ESTIMATE, environmentCrowdFor, liveWorlds, type WorldMetricsSource } from './presence/publicMetrics.ts';
import { testJoinFlags } from './presence/testJoin.ts';
import { liveMemorySweepers } from './cleanup/CleanupService.ts';
import { LINK_WIRE, RECONNECT } from '../../src/net/reconnect.ts';

const AOI_RADIUS = Number(process.env.PV_AOI ?? 220); // m — jogadores/veículos visíveis
/** histerese da AOI: entra a ≤ R, sai só além de R × AOI_HYST */
const AOI_HYST = 1.15;
/** máximo de jogadores com estado completo (StateView) por cliente — os mais próximos. 0 = sem limite */
const AOI_MAX = Number(process.env.PV_AOI_MAX ?? 48);
/** multidão distante: frequência (Hz) e máximo de entradas por mensagem */
const CROWD_HZ = Number(process.env.PV_CROWD_HZ ?? 2);
const TICK_MS = 100; // simulação a 10 Hz
/** AOI e multidão são FATIADAS entre ticks (cada cliente no seu tick: slot % fatias): sem picos de custo */
const AOI_SLICES = 2; // cada cliente a cada 2 ticks = 5 Hz (antes: todos juntos a 4 Hz)
const CROWD_SLICES = Math.max(1, Math.round(1000 / TICK_MS / Math.max(0.1, CROWD_HZ)));
const CROWD_MAX = Number(process.env.PV_CROWD_MAX ?? 600);
/** limite pedido pelo cliente (aparelho fraco pede menos), entre 8 e AOI_MAX; 0 = sem limite */
const clientCap = (req: unknown) => {
  const n = typeof req === 'number' && Number.isFinite(req) ? Math.round(req) : 0;
  if (AOI_MAX <= 0) return n > 0 ? Math.max(8, n) : 0;
  return n > 0 ? Math.max(8, Math.min(AOI_MAX, n)) : AOI_MAX;
};
const BODY_INDEX: Record<string, number> = Object.fromEntries(BODIES.map((b, i) => [b, i]));
/** veículo abandonado longe da vaga volta para ela após este tempo (ms) sem ninguém por perto */
const VEH_RESET_MS = Number(process.env.PV_VEH_RESET_MS ?? RULES.vehicleResetMs);
const SIM_JITTER = Number(process.env.PV_JITTER ?? 0);
const SIM_LOSS = Number(process.env.PV_LOSS ?? 0);
/** prazo de graça da reconexão (s) — src/net/reconnect.ts */
const GRACE_S = Number(process.env.PV_GRACE_S ?? RECONNECT.graceS);

let WORLD: ServerWorld | null = null;
const world = () => (WORLD ??= loadWorld());

interface PlayerRT {
  actor: Actor;
  last: { x: number; y: number; z: number; t: number; seq: number };
  view: StateView;
  /** jogadores na vista (por slot) */
  inView: SlotView;
  vehInView: Set<string>;
  rest: { x: number; z: number } | null;
  pendingIn: number; // processamento ordenado com jitter simulado
  /** id numérico curto (mensagem "crowd") */
  nid: number;
  /** jogadores na área mas fora do limite AOI_MAX (do último cálculo de AOI), mais próximos primeiro */
  overflow: number[];
  /** slot na grade espacial (inteiro pequeno, reaproveitado) */
  slot: number;
  /** limite de detalhados deste cliente (pedido no join, ≤ AOI_MAX) */
  aoiCap: number;
  /** nids cuja aparência este cliente já recebeu pela mensagem "crowd" */
  crowdKnown: Set<number>;
  /** ações sociais / item segurado (regras puras em src/social/actionRules.ts) */
  social: ActionActor;
  /** em cima de um trio: posição LOCAL aceita (validação do próximo 'pmove') */
  plat: { id: string; x: number; z: number; t: number; seq: number } | null;
}

export class PresidenteVargasRoom extends Room<{ state: WorldState }> {
  maxClients = Number(process.env.PV_MAX_CLIENTS ?? 600);
  maxMessagesPerSecond = 60;
  state = new WorldState();
  private rt = new Map<string, PlayerRT>();
  private clients2 = new Map<string, Client>();
  /** vaga original e ociosidade de cada veículo (só servidor) */
  private vehRT = new Map<string, { spawnX: number; spawnZ: number; spawnHeading: number; idleSince: number; vslot: number }>();
  /** grade espacial dos veículos (AOI e retorno à vaga) */
  private vgrid = new SpatialGrid(AOI_RADIUS / 2);
  private vehIds: string[] = [];
  private vehAcc = 0;
  private interactionPolicy: 'pacifico' | 'opcional' = 'opcional';
  private spawn = { x: -580, z: 280, heading: 1.75 };
  private tickN = 0;
  private crowdTable = new CrowdTable();
  private crowdSlots = new Int32Array(1024);
  /** grade espacial dos jogadores (reconstruída a cada tick): AOI, candidatos de impacto */
  private grid = new SpatialGrid(AOI_RADIUS / 2);
  private scratch = new InterestScratch();
  private aoiAdd: number[] = [];
  private aoiRem: number[] = [];
  /** slot → sessionId (slots livres = '') */
  private slotIds: string[] = [];
  /** slot → nid (mensagem "crowd") */
  private slotNid: number[] = [];
  private freeSlots: number[] = [];
  private nextNid = 1;
  private nids = new Set<number>();
  /** trio → passageiros em cima (sessionIds) */
  private riders = new Map<string, Set<string>>();
  /** veículos de evento (carro de som, trio): sólidos para quem anda e para os outros veículos */
  private eventVehIds: string[] = [];
  /** espectador aéreo: células agregadas (uma vez por período, compartilhadas) e estimativa de ambiente */
  private cellAgg!: CrowdCellAggregator;
  private cellAcc = 0;
  private cellSet: CellSet | null = null;
  private envBase: Omit<EnvModel, 'rallies'> = { rallyCrowd: 0, peds: 0, axis: [], pedRange: [0, 1] };
  private envFixed: EnvRally[] = [];
  private envKey = '';
  private envCells = new Map<number, number>();
  /** QA: conjuntos montados, mensagens/bytes de spec_cells enviados e tempo da última agregação */
  readonly cellStats = { sets: 0, sent: 0, bytes: 0, aggMs: 0 };

  messages = {
    move: (client: Client, raw: unknown) => this.gate(client, 'world.play', () => this.withNet(client, true, () => this.onMove(client, raw))),
    ping: (client: Client, t0: number) => { this.pres.heartbeat(client.sessionId, Date.now()); client.send('pong', [t0, Date.now()]); },
    // espectador: posição da câmera (centro da área de interesse), presa aos limites e com taxa limitada
    spec_cam: (client: Client, m: unknown) => this.onSpecCam(client, m),
    mode: (client: Client, m: Mode) => this.gate(client, 'world.play', () => this.onMode(client, m)),
    enter: (client: Client, m: { id: string; seq?: number } | string) => this.gate(client, 'vehicle.use', () => this.withNet(client, false, () => this.onEnter(client, typeof m === 'string' ? m : m?.id, typeof m === 'object' ? m?.seq : undefined))),
    exit: (client: Client, m?: { seq?: number }) => this.gate(client, 'vehicle.use', () => this.withNet(client, false, () => this.onExit(client, m?.seq))),
    push: (client: Client, target: string) => this.gate(client, 'push', () => this.withNet(client, false, () => this.onPush(client, target))),
    // ações sociais (emotes) e itens seguráveis: só ids pequenos — os outros clientes tocam a animação localmente
    act: (client: Client, m: { a?: unknown; v?: unknown }) => this.gate(client, 'action.perform', () => this.onAct(client, m)),
    prop: (client: Client, m: { p?: unknown; d?: unknown }) => this.gate(client, 'item.hold', () => this.onProp(client, m)),
    // trio elétrico: subir/descer pela escada e andar em cima (posição LOCAL no piso)
    board: (client: Client, m: { id?: unknown; seq?: number }) => this.gate(client, 'vehicle.use', () => this.withNet(client, false, () => this.onBoard(client, m))),
    unboard: (client: Client, m?: { seq?: number }) => this.gate(client, 'vehicle.use', () => this.withNet(client, false, () => this.onUnboard(client, m?.seq))),
    pmove: (client: Client, raw: unknown) => this.gate(client, 'world.play', () => this.withNet(client, true, () => this.onPlatformMove(client, raw))),
    appearance: (client: Client, opts: Partial<JoinOptions>) => {
      if (!this.allowed(client, 'profile.edit')) return;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      // conta: o pedido é só um AVISO "salvei" — a aparência e o grupo vêm do banco (PUT /api/me/appearance)
      const id = this.identities.get(client.sessionId);
      if (id?.userId) { void this.reloadLook(client.sessionId, id.userId); return; }
      if (opts) { this.applyAppearance(p, opts); this.graffiti.rename(client.sessionId, p.name); }
    },
    // pichação/grafite (server/src/graffiti): o desenho em andamento é local — só chega aqui o grafite pronto
    gf_new: (client: Client, m: unknown) => this.gate(client, 'graffiti.create', () => client.send('gf_res', this.graffiti.create(client.sessionId, m, this.gfAuthor(client.sessionId)))),
    gf_report: (client: Client, m: { i?: unknown; c?: unknown }) => this.gate(client, 'report.create', () => client.send('gf_res', this.graffiti.report(client.sessionId, m?.i, Date.now(), m?.c))),
    gf_admin: (client: Client, m: unknown) => client.send('gf_res', this.graffiti.adminMessage(client.sessionId, m)),
    // chat (server/src/chat): o serviço checa `chat.write`/`report.create` e responde chat_denied / chat_report_res
    chat_send: (client: Client, m: unknown) => { this.chat.send(client.sessionId, m); },
    chat_mute: (client: Client, m: unknown) => this.chat.mute(client.sessionId, m),
    chat_report: (client: Client, m: unknown) => { void this.chat.report(client.sessionId, m); },
  };

  /** chat: destinatários decididos aqui (PROXIMIDADE pela grade espacial `this.grid`), sem trabalho por tick */
  private chat!: ChatService;

  /** grafites: autoridade, interesse, moderação e persistência (JSON local em dev; PV_GRAFFITI_STORE=memory para testes) */
  private graffiti!: GraffitiService;
  private gfPos = (sid: string) => { const r = this.rt.get(sid); return r ? { x: r.last.x, z: r.last.z } : this.specs.get(sid)?.cam; };
  /** espectadores (server/src/spectator) — sem entidade, AOI pela câmera */
  private specs!: SpectatorSessions;
  /** presença em memória (server/src/presence) — nunca gravada por quadro */
  readonly pres = new PresenceTracker();
  /** conexões caídas em graça de reconexão: sessionId → desde quando + promessa do Colyseus (rejeitável) */
  private grace = new Map<string, { since: number; deferred: { reject: (e?: unknown) => void } }>();
  private metricsSource: WorldMetricsSource | null = null;
  private gfAuthor(sid: string) {
    const p = this.state.players.get(sid), r = this.rt.get(sid);
    return { x: r?.last.x ?? 0, z: r?.last.z ?? 0, ok: !!p && !!r && p.status === STATUS.OK && !p.vehicle };
  }

  onCreate(options: { eventId?: string } = {}) {
    const W = world();
    const ev = typeof options.eventId === 'string' && W.events.has(options.eventId) ? options.eventId : (process.env.PV_EVENT ?? W.defaultEvent);
    this.state.eventId = ev;
    this.interactionPolicy = W.events.get(ev)?.interaction === 'pacifico' ? 'pacifico' : 'opcional';
    this.state.seed = Number(process.env.PV_SEED ?? 20261015) >>> 0;
    const sp = W.manifest.spawn;
    this.spawn = { x: sp.p[0], z: sp.p[1], heading: Math.atan2(Math.cos(sp.yaw), Math.sin(sp.yaw)) };
    // veículos utilizáveis (mesmos ids do cliente)
    const allowed = new Set((W.events.get(ev)?.vehicles ?? []).map((v) => v.kind));
    // arte dos painéis dos veículos de evento: DADOS do evento (scenery.designs: id → chave de design)
    const designs = W.events.get(ev)?.scenery?.designs ?? {};
    for (const s of W.manifest.vehicleSpawns ?? []) {
      if (allowed.size && !allowed.has(s.kind)) continue;
      const v = new NetVehicle();
      v.kind = s.kind; v.x = s.x; v.z = s.z; v.y = 0; v.heading = s.heading; v.speed = 0; v.occupant = ''; v.state = VEHICLE_STATE.AVAILABLE;
      v.design = DESIGN_BY_KEY.get(designs[s.id] ?? '')?.id ?? 0;
      if (EVENT_VEHICLE_KINDS.has(s.kind)) this.eventVehIds.push(s.id);
      this.state.vehicles.set(s.id, v);
      this.vehRT.set(s.id, { spawnX: s.x, spawnZ: s.z, spawnHeading: s.heading, idleSince: Date.now(), vslot: this.vehIds.length });
      this.vehIds.push(s.id);
    }
    this.rebuildVehicleGrid();
    this.specs = new SpectatorSessions(W.manifest.bounds as [number, number, number, number]);
    const evDef = W.events.get(ev) as (Parameters<typeof environmentCrowdFor>[0] & { name?: string }) | undefined;
    this.setupCells(W, evDef);
    this.metricsSource = { counts: (now) => this.pres.counts(now), eventId: ev, eventName: evDef?.name ?? ev, environmentCrowd: environmentCrowdFor(evDef) };
    liveWorlds.add(this.metricsSource);
    const gfStore = process.env.PV_GRAFFITI_STORE === 'memory' ? new MemoryGraffitiStore() : new JsonFileGraffitiStore(process.env.PV_GRAFFITI_FILE ?? fileURLToPath(new URL('../data/graffiti.json', import.meta.url)));
    this.graffiti = new GraffitiService(W.graffitiSurfaces, gfStore, { radius: Number(process.env.PV_GRAFFITI_AOI ?? 120), adminToken: process.env.PV_ADMIN_TOKEN ?? '', onReport: (e) => this.gfReported(e) });
    void this.graffiti.init();
    this.chat = new ChatService({
      nidOf: (sid) => this.rt.get(sid)?.nid ?? 0,
      posOf: (sid) => { const r = this.rt.get(sid); return r ? { x: r.last.x, z: r.last.z } : undefined; },
      near: (x, z, r, fn) => this.grid.forEachInRadius(x, z, r, (sl) => { const sid = this.slotIds[sl]; if (sid) fn(sid); }),
      broadcast: (type, msg, except) => this.broadcast(type, msg, except.length ? { except: except.map((s) => this.clientBySid(s)).filter((c): c is Client => !!c) } : undefined),
      // mutar pela entidade: nid → conexão → conta (só o servidor conhece o userId)
      identityOfNid: (nid) => {
        for (const [sid, r] of this.rt) if (r.nid === nid) { const id = this.identities.get(sid); return id ? { sid, userId: id.userId, nickname: this.state.players.get(sid)?.name ?? id.nickname } : undefined; }
        return undefined;
      },
    }, { store: storeOrNull(), eventId: ev, secret: serverSecret() });
    liveMemorySweepers.add(this.chat);
    this.patchRate = 50; // 20 Hz
    this.setSimulationInterval((dt) => this.tick(dt), 100); // 10 Hz
    // suspensão/banimento/revogação feitos pela CLI (outro processo) chegam aqui por releitura periódica do banco
    this.clock.setInterval(() => void this.recheckIdentities(), IDENTITY_RECHECK_MS);
    const kinds: Record<string, number> = {};
    this.state.vehicles.forEach((v) => { kinds[v.kind] = (kinds[v.kind] ?? 0) + 1; });
    console.log(`[room] ${this.roomId} evento=${ev} (interação: ${this.interactionPolicy}) sem trânsito NPC · veículos ${JSON.stringify(kinds)} AOI=${AOI_RADIUS} m`);
  }

  /** conexão pelo sessionId (jogadores e espectadores) */
  private clientBySid(sid: string): Client | undefined { return this.clients2.get(sid) ?? this.clients.find((c) => c.sessionId === sid); }

  /** denúncia de grafite aceita → Report no banco (autor identificado internamente; nunca enviado a clientes) */
  private gfReported(e: GfReportEvent) {
    const store = storeOrNull();
    if (!store) return;
    void store.reports.create({
      reporterUserId: e.reporterUserId, targetUserId: e.author.userId ?? null, targetType: 'GRAFFITI', targetRef: `graffiti:${e.id}`,
      category: e.category, details: null, eventId: this.state.eventId || null, reportedNicknameAtTime: e.author.name || null,
      evidence: { kind: 'graffiti', graffitiId: e.id, surface: e.surface, authorName: e.author.name, authorUserId: e.author.userId ?? null, ...(e.author.userId ? {} : { authorClientId: e.author.clientId }), state: e.state, reports: e.reports, hasText: e.hasText, createdAt: new Date(e.createdAt).toISOString(), persistence: e.persistence },
    }).then((r) => console.log(`[graffiti] denúncia ${r.id} (${e.category}) do grafite #${e.id}`))
      .catch((err) => console.warn(`[graffiti] falha ao gravar denúncia: ${(err as Error).message}`));
  }

  async onDispose() {
    if (this.metricsSource) liveWorlds.delete(this.metricsSource);
    if (this.chat) liveMemorySweepers.delete(this.chat);
    await this.graffiti?.flushStore();
  }

  /** mede a codificação/envio dos patches (StateView por cliente): é o custo que cresce com a multidão */
  broadcastPatch() {
    const t0 = performance.now();
    const r = super.broadcastPatch();
    metrics.patch(performance.now() - t0);
    return r;
  }

  // ---------------------------------------------------------------- rede adversa (dev)
  private withNet(client: Client, droppable: boolean, fn: () => void) {
    metrics.msgIn(client.sessionId);
    if (!SIM_JITTER && !SIM_LOSS) return fn();
    if (droppable && Math.random() < SIM_LOSS) return; // perde (movimento: o próximo compensa)
    const r = this.rt.get(client.sessionId);
    const due = Math.max(Date.now() + Math.random() * SIM_JITTER, r?.pendingIn ?? 0); // TCP: preserva ordem
    if (r) r.pendingIn = due;
    setTimeout(fn, due - Date.now());
  }

  // ---------------------------------------------------------------- ciclo
  private tick(dtMs: number) {
    const t0 = performance.now();
    const now = Date.now();
    const dt = dtMs / 1000;
    this.state.serverTime = now;
    void dt;
    // recuperação de quedas
    for (const [id, r] of this.rt) {
      const p = this.state.players.get(id);
      if (!p) continue;
      if (p.status === STATUS.DOWN && now >= (r.actor.lastDown ?? 0) + RULES.downMs) { p.status = STATUS.GETUP; r.actor.status = STATUS.GETUP; }
      if (p.status === STATUS.GETUP && now >= (r.actor.lastDown ?? 0) + RULES.downMs + RULES.getupMs) {
        p.status = STATUS.OK; r.actor.status = STATUS.OK;
        r.actor.immuneUntil = now + RULES.immuneMs;
        if (r.rest) { r.last = { x: r.rest.x, y: 0, z: r.rest.z, t: now, seq: r.last.seq }; r.rest = null; }
      }
    }
    // ações `once` que terminaram; quem caiu perde a ação
    for (const [id, r] of this.rt) {
      const p = this.state.players.get(id);
      if (!p || p.act === 0) continue;
      if (p.status !== STATUS.OK || onceFinished(r.social, now)) this.setAct(p, r, 0, now);
    }
    // grade espacial (O(N)) — base de todas as consultas de vizinhança
    this.rebuildGrid();
    // área de interesse (fatiada: cada cliente a 5 Hz) e multidão distante (fatiada: cada cliente a CROWD_HZ)
    this.tickN++;
    this.updateInterest(this.tickN % AOI_SLICES, AOI_SLICES);
    if (CROWD_HZ > 0) { const tc = performance.now(); this.sendCrowd(this.tickN % CROWD_SLICES, CROWD_SLICES); metrics.crowd(performance.now() - tc); }
    // espectador aéreo: células agregadas a CROWD_CELL.hz — só se alguém está em FAR/AGGREGATE (ou acabou de sair)
    this.cellAcc += dtMs;
    if (this.cellAcc >= 1000 / CROWD_CELL.hz) { this.cellAcc = 0; this.sendCells(now); }
    // veículos: grade (AOI) e retorno à vaga dos abandonados (1 Hz)
    this.vehAcc += dtMs;
    if (this.vehAcc >= 1000) { this.vehAcc = 0; this.rebuildVehicleGrid(); this.resetAbandoned(now); }
    // grafites: área de interesse por superfície (fatiada, 2 Hz por cliente) e expiração (1 Hz)
    this.graffiti.update(now, this.gfPos);
    metrics.tick(performance.now() - t0, this.state.players.size);
  }

  private rebuildVehicleGrid() {
    this.vgrid.clear();
    this.state.vehicles.forEach((v, id) => { const rt = this.vehRT.get(id); if (rt) this.vgrid.insert(rt.vslot, v.x, v.z); });
  }

  /** veículo deixado longe da vaga, sem ninguém por perto há VEH_RESET_MS → RESETTING (1 s) → volta à vaga, AVAILABLE */
  private resetAbandoned(now: number) {
    this.state.vehicles.forEach((v, id) => {
      const rt = this.vehRT.get(id);
      if (!rt) return;
      if (v.state === VEHICLE_STATE.RESETTING) {
        v.x = rt.spawnX; v.z = rt.spawnZ; v.heading = rt.spawnHeading; v.speed = 0; v.y = 0;
        v.state = VEHICLE_STATE.AVAILABLE; rt.idleSince = now;
        console.log(`[room] veículo ${id} voltou para a vaga`);
        return;
      }
      let nearest = Infinity;
      this.grid.forEachInRadius(v.x, v.z, RULES.vehicleResetClearM, (_sl, d) => { nearest = Math.min(nearest, d); });
      if (shouldResetVehicle({ occupant: v.occupant, x: v.x, z: v.z, spawnX: rt.spawnX, spawnZ: rt.spawnZ, idleSince: rt.idleSince }, now, nearest, VEH_RESET_MS)) {
        v.state = VEHICLE_STATE.RESETTING;
      }
    });
  }

  private rebuildGrid() {
    this.grid.clear();
    for (const r of this.rt.values()) { const p = this.state.players.get(r.actor.id); if (p) this.grid.insert(r.slot, p.x, p.z); }
  }

  /**
   * Área de interesse por cliente via grade espacial: só visita as células a ≤ R × histerese (não N×N).
   * Mesma regra de antes (entra a ≤ R, sai além de R × 1,15) + limite AOI_MAX dos mais próximos;
   * quem fica de fora do limite vai para a multidão distante.
   */
  private updateInterest(phase = 0, slices = 1, only?: string) {
    const t0 = performance.now();
    for (const [id, r] of this.rt) {
      if (only ? id !== only : r.slot % slices !== phase) continue;
      const me = this.state.players.get(id);
      if (!me) continue;
      this.interestAt(r, me.x, me.z, me.vehicle || me.platform); // o veículo em uso / o trio em que está em cima fica sempre na vista
    }
    // espectadores: mesma regra, centrada na câmera (sem slot na grade: ninguém os vê)
    for (const sp of this.specs.values()) {
      if (only ? sp.sid !== only : sp.slot % slices !== phase) continue;
      const high = sp.tier === 'FAR' || sp.tier === 'AGGREGATE';
      this.interestAt(sp, sp.cam.x, sp.cam.z, '', SpectatorSessions.aoiRadius(sp, AOI_RADIUS), high ? this.eventVehIds : undefined);
    }
    metrics.aoi(performance.now() - t0);
  }

  /** área de interesse de um observador (jogador ou espectador) num ponto */
  private interestAt(r: { slot: number; inView: SlotView; vehInView: Set<string>; view: StateView; aoiCap: number; overflow: number[] }, x: number, z: number, own: string, radius = AOI_RADIUS, keepVeh?: readonly string[]) {
    selectInterestSlots(this.grid, r.slot, x, z, r.inView, { radius, hysteresis: AOI_HYST, cap: r.aoiCap }, this.scratch, this.aoiAdd, this.aoiRem, r.overflow);
    for (const sl of this.aoiAdd) { const p = this.state.players.get(this.slotIds[sl]); if (p) r.view.add(p); }
    for (const sl of this.aoiRem) { const p = this.state.players.get(this.slotIds[sl]); if (p) r.view.remove(p); }
    // veículos: mesma grade espacial (só células próximas); o do próprio jogador fica sempre
    const vc: { item: string; d: number }[] = [];
    this.vgrid.forEachInRadius(x, z, radius * AOI_HYST, (vs, d) => vc.push({ item: this.vehIds[vs], d }));
    // espectador no alto: veículos de evento (trio, carros de som) ficam na vista — poucos, marcam a passeata
    let always: Set<string> | undefined = own ? new Set([own]) : undefined;
    if (keepVeh?.length) {
      always = new Set([...(always ?? []), ...keepVeh]);
      for (const id of keepVeh) if (!vc.some((c) => c.item === id)) vc.push({ item: id, d: Infinity });
    }
    const vr = selectInterest({ candidates: vc, inView: r.vehInView, radius, hysteresis: AOI_HYST, always });
    for (const vid of vr.add) { const v = this.state.vehicles.get(vid); if (v) { r.view.add(v); r.vehInView.add(vid); } }
    for (const vid of vr.remove) { const v = this.state.vehicles.get(vid); if (v) r.view.remove(v); r.vehInView.delete(vid); }
  }

  /**
   * multidão distante: posições compactas (binário) dos jogadores na área mas fora do limite detalhado.
   * Cada jogador é codificado uma vez (tabela por slot); cada mensagem é só cópia de bytes.
   */
  private sendCrowd(phase: number, slices: number) {
    let any = false;
    for (const r of this.rt.values()) if (r.slot % slices === phase && (r.overflow.length || r.crowdKnown.size)) { any = true; break; }
    if (!any) for (const r of this.specs.values()) if (r.slot % slices === phase && (r.overflow.length || r.crowdKnown.size)) { any = true; break; }
    if (!any) return;
    const now = Date.now();
    for (const r of this.rt.values()) {
      const p = this.state.players.get(r.actor.id);
      if (p) this.crowdTable.set(r.slot, { nid: r.nid, x: p.x, y: p.y, z: p.z, heading: p.heading, speed: p.speed, body: BODY_INDEX[p.body] ?? 0, status: p.status, vehicle: !!p.vehicle, social: { act: p.act, ageS: (now - p.actAt) / 1000, prop: p.prop, design: p.design }, app: { skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom } });
    }
    for (const [id, r] of this.rt) {
      if (r.slot % slices !== phase) continue;
      const c = this.clients2.get(id);
      if (c) this.crowdTo(c, r);
    }
    for (const sp of this.specs.values()) if (sp.slot % slices === phase) this.crowdTo(sp.client, sp);
  }

  /** mensagem "crowd" para um observador (jogador ou espectador) */
  private crowdTo(c: Client, r: { overflow: number[]; crowdKnown: Set<number>; inView: SlotView }) {
    if (!r.overflow.length && !r.crowdKnown.size) return;
    if (this.crowdSlots.length < r.overflow.length) this.crowdSlots = new Int32Array(r.overflow.length * 2);
    let n = 0;
    for (const sl of r.overflow) {
      if (n >= CROWD_MAX) break;
      if (!this.slotIds[sl] || r.inView.has[sl]) continue;
      this.crowdSlots[n++] = sl;
    }
    if (SIM_LOSS && Math.random() < SIM_LOSS) return;
    const known = r.crowdKnown;
    const slotNid = this.slotNid;
    const buf = this.crowdTable.build(this.crowdSlots, n, (sl) => {
      const nid = slotNid[sl];
      if (known.has(nid)) return false;
      known.add(nid);
      return true;
    });
    c.send('crowd', buf); // lista vazia também vai: o cliente remove quem saiu
    if (!n) known.clear();
  }

  private allocSlot(id: string): number {
    const sl = this.freeSlots.length ? this.freeSlots.pop()! : this.slotIds.length;
    this.slotIds[sl] = id;
    return sl;
  }

  private allocNid(): number {
    for (let i = 0; i < 65535; i++) {
      const n = this.nextNid;
      this.nextNid = this.nextNid >= 65535 ? 1 : this.nextNid + 1;
      if (!this.nids.has(n)) { this.nids.add(n); return n; }
    }
    return 0;
  }

  // ---------------------------------------------------------------- jogadores
  /** aparência sempre pelo validador ÚNICO (src/characters/validateAppearance.ts — o mesmo da API) */
  private applyAppearance(p: NetPlayer, o: Partial<JoinOptions> | CharacterAppearance) {
    const cur = p.body ? validateAppearance({
      body: p.body, skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, accessory: p.accessory, acc: p.acc,
      topStyle: p.topStyle, bottomStyle: p.bottomStyle, shoeStyle: p.shoeStyle, hairStyle: p.hairStyle, shirtDesign: p.shirtDesign,
    }) : null;
    const a = validateAppearance(o, cur ?? DEFAULT_PLAYER_APPEARANCE.homem)!;
    p.body = a.body; p.skin = a.skin; p.hair = a.hair; p.top = a.top; p.bottom = a.bottom; p.shoes = a.shoes;
    p.accessory = a.accessory ?? 'nenhum'; p.acc = a.acc ?? 0x222222;
    p.topStyle = a.topStyle ?? ''; p.bottomStyle = a.bottomStyle ?? ''; p.shoeStyle = a.shoeStyle ?? ''; p.hairStyle = a.hairStyle ?? '';
    p.shirtDesign = a.shirtDesign ?? 0;
    if ('name' in o && o.name !== undefined) p.name = sanitizeName(o.name);
  }

  /** aparência salva + grupo do evento das contas, carregados no onAuth (sessionId → dados do banco) */
  private savedLooks = new Map<string, { appearance: CharacterAppearance; groupKey: string | null }>();

  /** recarrega do banco aparência e grupo de uma conta já na sala (depois de salvar no editor) */
  private async reloadLook(sid: string, userId: string) {
    const look = await loadPlayerLook(services().store, userId, this.state.eventId).catch(() => null);
    const p = this.state.players.get(sid), id = this.identities.get(sid);
    if (!look || !p || !id || id.userId !== userId) return;
    this.applyAppearance(p, look.appearance);
    id.groupKey = look.groupKey;
  }

  /** identidade resolvida pelo SERVIDOR (ticket → conta; sem ticket → espectador) — ver server/src/identity */
  readonly identities = new Map<string, RoomIdentity>();

  async onAuth(_client: Client, options: JoinOptions) {
    try {
      const id: RoomIdentity = await resolveIdentity(services(), options, this.state.eventId);
      // servidor de TESTE: bot de carga / conta fictícia para QA (ignorado em produção — server/src/presence/testJoin.ts)
      const tf = testJoinFlags(options);
      if (tf.bot && id.role === 'player') id.bot = true;
      if (tf.testUser && !id.userId) { id.userId = `test:${tf.testUser}`; id.test = true; } // conta fictícia: fora da releitura do banco
      if (id.userId && !id.test) {
        const look = await loadPlayerLook(services().store, id.userId, this.state.eventId);
        this.savedLooks.set(_client.sessionId, look);
        id.groupKey = look.groupKey;
      }
      return id;
    } catch (e) {
      if (e instanceof JoinRefused) throw new Error(e.reason);
      throw e;
    }
  }

  private rechecking = false;
  /** relê contas conectadas (server/src/identity/recheck.ts): atualiza o estado ou desconecta (4002 rebaixado / 4003 banido) */
  private async recheckIdentities() {
    if (this.rechecking || !this.identities.size) return;
    this.rechecking = true;
    try {
      for (const a of await recheckIdentities(services(), this.identities, this.state.eventId)) {
        if (!this.identities.has(a.sessionId)) continue;
        this.identities.set(a.sessionId, a.identity); // gate() passa a negar já, antes da desconexão
        if (a.kind !== 'update') this.clients.getById(a.sessionId)?.leave(a.kind === 'kick' ? CLOSE_BANNED : CLOSE_DOWNGRADED);
      }
    } catch (e) { console.warn('[room] releitura de identidades falhou', (e as Error).message); }
    finally { this.rechecking = false; }
  }

  /** pode? (política central src/access/policy.ts, com o papel desta conexão) */
  allowed(client: Client, cap: Capability): boolean {
    const id = this.identities.get(client.sessionId);
    return !!id && can(id.state, cap, id.role);
  }

  /** executa a mensagem só se a conexão tem a capacidade; senão responde `denied` (espectador, sem licença, suspenso) */
  private gate(client: Client, cap: Capability, fn: () => void) {
    if (this.allowed(client, cap)) { this.pres.activity(client.sessionId, Date.now()); fn(); }
    else client.send('denied', { cap });
  }

  // ---------------------------------------------------------------- espectador (server/src/spectator)
  /** espectador: entra no MESMO mundo sem corpo; área de interesse pela câmera (spec_cam) */
  protected joinSpectator(client: Client, _id: RoomIdentity, options: JoinOptions) {
    const slot = this.allocSlot(client.sessionId);
    const o = options as JoinOptions & { specCam?: { x?: unknown; z?: unknown; alt?: unknown } }; // vem do cliente: validado abaixo
    const start = o?.specCam && Number.isFinite(o.specCam.x) && Number.isFinite(o.specCam.z) ? { x: o.specCam.x as number, z: o.specCam.z as number, alt: o.specCam.alt } : { x: this.spawn.x, z: this.spawn.z };
    const sp = this.specs.add(client, slot, start, clientCap(options?.aoiMax));
    this.slotNid[slot] = 0;
    client.view = sp.view;
    this.graffiti.join(client.sessionId, 'Espectador', sanitizeClientId(options?.cid, client.sessionId), client);
    this.updateInterest(0, 1, client.sessionId);
    this.graffiti.update(Date.now(), this.gfPos, client.sessionId);
    this.pres.enterWorld(client.sessionId, Date.now());
    client.send('spawn', { x: sp.cam.x, y: 0, z: sp.cam.z, heading: this.spawn.heading, sessionId: client.sessionId, policy: this.interactionPolicy, seed: this.state.seed, role: 'spectator' });
    // entrou já no alto: o `full` sai no próximo período de células (≤ 1 s) — antes disso o cliente nem registrou a mensagem
    console.log(`[room] espectador ${client.sessionId} — ${this.specs.size} assistindo`);
  }

  /** espectador sai sem deixar entidade (e sem graça de reconexão: o cliente simplesmente entra de novo) */
  protected leaveSpectator(client: Client) {
    const sp = this.specs.remove(client.sessionId);
    if (sp) { this.slotIds[sp.slot] = ''; this.freeSlots.push(sp.slot); }
    this.graffiti.leave(client.sessionId);
    this.pres.leave(client.sessionId);
  }

  private onSpecCam(client: Client, m: unknown) {
    const now = Date.now();
    this.pres.heartbeat(client.sessionId, now);
    const sp = this.specs.get(client.sessionId), before = sp?.tier;
    if (this.specs.onCam(client.sessionId, m, now) !== 'ok' || !sp) return;
    this.pres.activity(client.sessionId, now);
    if (sp.tier === before) return;
    // trocou de camada: AOI e células já (sem esperar a fatia / o próximo período)
    this.updateInterest(0, 1, sp.sid);
    this.cellsTo(sp, this.currentCells(now), now);
  }

  // ---------------------------------------------------------------- espectador aéreo: células (rodada 8.1)
  /** estimativa de ambiente pelos DADOS do evento: concentrações fixas (palco, caminhões) + veículos de evento (andam) */
  private setupCells(W: ServerWorld, ev: { social?: { rallyCrowd?: number }; npcs?: { pedestrianDensity?: number } } | undefined) {
    this.cellAgg = new CrowdCellAggregator(this.state.seed);
    const c0 = W.zones.find((z) => z.id === 'CENTRAL')?.from ?? 0.18;
    this.envBase = {
      rallyCrowd: Math.max(0, Math.round(ev?.social?.rallyCrowd ?? 0)),
      peds: ev ? Math.max(0, Math.round(PEDESTRIAN_ESTIMATE * (ev.npcs?.pedestrianDensity ?? 1))) : 0,
      axis: (W.manifest.pvAxis ?? []) as [number, number][], pedRange: [c0, 1],
    };
    this.envFixed = [];
    for (const sp of W.manifest.eventSpots ?? []) {
      if (sp.kind === 'stage') { const S = RALLY_SHAPE.stage; this.envFixed.push({ x: sp.x + Math.sin(sp.heading) * S.front, z: sp.z + Math.cos(sp.heading) * S.front, inner: S.inner, radius: S.radius, strength: S.strength }); }
      else if (sp.kind === 'truck') { const T = RALLY_SHAPE.truck; this.envFixed.push({ x: sp.x, z: sp.z, inner: T.inner, radius: T.radius, strength: T.strength }); }
    }
  }

  /** ambiente por célula — recalculado só quando um veículo de evento anda ≥ 1 m */
  private environment(): Map<number, number> {
    const rallies = [...this.envFixed];
    let key = '';
    for (const id of this.eventVehIds) {
      const v = this.state.vehicles.get(id);
      const sh = v && (v.kind === 'trio' || v.kind === 'soundcar') ? RALLY_SHAPE[v.kind] : null;
      if (!v || !sh) continue;
      rallies.push({ x: Math.round(v.x), z: Math.round(v.z), inner: sh.inner, radius: sh.radius, strength: sh.strength });
      key += `${id}:${Math.round(v.x)},${Math.round(v.z)};`;
    }
    if (key !== this.envKey || !this.envCells.size) { this.envKey = key; this.envCells = environmentCells({ ...this.envBase, rallies }); }
    return this.envCells;
  }

  /** conjunto de células do período (montado UMA vez por período, compartilhado por todos os espectadores) */
  private currentCells(now: number): CellSet {
    if (this.cellSet && now - this.cellSet.t < 1000 / CROWD_CELL.hz - 50) return this.cellSet;
    const players: CellPlayer[] = [];
    for (const [sid, p] of this.state.players) {
      const act = p.vehicle ? 3 : p.act ? 2 : (p.speed > 0.3 || p.loco > 0) ? 1 : 0;
      players.push({ x: p.x, z: p.z, group: this.identities.get(sid)?.groupKey ?? '', activity: act });
    }
    this.cellSet = this.cellAgg.build(players, this.environment(), now);
    this.cellStats.sets++;
    this.cellStats.aggMs = +this.cellAgg.stats.ms.toFixed(3);
    return this.cellSet;
  }

  /** CROWD_CELL.hz: células para quem está no alto (FAR/AGGREGATE); quem desceu já recebeu a mensagem vazia `full` */
  private sendCells(now: number) {
    let any = false;
    for (const sp of this.specs.values()) if (sp.tier === 'FAR' || sp.tier === 'AGGREGATE') { any = true; break; }
    if (!any) return;
    const set = this.currentCells(now);
    for (const sp of this.specs.values()) if (sp.tier === 'FAR' || sp.tier === 'AGGREGATE') this.cellsTo(sp, set, now);
  }

  private cellsTo(sp: SpectatorSession, set: CellSet, now: number) {
    const m = sp.feed.next(set, sp.cam, now);
    if (!m) return;
    const buf = encodeCells(m, this.cellAgg.epoch, set.t);
    this.cellStats.sent++; this.cellStats.bytes += buf.byteLength;
    sp.client.send('spec_cells', buf);
  }

  onJoin(client: Client, options: JoinOptions, auth?: RoomIdentity) {
    const id = auth ?? { userId: null, authSessionId: null, nickname: sanitizeName(options?.name), state: 'PLAYER', grant: 'NONE', role: 'player', groupKey: null, test: true } as RoomIdentity;
    // TESTE (PV_TEST=1): grupo do jogador anônimo para QA do canal GRUPO; contas reais vêm do EventMembership
    if (id.test && process.env.PV_TEST === '1' && typeof options?.testGroup === 'string') id.groupKey = options.testGroup.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || null;
    this.identities.set(client.sessionId, id);
    this.pres.join(client.sessionId, { userId: id.userId, role: id.role, bot: !!id.bot }, Date.now());
    this.chat.join(client.sessionId, id, client); // todas as conexões (espectador lê o GERAL)
    if (id.role === 'spectator') { this.savedLooks.delete(client.sessionId); this.joinSpectator(client, id, options); return; }
    // login duplicado: UMA entidade jogável por conta — a sessão nova assume (a antiga recebe session_replaced)
    const taken = id.userId ? this.takeOver(id.userId, client.sessionId) : null;
    const p = new NetPlayer();
    // apelido: da CONTA (o cliente não escolhe o nome exibido); anônimo só em servidor de teste
    p.name = id.test ? sanitizeName(options?.name) : id.nickname;
    // conta: aparência do BANCO (as opções do cliente são ignoradas); anônimo de teste: opções validadas
    const saved = this.savedLooks.get(client.sessionId);
    this.savedLooks.delete(client.sessionId);
    this.applyAppearance(p, id.userId ? (saved?.appearance ?? DEFAULT_PLAYER_APPEARANCE.homem) : (options ?? {}));
    const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 5;
    p.x = this.spawn.x + Math.cos(a) * rr;
    p.z = this.spawn.z + Math.sin(a) * rr;
    // spawn nunca dentro de parede: se o ponto sorteado cruza parede a partir do spawn, usa o spawn
    if (world().walls.raycast(this.spawn.x, 0.6, this.spawn.z, p.x, 0.6, p.z) < 1) { p.x = this.spawn.x; p.z = this.spawn.z; }
    // modo de TESTE (PV_TEST=1, nunca em produção): spawn escolhido para cenas reproduzíveis de QA.
    // As regras de autoridade continuam idênticas a partir daí.
    const ts = options?.testSpawn;
    if (process.env.PV_TEST === '1' && ts && Number.isFinite(ts.x) && Number.isFinite(ts.z)) { p.x = ts.x; p.z = ts.z; }
    if (taken) { p.x = taken.x; p.z = taken.z; } // sessão assumida: continua de onde a outra estava
    p.y = 0; p.heading = taken?.heading ?? this.spawn.heading; p.loco = 0; p.vehicle = ''; p.platform = ''; p.interaction = 'pacifico'; p.status = STATUS.OK;
    p.link = LINK_WIRE.CONNECTED;
    p.nid = this.allocNid();
    this.state.players.set(client.sessionId, p);
    const view = new StateView();
    client.view = view;
    const r: PlayerRT = {
      actor: { id: client.sessionId, x: p.x, z: p.z, heading: p.heading, mode: 'pacifico', status: 0, vehicle: '', immuneUntil: 0, lastActionAt: -1e12, actionTimes: [], lastDown: 0 },
      last: { x: p.x, y: p.y, z: p.z, t: Date.now(), seq: -1 },
      view, inView: makeSlotView(), vehInView: new Set(), rest: null, pendingIn: 0,
      nid: p.nid, overflow: [], crowdKnown: new Set(), slot: this.allocSlot(client.sessionId),
      aoiCap: clientCap(options?.aoiMax),
      social: { act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [] },
      plat: null,
    };
    if (taken?.prop) { r.social.prop = taken.prop; r.social.design = taken.design; p.prop = taken.prop; p.design = taken.design; } // item na mão vem junto
    this.slotNid[r.slot] = p.nid;
    this.rt.set(client.sessionId, r);
    this.clients2.set(client.sessionId, client);
    this.grid.insert(r.slot, p.x, p.z);
    this.updateInterest(0, 1, client.sessionId); // só o novo cliente; os demais o encontram na sua fatia
    this.graffiti.join(client.sessionId, p.name, sanitizeClientId(options?.cid, client.sessionId), client, id.userId);
    this.graffiti.update(Date.now(), this.gfPos, client.sessionId); // quem entra já recebe os grafites próximos
    client.send('spawn', { x: p.x, y: p.y, z: p.z, heading: p.heading, sessionId: client.sessionId, policy: this.interactionPolicy, seed: this.state.seed, role: 'player', ...(taken ? { takeover: true } : {}) });
    this.pres.enterWorld(client.sessionId, Date.now());
    metrics.join(client.sessionId);
    console.log(`[room] entrou ${client.sessionId} (${p.name}, ${p.body})${taken ? ' — assumiu a sessão anterior da conta' : ''} — total ${this.state.players.size}`);
  }

  /**
   * Login duplicado (rodada 8): a sessão NOVA assume. A antiga (conectada ou em graça) perde a entidade AGORA — antes
   * de a nova ser criada, então nunca há duas — recebe `session_replaced` e é fechada sem reconexão automática.
   * Posição e item na mão passam para a nova; veículo/trio são liberados (a nova começa a pé ao lado).
   * Abas de ESPECTADOR da mesma conta não são afetadas.
   */
  private takeOver(userId: string, newSid: string): { x: number; z: number; heading: number; prop: number; design: number } | null {
    let out: { x: number; z: number; heading: number; prop: number; design: number } | null = null;
    for (const [sid, other] of [...this.identities]) {
      if (sid === newSid || other.role !== 'player' || other.userId !== userId) continue;
      const p = this.state.players.get(sid);
      if (p) {
        let x = p.x, z = p.z;
        if (p.vehicle || p.platform) {
          // estava num veículo / em cima do trio: começa a pé ao lado, sem atravessar parede
          const t = { x: p.x + Math.cos(p.heading) * 3.5, z: p.z - Math.sin(p.heading) * 3.5 };
          if (world().walls.raycast(p.x, 0.6, p.z, t.x, 0.6, t.z) >= 1) { x = t.x; z = t.z; } else { x = this.spawn.x; z = this.spawn.z; }
          const o = this.pushOutOfEventVehicles(x, z);
          if (o) { x = o.x; z = o.z; }
        }
        out = { x, z, heading: p.heading, prop: p.prop, design: p.design };
      }
      const old = this.clients2.get(sid);
      const g = this.grace.get(sid);
      this.identities.delete(sid); // a partir daqui toda mensagem da antiga é negada e o onLeave dela é inócuo
      this.removePlayer(sid);
      if (g) { this.grace.delete(sid); g.deferred.reject(new Error('session_replaced')); }
      if (old) { old.send('session_replaced', { reason: 'outra_sessao' }); old.leave(RECONNECT.replacedCloseCode, 'session_replaced'); }
      console.log(`[room] sessão ${sid} substituída por ${newSid} (mesma conta)`);
    }
    return out;
  }

  // ---------------------------------------------------------------- reconexão (src/net/reconnect.ts)
  /**
   * queda sem consentimento: jogador fica no mundo em DISCONNECTED_GRACE por GRACE_S — congelado (parado, sem ação
   * em curso; veículo/trio/item mantidos) e marcado (`link = 1`); a mesma conexão volta pelo token de reconexão do
   * Colyseus e recupera a MESMA entidade. Vencido o prazo, o Colyseus chama onLeave → entidade removida (sem fantasma).
   */
  async onDrop(client: Client) {
    const id = this.identities.get(client.sessionId);
    if (!id) return; // sessão substituída: sai de vez
    if (id.role === 'spectator') return; // espectador não tem entidade: sai e o cliente entra de novo
    if (!can(id.state, 'world.play', id.role)) return; // expulso/rebaixado pelo servidor (releitura): sem graça
    const p = this.state.players.get(client.sessionId), r = this.rt.get(client.sessionId);
    const now = Date.now();
    if (p && r) {
      p.link = LINK_WIRE.GRACE; p.speed = 0; p.loco = 0;
      if (p.act) this.setAct(p, r, 0, now);
      const v = p.vehicle ? this.state.vehicles.get(p.vehicle) : undefined;
      if (v) v.speed = 0;
    }
    this.clients2.delete(client.sessionId);
    this.graffiti.leave(client.sessionId);
    this.chat.leave(client.sessionId); // volta no onReconnect (o anti-flood por conta continua)
    this.pres.drop(client.sessionId);
    console.log(`[room] caiu ${client.sessionId} — em graça por ${GRACE_S} s`);
    try {
      const deferred = this.allowReconnection(client, GRACE_S);
      this.grace.set(client.sessionId, { since: now, deferred: deferred as unknown as { reject: (e?: unknown) => void } });
      await deferred;
    } catch { /* prazo vencido ou substituída: o Colyseus segue para onLeave */ }
  }

  onReconnect(client: Client) {
    const sid = client.sessionId;
    this.grace.delete(sid);
    const p = this.state.players.get(sid), r = this.rt.get(sid), id = this.identities.get(sid);
    if (!p || !r || !id) return;
    const now = Date.now();
    p.link = LINK_WIRE.CONNECTED;
    this.clients2.set(sid, client);
    r.crowdKnown.clear(); // as aparências da multidão distante voltam a ser enviadas
    r.last.t = now; // a validação de velocidade recomeça agora (o cliente volta para a posição do servidor)
    this.graffiti.join(sid, p.name, sanitizeClientId(undefined, sid), client);
    this.graffiti.update(now, this.gfPos, sid); // grafites próximos de novo
    this.chat.join(sid, id, client);
    this.updateInterest(0, 1, sid);
    this.pres.resume(sid, now);
    // estado autoritativo para o cliente retomar (posição segura do servidor, veículo/trio, item)
    client.send('resume', { x: p.x, y: p.y, z: p.z, heading: p.heading, vehicle: p.vehicle || '', platform: p.platform || '', plx: p.plx ?? 0, plz: p.plz ?? 0, prop: p.prop ?? 0, design: p.design ?? 0, seq: r.last.seq });
    console.log(`[room] reconectou ${sid} (mesma entidade)`);
  }

  onLeave(client: Client) {
    const ident = this.identities.get(client.sessionId);
    this.identities.delete(client.sessionId);
    this.grace.delete(client.sessionId);
    this.pres.leave(client.sessionId);
    this.chat.leave(client.sessionId);
    this.savedLooks.delete(client.sessionId);
    if (ident?.role === 'spectator') { this.leaveSpectator(client); return; }
    this.removePlayer(client.sessionId);
  }

  /** remove a entidade de um jogador (saída, graça vencida, sessão substituída) — idempotente */
  private removePlayer(sid: string) {
    const p = this.state.players.get(sid);
    if (p?.vehicle) {
      const v = this.state.vehicles.get(p.vehicle);
      if (v && v.occupant === sid) { v.occupant = ''; v.speed = 0; v.state = VEHICLE_STATE.AVAILABLE; const rt = this.vehRT.get(p.vehicle); if (rt) rt.idleSince = Date.now(); }
    }
    if (p?.platform) this.riders.get(p.platform)?.delete(sid);
    const leaving = this.rt.get(sid);
    if (leaving) {
      const { nid, slot } = leaving;
      if (nid) this.nids.delete(nid);
      // slot e nid podem ser reaproveitados: ninguém pode continuar "vendo" o antigo dono
      for (const r of [...this.rt.values(), ...this.specs.values()]) {
        r.crowdKnown.delete(nid);
        if (r.inView.has[slot]) { r.inView.has[slot] = 0; r.inView.list = r.inView.list.filter((x) => x !== slot); }
      }
      this.grid.remove(slot);
      this.slotIds[slot] = '';
      this.freeSlots.push(slot);
    }
    this.graffiti.leave(sid);
    const existed = this.state.players.delete(sid);
    this.rt.delete(sid);
    this.clients2.delete(sid);
    if (existed) { metrics.leave(sid); console.log(`[room] saiu ${sid} — total ${this.state.players.size}`); }
  }

  private onMove(client: Client, raw: unknown) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    const m = unpackMove(raw);
    if (!p || !r || !m) return;
    if (m.seq <= r.last.seq) return; // fora de ordem/duplicada
    if (p.status !== STATUS.OK) { r.last.seq = m.seq; return; } // caído: servidor ignora (posição de repouso é do servidor)
    if (p.platform) { r.last.seq = m.seq; return; } // em cima do trio: só vale 'pmove' (local); o mundo é do trio
    const veh = p.vehicle ? this.state.vehicles.get(p.vehicle) : undefined;
    const mode: MoveMode = veh ? (veh.kind as MoveMode) : 'foot'; // modo vem do SERVIDOR, não do cliente
    const now = Date.now();
    const res = validateMoveInWorld(world().walls, r.last, { ...m, mode }, now);
    const dtS = Math.max(0.05, (now - r.last.t) / 1000);
    const measured = Math.hypot(res.x - r.last.x, res.z - r.last.z) / dtS;
    const prevX = r.last.x, prevZ = r.last.z;
    if (veh) {
      // MODO PACÍFICO: veículo não atravessa nem derruba ninguém — para antes de encostar (validado aqui)
      const blk = this.vehicleBlockers(client.sessionId, veh.kind as VehicleKind, prevX, prevZ, res.x, res.z);
      if (blk.length) {
        const b = vehicleBlock(veh.kind as VehicleKind, { x: prevX, z: prevZ }, { x: res.x, z: res.z }, m.heading, blk);
        if (b.blocked) { res.x = b.x; res.z = b.z; res.ok = false; res.reason = 'bloqueado'; }
      }
      // trio/carro de som são sólidos para os outros veículos (e vice-versa): não atravessa, para encostado
      if (this.vehicleOverlap(p.vehicle, veh.kind, prevX, prevZ, veh.heading, res.x, res.z, m.heading)) { res.x = prevX; res.z = prevZ; res.ok = false; res.reason = 'bloqueado'; }
    } else {
      // a pé: a carroceria do trio/carro de som é sólida (mesma regra da colisão local, com folga menor)
      const o = this.pushOutOfEventVehicles(res.x, res.z);
      if (o) { res.x = o.x; res.z = o.z; res.ok = false; res.reason = 'veiculo'; }
    }
    // andar cancela ações que não permitem movimento (dançar, sentar, pose…); as de "andar com bandeira" seguem
    if (p.act !== 0 && cancelsOnMove(p.act, Math.hypot(res.x - prevX, res.z - prevZ))) this.setAct(p, r, 0, now);
    p.x = res.x; p.y = res.y; p.z = res.z;
    p.heading = m.heading;
    p.speed = Math.min(Math.abs(m.speed), MAX_SPEED[mode]);
    p.loco = Math.max(0, Math.min(4, m.loco | 0));
    r.actor.x = res.x; r.actor.z = res.z; r.actor.heading = m.heading;
    r.last = { x: res.x, y: res.y, z: res.z, t: now, seq: m.seq };
    if (!res.ok) {
      client.send('correct', [res.x, res.y, res.z, m.seq, res.reason ?? '']);
      metrics.correction();
    }
    if (veh) {
      veh.x = res.x; veh.z = res.z; veh.y = res.y; veh.heading = m.heading; veh.speed = measured;
      if (veh.kind === 'trio') this.carryRiders(p.vehicle);
      if (veh.kind === 'car' || veh.kind === 'moto') {
        const box = VEHICLE_BOX[veh.kind as VehicleKind];
        this.checkImpacts(client.sessionId, { x: res.x, z: res.z, px: prevX, pz: prevZ, heading: m.heading, speed: measured, len: box.len, width: box.width });
      }
    }
  }

  private onMode(client: Client, m: Mode) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    if (!p || !r || (m !== 'pacifico' && m !== 'interacao')) return;
    if (m === 'interacao' && this.interactionPolicy === 'pacifico') { client.send('mode_denied', 'evento_pacifico'); return; }
    if (p.status !== STATUS.OK) { client.send('mode_denied', 'estado'); return; }
    p.interaction = m; r.actor.mode = m;
    client.send('mode_ok', m);
  }

  // ---------------------------------------------------------------- veículos
  private onEnter(client: Client, id: string, seq?: number) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    const v = typeof id === 'string' ? this.state.vehicles.get(id) : undefined;
    if (!p || !r) return;
    if (p.platform) { client.send('enter_denied', { id, reason: 'em_cima_do_trio' }); return; }
    const c = canEnter({ x: r.last.x, z: r.last.z, status: p.status, vehicle: p.vehicle }, v ? { x: v.x, z: v.z, occupant: v.occupant, heading: v.heading, kind: v.kind } : undefined);
    if (!c.ok) { client.send('enter_denied', { id, reason: c.reason }); metrics.denied(); console.log(`[room] entrar negado ${client.sessionId} → ${JSON.stringify(id)}: ${c.reason}`); return; }
    v!.occupant = client.sessionId;
    v!.state = VEHICLE_STATE.OCCUPIED;
    p.vehicle = id;
    if (p.act !== 0) this.setAct(p, r, 0, Date.now()); // ação social termina ao entrar no veículo
    r.actor.vehicle = id;
    // o ocupante "assume" a posição do veículo (autoritativa)
    // movimentos a pé ainda em trânsito (seq ≤ seq do pedido) passam a ser descartados
    r.last = { x: v!.x, y: v!.y, z: v!.z, t: Date.now(), seq: Math.max(r.last.seq, Number.isFinite(seq) ? (seq as number) : r.last.seq) };
    p.x = v!.x; p.z = v!.z;
    client.send('enter_ok', { id, x: v!.x, z: v!.z, heading: v!.heading });
    console.log(`[room] ${client.sessionId} entrou em ${id}`);
  }

  private onExit(client: Client, seq?: number) {
    const p = this.state.players.get(client.sessionId);
    const r = this.rt.get(client.sessionId);
    if (!p || !r || !p.vehicle) return;
    const vid = p.vehicle;
    const v = this.state.vehicles.get(vid);
    p.vehicle = ''; r.actor.vehicle = '';
    if (v) {
      v.occupant = ''; v.speed = 0; v.state = VEHICLE_STATE.AVAILABLE;
      const vrt = this.vehRT.get(vid);
      if (vrt) vrt.idleSince = Date.now();
      // sai pelo lado esquerdo (motorista); se houver parede, pelo direito; senão no lugar
      const side = v.kind === 'car' ? 1.6 : v.kind === 'moto' ? 1.0 : 0.9;
      let cands = [[-Math.cos(v.heading), Math.sin(v.heading)], [Math.cos(v.heading), -Math.sin(v.heading)]].map(([dx, dz]) => ({ x: v.x + dx * side, z: v.z + dz * side }));
      // veículos de evento: desce pela porta da cabine (longe do centro), fora da carroceria
      if (EVENT_VEHICLE_KINDS.has(v.kind)) cands = exitPoints(v.kind, v);
      let out = { x: v.x, z: v.z };
      for (const t of cands) {
        if (world().walls.raycast(v.x, 0.6, v.z, t.x, 0.6, t.z) >= 1) { out = t; break; }
      }
      p.x = out.x; p.z = out.z;
      r.last = { x: out.x, y: 0, z: out.z, t: Date.now(), seq: Math.max(r.last.seq, Number.isFinite(seq) ? (seq as number) : r.last.seq) };
      client.send('exit_ok', { x: out.x, z: out.z });
    }
  }

  // ---------------------------------------------------------------- trio elétrico (plataforma) e veículos de evento
  /**
   * passageiros acompanham o trio: mundo = pose do trio × posição local (chamado a cada movimento do trio).
   * Quem recebe o estado completo desenha pelo LOCAL (plx/plz/plh) × pose do trio — o x/z de mundo sincronizado só
   * serve à grade/AOI e à multidão distante, então só é regravado quando se afasta > 1 m (banda: 20 passageiros num
   * trio andando não geram 20 × 20 Hz de patches de posição).
   */
  private carryRiders(trioId: string, force = false) {
    const v = this.state.vehicles.get(trioId), set = this.riders.get(trioId);
    if (!v || !set) return;
    for (const id of set) {
      const p = this.state.players.get(id), r = this.rt.get(id);
      if (!p || !r) continue;
      const w = localToWorld(v, p.plx, p.plz);
      if (force || Math.hypot(w.x - p.x, w.z - p.z) > 1) { p.x = w.x; p.z = w.z; p.y = v.y + TRIO.deckH; p.heading = v.heading + p.plh; }
      r.actor.x = w.x; r.actor.z = w.z; r.actor.heading = v.heading + p.plh;
      r.last.x = w.x; r.last.z = w.z; r.last.y = v.y + TRIO.deckH;
    }
  }

  private onBoard(client: Client, m: { id?: unknown; seq?: number }) {
    const p = this.state.players.get(client.sessionId), r = this.rt.get(client.sessionId);
    const id = typeof m?.id === 'string' ? m.id : '';
    const v = id ? this.state.vehicles.get(id) : undefined;
    if (!p || !r) return;
    const c = canBoard({ x: r.last.x, z: r.last.z, status: p.status, vehicle: p.vehicle, platform: p.platform }, v ? { x: v.x, z: v.z, heading: v.heading, kind: v.kind } : undefined, this.riders.get(id)?.size ?? 0);
    if (!c.ok) { client.send('board_denied', { id, reason: c.reason }); metrics.denied(); console.log(`[room] subir negado ${client.sessionId} → ${JSON.stringify(id)}: ${c.reason}`); return; }
    const now = Date.now();
    const seq = Math.max(r.last.seq, Number.isFinite(m.seq) ? (m.seq as number) : r.last.seq);
    p.platform = id; p.plx = TRIO.ladderTop[0]; p.plz = TRIO.ladderTop[1]; p.plh = 0;
    r.plat = { id, x: p.plx, z: p.plz, t: now, seq };
    r.last.seq = seq;
    r.actor.platform = id;
    if (p.act !== 0) this.setAct(p, r, 0, now);
    let set = this.riders.get(id);
    if (!set) this.riders.set(id, (set = new Set()));
    set.add(client.sessionId);
    this.carryRiders(id, true);
    client.send('board_ok', { id, lx: p.plx, lz: p.plz });
    console.log(`[room] ${client.sessionId} subiu no ${id} (${set.size} em cima)`);
  }

  private onUnboard(client: Client, seq?: number) {
    const p = this.state.players.get(client.sessionId), r = this.rt.get(client.sessionId);
    if (!p || !r || !p.platform) return;
    const id = p.platform, v = this.state.vehicles.get(id);
    let out = { x: p.x, z: p.z };
    if (v) {
      // desce pela escada; se houver parede atrás, pelas laterais da traseira
      const top = localToWorld(v, TRIO.ladderTop[0], TRIO.ladderTop[1]);
      const cands: [number, number][] = [[TRIO.ladderFoot[0], TRIO.ladderFoot[1]], [TRIO.width / 2 + 1.0, TRIO.ladderTop[1]], [-TRIO.width / 2 - 1.0, TRIO.ladderTop[1]]];
      out = localToWorld(v, cands[0][0], cands[0][1]);
      for (const [lx, lz] of cands) {
        const t = localToWorld(v, lx, lz);
        if (world().walls.raycast(top.x, 0.6, top.z, t.x, 0.6, t.z) >= 1) { out = t; break; }
      }
    }
    this.riders.get(id)?.delete(client.sessionId);
    p.platform = ''; p.plx = 0; p.plz = 0; p.plh = 0;
    r.plat = null; r.actor.platform = '';
    p.x = out.x; p.z = out.z; p.y = v?.y ?? 0;
    r.actor.x = out.x; r.actor.z = out.z;
    r.last = { x: out.x, y: p.y, z: out.z, t: Date.now(), seq: Math.max(r.last.seq, Number.isFinite(seq) ? (seq as number) : r.last.seq) };
    client.send('unboard_ok', { x: out.x, z: out.z });
  }

  /** movimento LOCAL em cima do trio: velocidade de quem anda + preso ao polígono do piso (TRIO_DECK) */
  private onPlatformMove(client: Client, raw: unknown) {
    const p = this.state.players.get(client.sessionId), r = this.rt.get(client.sessionId);
    const m = unpackPlatformMove(raw);
    if (!p || !r || !m || !r.plat || !p.platform) return;
    if (m.seq <= r.plat.seq) return;
    const now = Date.now();
    const res = validatePlatformMove(r.plat, { x: m.lx, z: m.lz }, (now - r.plat.t) / 1000, MAX_SPEED.foot);
    if (p.act !== 0 && cancelsOnMove(p.act, Math.hypot(res.x - r.plat.x, res.z - r.plat.z))) this.setAct(p, r, 0, now);
    p.plx = res.x; p.plz = res.z; p.plh = m.lh;
    p.speed = Math.min(Math.abs(m.speed), MAX_SPEED.foot);
    p.loco = Math.max(0, Math.min(2, m.loco | 0));
    r.plat = { id: r.plat.id, x: res.x, z: res.z, t: now, seq: m.seq };
    r.last.seq = m.seq;
    r.last.t = now;
    this.carryRiders(p.platform);
    if (!res.ok) { client.send('pcorrect', [res.x, res.z, m.seq, res.reason ?? '']); metrics.correction(); }
  }

  /** quem anda a pé não entra na carroceria do trio/carro de som (folga menor que a do cliente: correção rara) */
  private pushOutOfEventVehicles(x: number, z: number): { x: number; z: number } | null {
    let out: { x: number; z: number } | null = null;
    for (const id of this.eventVehIds) {
      const v = this.state.vehicles.get(id);
      if (!v || Math.hypot(v.x - x, v.z - z) > 10) continue;
      const o = pushOutOfBox(out?.x ?? x, out?.z ?? z, v, 0.15);
      if (o) out = o;
    }
    return out;
  }

  /** o veículo em `next` sobrepõe um veículo de evento (ou, sendo de evento, qualquer outro)? só se antes não sobrepunha */
  private vehicleOverlap(selfId: string, kind: string, px: number, pz: number, ph: number, x: number, z: number, h: number): boolean {
    let hit = false;
    this.vgrid.forEachInRadius(x, z, 30, (vs) => {
      if (hit) return;
      const oid = this.vehIds[vs];
      const o = oid === selfId ? undefined : this.state.vehicles.get(oid);
      if (!o || (!EVENT_VEHICLE_KINDS.has(kind) && !EVENT_VEHICLE_KINDS.has(o.kind))) return;
      if (boxesOverlap({ x, z, heading: h, kind }, o) && !boxesOverlap({ x: px, z: pz, heading: ph, kind }, o)) hit = true;
    });
    return hit;
  }

  // ---------------------------------------------------------------- interação física
  private setAct(p: NetPlayer, r: PlayerRT, act: number, now: number, variation = 0) {
    r.social.act = act; r.social.actAt = now;
    p.act = act; p.actAt = now; p.actVar = variation;
  }

  private onAct(client: Client, m: { a?: unknown; v?: unknown }) {
    const p = this.state.players.get(client.sessionId), r = this.rt.get(client.sessionId);
    if (!p || !r || !m) return;
    const now = Date.now();
    const s = r.social;
    s.status = p.status; s.vehicle = p.vehicle; s.prop = p.prop; s.onPlatform = !!p.platform;
    const v = validateAction(s, m.a, now);
    if (!v.ok) { client.send('act_denied', v.reason); return; }
    applyAction(s, m.a as number, now);
    const variation = typeof m.v === 'number' ? Math.max(0, Math.min(ACTION_RULES.maxVariation, m.v | 0)) : 0;
    this.setAct(p, r, m.a as number, now, variation);
  }

  private onProp(client: Client, m: { p?: unknown; d?: unknown }) {
    const p = this.state.players.get(client.sessionId), r = this.rt.get(client.sessionId);
    if (!p || !r || !m) return;
    const now = Date.now();
    const s = r.social;
    s.status = p.status; s.vehicle = p.vehicle; s.act = p.act; s.onPlatform = !!p.platform;
    const v = validateProp(s, m.p, m.d ?? 0, now);
    if (!v.ok) { client.send('prop_denied', v.reason); return; }
    applyProp(s, m.p as number, typeof m.d === 'number' ? m.d : 0, now);
    p.prop = s.prop; p.design = s.design;
    if (p.act !== s.act) this.setAct(p, r, s.act, now);
  }

  private knockdown(targetId: string, fromX: number, fromZ: number, distance: number, kind: 'push' | 'impact', by: string, strength: number) {
    const tp = this.state.players.get(targetId);
    const tr = this.rt.get(targetId);
    if (!tp || !tr) return;
    const out = knockdownOutcome({ x: fromX, z: fromZ }, { x: tr.last.x, z: tr.last.z }, distance, world().walls, tp.heading);
    const now = Date.now();
    tp.status = STATUS.DOWN; tr.actor.status = STATUS.DOWN; tr.actor.lastDown = now;
    tr.rest = { x: out.rx, z: out.rz };
    tp.x = out.rx; tp.z = out.rz; tp.speed = 0;
    this.broadcast('knock', { target: targetId, by, kind, dx: out.dx, dz: out.dz, strength, rx: out.rx, rz: out.rz, downMs: RULES.downMs, getupMs: RULES.getupMs });
    metrics.knock(kind);
    console.log(`[room] queda (${kind}) ${targetId} por ${by} força ${strength.toFixed(1)}`);
  }

  private onPush(client: Client, targetId: string) {
    const r = this.rt.get(client.sessionId);
    const t = typeof targetId === 'string' ? this.rt.get(targetId) : undefined;
    if (!r) return;
    const now = Date.now();
    const v = canPush(r.actor, t?.actor, now, world().walls);
    if (!v.ok) { client.send('push_denied', v.reason); metrics.denied(); console.log(`[room] empurrão negado ${client.sessionId} → ${targetId}: ${v.reason}`); return; }
    r.actor.lastActionAt = now;
    r.actor.actionTimes = [...r.actor.actionTimes.filter((x) => now - x < RULES.rateWindowMs), now];
    this.broadcast('action', { by: client.sessionId, type: 'push', target: targetId });
    this.knockdown(targetId, r.actor.x, r.actor.z, RULES.pushDistance, 'push', client.sessionId, 1);
  }

  /**
   * jogadores a pé que BLOQUEIAM este veículo: todos, exceto quando o atropelamento é permitido (motorista e alvo em
   * modo interação, alvo de pé e sem imunidade, e só carro/moto). Candidatos pela grade espacial.
   */
  private vehicleBlockers(driverId: string, kind: VehicleKind, px: number, pz: number, x: number, z: number) {
    const d = this.rt.get(driverId);
    const now = Date.now();
    const out: { x: number; z: number }[] = [];
    const reach = Math.hypot(x - px, z - pz) / 2 + VEHICLE_BOX[kind].len / 2 + 2;
    this.grid.forEachInRadius((x + px) / 2, (z + pz) / 2, reach, (sl) => {
      const id = this.slotIds[sl];
      if (id === driverId) return;
      const a = this.rt.get(id)?.actor;
      if (!a || a.vehicle || a.platform) return; // em veículo ou em cima do trio: não está no chão
      const canHit = (kind === 'car' || kind === 'moto') && !!d && impactAllowed(d.actor.mode, a.mode) && a.status === STATUS.OK && now >= a.immuneUntil;
      if (!canHit) out.push({ x: a.x, z: a.z });
    });
    return out;
  }

  private checkImpacts(driverId: string, car: { x: number; z: number; px: number; pz: number; heading: number; speed: number; len?: number; width?: number }) {
    const d = this.rt.get(driverId);
    if (!d || d.actor.mode !== 'interacao') return; // motorista também precisa estar em modo interação
    const now = Date.now();
    // candidatos pela grade: círculo que cobre o trajeto do tick (anti-tunelamento) + caixa do carro + folga
    const mx = (car.x + car.px) / 2, mz = (car.z + car.pz) / 2;
    const reach = Math.hypot(car.x - car.px, car.z - car.pz) / 2 + 6;
    const cands: string[] = [];
    this.grid.forEachInRadius(mx, mz, reach, (sl) => cands.push(this.slotIds[sl]));
    for (const id of cands) {
      const r = this.rt.get(id);
      if (!r || id === driverId) continue;
      const a = r.actor;
      if (a.mode !== 'interacao' || a.status !== STATUS.OK || a.vehicle || a.platform || now < a.immuneUntil) continue;
      const hit = vehicleImpact(car, { x: a.x, z: a.z });
      if (hit.hit) this.knockdown(id, car.x - Math.sin(car.heading) * 3, car.z - Math.cos(car.heading) * 3, hit.strength, 'impact', driverId, hit.strength);
    }
  }
}
