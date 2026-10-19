/**
 * Rodada 12 — PONTO DE SURGIMENTO do veículo pessoal (docs/PERSONAL_VEHICLES.md). PURO e determinístico: o servidor
 * decide com ele (server/src/vehicles/PersonalVehicles.ts) e o modo offline usa o mesmo.
 *
 * Candidatos em ANÉIS em volta do avatar, do raio-alvo `PERSONAL_RULES.spawnDist[kind]` até `spawnMaxDist[kind]`;
 * em cada anel, direções em ordem de preferência (lado direito/esquerdo antes da frente — não "nasce" no caminho;
 * atrás por último) e, para cada direção, rumos (paralelo ao avatar; carro também atravessado) — a porta do motorista
 * virada para o avatar primeiro. Um candidato vale se a CAIXA do veículo (VEHICLE_BOX):
 *   - fica dentro do mapa;
 *   - está toda sobre superfície permitida (carro/moto: só PISTA — `RIDEABLE_DEFS.sidewalk`; patinete/bicicleta:
 *     pista ou calçada) — nunca prédio, água, plataforma ou fora do mapa;
 *   - não cruza parede (centro → cantos e avatar → centro sem parede);
 *   - não encosta em outro veículo (caixas orientadas com folga), nem em pessoa (jogador/autônomo, BODY.radius + folga;
 *     o próprio dono também — o veículo nunca nasce "dentro" dele), nem em objeto (poste, banco, banca…).
 * Nenhum candidato até `spawnMaxDist` → `sem_lugar` (nunca "seu carro está a 180 m").
 */
import { BODY } from '../physics/bodies';
import { boxesOverlap, VEHICLE_BOX, type VehicleKind } from '../net/rules';
import { PERSONAL_RULES, type PersonalKind } from './personal';
import { seatOf } from './seats';
import { localToWorld } from './platform';

export type SpawnSurface = 'road' | 'walk' | 'blocked';

export interface SpawnWorld {
  /** caminho livre (sem parede) entre dois pontos do chão */
  clear(ax: number, az: number, bx: number, bz: number): boolean;
  /** tipo do chão num ponto */
  surface(x: number, z: number): SpawnSurface;
  /** limites do mapa [minX, minZ, maxX, maxZ] */
  bounds?: readonly [number, number, number, number];
}

export interface SpawnObstacles {
  /** veículos existentes (caixas orientadas) */
  vehicles?: readonly { x: number; z: number; heading: number; kind: string }[];
  /** corpos (jogadores/autônomos — centros), sem o dono */
  people?: readonly { x: number; z: number }[];
  /** objetos do chão (centro + raio) */
  objects?: readonly { x: number; z: number; r: number }[];
}

export interface SpawnFrom { x: number; z: number; heading: number }

export type SpawnResult =
  | { ok: true; x: number; z: number; heading: number; d: number; tag: string; tried: number }
  | { ok: false; tried: number };

/** pode andar na calçada? (o mesmo de RIDEABLE_DEFS.sidewalk — sem importar three.js) */
export const SIDEWALK_OK: Record<PersonalKind, boolean> = { scooter: true, bicycle: true, moto: false, car: false };
/** folgas (m) */
export const SPAWN_GAP = { vehicle: 0.35, person: 0.15, owner: 0.12, object: 0.1, mapMargin: 2 } as const;
/** passo entre anéis (m) */
const RING_STEP: Record<PersonalKind, number> = { scooter: 0.35, bicycle: 0.35, moto: 0.5, car: 0.8 };
/** direções relativas ao rumo do avatar, em ordem de preferência (rad; + = direita do avatar) */
const DIRS = [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 8, -(3 * Math.PI) / 8, Math.PI / 8, -Math.PI / 8,
  0, (5 * Math.PI) / 8, -(5 * Math.PI) / 8, (3 * Math.PI) / 4, -(3 * Math.PI) / 4, (7 * Math.PI) / 8, -(7 * Math.PI) / 8, Math.PI];

/** distância de um ponto à caixa orientada (0 = dentro) */
export function boxDist(px: number, pz: number, c: { x: number; z: number; heading: number }, box: { len: number; width: number }): number {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  const dx = px - c.x, dz = pz - c.z;
  const along = Math.max(0, Math.abs(dx * fx + dz * fz) - box.len / 2), lat = Math.max(0, Math.abs(dx * fz - dz * fx) - box.width / 2);
  return Math.hypot(along, lat);
}

