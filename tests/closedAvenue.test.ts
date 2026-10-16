/**
 * Rodada 7 — Avenida Presidente Vargas FECHADA ao trânsito convencional: sem trânsito NPC; veículos dos jogadores
 * (carro, moto, bicicleta, patinete) estacionados, autoridade do servidor, modo pacífico sem atropelamento.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { stepRideable, RIDEABLE_DEFS, type RideableKind, type RideableState } from '../src/vehicles/Rideable';
import { MAX_SPEED } from '../src/net/protocol';
import { RULES, VEHICLE_BOX, VEHICLE_STATE, canEnter, impactAllowed, shouldResetVehicle, vehicleBlock, distToVehicle } from '../src/net/rules';
import { SpatialGrid } from '../src/net/spatialGrid';

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));
const distToPolyline = (p: number[], pl: number[][]) => {
  let best = Infinity;
  for (let i = 0; i < pl.length - 1; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]));
  }
  return best;
};

describe('avenida fechada: não existe trânsito NPC', () => {
  it('servidor não simula nem envia trânsito', () => {
    const room = readFileSync('server/src/PresidenteVargasRoom.ts', 'utf8');
    expect(room).not.toMatch(/TrafficSim|populateGlobal|packAround|send\('traffic'/);
    expect(existsSync('src/traffic/TrafficSim.ts')).toBe(false);
    expect(existsSync('src/traffic/TrafficSystem.ts')).toBe(false);
  });
  it('cliente não cria nem atualiza trânsito', () => {
    const game = readFileSync('src/core/Game.ts', 'utf8');
    expect(game).not.toMatch(/new TrafficSystem|traffic\.update|traffic\.pushOut/);
    for (const f of readdirSync('src', { recursive: true }) as string[]) {
      if (!f.endsWith('.ts')) continue;
      expect(readFileSync(`src/${f}`, 'utf8'), f).not.toMatch(/from ['"].*TrafficSim['"]/);
    }
  });
});

describe('veículos do mundo (estacionados)', () => {
  const spawns: { id: string; kind: string; x: number; z: number; heading: number }[] = manifest.vehicleSpawns;
  it('há carros, motos, bicicletas e patinetes', () => {
    const n = (k: string) => spawns.filter((s) => s.kind === k).length;
    expect(n('car')).toBeGreaterThanOrEqual(8);
    expect(n('moto')).toBeGreaterThanOrEqual(6);
    expect(n('bicycle')).toBeGreaterThanOrEqual(10);
    expect(n('scooter')).toBeGreaterThanOrEqual(10);
  });
  it('ids únicos e estáveis', () => {
    expect(new Set(spawns.map((s) => s.id)).size).toBe(spawns.length);
  });
  it('carros e motos ficam junto ao meio-fio, nunca no meio da avenida', () => {
    for (const s of spawns.filter((v) => v.kind === 'car' || v.kind === 'moto')) {
      expect(distToPolyline([s.x, s.z], manifest.pvAxis), s.id).toBeGreaterThan(12);
    }
  });
  it('ônibus são só cenário (não utilizáveis) e encostados no meio-fio', () => {
    expect(spawns.some((s) => s.kind === 'bus')).toBe(false);
    expect((manifest.parkedBuses ?? []).length).toBeGreaterThan(0);
    for (const b of manifest.parkedBuses) expect(distToPolyline([b.x, b.z], manifest.pvAxis)).toBeGreaterThan(10);
  });
});

describe('controles por categoria', () => {
  // mundo de teste todo em ASFALTO (sem tiles carregados o chão seria "calçada", onde carro/moto só manobram)
  const world = new CollisionWorld(250, [-1000, -1000, 1000, 1000]);
  (world as unknown as { surfaceAt: () => number }).surfaceAt = () => 1; // Surface.Road
  const mk = (kind: RideableKind): RideableState => ({ id: 't', kind, x: 0, y: 0, z: 0, heading: 0, speed: 0, occupant: 'p' });
  const run = (v: RideableState, throttle: number, steer: number, s: number) => {
    for (let i = 0; i < s * 60; i++) stepRideable(v, RIDEABLE_DEFS[v.kind], { throttle, steer, boost: false }, 1 / 60, world);
  };
  for (const kind of ['car', 'moto', 'bicycle', 'scooter'] as RideableKind[]) {
    it(`${kind}: acelera, freia, esterça; limite urbano`, () => {
      const v = mk(kind);
      run(v, 1, 0, 6);
      expect(v.speed).toBeGreaterThan(RIDEABLE_DEFS[kind].maxSpeed * 0.9);
      expect(v.z).toBeGreaterThan(5);
      const h0 = v.heading;
      run(v, 1, 1, 1);
      expect(Math.abs(v.heading - h0)).toBeGreaterThan(0.3); // esterçou
      run(v, -1, 0, 4);
      if (RIDEABLE_DEFS[kind].reverse) expect(v.speed).toBeLessThan(0); // carro engata ré
      else expect(v.speed).toBeCloseTo(0, 1); // moto/bicicleta/patinete só freiam
      // limites: carro/moto ≤ 30 km/h, bicicleta ≤ 25, patinete ≤ 20 (+ validação do servidor coerente)
      expect(RIDEABLE_DEFS[kind].boostSpeed).toBeLessThanOrEqual({ car: 8.34, moto: 8.34, bicycle: 6.95, scooter: 5.56 }[kind]);
      expect(MAX_SPEED[kind]).toBeGreaterThanOrEqual(RIDEABLE_DEFS[kind].boostSpeed);
    });
  }
});

describe('posse do veículo (servidor)', () => {
  const p = { x: 0, z: 1.5, status: 0, vehicle: '' };
  it('jogador entra num veículo livre; outro não entra no mesmo', () => {
    const v = { x: 0, z: 0, occupant: '', heading: 0, kind: 'moto' };
    expect(canEnter(p, v).ok).toBe(true);
    expect(canEnter({ ...p, x: 0.5 }, { ...v, occupant: 'A' })).toEqual({ ok: false, reason: 'ocupado' });
  });
  it('estados mínimos AVAILABLE / OCCUPIED / RESETTING', () => {
    expect(VEHICLE_STATE).toEqual({ AVAILABLE: 0, OCCUPIED: 1, RESETTING: 2 });
  });
  it('veículo abandonado longe da vaga volta só sem ninguém por perto e depois do tempo', () => {
    const v = { occupant: '', x: 100, z: 0, spawnX: 0, spawnZ: 0, idleSince: 0 };
    expect(shouldResetVehicle(v, RULES.vehicleResetMs + 1, 100)).toBe(true);
    expect(shouldResetVehicle(v, RULES.vehicleResetMs - 1, 100)).toBe(false);
    expect(shouldResetVehicle(v, RULES.vehicleResetMs + 1, 5)).toBe(false); // alguém perto
    expect(shouldResetVehicle({ ...v, occupant: 'A' }, RULES.vehicleResetMs + 1, 100)).toBe(false);
    expect(shouldResetVehicle({ ...v, x: 3 }, RULES.vehicleResetMs + 1, 100)).toBe(false); // já na vaga
  });
  it('moto: alcance pela carroceria', () => {
    const d = distToVehicle(0, 1.2, { x: 0, z: 0, heading: 0, kind: 'moto' });
    expect(d).toBeCloseTo(1.2 - VEHICLE_BOX.moto.len / 2, 5);
  });
});

describe('modo pacífico: veículo não atropela', () => {
  it('atropelamento só entre jogadores em modo interação', () => {
    expect(impactAllowed('pacifico', 'pacifico')).toBe(false);
    expect(impactAllowed('interacao', 'pacifico')).toBe(false);
    expect(impactAllowed('pacifico', 'interacao')).toBe(false);
    expect(impactAllowed('interacao', 'interacao')).toBe(true);
  });
  it('carro para ANTES de encostar num jogador pacífico (não atravessa)', () => {
    const person = { x: 0, z: 5 };
    const r = vehicleBlock('car', { x: 0, z: 0 }, { x: 0, z: 4 }, 0, [person]);
    expect(r.blocked).toBe(true);
    expect(r.z).toBeLessThan(5 - VEHICLE_BOX.car.len / 2);
  });
  it('já encostado: pode dar ré ou desviar, nunca avançar sobre a pessoa', () => {
    const person = { x: 0, z: 2.9 };
    expect(vehicleBlock('car', { x: 0, z: 0 }, { x: 0, z: 0.3 }, 0, [person]).blocked).toBe(true);
    expect(vehicleBlock('car', { x: 0, z: 0 }, { x: 0, z: -0.3 }, 0, [person]).blocked).toBe(false);
  });
  it('sem ninguém no caminho, não bloqueia; bicicleta também para', () => {
    expect(vehicleBlock('car', { x: 0, z: 0 }, { x: 0, z: 4 }, 0, [{ x: 10, z: 10 }]).blocked).toBe(false);
    expect(vehicleBlock('bicycle', { x: 0, z: 0 }, { x: 0, z: 2 }, 0, [{ x: 0, z: 2.5 }]).blocked).toBe(true);
  });
});

describe('área de interesse dos veículos (grade espacial)', () => {
  it('só os veículos próximos entram na consulta', () => {
    const g = new SpatialGrid(110);
    const vs = [[0, 0], [150, 0], [400, 0], [-900, 300]];
    vs.forEach(([x, z], i) => g.insert(i, x, z));
    const near: number[] = [];
    g.forEachInRadius(0, 0, 220, (id) => near.push(id));
    expect(near.sort()).toEqual([0, 1]);
  });
});
