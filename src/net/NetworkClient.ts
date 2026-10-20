/**
 * Cliente multiplayer (Colyseus SDK). Opcional: só conecta com ?mp=1 (ou ?mp=ws://host:porta).
 *
 *  predição      o jogador local move-se imediatamente; envia propostas a 15 Hz (compactas, com seq)
 *  reconciliação correções do servidor: aplica o erro medido no seq corrigido sobre a posição atual
 *  interpolação  remotos com buffer adaptativo ao jitter medido (100–300 ms)
 *  relógio       ping/pong estilo NTP → worldClock (semáforos e trânsito iguais para todos)
 *  mundo         trânsito por snapshots binários (área de interesse); veículos e jogadores via StateView
 *  trio         quem está EM CIMA do trio manda posição LOCAL ('pmove'); remotos em cima são desenhados como
 *                pose interpolada do trio × posição local interpolada (não escorregam quando o trio anda)
 *  multidão      os remotos detalhados (StateView, os mais próximos) e a multidão distante (mensagem "crowd", 2 Hz)
 *                entram no orçamento do CrowdDirector: só os mais próximos ganham esqueleto (pool por corpo); o resto
 *                é desenhado instanciado. Ver docs/CROWDS.md
 *  espectador    (rodada 8) entra com role 'spectator': sem corpo, só manda a câmera (`spec_cam`, 2 Hz) — docs/SPECTATOR.md
 *                (rodada 8.1) com altitude: no alto o servidor manda células agregadas (`spec_cells`, binário, 1 Hz)
 *  reconexão     (rodada 8) queda → RECONECTANDO (token do Colyseus, exponencial + jitter) → mesma entidade; graça
 *                vencida → entra de novo (ticket novo se autenticado); sessão substituída → para (src/net/reconnect.ts)
 *  reinício      (rodada 9.1) servidor reiniciando (aviso `server_restarting` ou fechamento 4001) ou processo novo sem a
 *                sala antiga → entra de novo (entidade nova, conta/progresso preservados) com backoff; versão nova
 *                (4010) / sala cheia (4011) param e avisam (`onJoinRefused`) — docs/SHARED_WORLD.md § Reinício
 */
import { BODY, type BodyRef } from '../physics/bodies'; // rodada 12 — colisão
/** rodada 12 — colisão: penetração que o jogador local pode fazer num autônomo (o servidor o empurra para fora) */
const AUTONOMOUS_SOFT = 0.12;
import './netWebSocket'; // precisa vir ANTES do SDK (instrumenta globalThis.WebSocket)
import * as THREE from 'three';
import { Client, Callbacks, type Room } from '@colyseus/sdk';
import { supporterJoinOpt } from '../supporters/session'; // rodada 10 — torcida de quem não tem conta (só a sessão)
import { ROOM_NAME, NET_TICK_HZ, LOCO, JOIN_ERROR, PROTOCOL_VERSION, type JoinOptions } from './protocol';
import { packMove, RULES } from './rules';
import { FallSync } from '../player/fallSync';
import { netStats, SIM } from './netWebSocket';
import { worldClock } from './clock';
import { RIDEABLE_DEFS, seatWorld, type RideableKind } from '../vehicles/Rideable';
import { TRIO, localToWorld, packPlatformMove } from '../vehicles/platform';
import type { MountSource } from '../characters/human/vehicleClips'; // rodada 10 — montagem
import { AvatarVisual } from '../player/AvatarVisual';
import { createPlayerState, type PlayerState } from '../player/PlayerState';
import type { Accessory, BodyType, CharacterAppearance } from '../characters/bodyTypes';
import { decodeCrowd } from './crowdCodec';
import { anonymousClientId } from './clientId';
import { packLook } from '../characters/garments';
import { createAgent, type CrowdAgent } from '../characters/crowd/crowdBudget';
import type { CrowdDirector } from '../characters/crowd/CrowdDirector';
import type { SocialState } from '../social/types';
import { NAME_LOD, OcclusionCache, autonomousTagged, npcRanges, rayBlocks, selectNames, shortName, type NameCandidate, type NameRanges, type NameTier, type NamesMode } from './nameLod';
import { NameTagPool, TAG_CLS, type TagSlot } from './NameTagPool';
import { ENTITY_KIND } from '../world/entityKind';
import { countHumans } from './population';
import { personSeed } from '../characters/crowd/animVariety';
import { setAgentSeed } from '../characters/crowd/crowdBudget';
import { RateGate } from '../ui/hud/throttle';
import type { IdentityJoinOptions, WorldRole } from '../identity/types';
import { LinkMachine, RECONNECT, backoffDelay, retriesForGrace, type LinkEvent, type LinkState } from './reconnect';
import { SPECTATOR } from '../spectator/bounds';
import { decodeCells, cellKey } from '../spectator/cellCodec';
import type { CrowdCellSnapshot, SpecTier } from '../spectator/tiers';

const BODY_LIST = ['homem', 'mulher', 'idoso', 'idosa'] as const;
const bodyIndex = (b: string) => Math.max(0, BODY_LIST.indexOf(b as (typeof BODY_LIST)[number]));
/** atraso de interpolação da multidão distante: um intervalo de mensagem (500 ms a 2 Hz) + folga */
const FAR_DELAY_MS = 650;

interface FarSnap { t: number; x: number; y: number; z: number; heading: number; speed: number }
interface FarRemote { nid: number; agent: CrowdAgent; a: FarSnap; b: FarSnap; seen: number; npc: boolean }

/** estado social → `SocialState` com a fase no relógio comum (todos tocam a mesma fase) */
function socialOf(s: { act: number; actAt: number; actVar: number; prop: number; design: number }): SocialState {
  return { act: s.act, phase: s.act ? Math.max(0, (worldClock.now() - s.actAt) / 1000) : 0, variation: s.actVar, prop: s.prop, design: s.design };
}

interface Snapshot { t: number; x: number; y: number; z: number; heading: number; speed: number; loco: number; vehicle: string; platform: string; plx: number; plz: number; plh: number }

export interface RemoteInfo {
  id: string; name: string; body: string; accessory: string;
  x: number; z: number; speed: number; interaction: string; status: number; vehicle: string;
  /** rodada 9: altura desenhada (pulo visto pelos outros) */
  y: number;
  /** vida social sincronizada (ids) e o que o esqueleto local está tocando (se houver esqueleto) */
  act: number; actPhase: number; prop: number; design: number; visualAct: number | null; visualProp: number | null;
  /** em cima de um trio: id e posição local */
  platform: string; plx: number; plz: number;
  /** última posição de MUNDO recebida do servidor (QA: o servidor leva o passageiro junto com o trio) */
  wx: number; wz: number;
  /** 0 conectado · 1 caiu, em graça de reconexão (entidade congelada) */
  link: number;
  /** rodada 9 — efeitos (NetPlayer.fx) e o que o esqueleto local aplicou */
  fx: number; fxVisual: AvatarVisual['fxDebug'] | null;
}

/** estado autoritativo mandado pelo servidor ao reconectar (mesma entidade) */
export interface ResumeMsg { x: number; y: number; z: number; heading: number; vehicle: string; platform: string; plx: number; plz: number; prop: number; design: number; seq: number }

/** opções de entrada além da aparência (rodada 8) */
export interface ConnectOptions {
  /** papel pedido (o servidor decide; visitante sempre assiste) */
  role?: WorldRole;
  /** espectador: posição inicial da câmera (e altitude acima do foco, m) */
  specCam?: { x: number; z: number; alt?: number };
  /** SÓ servidor de teste: conta fictícia (QA de login duplicado) */
  testUser?: string;
}

interface Remote {
  id: string;
  nid: number;
  /** esqueleto próprio — só enquanto o orçamento da multidão o concede (pool por corpo) */
  visual: AvatarVisual | null;
  app: CharacterAppearance;
  agent: CrowdAgent;
  state: PlayerState;
  /** rodada 9.1: posição DESENHADA (filtrada) — `state` continua a interpolação crua usada pelas regras */
  view?: PlayerState;
  buf: Snapshot[];
  /** rodada 12 — rótulo emprestado do pool fixo (src/net/NameTagPool.ts; null = sem rótulo agora) */
  tag: TagSlot | null;
  /** faixa atual do rótulo (LOD dos apelidos, src/net/nameLod.ts) */
  labelTier: NameTier;
  /** rodada 12 — objeto sincronizado do servidor (leitura tolerante de kind/look/sup/tag) */
  st: Record<string, unknown>;
  /** rodada 12 — tipo (src/world/entityKind.ts: 0 humano · 1 autônomo · 2 bot de carga; ausente = 0) */
  kind: number;
  /** rodada 12 — semente da individualidade da animação (estável por pessoa) */
  seed: number;
  /** falando no chat até (ms, performance.now) — rótulo ganha prioridade */
  speakingUntil: number;
  name: string;
  body: string;
  accessory: string;
  interaction: string;
  status: number;
  vehicle: string;
  platform: string;
  link: number;
  lastArrival: number;
  /** carimbo de tempo (sem jitter) da última amostra — rodada 9.1 */
  lastStamp: number;
  /** vida social vinda do servidor (actAt no relógio do servidor) */
  soc: { act: number; actAt: number; actVar: number; prop: number; design: number };
  /** o esqueleto atual já recebeu o estado social atual */
  socApplied: AvatarVisual | null;
  /** rodada 9 — efeitos (NetPlayer.fx) e entrada na queda sem duplicar (knock × status) */
  fx: number;
  fall: FallSync;
}

export interface KnockMsg { target: string; by: string; kind: 'push' | 'impact' | 'combat'; dx: number; dz: number; strength: number; rx: number; rz: number; downMs: number; getupMs: number }

