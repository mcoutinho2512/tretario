/**
 * Ponte para abrir o editor de personagem de dentro do jogo (rodada 8): o HUD/menu chama `openCharacterEditor()`
 * sem depender da tela inicial. main.ts registra a implementação ao iniciar.
 */
let impl: (() => void) | null = null;

export function registerCharacterEditor(fn: () => void) { impl = fn; }

/** abre "PERSONAGEM / CUSTOMIZAR" (salva no servidor e aplica no avatar); false se indisponível (sem conta) */
export function openCharacterEditor(): boolean {
  if (!impl) return false;
  impl();
  return true;
}
