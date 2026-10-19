/**
 * Rodada 11 — ícones do inventário/acesso rápido: SVG simples de traço (cor do texto), como os da barra de ações.
 * Artes (camisas, bandeiras) usam a miniatura de cor do próprio design (shirtSwatch) — sem imagem nova.
 */
import { shirtSwatch } from '../ui/supporterPicker';
import { DESIGN_BY_ID } from '../social/designs';
import { PROP_BY_ID } from '../social/props';
import type { InventoryEntry } from './catalog';

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const KIND: Record<string, string> = {
  flag_small: svg('<path d="M6 21V3"/><path d="M6 4h11l-2.5 4L17 12H6"/>'),
  flag_large: svg('<path d="M5 22V2"/><path d="M5 3h15l-3 5 3 5H5"/>'),
  sign_small: svg('<rect x="5" y="3" width="14" height="10" rx="1"/><path d="M12 13v8"/>'),
  sign_large: svg('<rect x="3" y="2" width="18" height="12" rx="1"/><path d="M12 14v8"/>'),
  sign_double: svg('<rect x="4" y="3" width="16" height="11" rx="1"/><path d="M9 14v7M15 14v7"/>'),
  banner: svg('<path d="M2 7h20v7H2z"/><path d="M4 14v6M20 14v6"/>'),
  megaphone: svg('<path d="M4 10v4h3l8 4V6L7 10z"/><path d="M18 9a4 4 0 0 1 0 6"/>'),
  whistle: svg('<circle cx="9" cy="14" r="5"/><path d="M13 11h8v4h-5"/>'),
  umbrella: svg('<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v7a2 2 0 0 1-4 0"/>'),
  drum: svg('<ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8"/><path d="M8 3l3 4M16 3l-3 4"/>'),
  bat: svg('<path d="M5 19l11-11a2.5 2.5 0 0 1 3.5 3.5L8.5 22.5"/><path d="M3 21l2-2"/>'),
  bar: svg('<path d="M5 20L19 4"/><path d="M4 18l2 2M18 6l2-2"/>'),
  spray: svg('<rect x="7" y="9" width="8" height="12" rx="1.5"/><path d="M9 9V6h4v3M11 6V4"/><path d="M17 5h.01M19.5 3.5h.01M19.5 7h.01"/>'),
};
const SLOT: Record<string, string> = {
  top: svg('<path d="M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z"/>'),
  bottom: svg('<path d="M6 3h12l1 18h-5l-2-11-2 11H5z"/>'),
  shoes: svg('<path d="M3 16c0-3 2-5 4-6l2 3h3c4 0 8 1 9 4v2H3z"/>'),
  hair: svg('<path d="M5 13c0-5 3-8 7-8s7 3 7 8"/><path d="M5 13c1-3 4-4 7-4s6 1 7 4"/><circle cx="12" cy="14" r="5"/>'),
  acc: svg('<path d="M4 15c0-4 3.6-7 8-7s8 3 8 7"/><path d="M2 15h20"/>'),
  title: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/>'),
  sup: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>'),
};
export const LOCK = svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
export const BAG = svg('<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>');

/** HTML do ícone de um item (miniatura de cor para artes) */
export function iconHtml(e: Pick<InventoryEntry, 'key' | 'designId' | 'propId'>): string {
  if (e.designId) return `<span class="inv-sw" style="${shirtSwatch(DESIGN_BY_ID.get(e.designId))}"></span>`;
  if (e.propId) return KIND[PROP_BY_ID.get(e.propId)?.kind ?? ''] ?? BAG;
  return SLOT[e.key.split(':')[0]] ?? BAG;
}
