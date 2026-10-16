/**
 * Cliente multiplayer (Colyseus SDK). Opcional: só conecta com ?mp=1 (ou ?mp=ws://host:porta).
 *
 *  predição      o jogador local move-se imediatamente; envia propostas a 15 Hz (compactas, com seq)
 *  reconciliação correções do servidor: aplica o erro medido no seq corrigido sobre a posição atual
 *  interpolação  remotos com buffer adaptativo ao jitter medido (100–300 ms)
 *  relógio       ping/pong estilo NTP → worldClock (semáforos e trânsito iguais para todos)
 *  mundo         trânsito por snapshots binários (área de interesse); veículos e jogadores via StateView
 */
import './netWebSocket'; // precisa vir ANTES do SDK (instrumenta globalThis.WebSocket)
import * as THREE from 'three';
import { Client, Callbacks, type Room } from '@colyseus/sdk';
import { ROOM_NAME, NET_TICK_HZ, LOCO, type JoinOptions } from './protocol';
import { packMove } from './rules';
import { netStats, SIM } from './netWebSocket';
import { worldClock } from './clock';
import { AvatarVisual } from '../player/AvatarVisual';
import { createPlayerState, type PlayerState } from '../player/PlayerState';
import type { CharacterAppearance } from '../characters/bodyTypes';

interface Snapshot { t: number; x: number; y: number; z: number; heading: number; speed: number; loco: number; vehicle: string }

export interface RemoteInfo {
  id: string; name: string; body: string;
  x: number; z: number; speed: number; interaction: string; status: number; vehicle: string;
}

interface Remote {
  id: string;
  visual: AvatarVisual;
  state: PlayerState;
  buf: Snapshot[];
  label: HTMLDivElement;
  name: string;
  body: string;
  interaction: string;
  status: number;
  vehicle: string;
  lastArrival: number;
}

