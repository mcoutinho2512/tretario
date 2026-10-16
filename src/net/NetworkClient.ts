/**
 * Cliente multiplayer (Colyseus SDK). Opcional: só conecta com ?mp=1 (ou ?mp=ws://host:porta).
 * - envia propostas de movimento a 15 Hz (o servidor valida e pode corrigir)
 * - jogadores remotos: mesmo AvatarVisual do jogador local + interpolação (buffer ~120 ms)
 * - entrada/saída/aparência sincronizadas pelo estado do servidor
 */
import * as THREE from 'three';
import { Client, Callbacks, type Room } from '@colyseus/sdk';
import { ROOM_NAME, NET_TICK_HZ, LOCO, type JoinOptions, type MoveMsg, type MoveMode, type CorrectMsg } from './protocol';
import { AvatarVisual } from '../player/AvatarVisual';
import { createPlayerState, type PlayerState } from '../player/PlayerState';
import type { CharacterAppearance } from '../characters/bodyTypes';

interface Snapshot { t: number; x: number; y: number; z: number; heading: number; speed: number; loco: number; vehicle: string }

interface Remote {
  id: string;
  visual: AvatarVisual;
  state: PlayerState;
  buf: Snapshot[];
  label: HTMLDivElement;
  name: string;
  body: string;
}

const INTERP_DELAY = 120;

export class NetworkClient {
  readonly group = new THREE.Group();
  private room: Room | null = null;
  private remotes = new Map<string, Remote>();
  private seq = 0;
  private sendAcc = 0;
  private labels: HTMLDivElement;
  sessionId = '';
  status: 'offline' | 'connecting' | 'online' | 'error' = 'offline';
  lastError = '';
  corrections = 0;
  onCorrect: ((c: CorrectMsg) => void) | null = null;
  onSpawn: ((s: { x: number; y: number; z: number; heading: number }) => void) | null = null;

  constructor(private endpoint: string, hudRoot: HTMLElement) {
    this.group.name = 'remote_players';
    this.labels = document.createElement('div');
    this.labels.className = 'name-labels';
    hudRoot.appendChild(this.labels);
  }

  get remoteCount() { return this.remotes.size; }

  /** para QA: estado dos remotos renderizados */
  remotesInfo() {
    return [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, body: r.body, x: +r.state.x.toFixed(2), z: +r.state.z.toFixed(2), speed: +r.state.speed.toFixed(2) }));
  }

  async connect(app: CharacterAppearance, name: string): Promise<void> {
    this.status = 'connecting';
    try {
      const client = new Client(this.endpoint);
      const opts: JoinOptions = { name, body: app.body, skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, shoes: app.shoes };
      const room = await client.joinOrCreate(ROOM_NAME, opts);
      this.room = room;
      this.sessionId = room.sessionId;
      this.status = 'online';
      room.onMessage('correct', (c: CorrectMsg) => { this.corrections++; this.onCorrect?.(c); });
      room.onMessage('spawn', (s: { x: number; y: number; z: number; heading: number }) => this.onSpawn?.(s));
      room.onLeave(() => { this.status = 'offline'; });
      const cb = Callbacks.get(room as any) as any;
      cb.onAdd('players', (p: any, id: string) => {
        if (id === this.sessionId) return;
        this.addRemote(id, p);
        cb.onChange(p, () => this.pushSnapshot(id, p));
      });
      cb.onRemove('players', (_p: any, id: string) => this.removeRemote(id));
    } catch (e) {
      this.status = 'error';
      this.lastError = (e as Error)?.message ?? String(e);
      throw e;
    }
  }

  private addRemote(id: string, p: any) {
    const app: CharacterAppearance = { body: p.body || 'homem', skin: p.skin, hair: p.hair, top: p.top, bottom: p.bottom, shoes: p.shoes, scale: 1 };
    const visual = new AvatarVisual(app);
    this.group.add(visual.root);
    const label = document.createElement('div');
    label.className = 'name-label';
    label.textContent = p.name || 'Visitante';
    this.labels.appendChild(label);
    const r: Remote = { id, visual, state: createPlayerState(id, p.x, p.y, p.z, p.heading), buf: [], label, name: p.name, body: p.body };
    this.remotes.set(id, r);
    this.pushSnapshot(id, p);
  }

  private pushSnapshot(id: string, p: any) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.buf.push({ t: performance.now(), x: p.x, y: p.y, z: p.z, heading: p.heading, speed: p.speed, loco: p.loco, vehicle: p.vehicle });
    if (r.buf.length > 30) r.buf.shift();
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

  /** envia o estado local (proposta) e interpola os remotos */
  update(dt: number, local: PlayerState, mode: MoveMode, camera: THREE.Camera, viewport: { w: number; h: number }) {
    if (this.room && this.status === 'online') {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / NET_TICK_HZ) {
        this.sendAcc = 0;
        const loco = mode !== 'foot' ? 4 : Math.max(0, LOCO.indexOf(local.locomotion as (typeof LOCO)[number]));
        const msg: MoveMsg = { x: local.x, y: local.y, z: local.z, heading: local.heading, speed: local.speed, loco, mode, seq: ++this.seq };
        this.room.send('move', msg);
      }
    }
    const renderT = performance.now() - INTERP_DELAY;
    const v = new THREE.Vector3();
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
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
      if (c.vehicle) {
        const pose = c.vehicle === 'bicycle' ? 'sit-pedal' : c.vehicle === 'scooter' ? 'stand' : 'drive';
        r.visual.updateRiding(s.x, s.y, s.z, s.heading, pose, s.speed, c.vehicle === 'bicycle' ? 0.92 : 0.18, dt);
      } else r.visual.update(s, dt);
      // rótulo com o nome
      v.set(s.x, s.y + 2.1, s.z).project(camera);
      const vis = v.z < 1 && Math.hypot(s.x - camera.position.x, s.z - camera.position.z) < 60;
      r.label.style.display = vis ? '' : 'none';
      if (vis) r.label.style.transform = `translate(${((v.x + 1) / 2) * viewport.w}px, ${((1 - v.y) / 2) * viewport.h}px) translate(-50%, -100%)`;
    }
  }

  disconnect() {
    void this.room?.leave();
  }
}
