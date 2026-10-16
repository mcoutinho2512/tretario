/**
 * Simulação de trânsito PURA (sem three.js / DOM) — roda igual no servidor e no cliente (docs/SHARED_WORLD.md).
 *
 *  - servidor (multiplayer): população GLOBAL autoritativa no corredor, passo de 10 Hz; envia a cada cliente,
 *    a 2 Hz e só dentro da sua área de interesse, snapshots binários de 12 bytes por veículo
 *    (id, faixa, posição na faixa, velocidade, próxima faixa, tipo/cor).
 *  - cliente: aplica os snapshots e EXTRAPOLA com o mesmo código entre eles (mesmas faixas, mesmos semáforos
 *    pelo relógio global) → todos veem essencialmente a mesma situação em cada cruzamento.
 *  - singleplayer: população local ao redor do jogador (comportamento anterior).
 */
import type { TrafficLane } from '../world/types';
import type { Light } from './SignalController';

export type VType = 0 | 1 | 2; // carro, táxi, ônibus
export const VTYPE_NAMES = ['car', 'taxi', 'bus'] as const;
export const DIMS = [{ len: 4.4, width: 1.8 }, { len: 4.4, width: 1.8 }, { len: 12.2, width: 2.55 }];

export interface LaneRT extends TrafficLane { cum: number[]; length: number }

export interface SimVehicle {
  id: number;
  type: VType;
  color: number; // índice da paleta
  lane: LaneRT;
  next: LaneRT | null;
  s: number;
  v: number;
  v0: number;
  len: number;
  width: number;
  x: number; z: number; heading: number;
  active: boolean;
}

export interface Obstacle { x: number; z: number; r?: number }

export class TrafficSim {
  readonly lanes: LaneRT[] = [];
  readonly pvLanes: LaneRT[] = [];
  vehicles: SimVehicle[] = [];
  private byId = new Map<number, SimVehicle>();
  private rngState: number;
  private nextId = 1;
  signals: ((j: number, ph: number) => Light) | null = null;
  stoppedAtRed = 0;

