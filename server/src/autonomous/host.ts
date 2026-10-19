/**
 * Rodada 12 — o que o sistema de autônomos vê/faz no mundo. A SALA implementa (PresidenteVargasRoom, bloco
 * "rodada 12 — autônomos") passando pelos MESMOS caminhos dos jogadores: movimento validado (onMove: velocidade,
 * paredes, carroceria do trio), ações sociais/itens (onAct/onProp: validateAction/validateProp), veículos
 * (onEnter/onExit: canEnter, saída segura), confronto (CombatSystem.request: stamina/cooldown/alcance/política).
 * Os testes e a ferramenta de humanização usam `SimHost` (simHost.ts), com as mesmas regras puras.
 */
import type { CharacterAppearance } from '../../../src/characters/bodyTypes';

/** pessoa conectada (humano ou bot de carga). `spectator`: câmera de espectador — mantém a área viva (LOD), mas não é
 * corpo, não é olhado e nunca é alvo */
export interface HumanView { id: string; nid: number; x: number; z: number; heading: number; speed: number; vehicle: boolean; status: number; spectator?: boolean }
export interface VehicleView { id: string; kind: string; x: number; z: number; heading: number; occupant: string; state: number; owner?: string }
export type HotspotKind = 'stage' | 'truck' | 'screen' | 'spawn' | 'trio' | 'soundcar' | 'event';
/** ponto de concentração (dados do mundo/evento): palco, caminhões, telões, praça do spawn, trio/carro de som, evento vivo */
export interface Hotspot { id: string; kind: HotspotKind; x: number; z: number; inner: number; radius: number; weight: number; heading?: number; moving?: boolean }

/** aparência/identidade pública do autônomo ao aparecer (a sala valida a aparência pelo validador único) */
export interface AgentLook {
  name: string; appearance: CharacterAppearance; sup: number; title: string; lvl: number;
  /** NetPlayer.tag: 0 regra padrão do cliente · 1 sempre mostrar o apelido · 2 nunca mostrar */
  tag: number;
  prop: number; design: number;
}

/** estado autoritativo da entidade na sala (o servidor pode ter mudado: queda, saída de veículo, correção) */
export interface EntityState { x: number; z: number; heading: number; status: number; vehicle: string; act: number; prop: number }

export interface AutonomousHost {
  now(): number;
  /** segmento livre de paredes (a 0,6 m do chão) */
  clear(ax: number, az: number, bx: number, bz: number): boolean;
  readonly bounds: readonly [number, number, number, number];
  /** eixo da avenida (polilinha) — base de destinos */
  readonly axis: readonly (readonly [number, number])[];
  /** HUMANOS jogando (nunca autônomos; bots de carga contam como presença de teste, não como humano) */
  humans(): readonly HumanView[];
  hotspots(): readonly Hotspot[];
  vehiclesNear(x: number, z: number, r: number, out: VehicleView[]): VehicleView[];
  /** cria a entidade sincronizada (state.players, kind AUTÔNOMO) — devolve o nid (0 = falhou/lotado) */
  spawn(id: string, look: AgentLook, x: number, z: number, heading: number): number;
  despawn(id: string): void;
  state(id: string): EntityState | undefined;
  /** movimento proposto → validado como o de um jogador; devolve a posição aceita */
  move(id: string, x: number, z: number, heading: number, speed: number, loco: number): { x: number; z: number; ok: boolean };
  act(id: string, act: number, variation: number): boolean;
  prop(id: string, prop: number, design: number): boolean;
  /** para onde a cabeça olha (nid; 0 = nada) */
  look(id: string, nid: number): void;
  enter(id: string, vehicleId: string): boolean;
  exit(id: string): boolean;
  /** pedido de confronto pelo CombatSystem (mesmas regras) — true = aceito */
  combat(id: string, action: number, heading: number): boolean;
  /** humano presente com esta chave de apelido (não colidir) */
  nameTaken?(key: string): boolean;
  /** gancho OPCIONAL (agente B): veículo pessoal — devolve o id criado ou null */
  personalVehicle?(ownerId: string, kind: string, at: { x: number; z: number }): string | null;
}
