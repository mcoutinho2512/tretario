/**
 * Rodada 10 — COLA entre o jogo e o áudio: tudo o que o jogo já sabe vira pedido ao contrato (bus.ts), sem que
 * Game/veículos/multidão precisem conhecer WebAudio. Uma chamada por quadro (`update`) + o "tap" da multidão.
 *
 *  ouvinte     câmera (rumo) e um ponto entre a câmera e o personagem (distância) → `audioListener`
 *  passos      jogador local pela distância andada (passada cresce com a velocidade; superfície do CollisionWorld:
 *              pista = asfalto, calçada/plataforma = calçada) + pulo/aterrissagem; remotos detalhados mais perto (≤ 4)
 *  quedas      mudança de estado físico (NetPlayer.status: caiu / levantando) do próprio e dos remotos
 *  veículos    um laço LÓGICO por veículo perto (motor do carro/moto, rolagem da bicicleta, motor elétrico do patinete,
 *              música própria do trio/carro de som — espacial, nunca global); freio pela desaceleração; porta/montar
 *              pela troca de ocupante. O AudioManager decide quais viram vozes reais (≤ 8)
 *  multidão    CrowdDirector.audioTap → CrowdAudioAggregator (≤ 4 células) → `audioCrowd`; perfil pelo design de
 *              camisa/bandeira (supporters.json) e por `NetPlayer.sup`; tipo de evento pelos pontos de evento
 *  interface   clique em botão do HUD → ui_click (captura no documento; sem tocar nos componentes)
 */
import * as THREE from 'three';
import { audioCrowd, audioListener, audioLoop, sfx, type LoopHandle, type LoopKind } from './bus';
import { AudioManager, type AudioBudget } from './AudioManager';
import { CrowdAudioAggregator, type EventZone, type SupporterAudioData } from './crowdCells';
import { eventCrowdProfile } from './catalog';
import { audioSettings } from './settings';
import type { CrowdAgent } from '../characters/crowd/crowdBudget';
import type { PlayerState } from '../player/PlayerState';
import type { RideableInstance } from '../vehicles/Rideable';
import type { NetworkClient } from '../net/NetworkClient';
import type { CrowdCellSnapshot } from '../spectator/tiers';

export interface AudioWorldDeps {
  camera: THREE.Camera;
  player: PlayerState;
  /** posição desenhada do personagem local */
  avatarPos: () => THREE.Vector3;
  isDown: () => boolean;
  ridingId: () => string | null;
  onPlatform: () => boolean;
  rideables: { items: RideableInstance[] };
  /** Surface do CollisionWorld (1 pista, 2 calçada, 3 plataforma…) */
  surfaceAt: (x: number, z: number) => number;
  net: () => NetworkClient | null;
  spectator: boolean;
  aerial: () => boolean;
  /** evento atual (formato/categoria/ambience) */
  event: () => { format?: string; category?: string; ambience?: { music?: string; crowd?: string } } | null;
  /** células do espectador no alto (vista aérea: a multidão vem delas) */
  specCells?: () => Iterable<CrowdCellSnapshot> | null;
  /** pontos de evento ativos (concentração da caminhada, largada…) com o formato */
  eventZones?: () => EventZone[];
  baseUrl?: string;
}

const LOOP_OF: Record<string, LoopKind> = { car: 'car_engine', moto: 'moto_engine', bicycle: 'bike_roll', scooter: 'scooter_motor', soundcar: 'soundcar_music', trio: 'trio_music' };
const CELL_M = 40; // CROWD_CELL.sizeM (spectator/tiers.ts)

interface VehAudio { h: LoopHandle | null; px: number; pz: number; speed: number; occ: string | null; brakeAt: number; seen: number }
interface RemoteAudio { status: number; acc: number; seen: number }

export class AudioWorld {
  readonly manager: AudioManager;
  readonly agg = new CrowdAudioAggregator();
  private d: AudioWorldDeps | null = null;
  private tapAcc = 0;
  private tapDue = true;
  private veh = new Map<string, VehAudio>();
  private remotes = new Map<number, RemoteAudio>();
  private stepAcc = 0;
  private wasGrounded = true;
  private airT = 0;
  private selfStatus = 0;
  private selfDown = false;
  private selfProp = 0;
  private frame = 0;
  private dir = new THREE.Vector3();
  private lp = new THREE.Vector3();
  private profileFor = '';
  private ms = 0;