/** versão do protocolo enviada na entrada; QA: ?pvTest=N simula uma aba com bundle antigo (só afeta quem usa) */
const pvForJoin = (): number => { const t = new URLSearchParams(location.search).get('pvTest'); return t !== null && /^\d+$/.test(t) ? Number(t) : PROTOCOL_VERSION; };
/** QA (servidor PV_TEST=1): ?testGroup=chave → grupo do jogador anônimo (canal GRUPO do chat); o servidor real ignora */
const testGroupOpt = (): { testGroup?: string } => { const g = new URLSearchParams(location.search).get('testGroup'); return g ? { testGroup: g } : {}; };

export class NetworkClient {
  readonly group = new THREE.Group();
  private room: Room | null = null;
  private remotes = new Map<string, Remote>();
  private seq = 0;
  private sendAcc = 0;
  private pingAcc = 0;
  private labels: HTMLDivElement;
  /** rodada 12 — pool fixo de rótulos (o DOM não cresce com a população) */
  readonly tags: NameTagPool;
  private history = new Map<number, { x: number; z: number }>();
  private jitterMs = 0;
  interpDelay = 120;
  sessionId = '';
  status: 'offline' | 'connecting' | 'online' | 'error' = 'offline';
  lastError = '';
  corrections = 0;
  correctionReasons: Record<string, number> = {};
  /** estado do PRÓPRIO jogador segundo o servidor */
  self = { interaction: 'pacifico', status: 0, vehicle: '', platform: '', fx: 0, social: { act: 0, actAt: 0, actVar: 0, prop: 0, design: 0 } };
  /** rodada 9 — id curto do próprio jogador (mensagens de confronto trazem nids) */
  selfNid = 0;
  /** rodada 9 — o próprio caiu por mudança de status SEM `knock` (queda decidida por outro sistema) */
  onSelfStatusFall: (() => void) | null = null;
  private selfFall = new FallSync();
  /** QA: todos os bits de efeito que o próprio já recebeu */
  selfFxSeen = 0;
  /** o servidor mudou a ação/item do próprio jogador (confirmação, fim, cancelamento) */
  onSelfSocial?: (s: SocialState) => void;
  /** pedido de ação/item negado (motivo) */
  onSocialDenied?: (kind: 'act' | 'prop', reason: string) => void;
  policy: 'pacifico' | 'opcional' = 'opcional';
  /** última negativa/aviso do servidor (QA) */
  lastDenial = '';
  seed = 0;
  /** só envia movimento depois de receber o spawn decidido pelo servidor (evita "teleporte" sob latência) */
  private spawned = false;
  private rate = { t: performance.now(), bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 };
  bandwidth = { inBps: 0, outBps: 0, inMps: 0, outMps: 0 };

