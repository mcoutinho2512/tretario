/**
 * Ponto de entrada do jogo (pedido do dono, 20/10/2026): EM FRENTE À CANDELÁRIA — na praça do lado da FACHADA (torres do
 * relógio, lado leste; a Presidente Vargas chega pelos fundos da igreja), no prolongamento do eixo, a `FRONT_GAP_M` da
 * fachada (metade do comprimento da igreja + folga), virado para ela. Calculado dos DADOS do mapa
 * (marco LANDMARK_CANDELARIA + eixo `pvAxis`) — o mesmo no servidor (sala) e no cliente (pré-carga, modo offline).
 * Sem o marco ou sem eixo: o `manifest.spawn` original (Central do Brasil).
 * Formato igual ao do manifest: p = [x, z], yaw = atan2(dz, dx) do rumo.
 */
export interface SpawnLike { p: [number, number] | number[]; yaw: number }
interface ManifestLike {
  spawn: SpawnLike;
  pvAxis?: [number, number][] | number[][];
  landmarks?: { key: string; center: [number, number] | number[]; length?: number }[];
}

/** distância da fachada (m) até o ponto de entrada, além da metade do comprimento da igreja */
export const FRONT_GAP_M = 70; // ~106 m do centro: beira da praça, pista a poucos metros (moto/carro surgem e montam na hora)
/** raio da "região da Candelária" (foco dos personagens autônomos) em volta do centro da igreja */
export const CANDELARIA_FOCUS_RADIUS_M = 150;

export function gameSpawn(m: ManifestLike): { p: [number, number]; yaw: number } {
  const fallback = { p: [m.spawn.p[0], m.spawn.p[1]] as [number, number], yaw: m.spawn.yaw };
  const lm = m.landmarks?.find((l) => l.key === 'LANDMARK_CANDELARIA');
  const ax = m.pvAxis;
  if (!lm || !ax || ax.length < 2) return fallback;
  // projeção do centro da igreja no eixo (segmento mais próximo) → distância acumulada sC
  const cx = lm.center[0], cz = lm.center[1];
  let best = Infinity, sC = 0, acc = 0;
  const segs: { ax: number; az: number; dx: number; dz: number; len: number; s0: number }[] = [];
  for (let i = 0; i < ax.length - 1; i++) {
    const a = ax[i], b = ax[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    segs.push({ ax: a[0], az: a[1], dx, dz, len, s0: acc });
    const t = Math.max(0, Math.min(1, ((cx - a[0]) * dx + (cz - a[1]) * dz) / (len * len)));
    const d = Math.hypot(a[0] + dx * t - cx, a[1] + dz * t - cz);
    if (d < best) { best = d; sC = acc + t * len; }
    acc += len;
  }
  if (!segs.length) return fallback;
  // o eixo vem da Cidade Nova e passa pela igreja: a fachada é o lado de s MAIOR (depois dela); olhando de volta para ela
  // pode passar um pouco do fim do eixo (prolonga o último trecho em até 12 m)
  const s = Math.min(acc + 12, sC + (lm.length ?? 60) / 2 + FRONT_GAP_M);
  const seg = segs.find((g) => s >= g.s0 && s <= g.s0 + g.len) ?? segs[segs.length - 1];
  const t = (s - seg.s0) / seg.len;
  return { p: [+(seg.ax + seg.dx * t).toFixed(2), +(seg.az + seg.dz * t).toFixed(2)], yaw: Math.atan2(-seg.dz, -seg.dx) };
}

/**
 * Região da Candelária para os personagens autônomos: centro da igreja e dois pontos ABERTOS de onde se sorteiam lugares
 * com linha livre (a praça da fachada = ponto de entrada; e o fim da Presidente Vargas, atrás da igreja) — assim nunca
 * se escolhe um ponto DENTRO do prédio. null sem o marco/eixo.
 */
export function candelariaArea(m: ManifestLike): { center: { x: number; z: number }; anchors: { x: number; z: number }[] } | null {
  const lm = m.landmarks?.find((l) => l.key === 'LANDMARK_CANDELARIA');
  if (!lm || !m.pvAxis || m.pvAxis.length < 2) return null;
  const front = gameSpawn(m);
  // atrás da igreja, na avenida: espelho do ponto da fachada em relação ao centro, recuado mais 10 m
  const dx = front.p[0] - lm.center[0], dz = front.p[1] - lm.center[1], d = Math.hypot(dx, dz) || 1;
  const back = { x: lm.center[0] - (dx / d) * (d + 10), z: lm.center[1] - (dz / d) * (d + 10) };
  return { center: { x: lm.center[0], z: lm.center[1] }, anchors: [{ x: front.p[0], z: front.p[1] }, back] };
}

