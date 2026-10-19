/**
 * Rodada 10 — montagem (AGENTE C): perfis por dados, fase visual derivada do `vehicle` e saída segura (pura).
 */
import { describe, expect, it } from 'vitest';
import { WallGrid } from '../src/physics/walls';
import { MOUNT_PROFILES, MountTracker, mountProfile, seatOf, type MountKind } from '../src/vehicles/seats';
import { EXIT_PERSON_GAP, exitCandidates, findSafeExit } from '../src/vehicles/exitSafety';
import { distToVehicle, VEHICLE_BOX, type VehicleKind } from '../src/net/rules';
import { worldToLocal } from '../src/vehicles/platform';

const KINDS: MountKind[] = ['car', 'moto', 'bicycle', 'scooter', 'soundcar', 'trio'];

describe('perfis de montagem (dados)', () => {
  it('todo tipo tem DRIVER com as âncoras completas, transições e câmera', () => {
    for (const k of KINDS) {
      const p = MOUNT_PROFILES[k];
      expect(p.kind).toBe(k);
      const d = p.seats.find((s) => s.role === 'DRIVER')!;
      expect(d).toBeTruthy();
      for (const a of [d.hip, d.handL, d.handR, d.footL, d.footR, d.entry]) { expect(a).toHaveLength(3); for (const x of a) expect(Number.isFinite(x)).toBe(true); }
      expect(p.enterMs).toBeGreaterThan(200); expect(p.enterMs).toBeLessThan(1500);
      expect(p.exitMs).toBeGreaterThan(200); expect(p.exitMs).toBeLessThan(1500);
      expect(p.camera.distance).toBeGreaterThan(3);
      // mão esquerda à esquerda (+x) da direita; entrada fora da carroceria
      expect(d.handL[0]).toBeGreaterThan(d.handR[0]);
      const box = VEHICLE_BOX[k as VehicleKind];
      expect(Math.abs(d.entry[0])).toBeGreaterThan(box.width / 2);
    }
  });
  it('carro: motorista à esquerda, sentado abaixo do teto (1,46 m) e com a cabeça acima da linha dos vidros (0,98 m)', () => {
    const d = seatOf('car');
    expect(d.hip[0]).toBeGreaterThan(0.2);
    expect(d.hip[1]).toBeLessThan(0.65);
    // pelve + ~0,62 m de tronco/pescoço ≈ cabeça
    expect(d.hip[1] + 0.62).toBeGreaterThan(0.98);
    expect(d.hip[1] + 0.85).toBeLessThan(1.46);
  });
  it('papel desconhecido cai no motorista; tipo desconhecido cai na bicicleta', () => {
    expect(seatOf('car', 'PASSENGER_FRONT').role).toBe('DRIVER');
    expect(mountProfile('xyz').kind).toBe('bicycle');
  });
});

describe('fase visual da montagem (MountTracker)', () => {
  it('none → entering → mounted → exiting → none pelos tempos do perfil', () => {
    const t = new MountTracker();
    const car = MOUNT_PROFILES.car;
    expect(t.step(null, null, 0).phase).toBe('none');
    const a = t.step('car0', 'car', 1000);
    expect(a.phase).toBe('entering'); expect(a.changed).toBe(true); expect(a.k).toBe(0);
    expect(t.step('car0', 'car', 1000 + car.enterMs / 2).k).toBeCloseTo(0.5, 5);
    expect(t.step('car0', 'car', 1000 + car.enterMs).phase).toBe('mounted');
    const e = t.step(null, null, 5000);
    expect(e.phase).toBe('exiting'); expect(t.vehicle).toBe('car0');
    expect(t.step(null, null, 5000 + car.exitMs).phase).toBe('none');
    expect(t.vehicle).toBeNull();
  });
  it('voltar ao mesmo veículo durante a saída entra de novo; trocar de veículo recomeça a entrada', () => {
    const t = new MountTracker();
    t.step('m1', 'moto', 0); t.step('m1', 'moto', 5000);
    t.step(null, null, 6000);
    expect(t.step('m1', 'moto', 6100).phase).toBe('entering');
    expect(t.step('b2', 'bicycle', 6200).phase).toBe('entering');
    expect(t.vehicle).toBe('b2');
  });
  it('snap (reconexão / avatar novo): já montado, sem transição', () => {
    const t = new MountTracker();
    expect(t.step('car0', 'car', 0, true).phase).toBe('mounted');
    expect(t.step(null, null, 10, true).phase).toBe('none');
  });
});

