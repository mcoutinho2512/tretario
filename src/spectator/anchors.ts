/**
 * Pontos de câmera do espectador a partir dos DADOS do mundo: âncoras das zonas (public/world/zones.json), marcos
 * (Central do Brasil, Candelária) e palco do evento (manifest.eventSpots). Puro (testável).
 */
import { pointOnAxis, type ZoneDefinition } from '../world/zones';
import { SPECTATOR, type SpecPose } from './bounds';
import type { SpecAnchors } from './SpectatorCamera';

type XZ = [number, number];

export interface AnchorInputs {
  pvAxis: XZ[];
  zones: readonly ZoneDefinition[];
  landmarks: { key: string; center: number[] }[];
  eventSpots?: { kind: string; x: number; z: number; heading?: number }[];
}

const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);

export function buildAnchors(m: AnchorInputs): SpecAnchors {
  const zoneT = (id: string, fb: number) => m.zones.find((z) => z.id === id)?.anchor?.t ?? fb;
  const lm = (key: string) => m.landmarks.find((l) => l.key === key)?.center as XZ | undefined;
  /** vista do eixo da avenida em t, olhando para um alvo (ou ao longo do eixo) */
  const view = (t: number, target: XZ | undefined, pitch: number, dist: number, back = 0): SpecPose => {
    const a = pointOnAxis(m.pvAxis, t);
    if (target) {
      // foco entre a avenida e o marco; câmera do lado da avenida
      const fx = a.x + (target[0] - a.x) * 0.55, fz = a.z + (target[1] - a.z) * 0.55;
      return { x: fx, z: fz, yaw: yawTo(a.x, a.z, target[0], target[1]), pitch, dist };
    }
    const b = pointOnAxis(m.pvAxis, Math.max(0, t - back));
    return { x: a.x, z: a.z, yaw: yawTo(b.x, b.z, a.x, a.z) || a.heading, pitch, dist };
  };
  const tC = zoneT('CENTRAL', 0.28), tK = zoneT('CANDELARIA', 0.954);
  const stage = m.eventSpots?.find((s) => s.kind === 'stage');
  const mid = pointOnAxis(m.pvAxis, (tC + tK) / 2);
  const aerialPitch = 1.18;
  return {
    central: view(Math.max(0, tC - 0.04), lm('LANDMARK_CENTRAL'), 0.34, 120),
    campo: view(zoneT('CAMPO_DE_SANTANA', 0.38), undefined, 0.5, 140, 0.04),
    candelaria: view(Math.max(0, tK - 0.06), lm('LANDMARK_CANDELARIA'), 0.3, 120),
    aerea: { x: mid.x, z: mid.z, yaw: mid.heading, pitch: aerialPitch, dist: SPECTATOR.maxAlt / Math.sin(aerialPitch) },
    stage: stage ? { x: stage.x, z: stage.z, yaw: (stage.heading ?? 0) + Math.PI, pitch: 0.4, dist: 60 } : view(0.6, undefined, 0.4, 80, 0.04),
  };
}
