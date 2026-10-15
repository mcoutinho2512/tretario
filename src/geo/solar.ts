/**
 * Posição solar (algoritmo NOAA simplificado, precisão ~0.1°) para iluminação fisicamente coerente.
 * Permite ciclo de horários futuros (manhã, tarde, pôr do sol, noite).
 */
const DEG = Math.PI / 180;

export interface SunPosition {
  /** elevação acima do horizonte (rad) */
  elevation: number;
  /** azimute a partir do norte, sentido horário (rad) */
  azimuth: number;
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * DEG) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * DEG) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(eps * DEG) * Math.sin(lambda * DEG));
  const y = Math.tan((eps / 2) * DEG) ** 2;
  const eqTime = 4 / DEG * (y * Math.sin(2 * L0 * DEG) - 2 * e * Math.sin(M * DEG) + 4 * e * y * Math.sin(M * DEG) * Math.cos(2 * L0 * DEG)
    - 0.5 * y * y * Math.sin(4 * L0 * DEG) - 1.25 * e * e * Math.sin(2 * M * DEG));
  const minutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (minutesUTC + eqTime + 4 * lon + 1440) % 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;
  const ha = hourAngle * DEG;
  const latR = lat * DEG;
  const cosZen = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(latR) - Math.tan(decl) * Math.cos(latR));
  return { elevation: Math.PI / 2 - zenith, azimuth: (az + Math.PI) % (2 * Math.PI) };
}

/** Converte para vetor no sistema do mundo (x = leste, y = cima, z = sul). */
export function sunDirection(p: SunPosition): [number, number, number] {
  const ce = Math.cos(p.elevation);
  return [ce * Math.sin(p.azimuth), Math.sin(p.elevation), -ce * Math.cos(p.azimuth)];
}

/** Data no fuso do Rio (UTC−3, sem horário de verão desde 2019). */
export function rioDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
}
