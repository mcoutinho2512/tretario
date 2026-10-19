/**
 * Rodada 11 — marcador NOVO do inventário: desbloqueios que a pessoa ainda não VIU (abriu o item). Só cosmético da
 * interface, guardado no aparelho (localStorage com try/catch; sem armazenamento vale só nesta aba).
 */
const STORE = 'pv3d.inv.seen';
const MAX = 400;
let mem: Set<string> | null = null;

export function seenItems(): Set<string> {
  if (mem) return mem;
  try { const v = JSON.parse(localStorage.getItem(STORE) ?? '[]'); mem = new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-MAX) : []); } catch { mem = new Set(); }
  return mem;
}

/** marca como visto; devolve true se mudou */
export function markSeen(key: string): boolean {
  const s = seenItems();
  if (s.has(key)) return false;
  s.add(key);
  try { localStorage.setItem(STORE, JSON.stringify([...s].slice(-MAX))); } catch { /* só nesta aba */ }
  return true;
}
