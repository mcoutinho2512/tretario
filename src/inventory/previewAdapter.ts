/**
 * Rodada 11 — prévia 3D do inventário (contrato `AvatarPreviewHandle`, src/inventory/types.ts) sobre a prévia
 * COMPARTILHADA do editor (src/ui/preview/sharedPreview.ts): um renderer de prévia por página, reutilizado; o
 * inventário só cria/descarta o seu handle (personagem + câmera). Regra: um handle do inventário vivo por vez e
 * `dispose()` ao fechar o painel.
 */
import type { CharacterAppearance } from '../characters/bodyTypes';
import { createSharedPreview, previewInfo } from '../ui/preview/sharedPreview';
import type { AvatarPreviewHandle } from './types';

export interface InventoryPreview extends AvatarPreviewHandle {
  /** aproximar (+) / afastar (−) — botões; a roda do mouse já faz isso na própria prévia */
  zoom?(by: number): void;
  ready?: Promise<void>;
}

/** QA (tools/qa/inventory_mp.mjs): handles do inventário criados/descartados e o renderer compartilhado */
export const previewStats = {
  created: 0, disposed: 0, get live() { return this.created - this.disposed; },
  /** renderer da prévia (compartilhado): renderers vivos/criados, geometrias/texturas/programas */
  memory() { const i = previewInfo(); return { renderersLive: i.renderersLive, renderersCreated: i.renderersCreated, textures: i.textures, geometries: i.geometries, programs: i.programs }; },
};
let current: InventoryPreview | null = null;

export function createInventoryPreview(container: HTMLElement, app: CharacterAppearance): InventoryPreview {
  current?.dispose(); // um handle do inventário por vez
  const p = createSharedPreview(container);
  p.show(app);
  previewStats.created++;
  let dead = false;
  const h: InventoryPreview = {
    show(a: unknown) { if (!dead) p.show(a); },
    view(side) { if (!dead) p.view(side); },
    zoom(by) { if (!dead) p.zoom(by); },
    get ready() { return p.ready; },
    dispose() {
      if (dead) return;
      dead = true;
      p.dispose();
      previewStats.disposed++;
      if (current === h) current = null;
    },
  };
  current = h;
  return h;
}