export interface KnockMsg { target: string; by: string; kind: 'push' | 'impact'; dx: number; dz: number; strength: number; rx: number; rz: number; downMs: number; getupMs: number }

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
  self = { interaction: 'pacifico', status: 0, vehicle: '' };
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
  onTraffic: ((buf: Uint8Array) => void) | null = null;
  onVehicle: ((id: string, v: { x: number; y: number; z: number; heading: number; occupant: string; kind: string }) => void) | null = null;
  onEnter: ((ok: boolean, data: { id: string; reason?: string; x?: number; z?: number; heading?: number }) => void) | null = null;
  onExit: ((pos: { x: number; z: number }) => void) | null = null;
  onKnock: ((k: KnockMsg, isSelf: boolean) => void) | null = null;
  onNotice: ((msg: string) => void) | null = null;
  onEvent: ((eventId: string) => void) | null = null;

  constructor(private endpoint: string, hudRoot: HTMLElement) {
    this.group.name = 'remote_players';
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    hudRoot.appendChild(this.labels);
  }

  get remoteCount() { return this.remotes.size; }

  async connect(app: CharacterAppearance, name: string, testSpawn?: { x: number; z: number }): Promise<void> {
    this.status = 'connecting';
    try {
      const client = new Client(this.endpoint);
      const opts: JoinOptions = { name, body: app.body, skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, shoes: app.shoes, ...(testSpawn ? { testSpawn } : {}) };
      const room = await client.joinOrCreate(ROOM_NAME, opts);
      this.room = room;
      this.sessionId = room.sessionId;
      this.status = 'online';
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
      room.onMessage('traffic', (b: Uint8Array | ArrayBuffer) => this.onTraffic?.(b instanceof Uint8Array ? b : new Uint8Array(b)));
      room.onMessage('enter_ok', (d: { id: string; x: number; z: number; heading: number }) => { this.holdMoves = false; this.onEnter?.(true, d); });
      room.onMessage('enter_denied', (d: { id: string; reason: string }) => { this.holdMoves = false; this.lastDenial = `enter:${d.reason}`; this.onEnter?.(false, d); });
      room.onMessage('exit_ok', (d: { x: number; z: number }) => { this.holdMoves = false; this.onExit?.(d); });
      room.onMessage('mode_ok', (m: string) => { this.self.interaction = m; this.onNotice?.(m === 'interacao' ? 'Modo INTERAÇÃO (validado pelo servidor)' : 'Modo PACÍFICO'); });
      room.onMessage('mode_denied', (r: string) => this.onNotice?.(r === 'evento_pacifico' ? 'Este evento é pacífico' : `Modo negado: ${r}`));
      room.onMessage('push_denied', (r: string) => { this.lastDenial = `push:${r}`; this.onNotice?.(DENIAL_TEXT[r] ?? `Empurrão negado (${r})`); });
      room.onMessage('action', (a: { by: string; type: string }) => { const r = this.remotes.get(a.by); if (r) r.visual.playPush(); });
      room.onMessage('knock', (k: KnockMsg) => this.handleKnock(k));
      room.onLeave(() => { this.status = 'offline'; });
      const cb = Callbacks.get(room as any) as any;
      cb.listen('eventId', (id: string) => { if (id) this.onEvent?.(id); });
      cb.onAdd('players', (p: any, id: string) => {
        if (id === this.sessionId) {
          cb.onChange(p, () => { this.self.interaction = p.interaction; this.self.status = p.status; this.self.vehicle = p.vehicle; });
          return;
        }
        this.addRemote(id, p);
        cb.onChange(p, () => this.pushSnapshot(id, p));
      });
      cb.onRemove('players', (_p: any, id: string) => this.removeRemote(id));
      cb.onAdd('vehicles', (v: any, id: string) => {
        const emit = () => this.onVehicle?.(id, { x: v.x, y: v.y, z: v.z, heading: v.heading, occupant: v.occupant, kind: v.kind });
        emit();
        cb.onChange(v, emit);
      });
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
  requestMode(m: 'pacifico' | 'interacao') { this.send('mode', m); }
  /** entrar/sair levam o seq atual: o servidor descarta movimentos antigos ainda em trânsito */
  requestEnter(id: string) { this.holdMoves = true; this.send('enter', { id, seq: this.seq }); }
  requestExit() { this.holdMoves = true; this.send('exit', { seq: this.seq }); }
  /** segura o envio de movimento entre o pedido de entrar/sair e a resposta (a posição muda de "dono") */
  private holdMoves = false;
  requestPush(target: string) { this.send('push', target); }

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

  remotesForObstacles(): { x: number; z: number; interaction: string; status: number; vehicle: string }[] {
    return [...this.remotes.values()].map((r) => ({ x: r.state.x, z: r.state.z, interaction: r.interaction, status: r.status, vehicle: r.vehicle }));
  }

  // ---------------------------------------------------------------- remotos
  private addRemote(id: string, p: any) {
    const app: CharacterAppearance = { body: p.body || 'homem', skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, scale: 1 };
    const visual = new AvatarVisual(app);
    this.group.add(visual.root);
    const label = document.createElement('div');
    label.className = 'name-label';
    label.textContent = p.name || 'Visitante';
    this.labels.appendChild(label);
    const r: Remote = {
      id, visual, state: createPlayerState(id, p.x, p.y, p.z, p.heading), buf: [], label, name: p.name, body: p.body,
      interaction: p.interaction, status: p.status, vehicle: p.vehicle, lastArrival: performance.now(),
    };
    this.remotes.set(id, r);
    this.pushSnapshot(id, p);
  }

  private pushSnapshot(id: string, p: any) {
    const r = this.remotes.get(id);
    if (!r) return;
    const now = performance.now();
    // estimativa de jitter: desvio do intervalo entre chegadas em relação ao patchRate (50 ms)
    const ia = now - r.lastArrival;
    r.lastArrival = now;
    if (ia < 1000) this.jitterMs = this.jitterMs * 0.9 + Math.abs(ia - 50) * 0.1;
    r.buf.push({ t: now, x: p.x, y: p.y, z: p.z, heading: p.heading, speed: p.speed, loco: p.loco, vehicle: p.vehicle });
    if (r.buf.length > 40) r.buf.shift();
    r.interaction = p.interaction; r.status = p.status; r.vehicle = p.vehicle;
    r.label.classList.toggle('combat', p.interaction === 'interacao');
    if (p.name && p.name !== r.name) { r.name = p.name; r.label.textContent = p.name; }
  }

  private removeRemote(id: string) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.group.remove(r.visual.root);
    r.visual.rig.dispose();
    r.label.remove();
    this.remotes.delete(id);
  }

  private handleKnock(k: KnockMsg) {
    if (k.target === this.sessionId) { this.onKnock?.(k, true); return; }
    const r = this.remotes.get(k.target);
    if (r) {
      void r.visual.knockdown({ dirX: k.dx, dirZ: k.dz, strength: k.strength, groundY: r.state.y, walls: [], downMs: k.downMs, getupMs: k.getupMs });
      // posição de repouso autoritativa: o buffer passa a apontar para ela
      r.buf.length = 0;
      r.buf.push({ t: performance.now(), x: k.rx, y: r.state.y, z: k.rz, heading: r.state.heading, speed: 0, loco: 0, vehicle: '' });
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
        this.room.send('move', packMove({ x: local.x, y: local.y, z: local.z, heading: local.heading, speed: local.speed, loco, seq }));
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
    const v = new THREE.Vector3();
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
      if (c.vehicle && !r.visual.isDown) {
        const kind = c.vehicle.startsWith('car') ? 'car' : c.vehicle.endsWith('_2') ? 'scooter' : 'bicycle';
        const pose = kind === 'bicycle' ? 'sit-pedal' : kind === 'scooter' ? 'stand' : 'drive';
        r.visual.updateRiding(s.x, s.y, s.z, s.heading, pose, s.speed, kind === 'bicycle' ? 0.92 : kind === 'scooter' ? 0.18 : 0.42, dt);
        r.visual.root.visible = kind !== 'car' || true;
      } else r.visual.update(s, dt);
      v.set(s.x, s.y + 2.1, s.z).project(camera);
      const vis = v.z < 1 && Math.hypot(s.x - camera.position.x, s.z - camera.position.z) < 70;
      r.label.style.display = vis ? '' : 'none';
      if (vis) r.label.style.transform = `translate(${((v.x + 1) / 2) * viewport.w}px, ${((1 - v.y) / 2) * viewport.h}px) translate(-50%, -100%)`;
    }
  }

  /** para QA */
  remotesInfo(): RemoteInfo[] {
    return [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, body: r.body, x: +r.state.x.toFixed(2), z: +r.state.z.toFixed(2), speed: +r.state.speed.toFixed(2), interaction: r.interaction, status: r.status, vehicle: r.vehicle }));
  }

  disconnect() {
    void this.room?.leave();
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
