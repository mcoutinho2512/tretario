/**
 * Uniformes globais de horário compartilhados por shaders (edifícios, nuvens, postes).
 * night: 0 = dia pleno, 1 = noite fechada (derivado da elevação solar real).
 */
export const timeUniforms = {
  night: { value: 0 },
};

/** 0 (sol acima de ~3°) → 1 (sol abaixo de −8°, fim do crepúsculo civil/náutico) */
export function nightFactor(sunElevationRad: number): number {
  const deg = (sunElevationRad * 180) / Math.PI;
  const t = Math.min(1, Math.max(0, (3 - deg) / 11));
  return t * t * (3 - 2 * t);
}