  constructor(lanes: TrafficLane[], seed = 7) {
    this.rngState = seed >>> 0 || 7;
    for (const l of lanes) {
      const cum = [0];
      for (let i = 1; i < l.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]));
      this.lanes.push({ ...l, cum, length: cum[cum.length - 1] });
    }
    for (const l of this.lanes) if (l.pv) this.pvLanes.push(l);
  }

  rnd() {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  pickNext(l: LaneRT): LaneRT | null {
    const nexts = l.next;
    if (!nexts.length) return null;
    const pvNext = nexts.filter((id) => this.lanes[id].pv);
    const pool = pvNext.length && l.pv ? pvNext : nexts;
    return this.lanes[pool[Math.floor(this.rnd() * pool.length)]];
  }

  posAt(l: LaneRT, s: number): { x: number; z: number; h: number } {
    let i = 1;
    while (i < l.cum.length - 1 && l.cum[i] < s) i++;
    const a = l.pts[i - 1], b = l.pts[i];
    const seg = l.cum[i] - l.cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - l.cum[i - 1]) / seg));
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }

  /** cria um veículo numa faixa/posição (tipo/cor sorteados com o RNG da simulação) */
  private make(lane: LaneRT, s: number, id?: number): SimVehicle {
    const r = this.rnd();
    const type: VType = lane.speed >= 12 && r < 0.24 ? 2 : r < 0.42 ? 1 : 0;
    const p = this.posAt(lane, s);
    const v0 = lane.speed * (type === 2 ? 0.8 : 0.85 + this.rnd() * 0.3);
    const vid = id ?? this.nextId++;
    const veh: SimVehicle = {
      id: vid, type, color: Math.floor(this.rnd() * 10), lane, next: this.pickNext(lane), s, v: v0 * 0.7, v0,
      len: DIMS[type].len, width: DIMS[type].width, x: p.x, z: p.z, heading: p.h, active: true,
    };
    return veh;
  }

  private free(x: number, z: number, len: number) {
    for (const o of this.vehicles) if (o.active && Math.hypot(o.x - x, o.z - z) < (o.len + len) / 2 + 3) return false;
    return true;
  }

  private add(v: SimVehicle) {
    this.vehicles.push(v);
    this.byId.set(v.id, v);
  }

  /** população global (servidor): `n` veículos, `pvShare` deles na Pres. Vargas */
  populateGlobal(n: number, pvShare = 0.8) {
    let guard = 0;
    while (this.vehicles.length < n && guard++ < n * 40) {
      const pool = this.rnd() < pvShare ? this.pvLanes : this.lanes;
      const lane = pool[Math.floor(this.rnd() * pool.length)];
      if (!lane || lane.length < 8) continue;
      const s = this.rnd() * lane.length;
      const p = this.posAt(lane, s);
      if (!this.free(p.x, p.z, 12)) continue;
      this.add(this.make(lane, s));
    }
  }

  /** população local (singleplayer): mantém até `n` veículos no raio, nascendo fora da vista */
  populateAround(n: number, px: number, pz: number, radius: number, initial: boolean, camFwd?: { x: number; z: number }) {
    let tries = 0;
    while (this.vehicles.length < n && tries++ < 6) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const pool = this.rnd() < 0.75 ? this.pvLanes : this.lanes;
        const lane = pool[Math.floor(this.rnd() * pool.length)];
        if (!lane || lane.length < 8) continue;
        const s = this.rnd() * lane.length;
        const p = this.posAt(lane, s);
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d > radius || d < (initial ? 25 : 90)) continue;
        if (!initial && camFwd && d < 200 && (p.x - px) * camFwd.x + (p.z - pz) * camFwd.z > 0) continue;
        if (!this.free(p.x, p.z, 12)) continue;
        this.add(this.make(lane, s));
        break;
      }
    }
  }

  /** remove veículos fora do raio (singleplayer) */
  cull(px: number, pz: number, radius: number) {
    for (const v of this.vehicles) if (Math.hypot(v.x - px, v.z - pz) > radius) v.active = false;
    this.compact();
  }

  private compact() {
    if (this.vehicles.some((v) => !v.active)) {
      this.vehicles = this.vehicles.filter((v) => { if (!v.active) this.byId.delete(v.id); return v.active; });
    }
  }

  /** um passo de simulação (gap-following, semáforos, obstáculos, troca de faixa) */
  step(dt: number, obstacles: Obstacle[] = [], respawnGlobal = false) {
    let stopped = 0;
    // grade espacial para vizinhança (células de 50 m)
    const cell = new Map<string, SimVehicle[]>();
    for (const v of this.vehicles) {
      const k = `${Math.floor(v.x / 50)},${Math.floor(v.z / 50)}`;
      (cell.get(k) ?? cell.set(k, []).get(k)!).push(v);
    }
    for (const v of this.vehicles) {
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      let gap = 80;
      const cx = Math.floor(v.x / 50), cz = Math.floor(v.z / 50);
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
        for (const o of cell.get(`${ix},${iz}`) ?? []) {
          if (o === v) continue;
          const dx = o.x - v.x, dz = o.z - v.z;
          const ahead = dx * fx + dz * fz;
          if (ahead <= 0 || ahead > 80) continue;
          const lat = Math.abs(dx * fz - dz * fx);
          if (lat > 1.7) continue;
          if (Math.sin(o.heading) * fx + Math.cos(o.heading) * fz < 0.5) continue;
          gap = Math.min(gap, ahead - (v.len + o.len) / 2);
        }
      }
      for (const ob of obstacles) {
        const dx = ob.x - v.x, dz = ob.z - v.z;
        if (Math.abs(dx) > 35 || Math.abs(dz) > 35) continue;
        const ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        const r = ob.r ?? 0.9;
        if (ahead > 0 && ahead < 30 && lat < v.width / 2 + r) gap = Math.min(gap, ahead - v.len / 2 - r + 0.3);
      }
      if (this.signals) {
        const checkStops = (lane: LaneRT, base: number) => {
          for (const st of lane.stops ?? []) {
            const d = base + st.s - v.s - v.len / 2;
            if (d < -1 || d > 70) continue;
            const light = this.signals!(st.j, st.ph);
            if (light === 'G') continue;
            if (light === 'Y' && d < (v.v * v.v) / (2 * 4.5)) continue;
            gap = Math.min(gap, d + 2.4);
            if (d < 6 && v.v < 0.5) stopped++;
          }
        };
        checkStops(v.lane, 0);
        if (v.next) checkStops(v.next, v.lane.length);
      }
      const safe = Math.max(0, (gap - 3) / 1.4);
      const target = Math.min(v.v0, safe);
      const acc = target > v.v ? 2.2 : 6.5;
      v.v += Math.sign(target - v.v) * Math.min(Math.abs(target - v.v), acc * dt);
    }
    for (const v of this.vehicles) {
      v.s += v.v * dt;
      while (v.s > v.lane.length) {
        if (!v.next) {
          if (respawnGlobal) {
            // servidor: o veículo "renasce" numa faixa da avenida (mantém o id)
            const lane = this.pvLanes[Math.floor(this.rnd() * this.pvLanes.length)];
            const nv = this.make(lane, 0, v.id);
            Object.assign(v, nv);
          } else v.active = false;
          break;
        }
        v.s -= v.lane.length;
        v.lane = v.next;
        v.next = this.pickNext(v.lane);
      }
      if (!v.active) continue;
      const p = this.posAt(v.lane, v.s);
      let dh = p.h - v.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      v.heading += dh * Math.min(1, dt * 8);
      v.x = p.x; v.z = p.z;
    }
    this.compact();
    this.stoppedAtRed = stopped;
  }

  // ------------------------------------------------------------------ snapshots binários
  static readonly BYTES = 12;

  /** empacota os veículos dentro do raio de interesse (servidor) */
  packAround(px: number, pz: number, radius: number): Uint8Array {
    const list = this.vehicles.filter((v) => Math.abs(v.x - px) < radius && Math.abs(v.z - pz) < radius && Math.hypot(v.x - px, v.z - pz) < radius);
    const buf = new Uint8Array(list.length * TrafficSim.BYTES);
    const dv = new DataView(buf.buffer);
    list.forEach((v, i) => {
      const o = i * TrafficSim.BYTES;
      dv.setUint16(o, v.id);
      dv.setUint16(o + 2, v.lane.id);
      dv.setUint16(o + 4, Math.min(65535, Math.round(v.s * 10)));
      dv.setUint8(o + 6, Math.min(255, Math.round(v.v * 10)));
      dv.setUint8(o + 7, (v.type & 3) | ((v.color & 15) << 2));
      dv.setUint16(o + 8, v.next ? v.next.id : 65535);
      dv.setUint16(o + 10, Math.min(65535, Math.round(v.v0 * 100)));
    });
    return buf;
  }

  /**
   * Aplica um snapshot (cliente). Veículos ausentes no snapshot saem (fora da área de interesse).
   * Retorna ids novos/removidos para o renderizador ajustar instâncias e suavizar correções.
   */
  applySnapshot(buf: Uint8Array): { added: SimVehicle[]; removed: SimVehicle[]; updated: SimVehicle[] } {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const seen = new Set<number>();
    const added: SimVehicle[] = [], updated: SimVehicle[] = [];
    for (let o = 0; o + TrafficSim.BYTES <= buf.byteLength; o += TrafficSim.BYTES) {
      const id = dv.getUint16(o);
      const lane = this.lanes[dv.getUint16(o + 2)];
      if (!lane) continue;
      const s = dv.getUint16(o + 4) / 10;
      const v = dv.getUint8(o + 6) / 10;
      const tc = dv.getUint8(o + 7);
      const nextId = dv.getUint16(o + 8);
      const v0 = dv.getUint16(o + 10) / 100;
      seen.add(id);
      let veh = this.byId.get(id);
      const type = (tc & 3) as VType;
      if (!veh) {
        const p = this.posAt(lane, s);
        veh = { id, type, color: tc >> 2, lane, next: null, s, v, v0, len: DIMS[type].len, width: DIMS[type].width, x: p.x, z: p.z, heading: p.h, active: true };
        this.add(veh);
        added.push(veh);
      } else updated.push(veh);
      veh.type = type; veh.color = tc >> 2; veh.len = DIMS[type].len; veh.width = DIMS[type].width;
      veh.lane = lane; veh.s = s; veh.v = v; veh.v0 = v0;
      veh.next = nextId === 65535 ? null : this.lanes[nextId] ?? null;
      const p = this.posAt(lane, s);
      veh.x = p.x; veh.z = p.z;
    }
    const removed: SimVehicle[] = [];
    for (const v of this.vehicles) if (!seen.has(v.id)) { v.active = false; removed.push(v); }
    this.compact();
    return { added, removed, updated };
  }
}