  constructor(budget: Partial<AudioBudget> = {}) {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    if (q?.get('audioReverb') === '0') budget.reverb = false;
    this.manager = new AudioManager(audioSettings, budget);
    if (q?.get('audio') !== '0' && typeof window !== 'undefined') this.manager.installUnlock(window);
  }

  attach(d: AudioWorldDeps) {
    this.d = d;
    void fetch(`${d.baseUrl ?? '/'}gameplay/supporters.json`).then((r) => (r.ok ? r.json() : null)).then((j: SupporterAudioData | null) => { this.supporters = j; this.profileFor = ''; }).catch(() => { /* sem torcidas: só o perfil do evento */ });
    if (typeof document !== 'undefined') {
      document.addEventListener('click', (e) => {
        const t = e.target as HTMLElement | null;
        if (t && !(t instanceof HTMLCanvasElement) && t.closest?.('button, [role="button"], .seg-row label, .sheet-check, a.hud-link')) sfx('ui_click');
      }, { capture: true, passive: true });
    }
  }
  private supporters: SupporterAudioData | null = null;

  /** CrowdDirector.audioTap: agentes do quadro (lê a ~4 Hz) */
  crowdTap = (agents: readonly CrowdAgent[]) => {
    if (!this.tapDue || !this.d || this.d.aerial()) return;
    this.tapDue = false;
    const L = this.manager.listenerPose;
    this.agg.begin(L.x, L.z);
    for (const a of agents) this.agg.addAgent(a.x, a.z, a.speed, a.act, a.tilt, a.shirt, a.design);
    this.finishCells();
  };

  private finishCells() {
    const d = this.d!;
    const net = d.net();
    net?.forEachRemoteAudio((_n, x, z, _s, _st, sup) => this.agg.addVote(x, z, sup, 2));
    const now = this.manager.time;
    for (const h of this.manager.heatPoints()) this.agg.addHeat(h.x, h.z, h.k * Math.max(0, 1 - (now - h.t) / 6) * 0.4, 0);
    this.agg.setEventZones(d.eventZones?.() ?? []);
    audioCrowd(this.agg.end());
  }

  update(dt: number) {
    const d = this.d;
    if (!d) return;
    const t0 = performance.now();
    this.frame++;
    // ouvinte: rumo da câmera; distância medida de um ponto entre a câmera e o personagem (3ª pessoa) ou da câmera
    const cam = d.camera;
    cam.getWorldDirection(this.dir);
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    const ap = d.avatarPos();
    // câmera longe do corpo (espectador, câmera livre/aérea): o ouvinte é a câmera
    if (d.spectator || cam.position.distanceTo(ap) > 30) this.lp.copy(cam.position);
    else this.lp.copy(cam.position).lerp(ap, 0.6);
    audioListener(this.lp.x, this.lp.y, this.lp.z, yaw);

    // perfil padrão da multidão (evento) e perfis das torcidas (dados)
    const ev = d.event();
    const prof = eventCrowdProfile(ev);
    const key = `${prof}|${this.supporters ? this.supporters.groups.length : 0}`;
    if (key !== this.profileFor) { this.profileFor = key; this.agg.setProfiles(prof, this.supporters); }

    if ((this.tapAcc += dt) > 0.25) { this.tapAcc = 0; this.tapDue = true; if (d.aerial()) this.aerialCells(); }

    if (!d.spectator) this.localBody(dt, ap);
    this.remoteBodies(dt);
    this.vehicles(dt);
    this.manager.update(dt);
    this.ms = this.ms * 0.95 + (performance.now() - t0) * 0.05;
  }

  /** espectador no alto: a multidão vem das células agregadas do servidor (jogadores + ambiente) */
  private aerialCells() {
    const d = this.d!;
    this.tapDue = false;
    const L = this.manager.listenerPose;
    this.agg.begin(L.x, L.z);
    for (const c of d.specCells?.() ?? []) {
      const n = c.players + c.env;
      const act = c.players > 0 ? (c.activity[1] + c.activity[2] + c.activity[3]) / Math.max(1, c.players) : 0.2;
      this.agg.addMass((c.cx + 0.5) * CELL_M, (c.cz + 0.5) * CELL_M, n, Math.min(1, act));
    }
    this.finishCells();
  }

