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
 */
import './netWebSocket'; // precisa vir ANTES do SDK (instrumenta globalThis.WebSocket)
import * as THREE from 'three';
import { Client, Callbacks, type Room } from '@colyseus/sdk';
import { ROOM_NAME, NET_TICK_HZ, LOCO, type JoinOptions } from './protocol';
import { packMove } from './rules';
import { netStats, SIM } from './netWebSocket';
import { worldClock } from './clock';
import { RIDEABLE_DEFS, seatWorld, type RideableKind } from '../vehicles/Rideable';
import { TRIO, localToWorld, packPlatformMove } from '../vehicles/platform';
import { AvatarVisual } from '../player/AvatarVisual';
import { createPlayerState, type PlayerState } from '../player/PlayerState';
import type { Accessory, BodyType, CharacterAppearance } from '../characters/bodyTypes';
import { decodeCrowd } from './crowdCodec';
import { anonymousClientId } from './clientId';
import { packLook } from '../characters/garments';
import { createAgent, type CrowdAgent } from '../characters/crowd/crowdBudget';
import type { CrowdDirector } from '../characters/crowd/CrowdDirector';
import type { SocialState } from '../social/types';
import { NAME_LOD, selectNames, shortName, type NameCandidate, type NameTier, type NamesMode } from './nameLod';
import { RateGate } from '../ui/hud/throttle';

const BODY_LIST = ['homem', 'mulher', 'idoso', 'idosa'] as const;
const bodyIndex = (b: string) => Math.max(0, BODY_LIST.indexOf(b as (typeof BODY_LIST)[number]));
/** atraso de interpolação da multidão distante: um intervalo de mensagem (500 ms a 2 Hz) + folga */
const FAR_DELAY_MS = 650;

interface FarSnap { t: number; x: number; y: number; z: number; heading: number; speed: number }
interface FarRemote { nid: number; agent: CrowdAgent; a: FarSnap; b: FarSnap; seen: number }

/** estado social → `SocialState` com a fase no relógio comum (todos tocam a mesma fase) */
function socialOf(s: { act: number; actAt: number; actVar: number; prop: number; design: number }): SocialState {
  return { act: s.act, phase: s.act ? Math.max(0, (worldClock.now() - s.actAt) / 1000) : 0, variation: s.actVar, prop: s.prop, design: s.design };
}

interface Snapshot { t: number; x: number; y: number; z: number; heading: number; speed: number; loco: number; vehicle: string; platform: string; plx: number; plz: number; plh: number }

export interface RemoteInfo {
  id: string; name: string; body: string; accessory: string;
  x: number; z: number; speed: number; interaction: string; status: number; vehicle: string;
  /** vida social sincronizada (ids) e o que o esqueleto local está tocando (se houver esqueleto) */
  act: number; actPhase: number; prop: number; design: number; visualAct: number | null; visualProp: number | null;
  /** em cima de um trio: id e posição local */
  platform: string; plx: number; plz: number;
  /** última posição de MUNDO recebida do servidor (QA: o servidor leva o passageiro junto com o trio) */
  wx: number; wz: number;
}

interface Remote {
  id: string;
  nid: number;
  /** esqueleto próprio — só enquanto o orçamento da multidão o concede (pool por corpo) */
  visual: AvatarVisual | null;
  app: CharacterAppearance;
  agent: CrowdAgent;
  state: PlayerState;
  buf: Snapshot[];
  label: HTMLDivElement;
  /** faixa atual do rótulo (LOD dos apelidos, src/net/nameLod.ts) e último transform escrito */
  labelTier: NameTier;
  labelPos: string;
  /** falando no chat até (ms, performance.now) — rótulo ganha prioridade */
  speakingUntil: number;
  name: string;
  body: string;
  accessory: string;
  interaction: string;
  status: number;
  vehicle: string;
  platform: string;
  lastArrival: number;
  /** vida social vinda do servidor (actAt no relógio do servidor) */
  soc: { act: number; actAt: number; actVar: number; prop: number; design: number };
  /** o esqueleto atual já recebeu o estado social atual */
  socApplied: AvatarVisual | null;
}