describe('saída segura (findSafeExit)', () => {
  const free = { clear: () => true, bounds: [-100, -100, 100, 100] as const };
  const car = { x: 0, z: 0, heading: 0 };

  it('sem obstáculo: porta do motorista (lado esquerdo, +x local), fora da carroceria', () => {
    const r = findSafeExit('car', car, free);
    expect(r.reason).toBe('livre'); expect(r.tag).toBe('porta');
    const l = worldToLocal(car, r.x, r.z);
    expect(l.x).toBeGreaterThan(0.9);
    expect(distToVehicle(r.x, r.z, { ...car, kind: 'car' })).toBeGreaterThan(0.3);
  });
  it('parede do lado do motorista → sai pelo outro lado (nunca atravessa a parede)', () => {
    const walls = new WallGrid();
    walls.addPolygon([[1.1, -5], [1.3, -5], [1.3, 5], [1.1, 5]], 0, 10); // parede colada no lado esquerdo (+x)
    const r = findSafeExit('car', car, { clear: (ax, az, bx, bz) => walls.raycast(ax, 0.6, az, bx, 0.6, bz) >= 1, bounds: free.bounds });
    expect(r.tag).toBe('outro_lado');
    expect(r.x).toBeLessThan(0);
  });
  it('os dois lados bloqueados (vaga apertada entre parede e outro carro) → frente ou trás', () => {
    const walls = new WallGrid();
    walls.addPolygon([[1.1, -5], [1.3, -5], [1.3, 5], [1.1, 5]], 0, 10);
    const other = { x: -2.1, z: 0, heading: 0, kind: 'car' };
    const r = findSafeExit('car', car, { clear: (ax, az, bx, bz) => walls.raycast(ax, 0.6, az, bx, 0.6, bz) >= 1, bounds: free.bounds }, { vehicles: [other] });
    expect(['frente', 'tras']).toContain(r.tag);
    expect(distToVehicle(r.x, r.z, other)).toBeGreaterThan(0.3);
  });
  it('multidão sólida na porta → próxima posição livre a ≥ 0,65 m de todo mundo', () => {
    const door = exitCandidates('car', car)[0];
    const people = [{ x: door.x, z: door.z }, { x: door.x + 0.3, z: door.z + 0.4 }];
    const r = findSafeExit('car', car, free, { people });
    expect(r.tag).not.toBe('porta');
    for (const p of people) expect(Math.hypot(p.x - r.x, p.z - r.z)).toBeGreaterThanOrEqual(EXIT_PERSON_GAP);
  });
  it('perto da borda do mapa: nunca devolve ponto fora dele', () => {
    const edge = { x: 98.9, z: 0, heading: Math.PI / 2 }; // virado para +x, colado na borda
    for (const k of ['car', 'moto', 'bicycle', 'scooter'] as const) {
      const r = findSafeExit(k, edge, free);
      expect(r.x).toBeLessThanOrEqual(99);
    }
  });
  it('encurralado (tudo bloqueado): fica no banco, motivo sem_saida', () => {
    const r = findSafeExit('car', car, { clear: () => false });
    expect(r.reason).toBe('sem_saida');
    expect(Math.hypot(r.x, r.z)).toBeLessThan(1);
  });
  it('pessoas em volta inteira: aceita perto de pessoa em vez de ficar preso', () => {
    const people = exitCandidates('moto', car).map((c) => ({ x: c.x, z: c.z }));
    const r = findSafeExit('moto', car, free, { people });
    expect(r.reason).toBe('perto_de_pessoa');
  });
  it('aceita objeto com campos por getter (Schema do Colyseus no servidor) — não depende de espalhar propriedades', () => {
    class SchemaLike { private d = { x: 0, z: 0, heading: 0 }; get x() { return this.d.x; } get z() { return this.d.z; } get heading() { return this.d.heading; } }
    const r = findSafeExit('car', new SchemaLike(), free, { people: [{ x: exitCandidates('car', car)[0].x, z: exitCandidates('car', car)[0].z }] });
    expect(r.reason).toBe('livre');
    expect(r.tag).toBe('outro_lado');
  });
  it('determinística e com rumo: a mesma entrada dá a mesma saída para qualquer rumo do veículo', () => {
    for (const h of [0, 1, 2.5, -2]) {
      const a = findSafeExit('bicycle', { x: 5, z: 5, heading: h }, free), b = findSafeExit('bicycle', { x: 5, z: 5, heading: h }, free);
      expect(a).toEqual(b);
      expect(Math.hypot(a.x - 5, a.z - 5)).toBeGreaterThan(0.5);
    }
  });
});
