/**
 * Rodada 10 — SAÍDA SEGURA do veículo (servidor decide; o cliente offline usa a mesma função). PURA e testável.
 *
 * Candidatos em ordem de preferência (referencial local, +x = esquerda do motorista — src/vehicles/seats.ts):
 *   1. porta do motorista (entry do perfil)   2. o outro lado   3. frente   4. trás   5. anel de 12 direções a 1,2× e 1,8×
 * Um candidato vale se: fica dentro do mapa; o caminho do banco até ele não cruza parede; não cai dentro de outro
 * veículo (caixa + folga do corpo) nem do próprio; e não fica colado em outra pessoa (multidão sólida).
 * Sem nenhum candidato livre: relaxa a pessoa (pode ficar perto de alguém), depois os veículos; por último fica no
 * banco/centro (nunca atravessa parede para sair do outro lado).
 */
import { BOXED_KINDS, distToVehicle, VEHICLE_BOX, type VehicleKind } from '../net/rules';
import { localToWorld, type Pose2D } from './platform';
import { seatOf } from './seats';

export interface ExitWorld {
  /** caminho livre (sem parede) entre dois pontos do chão */
  clear(ax: number, az: number, bx: number, bz: number): boolean;
  /** limites do mapa [minX, minZ, maxX, maxZ] */
  bounds?: readonly [number, number, number, number];
  /** superfície bloqueada (água, canteiro sólido…) — opcional */
  blocked?(x: number, z: number): boolean;
}

export interface ExitObstacles {
  /** outros veículos (caixas orientadas) */
  vehicles?: { x: number; z: number; heading: number; kind: string }[];
  /** outras pessoas a pé (centros) */
  people?: { x: number; z: number }[];
}

/** raio do corpo (m) para não sair encostado em carroceria */
export const EXIT_BODY_R = 0.35;
/** distância mínima entre o centro de quem sai e o de outra pessoa */
export const EXIT_PERSON_GAP = 0.65;

export type ExitReason = 'livre' | 'perto_de_pessoa' | 'perto_de_veiculo' | 'sem_saida';

/** candidatos em ordem (mundo) */
export function exitCandidates(kind: string, v: Pose2D): { x: number; z: number; tag: string }[] {
  const box = VEHICLE_BOX[kind as VehicleKind] ?? { len: 1.2, width: 0.6 };
  const e = seatOf(kind).entry;
  const side = Math.max(Math.abs(e[0]), box.width / 2 + EXIT_BODY_R + 0.1);
  const lz = e[2];
  const out: { x: number; z: number; tag: string }[] = [];
  const add = (lx: number, z: number, tag: string) => { const w = localToWorld(v, lx, z); out.push({ x: w.x, z: w.z, tag }); };
  add(Math.sign(e[0] || 1) * side, lz, 'porta');
  add(-Math.sign(e[0] || 1) * side, lz, 'outro_lado');
  const front = box.len / 2 + EXIT_BODY_R + 0.25;
  add(0, front, 'frente');
  add(0, -front, 'tras');
  for (const f of [1.2, 1.8]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      // elipse em volta da carroceria
      add(Math.cos(a) * (box.width / 2 + EXIT_BODY_R + 0.25) * f, Math.sin(a) * (box.len / 2 + EXIT_BODY_R + 0.25) * f, `anel_${f}_${i}`);
    }
  }
  return out;
}

/** origem do caminho de saída: o banco do motorista (no mundo) */
function seatPoint(kind: string, v: Pose2D) {
  const h = seatOf(kind).hip;
  return localToWorld(v, h[0], h[2]);
}

/**
 * Escolhe a saída segura. `self` = o próprio veículo (pose + tipo). Devolve o ponto, o motivo e quantos candidatos
 * foram testados (QA). Determinística: mesma entrada → mesma saída.
 */
export function findSafeExit(kind: string, self: Pose2D, world: ExitWorld, obs: ExitObstacles = {}): { x: number; z: number; reason: ExitReason; tag: string; tried: number } {
  const cands = exitCandidates(kind, self);
  const seat = seatPoint(kind, self);
  const b = world.bounds;
  const inMap = (x: number, z: number) => !b || (x >= b[0] + 1 && z >= b[1] + 1 && x <= b[2] - 1 && z <= b[3] - 1);
  const selfBox = { x: self.x, z: self.z, heading: self.heading, kind }; // campos explícitos (o servidor passa um Schema)
  const others = obs.vehicles ?? [];
  const people = obs.people ?? [];
  const okWall = (c: { x: number; z: number }) => inMap(c.x, c.z) && !world.blocked?.(c.x, c.z) && world.clear(seat.x, seat.z, c.x, c.z);
  const okVeh = (c: { x: number; z: number }) => distToVehicle(c.x, c.z, selfBox) >= EXIT_BODY_R - 1e-6 && others.every((o) => distToVehicle(c.x, c.z, o) >= EXIT_BODY_R + (BOXED_KINDS.has(o.kind) ? 0 : 0.3));
  const okPeople = (c: { x: number; z: number }) => people.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= EXIT_PERSON_GAP);
  let tried = 0;
  for (const c of cands) { tried++; if (okWall(c) && okVeh(c) && okPeople(c)) return { x: c.x, z: c.z, reason: 'livre', tag: c.tag, tried }; }
  for (const c of cands) if (okWall(c) && okVeh(c)) return { x: c.x, z: c.z, reason: 'perto_de_pessoa', tag: c.tag, tried };
  for (const c of cands) if (okWall(c)) return { x: c.x, z: c.z, reason: 'perto_de_veiculo', tag: c.tag, tried };
  // nada livre (encurralado entre paredes): fica no banco — dentro do mapa e nunca do outro lado de uma parede
  return { x: seat.x, z: seat.z, reason: 'sem_saida', tag: 'banco', tried };
}

/** rumo de quem acabou de sair: de costas para o veículo (olhando para fora), ou o do veículo se saiu pela frente/trás */
export function exitHeading(self: Pose2D, at: { x: number; z: number }): number {
  const dx = at.x - self.x, dz = at.z - self.z;
  return Math.hypot(dx, dz) > 1e-3 ? Math.atan2(dx, dz) : self.heading;
}