export interface KnockMsg { target: string; by: string; kind: 'push' | 'impact'; dx: number; dz: number; strength: number; rx: number; rz: number; downMs: number; getupMs: number }

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
  private history = new Map<number, { x: number; z: number }>();
  private jitterMs = 0;
  interpDelay = 120;
  sessionId = '';
  status: 'offline' | 'connecting' | 'online' | 'error' = 'offline';
  lastError = '';
  corrections = 0;
  correctionReasons: Record<string, number> = {};
  /** estado do PRÓPRIO jogador segundo o servidor */
  self = { interaction: 'pacifico', status: 0, vehicle: '', platform: '', social: { act: 0, actAt: 0, actVar: 0, prop: 0, design: 0 } };
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
  onVehicle: ((id: string, v: { x: number; y: number; z: number; heading: number; occupant: string; kind: string; state: number; design: number }) => void) | null = null;
  // ---- trio elétrico (plataforma)
  /** em cima de um trio: o jogo atualiza a posição LOCAL a cada quadro; o envio vira 'pmove' */
  platform: { id: string; lx: number; lz: number; lh: number; speed: number; loco: number } | null = null;
  /** pose do trio COMO ESTE CLIENTE O DESENHA (interpolada) — os passageiros remotos são presos a ela */
  platformPose: ((id: string) => { x: number; y: number; z: number; heading: number } | null) | null = null;
  onBoard: ((ok: boolean, d: { id: string; reason?: string; lx?: number; lz?: number }) => void) | null = null;
  onUnboard: ((pos: { x: number; z: number }) => void) | null = null;
  onPlatformCorrect: ((lx: number, lz: number, reason: string) => void) | null = null;
  onEnter: ((ok: boolean, data: { id: string; reason?: string; x?: number; z?: number; heading?: number }) => void) | null = null;
  onExit: ((pos: { x: number; z: number }) => void) | null = null;
  onKnock: ((k: KnockMsg, isSelf: boolean) => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;
  onEvent: ((eventId: string) => void) | null = null;

  constructor(private endpoint: string, hudRoot: HTMLElement) {
    this.group.name = 'remote_players';
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    hudRoot.prepend(this.labels); // por baixo do HUD (menu, minimapa, ajustes)
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

  async connect(app: CharacterAppearance, name: string, testSpawn?: { x: number; z: number }): Promise<void> {
    this.status = 'connecting';
    try {
      const client = new Client(this.endpoint);
      const opts: JoinOptions = { name, body: app.body, skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, shoes: app.shoes, accessory: app.accessory ?? 'nenhum', acc: app.acc ?? 0x222222, topStyle: app.topStyle, bottomStyle: app.bottomStyle, shoeStyle: app.shoeStyle, hairStyle: app.hairStyle, shirtDesign: app.shirtDesign ?? 0, cid: anonymousClientId(), ...(testSpawn ? { testSpawn } : {}), ...testGroupOpt(), ...(this.crowd ? { aoiMax: Math.max(16, Math.min(64, this.crowd.budget.skinned * 2)) } : {}) };
      const room = await client.joinOrCreate(ROOM_NAME, opts);
      this.room = room;
      this.sessionId = room.sessionId;
      this.status = 'online';
      for (const type of this.handlers.keys()) room.onMessage(type, (m: unknown) => this.dispatch(type, m));
      room.onMessage('spawn', (s: { x: number; y: number; z: number; heading: number; policy: 'pacifico' | 'opcional'; seed: number }) => {
        this.policy = s.policy; this.seed = s.seed;
        this.onSpawn?.(s);
        this.spawned = true;
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
      room.onLeave(() => { this.status = 'offline'; });
      const cb = Callbacks.get(room as any) as any;
      cb.listen('eventId', (id: string) => { if (id) this.onEvent?.(id); });
      cb.onAdd('players', (p: any, id: string) => {
        if (id === this.sessionId) {
          cb.onChange(p, () => {
            this.self.interaction = p.interaction; this.self.status = p.status; this.self.vehicle = p.vehicle; this.self.platform = p.platform ?? '';
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
        const emit = () => this.onVehicle?.(id, { x: v.x, y: v.y, z: v.z, heading: v.heading, occupant: v.occupant, kind: v.kind, state: v.state ?? 0, design: v.design ?? 0 });
        emit();
        cb.onChange(v, emit);
      });
      // área de interesse: o servidor tira da vista veículos distantes
      cb.onRemove('vehicles', (_v: any, id: string) => { this.vehicleKinds.delete(id); });
      // sincronização rápida do relógio
      for (let i = 0; i < 5; i++) setTimeout(() => this.room?.send('ping', Date.now()), 150 * i);
    } catch (e) {
      this.status = 'error';
      this.lastError = (e as Error)?.message ?? String(e);
      throw e;
    }
  }

  // ---------------------------------------------------------------- comandos
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

  remotesForObstacles(): { x: number; z: number; interaction: string; status: number; vehicle: string; platform: string }[] {
    return [...this.remotes.values()].map((r) => ({ x: r.state.x, z: r.state.z, interaction: r.interaction, status: r.status, vehicle: r.vehicle, platform: r.platform }));
  }

  // ---------------------------------------------------------------- remotos
  private addRemote(id: string, p: any) {
    const app: CharacterAppearance = {
      body: (p.body || 'homem') as BodyType, skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, scale: 1, accessory: (p.accessory || 'nenhum') as Accessory, acc: p.acc,
      topStyle: p.topStyle || undefined, bottomStyle: p.bottomStyle || undefined, shoeStyle: p.shoeStyle || undefined, hairStyle: p.hairStyle || undefined, shirtDesign: p.shirtDesign || 0,
    };
    const nid = Number(p.nid) || 0;
    if (nid) { this.remoteNids.add(nid); this.far.delete(nid); }
    const agent = createAgent({ x: p.x, y: p.y, z: p.z, heading: p.heading, body: bodyIndex(app.body), skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, look: packLook(app), shirt: app.shirtDesign ?? 0 });
    const label = document.createElement('div');
    label.className = 'name-label';
    label.textContent = p.name || 'Visitante';
    label.hidden = true;
    this.labels.appendChild(label);
    const r: Remote = {
      id, nid, visual: null, app, agent, state: createPlayerState(id, p.x, p.y, p.z, p.heading), buf: [], label, labelTier: 'hidden', labelPos: '', speakingUntil: 0, name: p.name, body: p.body, accessory: p.accessory || 'nenhum',
      interaction: p.interaction, status: p.status, vehicle: p.vehicle, platform: p.platform ?? '', lastArrival: performance.now(),
      soc: { act: p.act ?? 0, actAt: p.actAt ?? 0, actVar: p.actVar ?? 0, prop: p.prop ?? 0, design: p.design ?? 0 }, socApplied: null,
    };
    this.remotes.set(id, r);
    if (!this.crowd) this.acquire(r);
    this.pushSnapshot(id, p);
  }

  /** esqueleto do pool (mesmo corpo) ou novo */
  private acquire(r: Remote): AvatarVisual {
    const list = this.pool.get(r.app.body);
    let v = list?.pop();
    if (v) { v.resetForReuse(); v.setAppearance(r.app); }
    else v = new AvatarVisual(r.app, { lod: 2, castShadow: false });
    this.group.add(v.root);
    r.visual = v;
    return v;
  }

  private release(r: Remote) {
    const v = r.visual;
    if (!v) return;
    r.visual = null;
    r.agent.skinReady = false;
    this.group.remove(v.root);
    let list = this.pool.get(r.app.body);
    if (!list) this.pool.set(r.app.body, (list = []));
    // pool pequeno por corpo: o suficiente para trocas na borda do orçamento sem recriar personagens
    const keep = Math.ceil((this.crowd?.budget.skinned ?? 8) / 3) + 2;
    if (list.length < keep) list.push(v); else v.dispose();
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
        f = { nid: e.nid, agent: createAgent({ maxTier: 1, body: e.body, x: e.x, y: e.y, z: e.z, heading: e.heading, ...(app ?? {}) }), a: snap, b: snap, seen: stamp };
        this.far.set(e.nid, f);
      } else {
        f.a = f.b; f.b = snap; f.seen = stamp;
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
    r.buf.push({ t: now, x: p.x, y: p.y, z: p.z, heading: p.heading, speed: p.speed, loco: p.loco, vehicle: p.vehicle, platform: p.platform ?? '', plx: p.plx ?? 0, plz: p.plz ?? 0, plh: p.plh ?? 0 });
    if (r.buf.length > 40) r.buf.shift();
    r.interaction = p.interaction; r.status = p.status; r.vehicle = p.vehicle; r.platform = p.platform ?? '';
    const so = r.soc;
    if (so.act !== p.act || so.actAt !== p.actAt || so.prop !== p.prop || so.design !== p.design || so.actVar !== p.actVar) {
      r.soc = { act: p.act, actAt: p.actAt, actVar: p.actVar, prop: p.prop, design: p.design };
      r.socApplied = null;
    }
    r.label.classList.toggle('combat', p.interaction === 'interacao');
    if (p.name && p.name !== r.name) { r.name = p.name; if (r.labelTier !== 'hidden') this.setLabelTier(r, r.labelTier, true); }
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.release(r);
    r.label.remove();
    this.shownLabels.delete(r);
    if (r.nid) this.remoteNids.delete(r.nid);
    this.remotes.delete(id);
  }

  private handleKnock(k: KnockMsg) {
    if (k.target === this.sessionId) { this.onKnock?.(k, true); return; }
    const r = this.remotes.get(k.target);
    if (r) {
      // queda é rara e importante: ganha esqueleto na hora (o orçamento o mantém enquanto estiver caído)
      if (!r.visual && Math.hypot(r.state.x - this.lastCam.x, r.state.z - this.lastCam.z) < (this.crowd?.budget.skinnedMaxDist ?? 1e9)) this.acquire(r);
      if (r.visual) void r.visual.knockdown({ dirX: k.dx, dirZ: k.dz, strength: k.strength, groundY: r.state.y, walls: [], downMs: k.downMs, getupMs: k.getupMs });
      // posição de repouso autoritativa: o buffer passa a apontar para ela
      r.buf.length = 0;
      r.buf.push({ t: performance.now(), x: k.rx, y: r.state.y, z: k.rz, heading: r.state.heading, speed: 0, loco: 0, vehicle: '', platform: '', plx: 0, plz: 0, plh: 0 });
    }
    this.onKnock?.(k, false);
  }

  // ---------------------------------------------------------------- por frame
  update(dt: number, local: PlayerState, riding: string | null, camera: THREE.Camera, viewport: { w: number; h: number }) {
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
      if (r.socApplied !== visual) { visual.setSocial(socialOf(r.soc)); r.socApplied = visual; }
      if (crowd) { visual.applyLod(ag.lod, d); visual.root.visible = ag.inView || d < 6 || visual.isDown; }
      else visual.setDistance(d);
      if (c.vehicle && !visual.isDown) {
        // tipo REAL do veículo (sincronizado), não deduzido do id
        const def = RIDEABLE_DEFS[(this.vehicleKinds.get(c.vehicle) ?? 'bicycle') as RideableKind] ?? RIDEABLE_DEFS.bicycle;
        const seat = seatWorld(def, s.x, s.z, s.heading); // carro de som/trio: banco na cabine, longe do centro
        visual.updateRiding(seat.x, s.y, seat.z, s.heading, def.pose, s.speed, def.seatHeight, dt);
      } else visual.update(s, dt, crowd ? visual.root.visible && crowd.shouldAnimate(ag) : undefined);
    }
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
  labelStats = { shown: 0, candidates: 0, decisions: 0, decideMs: 0, transforms: 0 };

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
    const was = r.labelTier;
    r.labelTier = t;
    if (t === 'hidden') { r.label.hidden = true; r.labelPos = ''; this.shownLabels.delete(r); return; }
    const name = r.name || 'Visitante';
    r.label.textContent = t === 'short' ? shortName(name) : name;
    if (t === 'short' || was === 'short' || force) r.label.classList.toggle('short', t === 'short');
    r.label.hidden = false;
    this.shownLabels.add(r);
  }

  /**
   * decisões (quem tem rótulo e em que faixa) a 5 Hz; por quadro só o transform dos escolhidos (≤ NAME_LOD.cap),
   * e só quando muda de pixel — nada de display/texto/classe por quadro.
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
        for (const r of this.remotes.values()) {
          const s = r.state;
          const d = Math.hypot(s.x - cam.x, s.z - cam.z);
          // tier 0 = fora do orçamento (não desenhado): sem rótulo flutuando no vazio
          if (d > NAME_LOD.max + NAME_LOD.hyst || (r.agent.tier === 0 && !r.visual)) continue;
          v.set(s.x, s.y + 2.1, s.z).project(camera);
          cands.push({ key: refs.length, dist: d, nx: v.x, ny: v.y, front: v.z < 1, interacting: r.speakingUntil > now || (r.soc.act !== 0 && srvNow - r.soc.actAt < 4000), prev: r.labelTier });
          refs.push(r);
        }
      }
      const pick = selectNames(cands, this.namesMode, NAME_LOD.cap, this.labelScratch);
      const keep = new Set<Remote>();
      for (const k of pick.keys()) keep.add(refs[k]);
      for (const r of [...this.shownLabels]) if (!keep.has(r)) this.setLabelTier(r, 'hidden');
      for (const [k, t] of pick) this.setLabelTier(refs[k], t);
      const st = this.labelStats;
      st.shown = this.shownLabels.size; st.candidates = cands.length; st.decisions++;
      st.decideMs = +(st.decideMs * 0.8 + (performance.now() - t0) * 0.2).toFixed(3);
    }
    for (const r of this.shownLabels) {
      const s = r.state;
      v.set(s.x, s.y + 2.1, s.z).project(camera);
      if (v.z >= 1) continue; // atrás da câmera: a próxima decisão esconde
      const pos = `translate3d(${Math.round(((v.x + 1) / 2) * viewport.w)}px,${Math.round(((1 - v.y) / 2) * viewport.h)}px,0) translate(-50%,-100%)`;
      if (pos === r.labelPos) continue;
      r.labelPos = pos;
      r.label.style.transform = pos;
      this.labelStats.transforms++;
    }
  }

  /** para QA */
  remotesInfo(): RemoteInfo[] {
    return [...this.remotes.values()].map((r) => {
      const c = r.buf[r.buf.length - 1];
      return { id: r.id, name: r.name, body: r.body, accessory: r.accessory, x: +r.state.x.toFixed(2), z: +r.state.z.toFixed(2), speed: +r.state.speed.toFixed(2), interaction: r.interaction, status: r.status, vehicle: r.vehicle, platform: r.platform, plx: +(c?.plx ?? 0).toFixed(3), plz: +(c?.plz ?? 0).toFixed(3), wx: +(c?.x ?? 0).toFixed(2), wz: +(c?.z ?? 0).toFixed(2),
        act: r.soc.act, actPhase: +socialOf(r.soc).phase.toFixed(2), prop: r.soc.prop, design: r.soc.design,
        visualAct: r.visual ? r.visual.social.act : null, visualProp: r.visual ? r.visual.social.prop : null };
    });
  }

  disconnect() {
    void this.room?.leave();
    for (const list of this.pool.values()) list.forEach((v) => v.dispose());
    this.pool.clear();
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