  private localBody(dt: number, ap: THREE.Vector3) {
    const d = this.d!, p = d.player;
    const riding = !!d.ridingId();
    const down = d.isDown();
    // queda/levantar do próprio (sem rede: pelo boneco)
    const net = d.net();
    const st = net ? net.self.status : down ? 1 : 0;
    if (st !== this.selfStatus) { this.onStatus(this.selfStatus, st, ap.x, ap.y, ap.z, 1); this.selfStatus = st; }
    else if (!net && down !== this.selfDown) sfx(down ? 'fall' : 'getup', { x: ap.x, y: ap.y, z: ap.z });
    this.selfDown = down;
    // item na mão (servidor confirmou): pegar / largar
    const prop = net?.self.social.prop ?? 0;
    if (prop !== this.selfProp) { sfx(prop ? 'pickup' : 'drop', { x: ap.x, y: ap.y + 1, z: ap.z, gain: 0.7 }); this.selfProp = prop; }
    if (riding || down) { this.stepAcc = 0; this.wasGrounded = true; return; }
    const sp = Math.abs(p.speed);
    if (!p.grounded) this.airT += dt;
    if (this.wasGrounded && !p.grounded && p.vy > 1.5) sfx('jump', { x: ap.x, y: ap.y, z: ap.z, gain: 0.6 });
    if (!this.wasGrounded && p.grounded) { if (this.airT > 0.25) sfx('land', { x: ap.x, y: ap.y, z: ap.z, gain: Math.min(1, 0.4 + this.airT) }); this.airT = 0; this.stepAcc = 0; }
    this.wasGrounded = p.grounded;
    if (!p.grounded || sp < 0.6) { this.stepAcc = Math.min(this.stepAcc, 0.3); return; }
    this.stepAcc += sp * dt;
    const stride = 0.7 + sp * 0.2;
    if (this.stepAcc >= stride) {
      this.stepAcc -= stride;
      sfx('step', { x: ap.x, y: ap.y, z: ap.z, surface: this.surface(ap.x, ap.z), gain: Math.min(1, 0.45 + sp * 0.08), pitchJitter: 0.08 });
    }
  }

  private surface(x: number, z: number): 'asphalt' | 'sidewalk' | 'grass' {
    const s = this.d!.surfaceAt(x, z);
    return s === 1 ? 'asphalt' : 'sidewalk';
  }

  private onStatus(prev: number, st: number, x: number, y: number | undefined, z: number, gain: number) {
    // PHYS (combat/types.ts): 1 caído, 2 levantando, 4 ragdoll
    if ((st === 1 || st === 4) && prev !== 1 && prev !== 4) sfx('fall', { x, y, z, gain });
    else if (st === 2 && prev !== 2) sfx('getup', { x, y, z, gain: gain * 0.8 });
  }

