/**
 * Rodada 10 — CONTRATO de áudio (docs/AUDIO_SYSTEM.md). Ponto único por onde jogo/veículos/combate/HUD PEDEM sons,
 * sem depender da implementação: até o AudioManager se registrar (depois de um gesto do usuário — autoplay), tudo
 * é no-op barato. Sons são próprios (síntese/gerados por código) ou de biblioteca com licença documentada em
 * docs/ASSET_LICENSES.md. Nunca uma fonte por NPC: multidão é agregada por célula (CrowdAudioCell).
 */
export type AudioCategory = 'master' | 'ambient' | 'crowd' | 'vehicles' | 'events' | 'ui' | 'sfx';

/** sons pontuais (one-shots). Acrescentar no FIM; nomes descritivos. */
export type SfxId =
  | 'step' | 'jump' | 'land'
  | 'punch' | 'kick' | 'whoosh' | 'dodge' | 'impact' | 'fall' | 'getup' | 'bat' | 'bar' | 'spray' | 'push' | 'blocked'
  | 'pickup' | 'drop' | 'ui_click' | 'ui_open' | 'ui_close' | 'ui_denied' | 'ui_ok'
  | 'veh_door' | 'veh_mount' | 'veh_brake' | 'veh_horn' | 'bike_bell'
  | 'whistle' | 'clap' | 'cheer' | 'megaphone';

export interface SfxOpts {
  /** posição no mundo (sem = 2D/interface) */
  x?: number; y?: number; z?: number;
  /** 0..1 */
  gain?: number;
  /** variação de altura ±(fração) */
  pitchJitter?: number;
  /** superfície para passos */
  surface?: 'asphalt' | 'sidewalk' | 'grass';
}

/** fonte contínua (motor, trio, carro de som): o dono atualiza posição/parâmetros por quadro; voz real é virtualizada */
export interface LoopHandle {
  set(p: { x: number; y?: number; z: number; rate?: number; gain?: number; intensity?: number }): void;
  stop(): void;
}
export type LoopKind = 'car_engine' | 'moto_engine' | 'bike_roll' | 'scooter_motor' | 'soundcar_music' | 'trio_music';

/** parâmetros agregados de uma célula de multidão (nada por NPC) */
export interface CrowdAudioCell {
  x: number; z: number;
  /** pessoas aproximadas na célula (NPC + jogadores) */
  density: number;
  /** 0..1 */
  activity: number;
  /** perfil de áudio dominante (torcida/manifestação/neutro) e fração */
  profile: string;
  profileShare: number;
  eventType?: string;
  combatIntensity: number;
  celebrationIntensity: number;
}

export interface AudioSink {
  sfx(id: SfxId, o?: SfxOpts): void;
  loop(kind: LoopKind, o: { x: number; y?: number; z: number }): LoopHandle;
  crowd(cells: readonly CrowdAudioCell[]): void;
  listener(x: number, y: number, z: number, yaw: number): void;
}

let sink: AudioSink | null = null;
/** handle preguiçoso: criado antes do áudio liberar, liga a voz real no primeiro `set` depois do registro */
class LazyLoop implements LoopHandle {
  private real: LoopHandle | null = null;
  private owner: AudioSink | null = null;
  private dead = false;
  constructor(private kind: LoopKind) {}
  set(p: { x: number; y?: number; z: number; rate?: number; gain?: number; intensity?: number }) {
    if (this.dead) return;
    if (this.owner !== sink) { this.real?.stop(); this.real = sink ? sink.loop(this.kind, p) : null; this.owner = sink; }
    this.real?.set(p);
  }
  stop() { this.dead = true; this.real?.stop(); this.real = null; }
}
/** chamado pelo AudioManager quando o AudioContext estiver liberado; null desliga */
export function setAudioSink(s: AudioSink | null) { sink = s; }
export function sfx(id: SfxId, o?: SfxOpts) { sink?.sfx(id, o); }
export function audioLoop(kind: LoopKind, o: { x: number; y?: number; z: number }): LoopHandle { const h = new LazyLoop(kind); h.set(o); return h; }
export function audioCrowd(cells: readonly CrowdAudioCell[]) { sink?.crowd(cells); }
export function audioListener(x: number, y: number, z: number, yaw: number) { sink?.listener(x, y, z, yaw); }
export function audioActive() { return sink !== null; }
