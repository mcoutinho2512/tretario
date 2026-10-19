/**
 * Rodada 11 — ADAPTADOR da prévia 3D do inventário (contrato `AvatarPreviewHandle`, src/inventory/types.ts).
 *
 * Nesta branch usa a prévia existente (src/ui/AvatarPreview.ts); na integração troca por `createSharedPreview` do
 * editor novo (src/ui/preview/sharedPreview.ts) — só ESTE arquivo muda. Regra: UM renderer de prévia vivo por vez
 * (abrir de novo descarta o anterior) e `dispose()` ao fechar o inventário (contexto WebGL liberado).
 */
import type { CharacterAppearance } from '../characters/bodyTypes';
import { AvatarPreview } from '../ui/AvatarPreview';
import type { AvatarPreviewHandle } from './types';

export interface InventoryPreview extends AvatarPreviewHandle {
  /** aproximar (+) / afastar (−) — botões; a roda do mouse já faz isso na própria prévia */
  zoom?(by: number): void;
  ready?: Promise<void>;
}

/** QA (tools/qa/inventory_mp.mjs): prévias criadas/descartadas e quantas estão vivas */
export const previewStats = { created: 0, disposed: 0, get live() { return this.created - this.disposed; } };
let current: InventoryPreview | null = null;

export function createInventoryPreview(container: HTMLElement, app: CharacterAppearance): InventoryPreview {
  current?.dispose(); // nunca dois renderers de prévia
  const canvas = document.createElement('canvas');
  canvas.className = 'inv-preview-canvas';
  canvas.setAttribute('aria-label', 'Prévia 3D do personagem (arraste para girar, roda para aproximar)');
  container.appendChild(canvas);
  const p = new AvatarPreview(canvas, app);
  previewStats.created++;
  let dead = false;
  const internals = p as unknown as { yaw: number; yawTarget: number; yawVel: number };
  const h: InventoryPreview = {
    show(a: unknown) { if (!dead && a && typeof a === 'object') p.setAppearance(a as CharacterAppearance); },
    view(side) {
      if (dead) return;
      // gira pelo caminho mais curto até a frente (0) ou as costas (π)
      const target = side === 'front' ? -0.35 : Math.PI - 0.35;
      const turns = Math.round((internals.yawTarget - target) / (Math.PI * 2));
      internals.yawTarget = target + turns * Math.PI * 2;
      internals.yawVel = 0;
    },
    zoom(by) { if (!dead) p.zoom(by); },
    get ready() { return p.ready; },
    dispose() {
      if (dead) return;
      dead = true;
      p.dispose();
      canvas.remove();
      previewStats.disposed++;
      if (current === h) current = null;
    },
  };
  current = h;
  return h;
}
