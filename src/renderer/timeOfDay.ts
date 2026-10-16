/**
 * Uniformes globais de horário compartilhados por shaders (edifícios, nuvens, postes, céu).
 * night: 0 = dia pleno, 1 = noite fechada (derivado da elevação solar real).
 * sunDir: direção (mundo) da luz principal — sol de dia, "luar" à noite.
 * skyHorizon / skyZenith: cores atuais do céu (lineares), usadas em reflexos falsos e neblina.
 */
import * as THREE from 'three';

export const timeUniforms = {
  night: { value: 0 },
  sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  skyHorizon: { value: new THREE.Color(0.62, 0.74, 0.9) },
  skyZenith: { value: new THREE.Color(0.12, 0.3, 0.72) },
};

/** 0 (sol acima de ~3°) → 1 (sol abaixo de −8°, fim do crepúsculo civil/náutico) */
export function nightFactor(sunElevationRad: number): number {
  const deg = (sunElevationRad * 180) / Math.PI;
  const t = Math.min(1, Math.max(0, (3 - deg) / 11));
  return t * t * (3 - 2 * t);
}
