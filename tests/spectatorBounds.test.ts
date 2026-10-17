import { describe, expect, it } from 'vitest';
import { SPECTATOR, clampPose, clampToBounds, insideBounds, poseToCamera, rateOk, sanitizeSpecCam, PITCH_RANGE, type Bounds } from '../src/spectator/bounds';
import { SpectatorSessions } from '../server/src/spectator/SpectatorSession';
import { buildAnchors } from '../src/spectator/anchors';
import { can } from '../src/access/policy';

const B: Bounds = [-1250, -750, 1250, 1000];

describe('espectador — limites da câmera', () => {
  it('foco preso aos limites do mapa (com margem)', () => {
    expect(clampToBounds(0, 0, B)).toEqual({ x: 0, z: 0 });
    expect(clampToBounds(99999, -99999, B)).toEqual({ x: 1250 - SPECTATOR.margin, z: -750 + SPECTATOR.margin });
  });
  it('spec_cam: só números finitos; fora do mapa é preso', () => {
    expect(sanitizeSpecCam({ x: 10, z: 20 }, B)).toEqual({ x: 10, z: 20 });
    expect(sanitizeSpecCam({ x: 1e9, z: 0 }, B)).toEqual({ x: 1250 - SPECTATOR.margin, z: 0 });
    for (const bad of [null, 'x', { x: NaN, z: 0 }, { x: Infinity, z: 0 }, { x: '1', z: 2 }, {}]) expect(sanitizeSpecCam(bad, B)).toBeNull();
  });
  it('taxa limitada', () => {
    expect(rateOk(-Infinity, 0)).toBe(true);
    expect(rateOk(1000, 1000 + SPECTATOR.serverMinIntervalMs - 1)).toBe(false);
    expect(rateOk(1000, 1000 + SPECTATOR.serverMinIntervalMs)).toBe(true);
  });
  it('pose: pitch, distância e altitude na faixa; a câmera também fica dentro do mapa', () => {
    const cases = [
      { x: 0, z: 0, yaw: 0, pitch: 5, dist: 1e6 },
      { x: 0, z: 0, yaw: 1, pitch: -1, dist: 0.1 },
      { x: 1240, z: 990, yaw: Math.PI, pitch: 0.2, dist: 320 },
      { x: -1e5, z: 1e5, yaw: 2.2, pitch: 0.5, dist: 300 },
    ];
    for (const c of cases) {
      const p = clampPose(c, B);
      expect(p.pitch).toBeGreaterThanOrEqual(PITCH_RANGE[0]);
      expect(p.pitch).toBeLessThanOrEqual(PITCH_RANGE[1]);
      expect(p.dist).toBeGreaterThanOrEqual(SPECTATOR.minDist);
      expect(p.dist).toBeLessThanOrEqual(SPECTATOR.maxDist);
      const cam = poseToCamera(p);
      expect(cam.y).toBeLessThanOrEqual(SPECTATOR.maxAlt + 1e-6);
      expect(insideBounds(cam, B)).toBe(true);
    }
  });
  it('âncoras (zonas + marcos + palco) caem dentro do mapa', () => {
    const a = buildAnchors({
      pvAxis: [[-1100, 480], [0, 100], [830, -210]], landmarks: [{ key: 'LANDMARK_CENTRAL', center: [-640, 330] }, { key: 'LANDMARK_CANDELARIA', center: [900, -260] }],
      zones: [{ id: 'CENTRAL', name: 'C', from: 0, to: 0.3, halfWidth: 200, anchor: { t: 0.28, side: 0 } }], eventSpots: [{ kind: 'stage', x: 593, z: -143, heading: 4.97 }],
    });
    for (const p of Object.values(a)) expect(insideBounds(poseToCamera(clampPose(p, B)), B)).toBe(true);
    expect(poseToCamera(clampPose(a.aerea, B)).y).toBeGreaterThan(200);
  });
});

describe('espectador — sessão no servidor', () => {
  const client = (sid: string) => ({ sessionId: sid }) as never;
  it('spec_cam aceita, prende e limita a taxa', () => {
    const s = new SpectatorSessions(B, 200);
    s.add(client('a'), 3, { x: 0, z: 0 }, 48);
    expect(s.onCam('a', { x: 5000, z: 10 }, 1000)).toBe('ok');
    expect(s.get('a')!.cam).toEqual({ x: 1250 - SPECTATOR.margin, z: 10 });
    expect(s.onCam('a', { x: 0, z: 0 }, 1100)).toBe('rate');
    expect(s.onCam('a', { x: 'a' }, 1300)).toBe('invalid');
    expect(s.onCam('a', { x: 1, z: 2 }, 1300)).toBe('ok');
    expect(s.onCam('zz', { x: 1, z: 2 }, 5000)).toBe('unknown');
    expect(s.get('a')!.dropped).toBe(2);
    expect(s.remove('a')?.slot).toBe(3);
    expect(s.size).toBe(0);
  });
  it('papel espectador não tem nenhuma capacidade de jogo, qualquer que seja a conta', () => {
    for (const st of ['VISITOR', 'REGISTERED', 'PLAYER', 'SUSPENDED'] as const) {
      for (const cap of ['world.play', 'vehicle.use', 'action.perform', 'item.hold', 'push', 'graffiti.create'] as const) expect(can(st, cap, 'spectator')).toBe(false);
      expect(can(st, 'world.spectate', 'spectator')).toBe(true);
    }
  });
});
