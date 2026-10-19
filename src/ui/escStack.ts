/**
 * Rodada 11 — CONTRATO: hierarquia ÚNICA do Esc. Todo painel/modal/overlay que fecha com Esc se registra aqui ao
 * abrir (`pushEsc`) e sai ao fechar (a função devolvida). Um Esc fecha SÓ o do topo; sem nada aberto, abre o menu
 * do jogo (o mundo não pausa). Componentes NÃO devem ter listener próprio de Esc.
 * Prioridade (maior fica por cima mesmo se aberto antes): 300 modal de confirmação · 200 diálogo (denúncia,
 * conta, editor) · 100 painel (inventário, ajustes, pessoa, agenda, progresso) · 50 popover (barra, roda) · 10 chat.
 */
export interface EscLayer { id: string; priority: number; close: () => void }

const stack: EscLayer[] = [];
let menuOpener: (() => void) | null = null;

export function pushEsc(layer: EscLayer): () => void {
  const i = stack.findIndex((l) => l.id === layer.id);
  if (i >= 0) stack.splice(i, 1);
  stack.push(layer);
  return () => { const j = stack.indexOf(layer); if (j >= 0) stack.splice(j, 1); };
}
/** o menu do jogo (Esc sem nada aberto) */
export function setEscMenu(open: (() => void) | null) { menuOpener = open; }
export function escTop(): EscLayer | null {
  let top: EscLayer | null = null;
  for (const l of stack) if (!top || l.priority >= top.priority) top = l;
  return top;
}
/** trata um Esc: fecha o topo ou abre o menu. Devolve o que fez (QA/testes). */
export function handleEsc(): 'closed' | 'menu' | 'none' {
  const top = escTop();
  if (top) { const j = stack.indexOf(top); stack.splice(j, 1); top.close(); return 'closed'; }
  if (menuOpener) { menuOpener(); return 'menu'; }
  return 'none';
}
export function escLayers(): readonly string[] { return stack.map((l) => l.id); }
