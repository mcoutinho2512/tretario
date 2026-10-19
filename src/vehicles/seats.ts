/**
 * Rodada 10 — CONTRATO de assentos/montagem (docs/VEHICLE_MOUNTING.md).
 *
 * Arquitetura pronta para vários assentos; nesta rodada só DRIVER é obrigatório. No servidor `NetVehicle.occupant`
 * continua sendo o motorista (compatibilidade de rede/banco); assentos extras, se entrarem, vêm por dados aqui.
 * Âncoras no referencial LOCAL do veículo, em metros: y para cima, z para a frente e x para a ESQUERDA do motorista —
 * o mesmo referencial do modelo three.js com `rotation.y = heading` e de `localToWorld` (src/vehicles/platform.ts).
 * (A primeira versão deste comentário dizia "x à direita"; a convenção do código sempre foi +x = esquerda.)
 */
// rodada 10: mesmo conjunto que RideableKind (Rideable.ts), vindo do módulo puro — o servidor importa este arquivo
import type { VehicleKind as RideableKind } from '../net/rules';

export type SeatRole = 'DRIVER' | 'PASSENGER_FRONT' | 'PASSENGER_REAR_LEFT' | 'PASSENGER_REAR_RIGHT';

/** pose do corpo montado (clipes em proceduralClips: veh_<pose>_*) */
export type MountPose = 'car_seat' | 'moto_ride' | 'bike_pedal' | 'scooter_stand' | 'cab_seat';

export interface SeatAnchors {
  role: SeatRole;
  pose: MountPose;
  /** pelve (quadril) do avatar sentado/montado */
  hip: [number, number, number];
  /** mãos (volante/guidão) — alvo dos braços (IK leve de 2 ossos ou pose) */
  handL: [number, number, number];
  handR: [number, number, number];
  /** pés (pedais/plataforma/assoalho) */
  footL: [number, number, number];
  footR: [number, number, number];
  /** onde o avatar está ao começar a entrar / ao terminar de sair (lado preferido; o servidor procura alternativa) */
  entry: [number, number, number];
}

export interface MountProfile {
  kind: RideableKind;
  seats: SeatAnchors[];
  /** duração das transições (ms) — o servidor não espera por elas; são só visuais */
  enterMs: number;
  exitMs: number;
  /** câmera por categoria (ThirdPersonCamera.setProfile) */
  camera: { distance: number; height: number; fov?: number };
}

/** fase visual da montagem (cliente local e remotos derivam da mudança de `vehicle`) */
export type MountPhase = 'none' | 'entering' | 'mounted' | 'exiting';

// ======================================================================== rodada 10 — montagem (AGENTE C)
type V3 = [number, number, number];

/**
 * Dinâmica do corpo montado por tipo (dados; o solver em src/characters/human/vehicleClips.ts lê). Tudo no mesmo
 * referencial local das âncoras. Os alvos de mão/pé das âncoras valem com o guidão/volante reto e o pedivela na
 * horizontal; o solver gira as mãos em torno de `steerPivot` e move os pés pelo pedivela/impulso.
 */
export interface MountRig {
  /** clipe da biblioteca por baixo do IK (pernas/braços são reposicionados por cima) */
  baseClip: 'drive' | 'sit' | 'idle';
  /** pivô e eixo (local, unitário) do guidão/volante; as mãos acompanham o esterço */
  steerPivot: V3;
  steerAxis: V3;
  /** giro do guidão/volante (rad) no esterço máximo; as mãos seguem até `handFollow` (rad) */
  steerMax: number;
  handFollow: number;
  /** inclinação do veículo + corpo nas curvas (rad, máx.) — duas rodas */
  leanMax: number;
  /** inclinação do tronco para a frente [mín, máx] (rad): o solver escolhe para as mãos alcançarem o guidão */
  torso: [number, number];
  /** polo dos joelhos e cotovelos (local, lado ESQUERDO: direção para onde a articulação aponta; x espelhado no direito) */
  kneePole: V3;
  elbowPole: V3;
  /** bicicleta: pedivela (centro local, raio, metros andados por volta, afastamento lateral do pedal) */
  crank?: { center: V3; radius: number; mPerRev: number; footX: number };
  /** patinete: o pé de trás rema no chão (ponto médio do impulso, local) quando acelera devagar */
  kick?: { ground: V3; stroke: number; maxSpeed: number };
  /** moto parada: pé esquerdo no chão (tornozelo, local) */
  footDown?: V3;
}