  /** remotos detalhados: quedas (todos os do AOI) e passos dos ≤ 4 mais perto */
  private near: { nid: number; d: number; x: number; z: number; speed: number }[] = [];
  private remoteBodies(dt: number) {
    const net = this.d!.net();
    if (!net) return;
    const L = this.manager.listenerPose;
    this.near.length = 0;
    const f = this.frame;
    net.forEachRemoteAudio((nid, x, z, speed, status, _sup, riding) => {
      let r = this.remotes.get(nid);
      if (!r) { r = { status, acc: 0, seen: f }; this.remotes.set(nid, r); }
      r.seen = f;
      if (status !== r.status) { this.onStatus(r.status, status, x, undefined, z, 0.9); r.status = status; }
      if (riding || status !== 0 || speed < 0.6) return;
      const dd = Math.hypot(x - L.x, z - L.z);
      if (dd < 16) this.near.push({ nid, d: dd, x, z, speed });
    });
    if (f % 120 === 0) for (const [k, r] of this.remotes) if (f - r.seen > 60) this.remotes.delete(k);
    this.near.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(4, this.near.length); i++) {
      const n = this.near[i], r = this.remotes.get(n.nid)!;
      r.acc += n.speed * dt;
      const stride = 0.7 + n.speed * 0.2;
      if (r.acc >= stride) { r.acc -= stride; sfx('step', { x: n.x, z: n.z, surface: this.surface(n.x, n.z), gain: 0.4, pitchJitter: 0.1 }); }
    }
  }

  /** um laço lógico por veículo perto; o AudioManager virtualiza o que não couber/não se ouve */
  private vehicles(dt: number) {
    const d = this.d!;
    const L = this.manager.listenerPose;
    const mine = d.ridingId();
    const f = this.frame;
    for (const it of d.rideables.items) {
      const s = it.state, kind = it.def.kind;
      const dist = Math.hypot(s.x - L.x, s.z - L.z);
      const range = kind === 'trio' ? 300 : kind === 'soundcar' ? 210 : kind === 'car' || kind === 'moto' ? 110 : 35;
      let v = this.veh.get(s.id);
      if (dist > range) { if (v) { v.h?.stop(); this.veh.delete(s.id); } continue; }
      if (!v) { v = { h: null, px: s.x, pz: s.z, speed: 0, occ: s.occupant, brakeAt: -1e9, seen: f }; this.veh.set(s.id, v); }
      v.seen = f;
      const gy = Number.isFinite(s.y) ? s.y : undefined; // y do servidor pode faltar (só x/z): som no chão
      const at = (dy: number) => (gy === undefined ? undefined : gy + dy);
      // velocidade: do estado (dirigido aqui) ou estimada pelo deslocamento suavizado (remotos)
      const prev = v.speed;
      const est = dt > 0 ? Math.hypot(s.x - v.px, s.z - v.pz) / dt : 0;
      v.speed = s.id === mine ? Math.abs(s.speed) : v.speed + (Math.min(est, 20) - v.speed) * Math.min(1, dt * 6);
      v.px = s.x; v.pz = s.z;
      if (s.occupant !== v.occ) {
        const door = kind === 'car' || kind === 'soundcar' || kind === 'trio';
        sfx(door ? 'veh_door' : 'veh_mount', { x: s.x, y: at(0.8), z: s.z, gain: 0.8 });
        v.occ = s.occupant;
      }
      const decel = dt > 0 ? (prev - v.speed) / dt : 0;
      const now = performance.now();
      if (decel > it.def.brake * 0.55 && prev > 2 && now - v.brakeAt > 1200) {
        v.brakeAt = now;
        sfx(kind === 'bicycle' || kind === 'scooter' ? ('bike_brake' as never) : 'veh_brake', { x: s.x, y: at(0.4), z: s.z, gain: Math.min(1, prev / it.def.maxSpeed) });
      }
      const music = kind === 'trio' || kind === 'soundcar';
      const engineOn = music || !!s.occupant || v.speed > 0.3;
      if (!engineOn) { if (v.h) { v.h.stop(); v.h = null; } continue; }
      const k = Math.min(1.3, v.speed / Math.max(0.1, it.def.maxSpeed));
      let rate = 1, gain = 1;
      if (kind === 'car' || kind === 'moto') { rate = 0.62 + k * 0.85; gain = 0.55 + 0.45 * k; }
      else if (kind === 'scooter') { rate = 0.5 + k * 0.9; gain = Math.min(1, 0.15 + k); }
      else if (kind === 'bicycle') { rate = 0.4 + k * 0.9; gain = Math.min(1, k * 1.2); }
      const pos = { x: s.x, y: at(music ? 3 : 0.6), z: s.z };
      if (!v.h) v.h = audioLoop(LOOP_OF[kind], pos);
      v.h.set({ ...pos, rate, gain });
    }
    if (f % 90 === 0) for (const [id, v] of this.veh) if (f - v.seen > 30) { v.h?.stop(); this.veh.delete(id); }
  }

  /** QA: estado completo (window.__pvAudio) */
  qa() { return { ...this.manager.stats(), world: { ms: +this.ms.toFixed(3), vehiclesTracked: this.veh.size, remotesTracked: this.remotes.size, aggAdded: this.agg.lastAdded, profiles: [...this.agg.profiles] } }; }
}
