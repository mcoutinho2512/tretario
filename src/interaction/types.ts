/**
 * Rodada 10 — CONTRATO do InteractionSystem (docs/INTERACTION_SYSTEM.md): "clicou/tocou → interagiu".
 *
 * Todo objeto interativo (veículo, trio, item no chão, pessoa, grafite…) é exposto por um PROVEDOR que entrega
 * candidatos perto do jogador; o sistema escolhe UM alvo contextual (prioridade → distância), destaca discretamente e
 * dispara a ação no clique/toque (ou na tecla-atalho). O cliente só PEDE (mensagem já existente: enter, board,
 * item…); o servidor decide. Não duplicar lógica por veículo: a ação é dado do candidato.
 */
export type InteractionType = 'enter_vehicle' | 'exit_vehicle' | 'board_platform' | 'pickup' | 'person' | 'graffiti' | 'other';

/** estados do jogador local em que o candidato vale */
export type InteractionPlayerState = 'foot' | 'vehicle' | 'platform' | 'down' | 'spectator';

export interface Interactable {
  /** chave única e estável no quadro: `<tipo>:<id>` */
  key: string;
  interactionType: InteractionType;
  /** rótulo curto do botão/realce: "Entrar", "Montar", "Usar", "Pegar", "Subir", "Interagir" */
  interactionLabel: string;
  /** nome do alvo para o realce ("Carro", "Moto", "Taco"…) */
  targetLabel: string;
  /** distância máxima (m) — o servidor revalida com as próprias regras */
  maxDistance: number;
  /** maior = vence (ex.: sair do veículo 100, veículo 50, item 40, pessoa 10) */
  priority: number;
  allowedStates: InteractionPlayerState[];
  /** mensagem/pedido ao servidor (nome da mensagem existente) — documentação + QA */
  serverAction: string;
  /** disponível agora (livre, sem cooldown local)? indisponível ainda pode aparecer esmaecido */
  availability: 'available' | 'busy' | 'cooldown';
  cooldownMs?: number;
  /** ponto do mundo para realce/raio de clique (centro do objeto, altura do realce) */
  x: number; y: number; z: number;
  /** raio de clique no mundo (m) — alvo de toque confortável vem do tamanho mínimo em px do sistema */
  pickRadius: number;
  /** executa o pedido (o provedor chama a mensagem existente) */
  activate(): void;
}

export interface InteractionProvider {
  readonly id: string;
  /** candidatos perto de (x, z) — sem alocar por quadro quando possível (reutilizar o array `out`) */
  collect(x: number, z: number, state: InteractionPlayerState, out: Interactable[]): void;
}