export type MountKind = 'car' | 'moto' | 'bicycle' | 'scooter' | 'soundcar' | 'trio';
export type MountProfileFull = MountProfile & { rig: MountRig };

/**
 * Perfis por tipo. Carro = sedan de vehicles.glb (motorista à esquerda, +x; teto 1,46 m, linha dos vidros 0,98 m,
 * para-brisa de z 0,2 a 1,08). Duas rodas = modelos procedurais de src/vehicles/Rideable.ts. Cabines do carro de som e
 * do trio: banco = `RIDEABLE_DEFS.seat` × `seatHeight` (cabine opaca — o motorista fica posado lá dentro).
 * `entry` = lado do motorista; o cliente usa o lado mais próximo de quem chega e o servidor escolhe a saída segura
 * (src/vehicles/exitSafety.ts).
 */
export const MOUNT_PROFILES: Record<MountKind, MountProfileFull> = {
  car: {
    kind: 'car', enterMs: 900, exitMs: 750, camera: { distance: 7.4, height: 1.85 },
    seats: [{ role: 'DRIVER', pose: 'car_seat', hip: [0.37, 0.58, -0.2], handL: [0.53, 0.97, 0.31], handR: [0.21, 0.97, 0.31], footL: [0.45, 0.3, 0.72], footR: [0.29, 0.3, 0.74], entry: [1.35, 0, -0.1] }],
    rig: { baseClip: 'drive', steerPivot: [0.37, 0.93, 0.36], steerAxis: [0, 0.42, -0.907], steerMax: 1.6, handFollow: 0.9, leanMax: 0, torso: [-0.12, 0.15], kneePole: [0.15, 1, 0.6], elbowPole: [0.7, -0.7, -0.2] },
  },
  moto: {
    kind: 'moto', enterMs: 650, exitMs: 550, camera: { distance: 4.9, height: 1.55 },
    seats: [{ role: 'DRIVER', pose: 'moto_ride', hip: [0, 1.04, -0.2], handL: [0.3, 1.05, 0.44], handR: [-0.3, 1.05, 0.44], footL: [0.2, 0.44, -0.1], footR: [-0.2, 0.44, -0.1], entry: [0.85, 0, -0.25] }],
    rig: { baseClip: 'sit', steerPivot: [0, 0.98, 0.5], steerAxis: [0, 0.947, -0.32], steerMax: 0.35, handFollow: 0.35, leanMax: 0.42, torso: [0.1, 0.55], kneePole: [0.35, 0.3, 1], elbowPole: [0.8, -0.5, -0.3], footDown: [0.33, 0.08, -0.02] },
  },
  bicycle: {
    kind: 'bicycle', enterMs: 550, exitMs: 450, camera: { distance: 4.6, height: 1.5 },
    seats: [{ role: 'DRIVER', pose: 'bike_pedal', hip: [0, 1.05, -0.3], handL: [0.26, 1.04, 0.3], handR: [-0.26, 1.04, 0.3], footL: [0.12, 0.4, 0.09], footR: [-0.12, 0.4, -0.25], entry: [0.7, 0, -0.2] }],
    rig: { baseClip: 'sit', steerPivot: [0, 0.92, 0.42], steerAxis: [0, 0.954, -0.3], steerMax: 0.4, handFollow: 0.4, leanMax: 0.3, torso: [0.1, 0.6], kneePole: [0.12, 0.25, 1], elbowPole: [0.8, -0.6, -0.2], crank: { center: [0, 0.33, 0], radius: 0.17, mPerRev: 4.8, footX: 0.12 } },
  },
  scooter: {
    kind: 'scooter', enterMs: 420, exitMs: 380, camera: { distance: 4.4, height: 1.5 },
    // em pé: `hip` y = altura da plataforma (o corpo fica de pé sobre ela); pé esquerdo na frente
    seats: [{ role: 'DRIVER', pose: 'scooter_stand', hip: [0, 0.18, -0.08], handL: [0.22, 1.16, 0.49], handR: [-0.22, 1.16, 0.49], footL: [0.05, 0.25, 0.14], footR: [-0.06, 0.25, -0.2], entry: [0.55, 0, -0.1] }],
    rig: { baseClip: 'idle', steerPivot: [0, 0.6, 0.42], steerAxis: [0, 0.993, 0.12], steerMax: 0.45, handFollow: 0.45, leanMax: 0.18, torso: [0, 0.45], kneePole: [0.1, 0, 1], elbowPole: [0.8, -0.6, -0.3], kick: { ground: [-0.15, 0.08, -0.3], stroke: 0.42, maxSpeed: 3.2 } },
  },
  soundcar: {
    kind: 'soundcar', enterMs: 800, exitMs: 700, camera: { distance: 10, height: 2.6 },
    seats: [{ role: 'DRIVER', pose: 'cab_seat', hip: [0.45, 1.05, 0.95], handL: [0.62, 1.45, 1.38], handR: [0.28, 1.45, 1.38], footL: [0.55, 0.72, 1.55], footR: [0.35, 0.72, 1.55], entry: [1.6, 0, 1.0] }],
    rig: { baseClip: 'drive', steerPivot: [0.45, 1.42, 1.4], steerAxis: [0, 0.42, -0.907], steerMax: 1.6, handFollow: 0.9, leanMax: 0, torso: [-0.1, 0.15], kneePole: [0.15, 1, 0.6], elbowPole: [0.7, -0.7, -0.2] },
  },
  trio: {
    kind: 'trio', enterMs: 900, exitMs: 800, camera: { distance: 17, height: 4.2 },
    seats: [{ role: 'DRIVER', pose: 'cab_seat', hip: [0.6, 1.85, 5.05], handL: [0.77, 2.25, 5.48], handR: [0.43, 2.25, 5.48], footL: [0.7, 1.52, 5.65], footR: [0.5, 1.52, 5.65], entry: [1.9, 0, 4.9] }],
    rig: { baseClip: 'drive', steerPivot: [0.6, 2.22, 5.5], steerAxis: [0, 0.42, -0.907], steerMax: 1.6, handFollow: 0.9, leanMax: 0, torso: [-0.1, 0.15], kneePole: [0.15, 1, 0.6], elbowPole: [0.7, -0.7, -0.2] },
  },
};

