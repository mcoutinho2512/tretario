/**
 * Rodada 10 — CONTRATO de assentos/montagem (docs/VEHICLE_MOUNTING.md).
 *
 * Arquitetura pronta para vários assentos; nesta rodada só DRIVER é obrigatório. No servidor `NetVehicle.occupant`
 * continua sendo o motorista (compatibilidade de rede/banco); assentos extras, se entrarem, vêm por dados aqui.
 * Âncoras no referencial LOCAL do veículo (x à direita, y para cima, z para a frente), em metros.
 */
import type { RideableKind } from './Rideable';

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
