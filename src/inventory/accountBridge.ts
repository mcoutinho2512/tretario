/**
 * Rodada 11 — ponte do inventário com a CONTA (tela inicial, main.ts): o inventário salva pela API existente
 * (PUT /api/me/appearance estrito, PUT /api/me/supporter, PUT /api/me/title) e avisa a tela inicial do que o SERVIDOR
 * aceitou, para o editor/rótulos não ficarem com o visual antigo. Sem conta (visitante/servidor de teste): `null` —
 * o inventário pede direto à sala (mesma validação no servidor, só na sessão).
 */
import type { CharacterAppearance } from '../characters/bodyTypes';

export interface InventoryAccount {
  authed(): boolean;
  /** aparência aceita pelo servidor (atualiza o visual salvo da tela inicial) */
  onLook(app: CharacterAppearance): void;
  /** torcida aceita (atualiza o rótulo TORCIDA da tela inicial) */
  onSupporter(s: { current: string | null; pending: string | null }): void;
}

let impl: InventoryAccount | null = null;
export function registerInventoryAccount(a: InventoryAccount | null) { impl = a; }
/** conta logada agora (null = visitante) */
export function inventoryAccount(): InventoryAccount | null { return impl && impl.authed() ? impl : null; }