/** perfil do tipo (reserva: bicicleta) */
export function mountProfile(kind: string): MountProfileFull { return MOUNT_PROFILES[kind as MountKind] ?? MOUNT_PROFILES.bicycle; }

/** assento de um papel (nesta rodada só DRIVER existe; outro papel cai no do motorista) */
export function seatOf(kind: string, role: SeatRole = 'DRIVER'): SeatAnchors {
  const p = mountProfile(kind);
  return p.seats.find((s) => s.role === role) ?? p.seats[0];
}

/**
 * Fase visual da montagem derivada SÓ da mudança do veículo (id) — cliente local e remotos usam a mesma regra, nada
 * de osso na rede. `step` a cada quadro com o veículo atual (ou null); devolve a fase e o progresso 0..1 dela.
 *  none → (veículo) → entering → (enterMs) → mounted → (null) → exiting → (exitMs) → none.
 * Trocar de veículo direto (A → B) recomeça a entrada; voltar ao mesmo veículo durante a saída entra de novo.
 */
export class MountTracker {
  phase: MountPhase = 'none';
  /** veículo da fase atual (na saída: o que está sendo deixado) */
  vehicle: string | null = null;
  kind: string | null = null;
  private t0 = 0;
  private dur = 0;
  /** `snap`: começa já montado (reconexão, primeiro quadro do avatar) */
  step(vehicle: string | null, kind: string | null, now: number, snap = false): { phase: MountPhase; k: number; changed: boolean } {
    let changed = false;
    if (vehicle && vehicle !== (this.phase === 'exiting' || this.phase === 'none' ? null : this.vehicle)) {
      this.vehicle = vehicle; this.kind = kind;
      this.phase = snap ? 'mounted' : 'entering';
      this.t0 = now; this.dur = mountProfile(kind ?? '').enterMs; changed = true;
    } else if (!vehicle && (this.phase === 'entering' || this.phase === 'mounted')) {
      this.phase = snap ? 'none' : 'exiting';
      this.t0 = now; this.dur = mountProfile(this.kind ?? '').exitMs; changed = true;
      if (snap) this.vehicle = null;
    }
    const k = this.dur > 0 ? Math.min(1, Math.max(0, (now - this.t0) / this.dur)) : 1;
    if (k >= 1 && this.phase === 'entering') this.phase = 'mounted';
    else if (k >= 1 && this.phase === 'exiting') { this.phase = 'none'; this.vehicle = null; }
    return { phase: this.phase, k: this.phase === 'mounted' ? 1 : this.phase === 'none' ? 0 : k, changed };
  }
  reset() { this.phase = 'none'; this.vehicle = null; this.kind = null; this.dur = 0; }
}
