/**
 * Rodada 7 — veículos de evento: trio elétrico (plataforma com passageiros) e carro de som; cenário de evento.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TRIO, TRIO_DECK, TRIO_STAND_SPOTS, canBoard, clampToPolygon, distToCabDoor, exitPoints, localToWorld, packPlatformMove,
  pointInPolygon, unpackPlatformMove, validatePlatformMove, worldToLocal,
} from '../src/vehicles/platform';
import { MAX_SPEED } from '../src/net/protocol';
import { RIDEABLE_DEFS, stepRideable, type RideableState } from '../src/vehicles/Rideable';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { RULES, VEHICLE_BOX, VEHICLE_KINDS, boxesOverlap, canEnter, canPush, distToVehicle, pushOutOfBox, vehicleBlock, type Actor } from '../src/net/rules';
import { validateAction } from '../src/social/actionRules';

const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8'));

describe('plataforma do trio: polígono do piso', () => {
  it('escada, pontos de pé e centro do piso estão dentro; recorte da mesa de som e fora do guarda-corpo, não', () => {
    expect(pointInPolygon(TRIO.ladderTop[0], TRIO.ladderTop[1], TRIO_DECK)).toBe(true);
    for (const [x, z] of TRIO_STAND_SPOTS) expect(pointInPolygon(x, z, TRIO_DECK), `${x},${z}`).toBe(true);
    expect(TRIO_STAND_SPOTS.length).toBeGreaterThanOrEqual(10); // 10–20 pessoas em cima
    expect(pointInPolygon(-0.6, 2.7, TRIO_DECK)).toBe(false); // mesa de som (polígono não convexo)
    expect(pointInPolygon(0.5, 2.7, TRIO_DECK)).toBe(true);
    expect(pointInPolygon(1.3, 0, TRIO_DECK)).toBe(false);
    expect(pointInPolygon(0, -6.5, TRIO_DECK)).toBe(false);
    expect(pointInPolygon(0, TRIO.cabZ0, TRIO_DECK)).toBe(false); // cabine não é piso
  });
  it('clampToPolygon devolve sempre um ponto DENTRO (inclusive no canto côncavo) e próximo da borda', () => {
    for (const [x, z] of [[3, 0], [-3, -9], [0, 9], [-0.5, 2.6], [-0.12, 2.05], [2, 3.5]] as const) {
      const c = clampToPolygon(x, z, TRIO_DECK);
      expect(c.clamped).toBe(true);
      expect(pointInPolygon(c.x, c.z, TRIO_DECK), `${x},${z} → ${c.x},${c.z}`).toBe(true);
    }
    const c = clampToPolygon(3, 0, TRIO_DECK);
    expect(c.x).toBeCloseTo(1.0, 1);
    expect(clampToPolygon(0.2, -1, TRIO_DECK)).toEqual({ x: 0.2, z: -1, clamped: false });
  });
});

describe('plataforma do trio: local ↔ mundo e passageiros presos ao trio', () => {
  const pose = { x: -169.7, z: 140.7, heading: 1.96 };
  it('local → mundo → local é identidade; +z local = frente do veículo', () => {
    for (const [lx, lz] of [[0, 0], [1, -5], [-0.7, 2.2], [0.3, 3.1]]) {
      const w = localToWorld(pose, lx, lz);
      const l = worldToLocal(pose, w.x, w.z);
      expect(l.x).toBeCloseTo(lx, 9); expect(l.z).toBeCloseTo(lz, 9);
    }
    const f = localToWorld(pose, 0, 1);
    expect(f.x - pose.x).toBeCloseTo(Math.sin(pose.heading), 9);
    expect(f.z - pose.z).toBeCloseTo(Math.cos(pose.heading), 9);
  });
  it('trio anda e vira: passageiro mantém a posição LOCAL e a distância aos outros (não escorrega)', () => {
    const riders = [[0.5, -4], [-0.6, 1.2], [0.9, 3.0]] as const;
    let p = { ...pose };
    const d0 = Math.hypot(riders[0][0] - riders[1][0], riders[0][1] - riders[1][1]);
    for (let k = 0; k < 200; k++) {
      // cortejo: 1,2 m/s, curva leve — o servidor recalcula o mundo a cada movimento do trio
      p = { x: p.x + Math.sin(p.heading) * 0.12, z: p.z + Math.cos(p.heading) * 0.12, heading: p.heading + 0.004 };
      const w = riders.map(([lx, lz]) => localToWorld(p, lx, lz));
      for (let i = 0; i < riders.length; i++) {
        const back = worldToLocal(p, w[i].x, w[i].z);
        expect(back.x).toBeCloseTo(riders[i][0], 9);
        expect(back.z).toBeCloseTo(riders[i][1], 9);
      }
      expect(Math.hypot(w[0].x - w[1].x, w[0].z - w[1].z)).toBeCloseTo(d0, 9);
    }
    expect(Math.hypot(p.x - pose.x, p.z - pose.z)).toBeGreaterThan(20);
  });
  it('movimento local validado: velocidade de quem anda e preso ao piso', () => {
    const ok = validatePlatformMove({ x: 0, z: -4 }, { x: 0.1, z: -3.9 }, 0.066, MAX_SPEED.foot);
    expect(ok.ok).toBe(true);
    const fast = validatePlatformMove({ x: 0, z: -4 }, { x: 0, z: 3 }, 0.066, MAX_SPEED.foot);
    expect(fast.ok).toBe(false);
    expect(fast.z).toBeLessThan(-2.5);
    const off = validatePlatformMove({ x: 0.9, z: 0 }, { x: 1.6, z: 0 }, 0.2, MAX_SPEED.foot);
    expect(off).toMatchObject({ ok: false, reason: 'plataforma' });
    expect(pointInPolygon(off.x, off.z, TRIO_DECK)).toBe(true);
    expect(validatePlatformMove({ x: 0, z: 0 }, { x: NaN, z: 0 }, 0.1, 6).ok).toBe(false);
  });
  it('mensagem compacta de movimento na plataforma', () => {
    const m = { lx: 0.4567, lz: -3.2109, lh: 1.23456, speed: 1.3, loco: 1, seq: 42 };
    expect(unpackPlatformMove(packPlatformMove(m))).toEqual({ lx: 0.46, lz: -3.21, lh: 1.235, speed: 1.3, loco: 1, seq: 42 });
    expect(unpackPlatformMove([1, 2, 3])).toBeNull();
    expect(unpackPlatformMove([1, 2, 3, 4, 5, 'x'])).toBeNull();
  });
});

describe('subir no trio (servidor)', () => {
  const trio = { x: 0, z: 0, heading: 0, kind: 'trio' };
  const foot = localToWorld(trio, TRIO.ladderFoot[0], TRIO.ladderFoot[1]);
  const p = { x: foot.x, z: foot.z, status: 0, vehicle: '', platform: '' };
  it('perto do pé da escada, a pé e de pé: sobe', () => {
    expect(canBoard(p, trio, 0)).toEqual({ ok: true });
  });
  it('negado: longe, em veículo, já em cima, caído, lotado, não é trio', () => {
    expect(canBoard({ ...p, z: p.z - 5 }, trio, 0)).toMatchObject({ reason: 'distancia' });
    expect(canBoard({ ...p, x: 1.9, z: 4.9 }, trio, 0)).toMatchObject({ reason: 'distancia' }); // porta da cabine ≠ escada
    expect(canBoard({ ...p, vehicle: 'car1' }, trio, 0)).toMatchObject({ reason: 'ja_em_veiculo' });
    expect(canBoard({ ...p, platform: 'trio0' }, trio, 0)).toMatchObject({ reason: 'ja_em_cima' });
    expect(canBoard({ ...p, status: 1 }, trio, 0)).toMatchObject({ reason: 'estado' });
    expect(canBoard(p, trio, TRIO.capacity)).toMatchObject({ reason: 'lotado' });
    expect(canBoard(p, { ...trio, kind: 'soundcar' }, 0)).toMatchObject({ reason: 'inexistente' });
    expect(canBoard(p, undefined, 0)).toMatchObject({ reason: 'inexistente' });
  });
  it('em cima do trio: ações sociais permitidas; ninguém empurra nem é empurrado', () => {
    const social = { act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', onPlatform: true, recent: [] };
    expect(validateAction(social, 2, 1000).ok).toBe(true);
    const actor = (id: string, x: number, platform = ''): Actor => ({ id, x, z: 0, heading: Math.PI / 2, mode: 'interacao', status: 0, vehicle: '', immuneUntil: 0, lastActionAt: -1e9, actionTimes: [], platform });
    expect(canPush(actor('a', 0), actor('b', 1), 0).ok).toBe(true);
    expect(canPush(actor('a', 0), actor('b', 1, 'trio0'), 0)).toMatchObject({ ok: false, reason: 'veiculo' });
    expect(canPush(actor('a', 0, 'trio0'), actor('b', 1), 0)).toMatchObject({ ok: false, reason: 'veiculo' });
  });
});

describe('carro de som e trio: novos tipos de veículo', () => {
  it('tipos, caixas e limites de velocidade (cortejo)', () => {
    expect(VEHICLE_KINDS).toContain('soundcar');
    expect(VEHICLE_KINDS).toContain('trio');
    expect(VEHICLE_BOX.trio).toEqual({ len: TRIO.len, width: TRIO.width });
    for (const k of ['soundcar', 'trio'] as const) {
      expect(MAX_SPEED[k]).toBeGreaterThanOrEqual(RIDEABLE_DEFS[k].boostSpeed);
      expect(RIDEABLE_DEFS[k].reverse).toBe(true);
    }
    expect(RIDEABLE_DEFS.soundcar.boostSpeed).toBeLessThanOrEqual(4.17); // ≤ 15 km/h
    expect(RIDEABLE_DEFS.soundcar.maxSpeed).toBeGreaterThanOrEqual(3);
    expect(RIDEABLE_DEFS.trio.boostSpeed).toBeLessThanOrEqual(1.5); // ≤ 1,5 m/s
  });
  it('entrar: carro de som pela carroceria; trio SÓ pela porta da cabine', () => {
    const p = { status: 0, vehicle: '' };
    const som = { x: 0, z: 0, heading: 0, occupant: '', kind: 'soundcar' };
    expect(canEnter({ ...p, x: 2.5, z: 0 }, som).ok).toBe(true);
    expect(canEnter({ ...p, x: 4, z: 0 }, som)).toMatchObject({ reason: 'distancia' });
    expect(canEnter({ ...p, x: 2.5, z: 0 }, { ...som, occupant: 'A' })).toMatchObject({ reason: 'ocupado' });
    const trio = { x: 0, z: 0, heading: 0, occupant: '', kind: 'trio' };
    expect(distToCabDoor(TRIO.cabDoor[0], TRIO.cabDoor[1], trio)).toBe(0);
    expect(canEnter({ ...p, x: TRIO.cabDoor[0] + 0.5, z: TRIO.cabDoor[1] }, trio).ok).toBe(true);
    expect(canEnter({ ...p, x: 2.0, z: -3 }, trio)).toMatchObject({ reason: 'distancia' }); // lateral da carroceria, longe da cabine
    expect(distToVehicle(0, -7, trio)).toBeCloseTo(7 - TRIO.len / 2, 6);
  });
  it('motorista desce fora da carroceria', () => {
    for (const k of ['trio', 'soundcar']) for (const e of exitPoints(k, { x: 10, z: 5, heading: 0.7 })) {
      expect(pushOutOfBox(e.x, e.z, { x: 10, z: 5, heading: 0.7, kind: k }, 0.2), k).toBeNull();
    }
  });
  it('modo pacífico: trio e carro de som param antes de encostar (nunca atropelam)', () => {
    for (const k of ['soundcar', 'trio'] as const) {
      const b = vehicleBlock(k, { x: 0, z: 0 }, { x: 0, z: 2 }, 0, [{ x: 0, z: VEHICLE_BOX[k].len / 2 + 1.2 }]);
      expect(b.blocked, k).toBe(true);
      expect(VEHICLE_BOX[k].len / 2 + RULES.vehicleBlockMargin).toBeLessThanOrEqual(VEHICLE_BOX[k].len / 2 + 1.2 - b.z + 1e-6);
    }
  });
  it('carroceria sólida para quem anda e para outros veículos', () => {
    const t = { x: 0, z: 0, heading: Math.PI / 2, kind: 'trio' }; // trio deitado no eixo x
    const o = pushOutOfBox(1, 0.5, t, 0.3)!;
    expect(o).not.toBeNull();
    expect(Math.abs(o.z)).toBeCloseTo(TRIO.width / 2 + 0.3, 6);
    expect(pushOutOfBox(0, 3, t, 0.3)).toBeNull();
    expect(boxesOverlap(t, { x: 7.0, z: 0, heading: 0, kind: 'car' })).toBe(true); // carro atravessado na frente, encostando
    expect(boxesOverlap(t, { x: 9, z: 0, heading: Math.PI / 2, kind: 'car' })).toBe(false);
    expect(boxesOverlap(t, { x: 0, z: 2.5, heading: Math.PI / 2, kind: 'soundcar' })).toBe(false);
    expect(boxesOverlap(t, { x: 0, z: 2.2, heading: Math.PI / 2, kind: 'soundcar' })).toBe(true);
  });
  it('trio: acelera devagar até ≤ 1,5 m/s; a frente bate antes do centro (veículo longo)', () => {
    const world = new CollisionWorld(250, [-1000, -1000, 1000, 1000]);
    (world as unknown as { surfaceAt: () => number }).surfaceAt = () => 1; // asfalto
    const v: RideableState = { id: 't', kind: 'trio', x: 0, y: 0, z: 0, heading: 0, speed: 0, occupant: 'p' };
    for (let i = 0; i < 60 * 8; i++) stepRideable(v, RIDEABLE_DEFS.trio, { throttle: 1, steer: 0, boost: true }, 1 / 60, world);
    expect(v.speed).toBeGreaterThan(1.3);
    expect(v.speed).toBeLessThanOrEqual(1.5 + 1e-9);
    // superfície bloqueada 3 m à frente do PARA-CHOQUE: quem para é a frente do trio, não o centro (12,6 m de caminhão)
    const wallZ = v.z + TRIO.len / 2 + 3;
    (world as unknown as { isBlockedSurface: (x: number, z: number) => boolean }).isBlockedSurface = (_x, z) => z > wallZ;
    for (let i = 0; i < 60 * 12; i++) stepRideable(v, RIDEABLE_DEFS.trio, { throttle: 1, steer: 0, boost: true }, 1 / 60, world);
    expect(v.z + TRIO.len / 2 - 0.3).toBeLessThanOrEqual(wallZ + 0.05);
    expect(v.z).toBeGreaterThan(wallZ - TRIO.len / 2 - 2); // chegou perto (não parou à toa)
  });
});

describe('mundo: veículos e cenário de evento (pipeline)', () => {
  const spawns: { id: string; kind: string; x: number; z: number; heading: number }[] = manifest.vehicleSpawns;
  const spots: { id: string; kind: string; x: number; z: number; heading: number }[] = manifest.eventSpots ?? [];
  it('um trio e 1–2 carros de som estacionados na avenida fechada', () => {
    expect(spawns.filter((s) => s.kind === 'trio').length).toBe(1);
    const n = spawns.filter((s) => s.kind === 'soundcar').length;
    expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(2);
  });
  it('caminhões de campanha, telões e palco', () => {
    expect(spots.filter((s) => s.kind === 'truck').length).toBeGreaterThanOrEqual(2);
    expect(spots.filter((s) => s.kind === 'screen').length).toBeGreaterThanOrEqual(1);
    expect(spots.filter((s) => s.kind === 'stage').length).toBe(1);
    expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
  });
  it('nada se sobrepõe: veículos de evento, outros veículos, ônibus e cenário', () => {
    const boxes = [
      ...spawns.filter((s) => s.kind in VEHICLE_BOX).map((s) => ({ ...s })),
      ...(manifest.parkedBuses ?? []).map((b: { x: number; z: number; heading: number }, i: number) => ({ id: `bus${i}`, kind: 'bus', ...b })),
      ...spots.map((s) => ({ ...s })),
    ];
    const ext: Record<string, { len: number; width: number }> = { ...VEHICLE_BOX, bus: { len: 12.2, width: 2.6 }, truck: { len: 8.5, width: 2.5 }, stage: { len: 7, width: 10 }, screen: { len: 1.2, width: 6 } };
    const ev = boxes.filter((b) => ['trio', 'soundcar', 'truck', 'stage', 'screen'].includes(b.kind));
    for (const a of ev) for (const b of boxes) {
      if (a === b) continue;
      const A = ext[a.kind], B = ext[b.kind];
      // separação por eixos (mesma ideia de boxesOverlap, com as caixas do cenário)
      const axes = [[Math.sin(a.heading), Math.cos(a.heading)], [Math.cos(a.heading), -Math.sin(a.heading)], [Math.sin(b.heading), Math.cos(b.heading)], [Math.cos(b.heading), -Math.sin(b.heading)]];
      const half = (bx: { len: number; width: number }, h: number, ax: number[]) => (bx.len / 2) * Math.abs(Math.sin(h) * ax[0] + Math.cos(h) * ax[1]) + (bx.width / 2) * Math.abs(Math.cos(h) * ax[0] - Math.sin(h) * ax[1]);
      const sep = axes.some((ax) => Math.abs((b.x - a.x) * ax[0] + (b.z - a.z) * ax[1]) > half(A, a.heading, ax) + half(B, b.heading, ax));
      expect(sep, `${a.id} × ${b.id}`).toBe(true);
    }
  });
  it('eventos com lista de veículos liberam o trio e o carro de som', () => {
    for (const f of ['cotidiano', 'classico-exemplo']) {
      const e = JSON.parse(readFileSync(`public/events/${f}.json`, 'utf8'));
      const kinds = e.vehicles.map((v: { kind: string }) => v.kind);
      expect(kinds, f).toContain('trio');
      expect(kinds, f).toContain('soundcar');
    }
  });
  it('o trio está no MEIO do corredor (centro da avenida), não encostado nas pontas', () => {
    const ax: number[][] = manifest.pvAxis;
    let total = 0;
    for (let i = 0; i < ax.length - 1; i++) total += Math.hypot(ax[i + 1][0] - ax[i][0], ax[i + 1][1] - ax[i][1]);
    const t = spawns.find((s) => s.kind === 'trio')!;
    let best = Infinity, at = 0, acc = 0;
    for (let i = 0; i < ax.length - 1; i++) {
      const [x0, z0] = ax[i], [x1, z1] = ax[i + 1], dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
      const k = Math.max(0, Math.min(1, ((t.x - x0) * dx + (t.z - z0) * dz) / (l * l)));
      const d = Math.hypot(x0 + dx * k - t.x, z0 + dz * k - t.z);
      if (d < best) { best = d; at = (acc + k * l) / total; }
      acc += l;
    }
    expect(at).toBeGreaterThan(0.4); expect(at).toBeLessThan(0.6);
    expect(best).toBeLessThan(35);
  });
});