/** pontos de amostra da caixa (centro, cantos e meios dos lados longos) */
function samples(c: { x: number; z: number; heading: number }, box: { len: number; width: number }): { x: number; z: number }[] {
  const hl = box.len / 2, hw = box.width / 2;
  const out: { x: number; z: number }[] = [];
  for (const [lx, lz] of [[0, 0], [hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [hw, 0], [-hw, 0], [0, hl], [0, -hl]] as const) out.push(localToWorld(c, lx, lz));
  return out;
}

/** distância do avatar à entrada (porta/lado) mais próxima do veículo — base do "monta já" */
export function entryDistance(kind: string, v: { x: number; z: number; heading: number }, px: number, pz: number): number {
  const e = seatOf(kind).entry;
  const a = localToWorld(v, e[0], e[2]), b = localToWorld(v, -e[0], e[2]);
  return Math.min(Math.hypot(a.x - px, a.z - pz), Math.hypot(b.x - px, b.z - pz));
}

/** candidatos em ordem (anel → direção → rumo) */
export function personalCandidates(kind: PersonalKind, from: SpawnFrom): { x: number; z: number; heading: number; d: number; tag: string }[] {
  const r0 = PERSONAL_RULES.spawnDist[kind], r1 = PERSONAL_RULES.spawnMaxDist[kind], step = RING_STEP[kind];
  const headings = kind === 'car' ? [0, Math.PI, Math.PI / 2, -Math.PI / 2] : [0, Math.PI];
  const out: { x: number; z: number; heading: number; d: number; tag: string }[] = [];
  for (let r = r0, ri = 0; r <= r1 + 1e-6; r += step, ri++) {
    for (let di = 0; di < DIRS.length; di++) {
      const a = from.heading + DIRS[di];
      const x = from.x + Math.sin(a) * r, z = from.z + Math.cos(a) * r;
      // a porta do motorista virada para o avatar primeiro
      const hs = headings.map((dh) => from.heading + dh).map((h) => ({ h, e: entryDistance(kind, { x, z, heading: h }, from.x, from.z) }));
      if (kind === 'car') hs.sort((p, q) => p.e - q.e);
      for (const { h } of hs) out.push({ x, z, heading: h, d: r, tag: `r${ri}_d${di}` });
    }
  }
  return out;
}

/** escolhe o ponto seguro mais próximo; `ok: false` = nada livre até spawnMaxDist (`sem_lugar`) */
export function findPersonalSpawn(kind: PersonalKind, from: SpawnFrom, world: SpawnWorld, obs: SpawnObstacles = {}): SpawnResult {
  const box = VEHICLE_BOX[kind as VehicleKind];
  const b = world.bounds;
  const m = SPAWN_GAP.mapMargin;
  const inMap = (x: number, z: number) => !b || (x >= b[0] + m && z >= b[1] + m && x <= b[2] - m && z <= b[3] - m);
  const okSurf = (s: SpawnSurface) => s === 'road' || (s === 'walk' && SIDEWALK_OK[kind]);
  const vehicles = obs.vehicles ?? [], people = obs.people ?? [], objects = obs.objects ?? [];
  let tried = 0;
  // o mesmo centro aparece com vários rumos: chão e parede do centro testados uma vez por posição
  const centerOk = new Map<string, boolean>();
  for (const c of personalCandidates(kind, from)) {
    tried++;
    const pos = c.tag;
    let co = centerOk.get(pos);
    if (co === undefined) { co = inMap(c.x, c.z) && okSurf(world.surface(c.x, c.z)) && world.clear(from.x, from.z, c.x, c.z); centerOk.set(pos, co); }
    if (!co) continue;
    // baratos primeiro: dono, pessoas, veículos, objetos; depois chão e paredes
    if (boxDist(from.x, from.z, c, box) < BODY.radius + SPAWN_GAP.owner) continue;
    if (people.some((p) => boxDist(p.x, p.z, c, box) < BODY.radius + SPAWN_GAP.person)) continue;
    const me = { x: c.x, z: c.z, heading: c.heading, kind };
    if (vehicles.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 20 && boxesOverlap(me, o, SPAWN_GAP.vehicle / 2))) continue;
    if (objects.some((o) => boxDist(o.x, o.z, c, box) < o.r + SPAWN_GAP.object)) continue;
    const pts = samples(c, box);
    if (!pts.every((p) => inMap(p.x, p.z) && okSurf(world.surface(p.x, p.z)))) continue;
    if (!pts.every((p, i) => i === 0 || world.clear(c.x, c.z, p.x, p.z))) continue;
    return { ok: true, x: c.x, z: c.z, heading: c.heading, d: Math.hypot(c.x - from.x, c.z - from.z), tag: c.tag, tried };
  }
  return { ok: false, tried };
}
