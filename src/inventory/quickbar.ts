/**
 * Rodada 11 — ACESSO RÁPIDO 1–5 (lógica pura + armazenamento local). Só itens de GAMEPLAY: seguráveis (`prop:<id>`) e
 * artes de bandeira/cartaz/faixa (`design:<key>`, que viram o item na mão) — nunca roupa, acessório, título ou torcida.
 * O layout é do APARELHO (localStorage, com try/catch); o servidor valida cada uso como qualquer pedido de item.
 */
import type { InventoryItem, QuickbarLayout } from './types';
import { PROP_BY_ID } from '../social/props';
import { DESIGN_BY_KEY } from '../social/designs';

export const QUICK_SLOTS = 5;
const STORE = 'pv3d.quickbar';
/** padrão: o que todo mundo já pega pela roda (bandeira, cartaz, megafone) */
export const DEFAULT_QUICKBAR: QuickbarLayout = ['prop:1', 'prop:3', 'prop:7', null, null];

/** a chave cabe no acesso rápido? (formato; o estado bloqueado/possuído é decidido ao usar) */
export function isQuickKey(key: unknown): key is NonNullable<QuickbarLayout[number]> {
  if (typeof key !== 'string') return false;
  if (key.startsWith('prop:')) return PROP_BY_ID.has(Number(key.slice(5))) && /^prop:\d+$/.test(key);
  if (key.startsWith('design:')) { const d = DESIGN_BY_KEY.get(key.slice(7)); return !!d && d.targets.some((t) => t === 'flag' || t === 'sign' || t === 'banner'); }
  return false;
}

/** saneia um layout lido (tamanho fixo, só chaves de gameplay, sem repetição) */
export function sanitizeQuickbar(raw: unknown): QuickbarLayout {
  const out: (QuickbarLayout[number])[] = [];
  const seen = new Set<string>();
  const arr = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < QUICK_SLOTS; i++) {
    const k = arr[i];
    if (isQuickKey(k) && !seen.has(k)) { out.push(k); seen.add(k); } else out.push(null);
  }
  return out as QuickbarLayout;
}

export function loadQuickbar(): QuickbarLayout {
  try {
    const v = localStorage.getItem(STORE);
    return v === null ? [...DEFAULT_QUICKBAR] as QuickbarLayout : sanitizeQuickbar(JSON.parse(v));
  } catch { return [...DEFAULT_QUICKBAR] as QuickbarLayout; }
}
export function saveQuickbar(l: QuickbarLayout) { try { localStorage.setItem(STORE, JSON.stringify(l)); } catch { /* sem armazenamento: vale só nesta aba */ } }

/**
 * fixa `item` num slot (0–4): sem índice, no primeiro vazio (cheio: no último). O mesmo item não fica em dois slots.
 * Item que não é de gameplay → layout inalterado (`ok: false`).
 */
export function pinQuick(l: QuickbarLayout, item: Pick<InventoryItem, 'key' | 'quickbar'>, index?: number): { layout: QuickbarLayout; ok: boolean; index: number } {
  if (!item.quickbar || !isQuickKey(item.key)) return { layout: l, ok: false, index: -1 };
  const next = l.map((k) => (k === item.key ? null : k)) as QuickbarLayout;
  let i = index !== undefined && index >= 0 && index < QUICK_SLOTS ? index : next.indexOf(null);
  if (i < 0) i = QUICK_SLOTS - 1;
  next[i] = item.key as QuickbarLayout[number];
  return { layout: next, ok: true, index: i };
}

export function unpinQuick(l: QuickbarLayout, index: number): QuickbarLayout {
  const next = [...l] as QuickbarLayout;
  if (index >= 0 && index < QUICK_SLOTS) next[index] = null;
  return next;
}

/** o item do slot está NA MÃO agora? */
export function isActive(key: string, prop: number, design: number): boolean {
  if (key.startsWith('prop:')) return prop !== 0 && prop === Number(key.slice(5));
  if (key.startsWith('design:')) {
    const d = DESIGN_BY_KEY.get(key.slice(7)), p = PROP_BY_ID.get(prop);
    return !!d && !!p?.designSlot && d.targets.includes(p.designSlot) && design === d.id;
  }
  return false;
}