  // callbacks para o jogo
  onSpawn: ((s: { x: number; y: number; z: number; heading: number }) => void) | null = null;
  onCorrect: ((dx: number, dz: number, abs: { x: number; y: number; z: number }, reason: string) => void) | null = null;
  /** QA: mensagens de trânsito NPC recebidas (deve ser 0: a avenida está fechada) */
  trafficMessages = 0;
  /** veículos que o servidor está enviando agora (área de interesse) */
  vehiclesInView() { return [...this.vehicleKinds.keys()]; }
  /** tipo de cada veículo (pela sincronização do servidor) — pose/altura do assento dos remotos */
  private vehicleKinds = new Map<string, string>();
  onVehicle: ((id: string, v: { x: number; y: number; z: number; heading: number; occupant: string; kind: string; state: number; design: number; owner?: string }) => void) | null = null;
  /** rodada 12 — veículo saiu da vista / sumiu (o pessoal some de verdade; as vagas do mundo ficam no cenário) */
  onVehicleGone: ((id: string) => void) | null = null;
  /** rodada 12 — resposta ao pedido de veículo pessoal (`pveh_ok` / `pveh_denied`) */
  onPersonal: ((ok: boolean, m: any) => void) | null = null;
  // ---- trio elétrico (plataforma)
  /** em cima de um trio: o jogo atualiza a posição LOCAL a cada quadro; o envio vira 'pmove' */
  platform: { id: string; lx: number; lz: number; lh: number; speed: number; loco: number } | null = null;
  /** pose do trio COMO ESTE CLIENTE O DESENHA (interpolada) — os passageiros remotos são presos a ela */
  platformPose: ((id: string) => { x: number; y: number; z: number; heading: number } | null) | null = null;
  /** rodada 10 — montagem: veículo desenhado neste cliente (pose + dinâmica) — o corpo do remoto vai fisicamente ao banco */
  vehicleSource: ((id: string) => MountSource | null) | null = null;
  onBoard: ((ok: boolean, d: { id: string; reason?: string; lx?: number; lz?: number }) => void) | null = null;
  onUnboard: ((pos: { x: number; z: number }) => void) | null = null;
  onPlatformCorrect: ((lx: number, lz: number, reason: string) => void) | null = null;
  onEnter: ((ok: boolean, data: { id: string; reason?: string; x?: number; z?: number; heading?: number }) => void) | null = null;
  onExit: ((pos: { x: number; z: number }) => void) | null = null;
  /** `refine`: a queda já tinha começado pela mudança de status — só corrige repouso/direção (não recomeça) */
  onKnock: ((k: KnockMsg, isSelf: boolean, refine?: boolean) => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;
  onEvent: ((eventId: string) => void) | null = null;
  // ---- rodada 8: papel, reconexão, sessão substituída
  /** papel desta conexão (o servidor confirma no spawn) */
  role: WorldRole = 'player';
  /** estado do enlace (src/net/reconnect.ts) */
  get link(): LinkState { return this.linkM.state; }
  private linkM = new LinkMachine('client');
  /** mudança de estado do enlace ('REPLACED' = outra sessão da mesma conta assumiu; 'RESTARTING' = servidor reiniciando) */
  onLink: ((s: LinkState | 'REPLACED' | 'RESTARTING') => void) | null = null;
  /** rodada 9.1 — entrada recusada de vez (JOIN_ERROR: versão nova, sala cheia…): o jogo mostra o aviso */
  onJoinRefused: ((code: number, message: string) => void) | null = null;
  /** rodada 9.1 — o servidor avisou que vai reiniciar (SIGTERM): a saída que vier a seguir é reinício, não expulsão */
  restarting = false;
  /** reconectou na MESMA entidade: estado autoritativo do servidor */
  onResume: ((r: ResumeMsg) => void) | null = null;
  /**
   * ticket de uso único para cada entrada NOVA (jogador autenticado — POST /api/session/ticket); `undefined` = sem
   * ticket (entra como visitante). Falha PASSAGEIRA (API fora no reinício, 429) deve LANÇAR: a entrada é tentada de
   * novo em vez de rebaixar a conta a visitante.
   */
  ticketProvider: (() => Promise<string | undefined>) | null = null;
  /** a sessão foi substituída por outra da mesma conta: não reconecta */
  replaced = false;
  /** QA: capacidades negadas pelo servidor (mensagem `denied`) */
  capDenials: string[] = [];
  /** QA: reconexões na mesma entidade e entradas novas após a graça */
  reconnects = 0;
  rejoins = 0;
  /** espectador: foco da câmera (o jogo atualiza a cada quadro; vai ao servidor como spec_cam em baixa frequência) */
  spectatorFocus: { x: number; z: number; alt?: number } | null = null;
  private specSent = { x: Infinity, z: Infinity, alt: 0, t: 0, acc: 0 };
  /** espectador aéreo (rodada 8.1): camada decidida pelo SERVIDOR e células agregadas recebidas (chave → snapshot) */
  specTier: SpecTier = 'NEAR';
  readonly specCells = new Map<number, CrowdCellSnapshot>();
  /** muda a cada spec_cells aplicada (o desenho/minimapa só refazem quando muda) */
  specCellsVersion = 0;
  /** QA: mensagens/bytes de spec_cells e quando chegou a última */
  specCellStats = { msgs: 0, bytes: 0, fulls: 0, at: 0 };
  private specPingAt = 0;
  private joinArgs: { app: CharacterAppearance; name: string; testSpawn?: { x: number; z: number }; o: IdentityJoinOptions & ConnectOptions } | null = null;
  private leaving = false;

  constructor(private endpoint: string, hudRoot: HTMLElement) {
    this.group.name = 'remote_players';
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    hudRoot.prepend(this.labels); // por baixo do HUD (menu, minimapa, ajustes)
    this.tags = new NameTagPool(this.labels, NAME_LOD.cap + 4);
  }

  // ---------------------------------------------------------------- rodada 12 — população (apresentação)
  /** remoto detalhado pelo nid (olhar, chat) */
  private byNid = new Map<number, Remote>();
  /** quem está sob o cursor / selecionado no painel (o rótulo ganha prioridade e aparece completo) */
  nameFocus: (() => { hover: string | null; selected: string | null }) | null = null;
  /** raio contra o mundo de colisão (fração 0..1 do segmento livre) — oclusão dos rótulos atrás de prédio */
  occluder: ((ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number) | null = null;
  readonly occlusion = new OcclusionCache(400, 8);
  /** autônomos: fração com nome e faixas (public/gameplay/autonomous.json `nametag`) */
  npcNames: { share: number; ranges: NameRanges } = { share: 0.6, ranges: npcRanges() };
  /** olhar (NetPlayer.look) calculado só para quem está a menos disto (m) da câmera e tem esqueleto no LOD <= 1 */
  lookMaxDist = 22;
  /** QA: sobrescreve o alvo do olhar (nid do remoto -> nid do alvo; 0 = nada) — sem servidor que mande `look` */
  qaLook: ((nid: number) => number) | null = null;
  /** QA/medição: remotos com olhar ativo no último quadro e ms gastos */
  lookStats = { active: 0, ms: 0 };

  /** HUMANOS vistos por este cliente (o próprio + remotos kind 0 + multidão distante não marcada) — contagem pública */
  humanCount(includeSelf: boolean): number {
    const kinds: number[] = [], far: boolean[] = [];
    for (const r of this.remotes.values()) kinds.push(r.kind);
    for (const f of this.far.values()) far.push(f.npc);
    return countHumans(kinds, far, includeSelf);
  }
  /** tipo de um remoto (ausente = humano) */
  kindOf(id: string): number { return this.remotes.get(id)?.kind ?? 0; }
  /**
   * rodada 12 (G) — AUTÔNOMOS do servidor a ≤ r m de (x, z): remotos kind 1 + multidão distante marcada `npc` — a
   * população LOCAL (pedestres/concentração deste cliente) cede onde eles estão (src/npc/localPopulation.ts)
   */
  autonomousNear(x: number, z: number, r: number): number {
    const r2 = r * r;
    let n = 0;
    for (const rm of this.remotes.values()) if (rm.kind === ENTITY_KIND.AUTONOMOUS && (rm.state.x - x) ** 2 + (rm.state.z - z) ** 2 <= r2) n++;
    for (const f of this.far.values()) if (f.npc && (f.agent.x - x) ** 2 + (f.agent.z - z) ** 2 <= r2) n++;
    return n;
  }

  get remoteCount() { return this.remotes.size; }
  /** jogadores da multidão distante (sem estado completo) */
  get farCount() { return this.far.size; }

  /** orçamento de personagens (definido pelo jogo); sem ele, todo remoto tem esqueleto (comportamento antigo) */
  crowd: CrowdDirector | null = null;
  private pool = new Map<string, AvatarVisual[]>();
  private far = new Map<number, FarRemote>();
  private farApp = new Map<number, { skin: number; hair: number; top: number; bottom: number }>();
  private remoteNids = new Set<number>();
  private farSeen = 0;
  /** mensagens "crowd" recebidas (QA) */
  crowdMsgs = 0;

  async connect(app: CharacterAppearance, name: string, testSpawn?: { x: number; z: number }, identity: IdentityJoinOptions & ConnectOptions = {}): Promise<void> {
    this.status = 'connecting';
    this.joinArgs = { app, name, testSpawn, o: { ...identity } };
    try {
      await this.join();
    } catch (e) {
      this.status = 'error';
      this.lastError = (e as Error)?.message ?? String(e);
      throw e;
    }
  }

  /** entrada NOVA na sala (primeira vez ou depois da graça vencida) */
  private async join() {
    const { app, name, testSpawn, o } = this.joinArgs!;
    const client = new Client(this.endpoint);
    // ticket de uso único: o da 1ª entrada (se veio pronto) e, depois, um NOVO a cada entrada (ticketProvider)
    const ticket = o.ticket ?? await this.ticketProvider?.();
    o.ticket = undefined;
    const spec = o.role === 'spectator' ? (this.spectatorFocus ?? o.specCam) : undefined;
    const opts: JoinOptions = { pv: pvForJoin(), name, body: app.body, skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, shoes: app.shoes, accessory: app.accessory ?? 'nenhum', acc: app.acc ?? 0x222222, topStyle: app.topStyle, bottomStyle: app.bottomStyle, shoeStyle: app.shoeStyle, hairStyle: app.hairStyle, shirtDesign: app.shirtDesign ?? 0, cid: anonymousClientId(), ...(testSpawn ? { testSpawn } : {}), ...testGroupOpt(), ...supporterJoinOpt(), ...(this.crowd ? { aoiMax: Math.max(16, Math.min(64, this.crowd.budget.skinned * 2)) } : {}),
      ...(o.role ? { role: o.role } : {}), ...(ticket ? { ticket } : {}), ...(spec ? { specCam: { x: spec.x, z: spec.z, ...(spec.alt !== undefined ? { alt: Math.round(spec.alt) } : {}) } } : {}), ...(o.testUser ? { testUser: o.testUser } : {}) };
    const room = await client.joinOrCreate(ROOM_NAME, opts);
    this.bind(room);
  }

  private setLink(e: LinkEvent) {
    const before = this.linkM.state;
    const s = this.linkM.apply(e, Date.now());
    if (s !== before) this.onLink?.(s);
  }

  /** liga os eventos da sala (também depois de uma entrada nova) */
  private bind(room: Room) {
    {
      this.room = room;
      this.sessionId = room.sessionId;
      this.status = 'online';
      // entrada nova: células do espectador aéreo recomeçam (o servidor manda `full`)
      this.specCells.clear(); this.specTier = 'NEAR'; this.specCellsVersion++;
      // reconexão automática do SDK com o token da sessão: exponencial + jitter, tentando durante toda a graça
      const rc = room.reconnection;
      rc.backoff = (attempt: number) => backoffDelay(attempt);
      rc.minDelay = 0; rc.maxDelay = RECONNECT.maxDelayMs;
      rc.maxRetries = retriesForGrace();
      rc.minUptime = 0;
      rc.maxEnqueuedMessages = 0; // nada de movimentos velhos na volta: o servidor manda 'resume'
      for (const type of this.handlers.keys()) room.onMessage(type, (m: unknown) => this.dispatch(type, m));
      room.onDrop(() => { if (this.room === room) { this.status = 'connecting'; this.setLink('drop'); } });
      room.onReconnect(() => { if (this.room === room) { this.status = 'online'; this.reconnects++; this.setLink('reconnected'); } });
      room.onMessage('session_replaced', () => { this.replaced = true; });
      room.onMessage('server_restarting', () => { if (this.room === room) { this.restarting = true; this.onLink?.('RESTARTING'); } });
      room.onMessage('resume', (r: ResumeMsg) => { this.holdMoves = false; this.onResume?.(r); });
      room.onMessage('denied', (d: { cap: string }) => { this.lastDenial = `cap:${d?.cap}`; if (this.capDenials.length < 64) this.capDenials.push(String(d?.cap)); });
      room.onMessage('spawn', (s: { x: number; y: number; z: number; heading: number; policy: 'pacifico' | 'opcional'; seed: number; role?: WorldRole }) => {
        this.policy = s.policy; this.seed = s.seed;
        this.role = s.role === 'spectator' ? 'spectator' : 'player';
        this.onSpawn?.(s);
        // espectador não manda movimento (só a câmera, em update)
        this.spawned = this.role === 'player';
      });
      room.onMessage('correct', (c: [number, number, number, number, string]) => {
        this.corrections++;
        this.correctionReasons[c[4]] = (this.correctionReasons[c[4]] ?? 0) + 1;
        const h = this.history.get(c[3]);
        this.onCorrect?.(h ? c[0] - h.x : 0, h ? c[2] - h.z : 0, { x: c[0], y: c[1], z: c[2] }, c[4]);
      });
      room.onMessage('pong', (p: [number, number]) => worldClock.addSample(p[0], p[1], Date.now()));
      // trânsito NPC foi removido (avenida fechada); se um servidor antigo mandar, só conta — não renderiza nada
      room.onMessage('traffic', () => { this.trafficMessages++; });
      room.onMessage('enter_ok', (d: { id: string; x: number; z: number; heading: number }) => { this.holdMoves = false; this.onEnter?.(true, d); });
      room.onMessage('enter_denied', (d: { id: string; reason: string }) => { this.holdMoves = false; this.lastDenial = `enter:${d.reason}`; this.onEnter?.(false, d); });
      room.onMessage('exit_ok', (d: { x: number; z: number }) => { this.holdMoves = false; this.onExit?.(d); });
      // rodada 12 — veículo pessoal ("selecionou → aparece")
      room.onMessage('pveh_ok', (d: unknown) => { this.holdMoves = false; this.pvehPending = false; this.onPersonal?.(true, d); });
      room.onMessage('pveh_denied', (d: { reason?: string }) => { this.holdMoves = false; this.pvehPending = false; this.lastDenial = `pveh:${d?.reason}`; this.onPersonal?.(false, d); });
      room.onMessage('board_ok', (d: { id: string; lx: number; lz: number }) => { this.holdMoves = false; this.onBoard?.(true, d); });
      room.onMessage('board_denied', (d: { id: string; reason: string }) => { this.holdMoves = false; this.lastDenial = `board:${d.reason}`; this.onBoard?.(false, d); });
      room.onMessage('unboard_ok', (d: { x: number; z: number }) => { this.holdMoves = false; this.platform = null; this.onUnboard?.(d); });
      room.onMessage('pcorrect', (c: [number, number, number, string]) => { this.corrections++; this.correctionReasons[c[3]] = (this.correctionReasons[c[3]] ?? 0) + 1; this.onPlatformCorrect?.(c[0], c[1], c[3]); });
      room.onMessage('mode_ok', (m: string) => { this.self.interaction = m; this.onNotice?.(m === 'interacao' ? 'Modo INTERAÇÃO (validado pelo servidor)' : 'Modo PACÍFICO'); });
      room.onMessage('mode_denied', (r: string) => this.onNotice?.(r === 'evento_pacifico' ? 'Este evento é pacífico' : `Modo negado: ${r}`));
      room.onMessage('act_denied', (r: string) => { this.lastDenial = `act:${r}`; this.onSocialDenied?.('act', r); });
      room.onMessage('prop_denied', (r: string) => { this.lastDenial = `prop:${r}`; this.onSocialDenied?.('prop', r); });
      room.onMessage('push_denied', (r: string) => { this.lastDenial = `push:${r}`; this.onNotice?.(DENIAL_TEXT[r] ?? `Empurrão negado (${r})`); });
      room.onMessage('action', (a: { by: string; type: string }) => { const r = this.remotes.get(a.by); r?.visual?.playPush(); });
      room.onMessage('knock', (k: KnockMsg) => this.handleKnock(k));
      room.onMessage('crowd', (b: Uint8Array | ArrayBuffer) => this.onCrowd(b instanceof Uint8Array ? b : new Uint8Array(b)));
      room.onMessage('spec_cells', (b: Uint8Array | ArrayBuffer) => this.onSpecCells(b instanceof Uint8Array ? b : new Uint8Array(b)));
      room.onLeave((code: number) => this.onRoomLeft(room, code));
      const cb = Callbacks.get(room as any) as any;
      cb.listen('eventId', (id: string) => { if (id) this.onEvent?.(id); });
      cb.onAdd('players', (p: any, id: string) => {
        if (id === this.sessionId) {
          this.selfNid = Number(p.nid) || 0;
          this.self.fx = p.fx ?? 0; this.selfFxSeen |= this.self.fx; // rodada 9: valor inicial (onChange só traz mudanças)
          cb.onChange(p, () => {
            this.self.interaction = p.interaction; this.self.status = p.status; this.self.vehicle = p.vehicle; this.self.platform = p.platform ?? '';
            this.self.fx = p.fx ?? 0;
            this.selfFxSeen |= this.self.fx;
            if (this.selfFall.onStatus(p.status, performance.now()) === 'start') this.onSelfStatusFall?.();
            // ação/item autoritativos do próprio jogador (o servidor pode encerrar: andar, cair, entrar em veículo)
            const s = this.self.social;
            if (s.act !== p.act || s.actAt !== p.actAt || s.prop !== p.prop || s.design !== p.design) {
              this.self.social = { act: p.act, actAt: p.actAt, actVar: p.actVar, prop: p.prop, design: p.design };
              this.onSelfSocial?.(socialOf(this.self.social));
            }
          });
          return;
        }
        this.addRemote(id, p);
        cb.onChange(p, () => this.pushSnapshot(id, p));
      });
      cb.onRemove('players', (_p: any, id: string) => this.removeRemote(id));
      cb.onAdd('vehicles', (v: any, id: string) => {
        this.vehicleKinds.set(id, v.kind);
        const emit = () => this.onVehicle?.(id, { x: v.x, y: v.y, z: v.z, heading: v.heading, occupant: v.occupant, kind: v.kind, state: v.state ?? 0, design: v.design ?? 0, owner: v.owner ?? '' });
        emit();
        cb.onChange(v, emit);
      });
      // área de interesse: o servidor tira da vista veículos distantes
      cb.onRemove('vehicles', (_v: any, id: string) => { this.vehicleKinds.delete(id); this.onVehicleGone?.(id); });
      // sincronização rápida do relógio
      for (let i = 0; i < 5; i++) setTimeout(() => this.room?.send('ping', Date.now()), 150 * i);
    }
  }

  /**
   * saiu de vez da sala. Substituída → para. Fechada pelo SERVIDOR com a conexão boa (expulsão, rebaixamento de
   * licença) → para (sem insistir). Só a saída DURANTE a reconexão (graça vencida, tentativas esgotadas) → entrada nova.
   */
  private onRoomLeft(room: Room, code: number) {
    if (this.room !== room || this.leaving) return;
    this.status = 'offline';
    if (this.replaced || code === RECONNECT.replacedCloseCode) {
      this.replaced = true;
      this.linkM.apply('replaced', Date.now());
      this.onLink?.('REPLACED');
      return;
    }
    // rodada 9.1 — reinício do servidor (aviso prévio ou fechamento SERVER_SHUTDOWN 4001): não há graça possível (a sala
    // some com o processo); entra de novo quando o processo novo subir, mostrando RECONECTANDO no meio
    if (this.restarting || code === 4001) {
      this.restarting = false;
      this.linkM.apply('replaced', Date.now());
      this.onLink?.('RESTARTING');
      void this.rejoinFresh();
      return;
    }
    if (this.linkM.state === 'CONNECTED') {
      this.linkM.apply('replaced', Date.now());
      this.lastError = `saída pelo servidor (${code})`;
      this.onLink?.('EXPIRED');
      return;
    }
    this.linkM.apply('replaced', Date.now()); // fora da sala de vez → EXPIRED (graça vencida ou recusa)
    this.onLink?.('EXPIRED');
    void this.rejoinFresh();
  }

  /** entidade antiga já não existe: limpa tudo o que veio da sala e entra como nova (o servidor decide o spawn) */
  private async rejoinFresh() {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.far.clear();
    this.vehicleKinds.clear();
    this.spawned = false;
    this.platform = null;
    this.holdMoves = false;
    this.room = null;
    for (let attempt = 1; attempt <= 40 && !this.leaving; attempt++) {
      await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
      try {
        this.status = 'connecting';
        await this.join();
        this.rejoins++;
        this.linkM.apply('rejoined', Date.now());
        this.onLink?.('CONNECTED');
        return;
      } catch (e) {
        this.lastError = (e as Error)?.message ?? String(e);
        // recusa DEFINITIVA (versão nova, lotação): não insiste — o jogo mostra o aviso com a decisão
        const code = (e as { code?: number })?.code;
        if (code === JOIN_ERROR.protocol || code === JOIN_ERROR.roomFull || code === JOIN_ERROR.spectatorsFull) {
          this.status = 'error';
          this.onJoinRefused?.(code, this.lastError);
          return;
        }
      }
    }
    this.status = 'error';
  }

  // ---------------------------------------------------------------- comandos
  /** rodada 8: visual salvo pelo editor — conta: o servidor relê do banco; teste anônimo: valida o enviado */
  sendAppearance(app: CharacterAppearance) {
    this.room?.send('appearance', { body: app.body, skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, shoes: app.shoes, accessory: app.accessory ?? 'nenhum', acc: app.acc ?? 0x222222, topStyle: app.topStyle, bottomStyle: app.bottomStyle, shoeStyle: app.shoeStyle, hairStyle: app.hairStyle, shirtDesign: app.shirtDesign ?? 0 });
  }

  /** TESTE: envia uma proposta de posição arbitrária (simula cliente modificado) */
  sendRawMove(x: number, z: number, heading = 0) {
    const seq = ++this.seq;
    this.history.set(seq, { x, z });
    this.room?.send('move', packMove({ x, y: 0.15, z, heading, speed: 1.5, loco: 1, seq }));
  }

  send(type: string, payload?: unknown) { this.room?.send(type, payload); }
  /** mensagens de outros sistemas (ex.: grafite, src/graffiti/GraffitiSystem.ts): registradas antes ou depois do connect */
  /** VÁRIOS ouvintes por tipo (chat: painel + prioridade de nomes) — um despachante por tipo na sala */
  private handlers = new Map<string, Set<(msg: any) => void>>();
  private dispatch(type: string, m: unknown) { for (const fn of this.handlers.get(type) ?? []) fn(m); }
  on(type: string, fn: (msg: any) => void) {
    let set = this.handlers.get(type);
    if (!set) {
      this.handlers.set(type, (set = new Set()));
      this.room?.onMessage(type, (m: unknown) => this.dispatch(type, m));
    }
    set.add(fn);
    return () => set!.delete(fn);
  }
  requestMode(m: 'pacifico' | 'interacao') { this.send('mode', m); }
  /** entrar/sair levam o seq atual: o servidor descarta movimentos antigos ainda em trânsito */
  requestEnter(id: string) { this.holdMoves = true; this.send('enter', { id, seq: this.seq }); }
  requestExit() { this.holdMoves = true; this.send('exit', { seq: this.seq }); }
  /** rodada 12 — pede o veículo pessoal (o servidor escolhe o ponto e monta): o seq descarta movimentos a pé antigos */
  requestPersonal(kind: string) {
    this.holdMoves = true; this.pvehPending = true;
    this.send('pveh_req', { kind, seq: this.seq });
    setTimeout(() => { if (this.pvehPending) { this.pvehPending = false; this.holdMoves = false; } }, 3000); // sem resposta: não trava o movimento
  }
  private pvehPending = false;
  /** subir/descer do trio (escada): mesma ideia do entrar/sair — o seq descarta movimentos antigos */
  requestBoard(id: string) { this.holdMoves = true; this.send('board', { id, seq: this.seq }); }
  requestUnboard() { this.holdMoves = true; this.send('unboard', { seq: this.seq }); }
  /** segura o envio de movimento entre o pedido de entrar/sair e a resposta (a posição muda de "dono") */
  private holdMoves = false;
  requestPush(target: string) { this.send('push', target); }
  /** ação social (0 = parar) — o servidor valida; só ids pequenos vão pela rede */
  requestAct(a: number, v = 0) { this.send('act', { a, v }); }
  /** item na mão (0 = nenhum) com design (0 = padrão) */
  requestProp(p: number, d = 0) { this.send('prop', { p, d }); }

  /** rodada 9 — seq do último movimento enviado (o pedido de pulo/golpe leva o seq) */
  get moveSeq() { return this.seq; }

  /**
   * rodada 9 — confronto: esqueleto do remoto pelo nid para tocar o golpe; `acquire` dá esqueleto na hora a quem está
   * perto (como na queda) — golpe é raro e importante
   */
  combatVisual(nid: number, acquire = true): { visual: AvatarVisual; x: number; z: number } | null {
    if (!nid) return null;
    for (const r of this.remotes.values()) {
      if (r.nid !== nid) continue;
      if (!r.visual && acquire && Math.hypot(r.state.x - this.lastCam.x, r.state.z - this.lastCam.z) < Math.min(40, this.crowd?.budget.skinnedMaxDist ?? 40)) this.acquire(r);
      return r.visual ? { visual: r.visual, x: r.state.x, z: r.state.z } : null;
    }
    return null;
  }

  /** remoto mais próximo à frente (alvo do empurrão) */
  pickTarget(x: number, z: number, heading: number, range = 2.4): string | null {
    let best: string | null = null, bd = range;
    for (const r of this.remotes.values()) {
      const dx = r.state.x - x, dz = r.state.z - z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01) continue;
      if ((dx * Math.sin(heading) + dz * Math.cos(heading)) / d < 0.2) continue;
      bd = d; best = r.id;
    }
    return best;
  }

  /**
   * rodada 12 — colisão (src/physics/LocalBodies.ts): corpos remotos A PÉ e de pé a ≤ r de (x, z), na posição
   * interpolada. Humano/bot = duro; autônomo (kind 1) cede um pouco (`soft`, abaixo da tolerância do servidor).
   * Caído/levantando, em veículo ou no trio: sem corpo (igual ao servidor). Reaproveita objetos (sem alocar por quadro).
   */
  bodiesNear(x: number, z: number, r: number, out: BodyRef[]): BodyRef[] {
    out.length = 0;
    const r2 = r * r;
    let i = 0;
    for (const rm of this.remotes.values()) {
      if (rm.vehicle || rm.platform || (rm.status !== 0 && rm.status !== 3)) continue;
      const dx = rm.state.x - x, dz = rm.state.z - z;
      if (dx * dx + dz * dz > r2) continue;
      const b = this.bodyPool[i] ?? (this.bodyPool[i] = { id: '', x: 0, z: 0, r: BODY.radius });
      i++;
      b.id = rm.id; b.x = rm.state.x; b.z = rm.state.z; b.r = BODY.radius; b.soft = rm.kind === ENTITY_KIND.AUTONOMOUS ? AUTONOMOUS_SOFT : 0;
      out.push(b);
    }
    return out;
  }
  private bodyPool: BodyRef[] = [];

  remotesForObstacles(): { x: number; z: number; interaction: string; status: number; vehicle: string; platform: string }[] {
    return [...this.remotes.values()].map((r) => ({ x: r.state.x, z: r.state.z, interaction: r.interaction, status: r.status, vehicle: r.vehicle, platform: r.platform }));
  }

  // ---------------------------------------------------------------- remotos
  private addRemote(id: string, p: any) {
    if (this.remotes.has(id)) this.removeRemote(id); // estado completo reenviado (reconexão): nunca dois para o mesmo id
    const app: CharacterAppearance = {
      body: (p.body || 'homem') as BodyType, skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, scale: 1, accessory: (p.accessory || 'nenhum') as Accessory, acc: p.acc,
      topStyle: p.topStyle || undefined, bottomStyle: p.bottomStyle || undefined, shoeStyle: p.shoeStyle || undefined, hairStyle: p.hairStyle || undefined, shirtDesign: p.shirtDesign || 0,
    };
    const nid = Number(p.nid) || 0;
    if (nid) { this.remoteNids.add(nid); this.far.delete(nid); }
    const agent = createAgent({ x: p.x, y: p.y, z: p.z, heading: p.heading, body: bodyIndex(app.body), skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, look: packLook(app), shirt: app.shirtDesign ?? 0 });
    // rodada 12 — individualidade estável por pessoa (mesma semente no esqueleto e no instanciado; todos os clientes iguais)
    const seed = personSeed(nid || id);
    setAgentSeed(agent, seed);
    const r: Remote = {
      id, nid, visual: null, app, agent, state: createPlayerState(id, p.x, p.y, p.z, p.heading), buf: [], tag: null, labelTier: 'hidden', st: p, kind: Number(p.kind ?? 0) || 0, seed, speakingUntil: 0, name: p.name, body: p.body, accessory: p.accessory || 'nenhum',
      interaction: p.interaction, status: p.status, vehicle: p.vehicle, platform: p.platform ?? '', link: 0, lastArrival: performance.now(), lastStamp: 0,
      soc: { act: p.act ?? 0, actAt: p.actAt ?? 0, actVar: p.actVar ?? 0, prop: p.prop ?? 0, design: p.design ?? 0 }, socApplied: null,
      fx: p.fx ?? 0, fall: new FallSync(),
    };
    this.remotes.set(id, r);
    if (nid) this.byNid.set(nid, r);
    if (!this.crowd) this.acquire(r);
    this.pushSnapshot(id, p);
  }

  /** esqueleto do pool (mesmo corpo) ou novo */
  private acquire(r: Remote): AvatarVisual {
    const list = this.pool.get(r.app.body);
    let v = list?.pop();
    if (v) { v.resetForReuse(); v.setAppearance(r.app); }
    else v = new AvatarVisual(r.app, { lod: 2, castShadow: false });
    if (NetworkClient.variety) v.setVariant(r.seed); // rodada 12 — fase/cadência/parado/laços próprios (animVariety.ts)
    this.group.add(v.root);
    r.visual = v;
    return v;
  }

  private release(r: Remote) {
    const v = r.visual;
    if (!v) return;
    r.visual = null;
    r.agent.skinReady = false;
    v.setLook(null);
    this.group.remove(v.root);
    let list = this.pool.get(r.app.body);
    if (!list) this.pool.set(r.app.body, (list = []));
    // pool pequeno por corpo: o suficiente para trocas na borda do orçamento sem recriar personagens
    const keep = Math.ceil((this.crowd?.budget.skinned ?? 8) / 3) + 2;
    if (list.length < keep) list.push(v); else v.dispose();
  }

  /** espectador aéreo: `full` apaga e aplica; delta aplica alteradas e tira removidas (src/spectator/cellCodec.ts) */
  private onSpecCells(buf: Uint8Array) {
    const m = decodeCells(buf);
    if (!m) return;
    const st = this.specCellStats;
    st.msgs++; st.bytes += buf.byteLength; st.at = performance.now();
    if (m.full) { this.specCells.clear(); st.fulls++; }
    this.specTier = m.tier;
    for (const [cx, cz] of m.removed ?? []) this.specCells.delete(cellKey(cx, cz));
    for (const c of m.cells) this.specCells.set(cellKey(c.cx, c.cz), c);
    this.specCellsVersion++;
  }

  /** posições (x, z) de todos os remotos desenhados individualmente (detalhados + multidão distante) */
  forEachRemotePos(fn: (x: number, z: number) => void) {
    for (const r of this.remotes.values()) if (r.buf.length) fn(r.state.x, r.state.z);
    for (const f of this.far.values()) fn(f.agent.x, f.agent.z);
  }

  // rodada 10 — interação (InteractionSystem / PersonPanel): só dados PÚBLICOS (apelido, torcida); o id interno serve
  // para reencontrar a entidade e nunca é mostrado
  /** remotos detalhados (com corpo e posição de desenho): id, nid, apelido, posição, em veículo */
  forEachPerson(fn: (id: string, nid: number, name: string, x: number, y: number, z: number, inVehicle: boolean) => void) {
    for (const r of this.remotes.values()) {
      if (!r.buf.length) continue;
      const s = r.view ?? r.state;
      fn(r.id, r.nid, r.name || 'Visitante', s.x, s.y, s.z, !!r.vehicle);
    }
  }
  /** perfil público de um remoto: apelido e torcida (`NetPlayer.sup`, lido de forma tolerante: ausente = 0) */
  publicProfile(id: string): { name: string; sup: number; x: number; z: number; lvl: number; title: string; kind: number } | null {
    const r = this.remotes.get(id);
    if (!r) return null;
    const st = (this.room?.state as { players?: { get?(k: string): { sup?: unknown; lvl?: unknown; title?: unknown; kind?: unknown; tag?: unknown } | undefined } } | undefined)?.players?.get?.(id);
    const sup = Number(st?.sup ?? 0);
    const s = r.view ?? r.state;
    // rodada 11 — nível e título equipado (públicos; ausentes = 0 / '')
    const lvl = Number(st?.lvl ?? 0);
    // rodada 12 — `kind` (0 humano · 1 autônomo · 2 bot de carga): o painel decide o que oferecer (nunca rotula)
    return { name: r.name || 'Visitante', sup: Number.isInteger(sup) && sup > 0 ? sup : 0, x: s.x, z: s.z, lvl: Number.isInteger(lvl) && lvl > 0 ? lvl : 0, title: typeof st?.title === 'string' ? st.title.slice(0, 48) : '', kind: r.kind };
  }

  /** rodada 11 — inventário: o que o SERVIDOR aplicou na própria entidade (aparência, torcida, nível, título) */
  selfPlayer(): Record<string, unknown> | null {
    const st = (this.room?.state as { players?: { get?(k: string): unknown } } | undefined)?.players?.get?.(this.sessionId);
    return st && typeof st === 'object' ? (st as Record<string, unknown>) : null;
  }

  /** multidão distante: posições compactas (2 Hz) → agentes instanciados interpolados */
  private onCrowd(buf: Uint8Array) {
    this.crowdMsgs++;
    if (!this.crowd) return;
    const now = performance.now();
    const stamp = ++this.farSeen;
    for (const e of decodeCrowd(buf)) {
      if (this.remoteNids.has(e.nid)) continue; // já está detalhado (StateView)
      if (e.app) this.farApp.set(e.nid, e.app);
      const snap: FarSnap = { t: now, x: e.x, y: e.y, z: e.z, heading: e.heading, speed: e.speed };
      let f = this.far.get(e.nid);
      if (!f) {
        const app = this.farApp.get(e.nid);
        f = { nid: e.nid, agent: createAgent({ maxTier: 1, body: e.body, x: e.x, y: e.y, z: e.z, heading: e.heading, seed: personSeed(e.nid), ...(app ?? {}) }), a: snap, b: snap, seen: stamp, npc: !!e.npc };
        this.far.set(e.nid, f);
      } else {
        f.a = f.b; f.b = snap; f.seen = stamp; f.npc = !!e.npc;
        if (e.app) Object.assign(f.agent, e.app);
      }
      f.agent.body = e.body;
      const so = e.social;
      const startS = now / 1000 - (so?.ageS ?? 0);
      // mantém o início da ação estável entre mensagens (a idade vem quantizada em ¼ s)
      if ((so?.act ?? 0) !== f.agent.act || Math.abs(startS - f.agent.actAt) > 0.6) f.agent.actAt = startS;
      f.agent.act = so?.act ?? 0; f.agent.prop = so?.prop ?? 0; f.agent.design = so?.design ?? 0;
    }
    for (const [nid, f] of this.far) if (f.seen !== stamp) this.far.delete(nid);
    if (this.farApp.size > 4096) this.farApp.clear();
  }

  private pushSnapshot(id: string, p: any) {
    const r = this.remotes.get(id);
    if (!r) return;
    const now = performance.now();
    // estimativa de jitter: desvio do intervalo entre chegadas em relação ao patchRate (50 ms)
    const ia = now - r.lastArrival;
    r.lastArrival = now;
    if (ia < 1000) this.jitterMs = this.jitterMs * 0.9 + Math.abs(ia - 50) * 0.1;
    // rodada 9.1: carimbo sem o jitter de chegada — amostras do servidor saem a cada 50 ms; carimbar pela CHEGADA dava
    // velocidades desiguais entre amostras (o remoto "tremia" andando em linha reta). Perto do ritmo esperado, segue a
    // grade de 50 ms corrigindo devagar a deriva; longe (pausa, perda), volta ao relógio real
    const exp = r.lastStamp + 50;
    const stamp = Math.abs(now - exp) < 40 ? exp + (now - exp) * 0.15 : now;
    r.lastStamp = stamp;
    // rodada 12 (AGENTE F): quem acabou de entrar chega sem `speed` (o servidor só o escreve no 1º movimento) → NaN
    r.buf.push({ t: stamp, x: p.x, y: p.y, z: p.z, heading: p.heading, speed: Number.isFinite(p.speed) ? p.speed : 0, loco: p.loco, vehicle: p.vehicle, platform: p.platform ?? '', plx: p.plx ?? 0, plz: p.plz ?? 0, plh: p.plh ?? 0 });
    if (r.buf.length > 40) r.buf.shift();
    // rodada 9 — queda pela mudança de status (sem `knock`), cambaleio e efeitos
    if (r.fall.onStatus(p.status, now) === 'start') this.statusFall(r);
    if ((p.fx ?? 0) !== r.fx) { r.fx = p.fx ?? 0; r.visual?.setFx(r.fx); }
    r.visual?.setPhys(p.status);
    r.interaction = p.interaction; r.status = p.status; r.vehicle = p.vehicle; r.platform = p.platform ?? '';
    if ((p.link ?? 0) !== r.link) { r.link = p.link ?? 0; if (r.labelTier !== 'hidden') this.setLabelTier(r, r.labelTier, true); }
    r.kind = Number(p.kind ?? 0) || 0; // rodada 12 — tolerante (servidor antigo: ausente = humano)
    const so = r.soc;
    if (so.act !== p.act || so.actAt !== p.actAt || so.prop !== p.prop || so.design !== p.design || so.actVar !== p.actVar) {
      r.soc = { act: p.act, actAt: p.actAt, actVar: p.actVar, prop: p.prop, design: p.design };
      r.socApplied = null;
    }
    if (r.tag && ((r.tag.cls & TAG_CLS.combat) !== 0) !== (p.interaction === 'interacao')) this.setLabelTier(r, r.labelTier, true);
    if (p.name && p.name !== r.name) { r.name = p.name; if (r.labelTier !== 'hidden') this.setLabelTier(r, r.labelTier, true); }
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.release(r);
    this.tags.release(r.tag); r.tag = null;
    this.shownLabels.delete(r);
    if (r.nid) { this.remoteNids.delete(r.nid); if (this.byNid.get(r.nid) === r) this.byNid.delete(r.nid); this.occlusion.forget(r.nid); }
    this.remotes.delete(id);
  }

  private handleKnock(k: KnockMsg) {
    const now = performance.now();
    if (k.target === this.sessionId) { const d = this.selfFall.onKnock(now); if (d !== 'ignore') this.onKnock?.(k, true, d === 'refine'); return; }
    const r = this.remotes.get(k.target);
    if (r) {
      // queda é rara e importante: ganha esqueleto na hora (o orçamento o mantém enquanto estiver caído)
      if (!r.visual && Math.hypot(r.state.x - this.lastCam.x, r.state.z - this.lastCam.z) < (this.crowd?.budget.skinnedMaxDist ?? 1e9)) this.acquire(r);
      // rodada 9: a queda pode já ter começado pela mudança de status — não recomeça (FallSync)
      if (r.visual && r.fall.onKnock(now) === 'start') void r.visual.knockdown({ dirX: k.dx, dirZ: k.dz, strength: k.strength, groundY: r.state.y, walls: [], downMs: k.downMs, getupMs: k.getupMs });
      // posição de repouso autoritativa: o buffer passa a apontar para ela
      r.buf.length = 0;
      r.buf.push({ t: performance.now(), x: k.rx, y: r.state.y, z: k.rz, heading: r.state.heading, speed: 0, loco: 0, vehicle: '', platform: '', plx: 0, plz: 0, plh: 0 });
    }
    this.onKnock?.(k, false);
  }

  /** rodada 9 — queda sem `knock` (status DOWN/RAGDOLL): para trás, força média, tempos das regras */
  private statusFall(r: Remote) {
    if (!r.visual && Math.hypot(r.state.x - this.lastCam.x, r.state.z - this.lastCam.z) < (this.crowd?.budget.skinnedMaxDist ?? 1e9)) this.acquire(r);
    if (!r.visual) return;
    const h = r.state.heading;
    void r.visual.knockdown({ dirX: -Math.sin(h), dirZ: -Math.cos(h), strength: 0.8, groundY: r.state.y, walls: [], downMs: RULES.downMs, getupMs: RULES.getupMs });
    this.statusFalls++;
  }
  /** QA: quedas iniciadas pela mudança de status */
  statusFalls = 0;

  // ---------------------------------------------------------------- por frame
  /** rodada 12 — QA/medição A/B: ?r12var=0 desliga a individualidade da animação dos remotos (comparação de custo) */
  static variety = typeof location === 'undefined' || new URLSearchParams(location.search).get('r12var') !== '0';
  /** rodada 12 — medição: ms (média móvel) do update por quadro — interpolação, animação dos esqueletos, olhar, rótulos */
  updateMs = 0;
  update(dt: number, local: PlayerState, riding: string | null, camera: THREE.Camera, viewport: { w: number; h: number }) {
    const tU = performance.now();
    this.updateInner(dt, local, riding, camera, viewport);
    this.updateMs = this.updateMs * 0.95 + (performance.now() - tU) * 0.05;
  }
  private updateInner(dt: number, local: PlayerState, riding: string | null, camera: THREE.Camera, viewport: { w: number; h: number }) {
    if (this.room && this.status === 'online' && this.role === 'spectator') this.sendSpectatorCam(dt);
    if (this.room && this.status === 'online' && this.spawned && !this.holdMoves) {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / NET_TICK_HZ) {
        this.sendAcc = 0;
        const loco = riding ? 4 : Math.max(0, LOCO.indexOf(local.locomotion as (typeof LOCO)[number]));
        const seq = ++this.seq;
        this.history.set(seq, { x: local.x, z: local.z });
        if (this.history.size > 120) this.history.delete(seq - 120);
        const pl = this.platform;
        if (pl) this.room.send('pmove', packPlatformMove({ lx: pl.lx, lz: pl.lz, lh: pl.lh, speed: pl.speed, loco: pl.loco, seq }));
        else this.room.send('move', packMove({ x: local.x, y: local.y, z: local.z, heading: local.heading, speed: local.speed, loco, seq }));
      }
      this.pingAcc += dt;
      if (this.pingAcc > 2) { this.pingAcc = 0; this.room.send('ping', Date.now()); }
    }
    // taxa de banda (1 s)
    const nowP = performance.now();
    if (nowP - this.rate.t > 1000) {
      const s = (nowP - this.rate.t) / 1000;
      this.bandwidth = {
        inBps: Math.round((netStats.bytesIn - this.rate.bytesIn) / s), outBps: Math.round((netStats.bytesOut - this.rate.bytesOut) / s),
        inMps: +((netStats.msgsIn - this.rate.msgsIn) / s).toFixed(1), outMps: +((netStats.msgsOut - this.rate.msgsOut) / s).toFixed(1),
      };
      this.rate = { t: nowP, bytesIn: netStats.bytesIn, bytesOut: netStats.bytesOut, msgsIn: netStats.msgsIn, msgsOut: netStats.msgsOut };
    }
    // interpolação adaptativa: patch (50 ms) + 2× jitter + folga
    this.interpDelay = THREE.MathUtils.clamp(70 + this.jitterMs * 2.5 + SIM.jitter * 0.5, 100, 300);
    const renderT = nowP - this.interpDelay;
    const cam = camera.position;
    this.lastCam.copy(cam);
    const crowd = this.crowd;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      if (renderT <= b[0].t) { a = c = b[0]; }
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= renderT && b[i + 1].t >= renderT) { a = b[i]; c = b[i + 1]; break; }
      const k = c.t > a.t ? THREE.MathUtils.clamp((renderT - a.t) / (c.t - a.t), 0, 1) : 1;
      const s = r.state;
      s.x = a.x + (c.x - a.x) * k;
      s.y = a.y + (c.y - a.y) * k;
      s.z = a.z + (c.z - a.z) * k;
      let dh = c.heading - a.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      s.heading = a.heading + dh * k;
      s.speed = a.speed + (c.speed - a.speed) * k;
      s.grounded = c.loco !== 3;
      if (c.platform) {
        // em cima do trio: pose do trio como ESTE cliente o desenha × posição local (interpolada no mesmo trio)
        const pose = this.platformPose?.(c.platform);
        if (pose) {
          const same = a.platform === c.platform;
          const lx = same ? a.plx + (c.plx - a.plx) * k : c.plx, lz = same ? a.plz + (c.plz - a.plz) * k : c.plz;
          let dl = c.plh - (same ? a.plh : c.plh);
          while (dl > Math.PI) dl -= Math.PI * 2;
          while (dl < -Math.PI) dl += Math.PI * 2;
          const w = localToWorld(pose, lx, lz);
          s.x = w.x; s.z = w.z; s.y = pose.y + TRIO.deckH; s.heading = pose.heading + (same ? a.plh : c.plh) + dl * k;
          s.grounded = true;
        }
      }
      const d = Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z);
      const ag = r.agent;
      ag.x = s.x; ag.y = s.y; ag.z = s.z; ag.heading = s.heading; ag.speed = c.vehicle ? 0 : s.speed;
      ag.priority = r.status !== 0 || r.vehicle ? 0.5 : 1;
      ag.act = r.soc.act; ag.prop = r.soc.prop; ag.design = r.soc.design;
      ag.actAt = nowP / 1000 - (r.soc.act ? Math.max(0, (worldClock.now() - r.soc.actAt) / 1000) : 0);
      crowd?.submit(ag, 'net');
      // representação decidida pelo orçamento no quadro anterior: esqueleto (tier 2) ou instanciado
      const skinned = !crowd || ag.tier === 2 || !!r.visual?.isDown;
      if (!skinned) { if (r.visual) this.release(r); continue; }
      const visual = r.visual ?? this.acquire(r);
      ag.skinReady = visual.ready;
      if (r.socApplied !== visual) { visual.setSocial(socialOf(r.soc)); visual.setFx(r.fx); visual.setPhys(r.status); r.socApplied = visual; }
      if (crowd) { visual.applyLod(ag.lod, d); visual.root.visible = visual.isDown || ((ag.inView || d < 6) && visual.ready); }
      else visual.setDistance(d);
      if (c.vehicle && !visual.isDown) {
        // tipo REAL do veículo (sincronizado), não deduzido do id
        const def = RIDEABLE_DEFS[(this.vehicleKinds.get(c.vehicle) ?? 'bicycle') as RideableKind] ?? RIDEABLE_DEFS.bicycle;
        const seat = seatWorld(def, s.x, s.z, s.heading); // carro de som/trio: banco na cabine, longe do centro
        visual.updateRiding(seat.x, s.y, seat.z, s.heading, def.pose, s.speed, def.seatHeight, dt, this.vehicleSource?.(c.vehicle) ?? undefined); // rodada 10 — montagem
      } else {
        if (visual.root.visible && (this.qaLook || Number(r.st.look ?? 0))) this.applyLook(r, visual, d, local);
        visual.update(this.viewOf(r, !!c.platform, dt), dt, crowd ? visual.root.visible && crowd.shouldAnimate(ag) : undefined);
      }
    }
    this.lookStats.active = this.lookActive; this.lookStats.ms = +(this.lookStats.ms * 0.9 + this.lookMs * 0.1).toFixed(4);
    this.lookActive = 0; this.lookMs = 0;
    this.updateLabels(camera, viewport, nowP);
    // multidão distante: interpolação simples entre as duas últimas posições (2 Hz), só instanciada
    if (crowd) {
      const rt = nowP - FAR_DELAY_MS;
      for (const f of this.far.values()) {
        const { a, b } = f, ag = f.agent;
        const k = b.t > a.t ? THREE.MathUtils.clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
        ag.x = a.x + (b.x - a.x) * k; ag.y = a.y + (b.y - a.y) * k; ag.z = a.z + (b.z - a.z) * k;
        let dh = b.heading - a.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        ag.heading = a.heading + dh * k;
        ag.speed = b.speed;
        crowd.submit(ag, 'far');
      }
    }
  }
  private lastCam = new THREE.Vector3();
  private lookActive = 0;
  private lookMs = 0;
  private lookTarget = { x: 0, y: 0, z: 0 };

  /**
   * rodada 12 — olhar (NetPlayer.look = nid do alvo): resolve o alvo LOCALMENTE (remoto detalhado, o próprio, multidão
   * distante) e passa o ponto da cabeça ao animador, que limita e suaviza. Só perto (LOD <= 1, < lookMaxDist).
   */
  private applyLook(r: Remote, v: AvatarVisual, d: number, local: PlayerState) {
    const t0 = performance.now();
    const target = this.qaLook ? this.qaLook(r.nid) : Number(r.st.look ?? 0) || 0;
    let p: { x: number; y: number; z: number } | null = null;
    if (target && d < this.lookMaxDist && r.agent.lod <= 1 && !r.vehicle && r.status === 0) {
      const lt = this.lookTarget;
      if (target === this.selfNid) { lt.x = local.x; lt.y = local.y + 1.6; lt.z = local.z; p = lt; }
      else {
        const o = this.byNid.get(target);
        const s = o ? o.view ?? o.state : null;
        const f = !s ? this.far.get(target) : null;
        if (s) { lt.x = s.x; lt.y = s.y + 1.6; lt.z = s.z; p = lt; }
        else if (f) { lt.x = f.agent.x; lt.y = f.agent.y + 1.6; lt.z = f.agent.z; p = lt; }
      }
    }
    v.setLook(p);
    if (p) this.lookActive++;
    this.lookMs += performance.now() - t0;
  }

  /**
   * rodada 9.1 — posição desenhada do remoto: as amostras chegam com o ritmo irregular de quem as enviou (quadros do
   * outro cliente), e a interpolação linear entre elas dava velocidade aos trancos (desvio de ~0,55 m/s andando a
   * 1,8 m/s). Filtro exponencial curto (constante de ~70 ms; atraso ~13 cm andando); saltos (> 1,5 m), trio e queda
   * seguem direto.
   */
  private viewOf(r: Remote, snap: boolean, dt: number): PlayerState {
    const s = r.state;
    const v = (r.view ??= { ...s });
    if (snap || Math.hypot(s.x - v.x, s.z - v.z) > 1.5 || dt <= 0) { v.x = s.x; v.z = s.z; }
    else { const k = 1 - Math.exp(-14 * dt); v.x += (s.x - v.x) * k; v.z += (s.z - v.z) * k; }
    v.y = s.y; v.heading = s.heading; v.speed = s.speed; v.grounded = s.grounded;
    return v;
  }

  /** espectador: foco da câmera a 2 Hz quando anda ≥ 6 m, e a cada 3 s de qualquer forma (batimento); ping do relógio */
  private sendSpectatorCam(dt: number) {
    const now = performance.now();
    if (now - this.specPingAt > 2000) { this.specPingAt = now; this.room?.send('ping', Date.now()); }
    const f = this.spectatorFocus, s = this.specSent;
    s.acc += dt;
    if (!f || s.acc < 1 / SPECTATOR.sendHz) return;
    const alt = f.alt ?? 0;
    if (Math.hypot(f.x - s.x, f.z - s.z) < SPECTATOR.sendMinMoveM && Math.abs(alt - s.alt) < SPECTATOR.sendMinAltM && now - s.t < SPECTATOR.keepAliveMs) return;
    s.acc = 0; s.x = f.x; s.z = f.z; s.alt = alt; s.t = now;
    // altitude decide a camada no servidor (src/spectator/tiers.ts) — inteira basta
    this.room?.send('spec_cam', { x: Math.round(f.x * 10) / 10, z: Math.round(f.z * 10) / 10, alt: Math.round(alt) });
  }

  // ---------------------------------------------------------------- apelidos (LOD — src/net/nameLod.ts)
  /** preferência NOMES DOS JOGADORES (HUD → ajustes) */
  namesMode: NamesMode = 'PROXIMOS';
  private labelGate = new RateGate(5);
  private shownLabels = new Set<Remote>();
  private labelCands: NameCandidate[] = [];
  private labelRefs: Remote[] = [];
  private labelScratch: { c: NameCandidate; t: NameTier; p: number }[] = [];
  private labelV = new THREE.Vector3();
  /** QA: rótulos visíveis, decisões e escritas de transform por segundo */
  labelStats = { shown: 0, candidates: 0, decisions: 0, decideMs: 0, transforms: 0, frameMs: 0, rays: 0, nodes: 0 };

  /** o chat (agente C) avisa quem falou: o rótulo ganha prioridade/aparece até 50 m por `ms` */
  /** id da entidade remota pelo id curto (nid) — mensagens de chat trazem só o nid */
  idByNid(nid: number): string | null {
    if (!nid) return null;
    for (const r of this.remotes.values()) if (r.nid === nid) return r.id;
    return null;
  }

  markSpeaking(entityId: string, ms = 6000) {
    const r = this.remotes.get(entityId);
    if (!r) return;
    r.speakingUntil = performance.now() + ms;
    this.labelGate.poke();
  }

  private setLabelTier(r: Remote, t: NameTier, force = false) {
    if (r.labelTier === t && !force) return;
    r.labelTier = t;
    if (t === 'hidden') { this.tags.release(r.tag); r.tag = null; this.shownLabels.delete(r); return; }
    // rodada 12 — rótulo do POOL fixo (src/net/NameTagPool.ts): esgotado = não mostra (o teto já é NAME_LOD.cap)
    if (!r.tag) r.tag = this.tags.acquire(r);
    if (!r.tag) { r.labelTier = 'hidden'; return; }
    const name = r.name || 'Visitante';
    const text = (t === 'short' ? shortName(name) : name) + (r.link ? ' · reconectando…' : ''); // caiu: em graça
    this.tags.set(r.tag, text, (t === 'short' ? TAG_CLS.short : 0) | (r.link ? TAG_CLS.away : 0) | (r.interaction === 'interacao' ? TAG_CLS.combat : 0));
    this.shownLabels.add(r);
  }

  /**
   * decisões (quem tem rótulo e em que faixa) a 5 Hz; por quadro só o transform dos escolhidos (<= NAME_LOD.cap),
   * e só quando muda de pixel — nada de display/texto/classe por quadro.
   * Rodada 12: autônomos (parte sem nome, faixas próprias), foco (hover/seleção), densidade da faixa média e oclusão
   * amostrada (raio câmera → cabeça contra as paredes do mundo de colisão, <= 8 raios novos por decisão).
   */
  private updateLabels(camera: THREE.Camera, viewport: { w: number; h: number }, now: number) {
    const cam = camera.position, v = this.labelV;
    if (this.labelGate.due(now)) {
      const t0 = performance.now();
      const cands = this.labelCands, refs = this.labelRefs;
      cands.length = refs.length = 0;
      if (this.namesMode !== 'NENHUM') {
        // "interagindo" = falou no chat ou COMEÇOU uma ação há pouco (dançar sem parar não acende rótulo a 50 m)
        const srvNow = worldClock.now();
        const foc = this.nameFocus?.() ?? null;
        const hover = foc?.hover ?? null, sel = foc?.selected ?? null;
        const share = this.npcNames.share;
        for (const r of this.remotes.values()) {
          const s = r.state;
          const d = Math.hypot(s.x - cam.x, s.z - cam.z);
          // tier 0 = fora do orçamento (não desenhado): sem rótulo flutuando no vazio
          if (d > NAME_LOD.max + NAME_LOD.hyst || (r.agent.tier === 0 && !r.visual)) continue;
          const npc = r.kind === ENTITY_KIND.AUTONOMOUS;
          const tagged = !npc || autonomousTagged(r.nid, share, Number(r.st.tag ?? 0) || 0);
          if (!tagged) { if (r.labelTier !== 'hidden') this.setLabelTier(r, 'hidden'); continue; }
          v.set(s.x, s.y + 2.1, s.z).project(camera);
          cands.push({ key: refs.length, dist: d, nx: v.x, ny: v.y, front: v.z < 1, interacting: r.speakingUntil > now || (r.soc.act !== 0 && srvNow - r.soc.actAt < 4000), prev: r.labelTier, kind: r.kind, tagged, focus: r.id === hover || r.id === sel });
          refs.push(r);
        }
      }
      const occ = this.occluder, oc = this.occlusion;
      oc.begin();
      const pick = selectNames(cands, this.namesMode, NAME_LOD.cap, this.labelScratch, occ ? (k) => {
        const r = refs[k], s = r.state;
        return oc.test(r.nid || k + 100000, now, () => {
          const hy = s.y + 1.75, len = Math.hypot(s.x - cam.x, hy - cam.y, s.z - cam.z);
          return rayBlocks(occ(cam.x, cam.y, cam.z, s.x, hy, s.z), len);
        });
      } : undefined, this.npcNames.ranges);
      const keep = new Set<Remote>();
      for (const k of pick.keys()) keep.add(refs[k]);
      for (const r of [...this.shownLabels]) if (!keep.has(r)) this.setLabelTier(r, 'hidden');
      for (const [k, t] of pick) this.setLabelTier(refs[k], t);
      const st = this.labelStats;
      st.shown = this.shownLabels.size; st.candidates = cands.length; st.decisions++;
      st.decideMs = +(st.decideMs * 0.8 + (performance.now() - t0) * 0.2).toFixed(3);
      st.rays = oc.rays; st.nodes = this.tags.nodes;
    }
    const t1 = performance.now();
    for (const r of this.shownLabels) {
      const s = r.state;
      v.set(s.x, s.y + 2.1, s.z).project(camera);
      if (v.z >= 1 || !r.tag) continue; // atrás da câmera: a próxima decisão esconde
      if (this.tags.move(r.tag, Math.round(((v.x + 1) / 2) * viewport.w), Math.round(((1 - v.y) / 2) * viewport.h))) this.labelStats.transforms++;
    }
    const st = this.labelStats;
    st.frameMs = +(st.frameMs * 0.95 + (performance.now() - t1) * 0.05).toFixed(4);
  }

  /**
   * rodada 12 — QA (tools/qa/humanization_probe.mjs): por remoto detalhado — tipo, ação, velocidade, rumo, com
   * esqueleto, fases normalizadas (caminhada, parado, ação em laço; instanciado: fase do VAT) e o olhar
   */
  humanizationSample() {
    const out: { nid: number; kind: number; act: number; actAt: number; speed: number; heading: number; skinned: boolean; walk: number | null; idle: number | null; actPhase: number | null; vat: number; look: number }[] = [];
    for (const r of this.remotes.values()) {
      if (!r.buf.length) continue;
      const ph = r.visual?.phaseDebug ?? null;
      out.push({ nid: r.nid, kind: r.kind, act: r.soc.act, actAt: r.soc.actAt, speed: +r.state.speed.toFixed(2), heading: +r.state.heading.toFixed(3), skinned: !!r.visual, walk: ph?.walk ?? null, idle: ph?.idle ?? null, actPhase: ph?.actPhase ?? null, vat: +r.agent.phase.toFixed(3), look: r.visual?.lookDebug?.w ?? 0 });
    }
    return out;
  }

  /** rodada 12 — QA: por remoto detalhado, distância à câmera, tipo, nome pela regra, faixa do rótulo e oclusão */
  labelDebug() {
    const c = this.lastCam;
    return [...this.remotes.values()].map((r) => ({ name: r.name, kind: r.kind, d: +Math.hypot(r.state.x - c.x, r.state.z - c.z).toFixed(1), tier: r.labelTier, agentTier: r.agent.tier, visual: !!r.visual, tagged: r.kind !== ENTITY_KIND.AUTONOMOUS || autonomousTagged(r.nid, this.npcNames.share, Number(r.st.tag ?? 0) || 0), occluded: this.occlusion.peek(r.nid) ?? null }));
  }

  /** para QA */
  /** rodada 10 — montagem (QA): fase da montagem e posição desenhada de cada remoto com corpo */
  mountDebug() {
    return [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, vehicle: r.vehicle, visual: !!r.visual, mount: r.visual?.mountInfo ?? null, root: r.visual ? r.visual.root.position.toArray().map((x) => +x.toFixed(3)) : null }));
  }

  remotesInfo(): RemoteInfo[] {
    return [...this.remotes.values()].map((r) => {
      const c = r.buf[r.buf.length - 1];
      return { id: r.id, name: r.name, body: r.body, accessory: r.accessory, x: +r.state.x.toFixed(2), y: +r.state.y.toFixed(2), z: +r.state.z.toFixed(2), speed: +r.state.speed.toFixed(2), interaction: r.interaction, status: r.status, vehicle: r.vehicle, platform: r.platform, plx: +(c?.plx ?? 0).toFixed(3), plz: +(c?.plz ?? 0).toFixed(3), wx: +(c?.x ?? 0).toFixed(2), wz: +(c?.z ?? 0).toFixed(2), link: r.link,
        act: r.soc.act, actPhase: +socialOf(r.soc).phase.toFixed(2), prop: r.soc.prop, design: r.soc.design,
        visualAct: r.visual ? r.visual.social.act : null, visualProp: r.visual ? r.visual.social.prop : null,
        fx: r.fx, fxVisual: r.visual ? r.visual.fxDebug : null };
    });
  }

  /** QA: derruba o WebSocket como uma queda de rede (sem LEAVE consentido) → o SDK tenta reconectar */
  dropConnectionForTest() { (this.room?.connection.transport as unknown as { ws?: { close: () => void } })?.ws?.close(); }
  /** QA: desliga a reconexão automática (para testar o vencimento da graça) */
  setAutoReconnect(on: boolean) { if (this.room) this.room.reconnection.enabled = on; }

  disconnect() {
    this.leaving = true;
    void this.room?.leave();
    for (const list of this.pool.values()) list.forEach((v) => v.dispose());
    this.pool.clear();
  }

  // rodada 10 — áudio: estado mínimo dos remotos detalhados (passos/quedas perto, voto de perfil da multidão).
  // `sup` (torcida, u8: 0 neutro, i+1 = grupo i de supporters.json) é lido de forma tolerante (ausente = 0).
  forEachRemoteAudio(fn: (nid: number, x: number, z: number, speed: number, status: number, sup: number, riding: boolean) => void) {
    for (const r of this.remotes.values()) {
      if (!r.buf.length) continue;
      const sup = Number(r.st.sup ?? 0) || 0; // rodada 12 — lido do estado sincronizado (antes: campo inexistente = sempre 0)
      fn(r.nid, r.state.x, r.state.z, Math.abs(r.state.speed), r.status, sup, !!(r.vehicle || r.platform));
    }
  }
}

const DENIAL_TEXT: Record<string, string> = {
  pacifico_atacante: 'Você está no modo pacífico (K para alternar)',
  pacifico_alvo: 'Esse jogador está no modo pacífico — não pode ser empurrado',
  estado: 'Agora não (alguém está caído ou levantando)',
  veiculo: 'Não dá para empurrar quem está em veículo',
  distancia: 'Longe demais',
  angulo: 'O alvo precisa estar à sua frente',
  cooldown: 'Aguarde um instante',
  spam: 'Calma! Muitas ações seguidas',
  imune: 'Esse jogador acabou de levantar (proteção temporária)',
  obstaculo: 'Tem algo no caminho',
  alvo_invalido: 'Ninguém ao alcance',
};
