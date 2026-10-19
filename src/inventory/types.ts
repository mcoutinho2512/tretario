/**
 * Rodada 11 — CONTRATO do inventário/equipamentos (docs/INVENTORY.md, docs/EQUIPMENT_SYSTEM.md).
 *
 * O inventário é uma VISÃO do que já existe (aparência por peças, camisas/designs, acessório, itens seguráveis de
 * manifestação e de torcida, itens de confronto, títulos) — nada de conteúdo fictício. O cliente só PEDE equipar;
 * o servidor decide posse/desbloqueio com os validadores existentes (validateAppearance + entitlements,
 * validateProp/itens de confronto). Slots evitam incompatibilidades (duas camisas, dois itens na mesma mão).
 */
import type { ItemKey } from '../characters/unlocks';

export type EquipSlot = 'HEAD' | 'TORSO' | 'LEGS' | 'FEET' | 'HAND' | 'BACK' | 'ACCESSORY' | 'TITLE' | 'SUPPORTER' | 'VEHICLE';

/** só categorias com conteúdo real aparecem na interface */
export type InventoryCategory = 'ROUPAS' | 'ACESSORIOS' | 'ITENS' | 'EQUIPAMENTOS' | 'BANDEIRAS' | 'MANIFESTACAO' | 'TORCIDA' | 'COSMETICOS' | 'TITULOS' | 'VEICULOS';

export type InventoryFilter = 'TODOS' | 'EQUIPADOS' | 'DESBLOQUEADOS' | 'NOVOS';

export type ItemState = 'equipped' | 'available' | 'locked';

export interface InventoryItem {
  /** chave estável: ItemKey de unlocks (aparência/design/ação) ou `prop:<id>` (segurável) / `title:<id>` / `sup:<id>` */
  key: ItemKey | `prop:${number}` | `title:${string}` | `sup:${string}` | `veh:${string}`; // rodada 12 — `veh:<tipo>` = veículo pessoal
  category: InventoryCategory;
  slot: EquipSlot;
  label: string;
  /** tipo curto para o tooltip ("Camisa", "Acessório", "Equipamento de confronto"…) */
  kind: string;
  state: ItemState;
  /** visto pela 1ª vez (desbloqueio recente) — só cosmético da interface */
  isNew?: boolean;
  /** por que está bloqueado ("Nível 4", "Missão X", "Evento") — sem loja */
  lockedReason?: string;
  /** cabe no acesso rápido (só itens de gameplay: seguráveis, de confronto e — rodada 12 — veículos pessoais; nunca roupa) */
  quickbar: boolean;
}

/** acesso rápido 1–5: chaves de itens de gameplay (local por aparelho; o servidor valida ao usar) */
export type QuickbarLayout = [InventoryItem['key'] | null, InventoryItem['key'] | null, InventoryItem['key'] | null, InventoryItem['key'] | null, InventoryItem['key'] | null];

/** prévia 3D reutilizável (um renderer compartilhado e descartável; ver docs/INVENTORY.md) */
export interface AvatarPreviewHandle {
  /** mostra a aparência (ou um item vestido sobre a atual) */
  show(app: unknown): void;
  /** rotação/zoom pelo mouse; frente/costas */
  view(side: 'front' | 'back'): void;
  dispose(): void;
}
