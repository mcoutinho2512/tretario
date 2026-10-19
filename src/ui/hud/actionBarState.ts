/**
 * Barra de ações (rodada 9.1) — lógica PURA: categorias, estado do popover (abrir/fechar/alternar, foco por teclado),
 * veículos perto (lista com distância) e quando mostrar a dica de controles. Sem DOM: testado em tests/actionBar.test.ts.
 * A parte visual está em ActionBar.ts; as ações em si continuam nos donos de sempre (roda, confronto, grafite, editor).
 */

export type BarCat = 'veiculos' | 'itens' | 'pichar' | 'confronto' | 'gestos' | 'personagem' | 'mapa';

export interface BarCatDef {
  key: BarCat;
  /** rótulo visível (curto) */
  label: string;
  /** nome completo (aria-label / título do popover) */
  name: string;
  /** abre popover (senão é ação direta) */
  popover: boolean;
}

export const BAR_CATS: readonly BarCatDef[] = [
  { key: 'veiculos', label: 'Veículos', name: 'Veículos por perto', popover: true },
  { key: 'itens', label: 'Itens', name: 'Itens e bandeiras', popover: true },
  { key: 'pichar', label: 'Pichar', name: 'Pichar (spray)', popover: false },
  { key: 'confronto', label: 'Confronto', name: 'Confronto', popover: true },
  { key: 'gestos', label: 'Gestos', name: 'Gestos e danças', popover: true },
  { key: 'personagem', label: 'Personagem', name: 'Editar personagem', popover: false },
  { key: 'mapa', label: 'Mapa', name: 'Mapa expandido', popover: false },
];

export const BAR_CAT_BY_KEY = new Map(BAR_CATS.map((c) => [c.key, c]));

/** resultado de uma tecla dentro da barra/popover */
export type KeyResult =
  | { kind: 'none' }
  | { kind: 'focus'; index: number }
  | { kind: 'close' }
  | { kind: 'open'; cat: BarCat };

/**
 * Estado do popover: qual categoria está aberta e qual opção tem o foco (navegação por teclado). Abrir outra categoria
 * troca; abrir a mesma fecha (alternar). `onChange` avisa a casca (camada do Esc).
 */
export class PopoverState {
  open: BarCat | null = null;
  focus = 0;
  onChange?: (open: BarCat | null, prev: BarCat | null) => void;

  /** clique/toque na categoria: popover alterna; categoria sem popover fecha o aberto e devolve false */
  toggle(cat: BarCat): boolean {
    const def = BAR_CAT_BY_KEY.get(cat);
    if (!def?.popover) { this.close(); return false; }
    this.set(this.open === cat ? null : cat);
    return this.open === cat;
  }

  show(cat: BarCat) { if (BAR_CAT_BY_KEY.get(cat)?.popover) this.set(cat); }
  close() { this.set(null); }

  private set(v: BarCat | null) {
    if (v === this.open) return;
    const prev = this.open;
    this.open = v;
    this.focus = 0;
    this.onChange?.(v, prev);
  }

  /** clique fora (`inside` = alvo dentro da barra ou do popover) */
  pointerDown(inside: boolean) { if (!inside && this.open) this.close(); }

  /** tecla com o foco DENTRO do popover aberto (`count` opções) */
  keyInPopover(code: string, count: number): KeyResult {
    if (!this.open) return { kind: 'none' };
    if (code === 'Escape') { this.close(); return { kind: 'close' }; }
    if (count <= 0) return { kind: 'none' };
    const next = moveIndex(this.focus, count, code);
    if (next === null) return { kind: 'none' };
    this.focus = next;
    return { kind: 'focus', index: next };
  }

  /** tecla com o foco num botão de categoria (índice `at`): setas andam na barra, ↑/Enter abrem o popover */
  keyOnBar(code: string, at: number): KeyResult {
    if (code === 'Escape' && this.open) { this.close(); return { kind: 'close' }; }
    if (code === 'ArrowUp') {
      const c = BAR_CATS[at];
      if (c?.popover) { this.show(c.key); return { kind: 'open', cat: c.key }; }
      return { kind: 'none' };
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Home' || code === 'End') {
      const i = moveIndex(at, BAR_CATS.length, code === 'ArrowLeft' ? 'ArrowUp' : code === 'ArrowRight' ? 'ArrowDown' : code);
      return i === null ? { kind: 'none' } : { kind: 'focus', index: i };
    }
    return { kind: 'none' };
  }
}

/** próxima posição na lista (com volta): ↑/← anterior, ↓/→ próxima, Home/End pontas; null = tecla não é de navegação */
export function moveIndex(i: number, n: number, code: string): number | null {
  if (n <= 0) return null;
  switch (code) {
    case 'ArrowDown': case 'ArrowRight': return (i + 1) % n;
    case 'ArrowUp': case 'ArrowLeft': return (i - 1 + n) % n;
    case 'Home': return 0;
    case 'End': return n - 1;
    default: return null;
  }
}

// ------------------------------------------------------------------ veículos perto
export interface VehicleLike { id: string; kind: string; x: number; z: number; free: boolean }
export interface NearVehicle { id: string; kind: string; x: number; z: number; d: number }

/**
 * Veículo livre mais próximo de cada tipo, até `maxM`, ordenados pela distância (no máximo `limit`). Um por tipo:
 * a lista diz "o que há por perto", não cada bicicleta da estação.
 */
export function nearbyVehicles(list: readonly VehicleLike[], x: number, z: number, maxM = 250, limit = 6): NearVehicle[] {
  const best = new Map<string, NearVehicle>();
  for (const v of list) {
    if (!v.free) continue;
    const d = Math.hypot(v.x - x, v.z - z);
    if (d > maxM) continue;
    const cur = best.get(v.kind);
    if (!cur || d < cur.d) best.set(v.kind, { id: v.id, kind: v.kind, x: v.x, z: v.z, d });
  }
  return [...best.values()].sort((a, b) => a.d - b.d).slice(0, limit);
}

/** distância legível ("aqui", "35 m", "1,2 km") — arredonda para não trocar o texto a cada passo */
export function distLabel(d: number): string {
  if (d < 4) return 'aqui';
  if (d < 100) return `${Math.round(d / 5) * 5} m`;
  if (d < 1000) return `${Math.round(d / 10) * 10} m`;
  return `${(d / 1000).toFixed(1).replace('.', ',')} km`;
}

// ------------------------------------------------------------------ dica de controles
/** a dica acima da barra fica nos primeiros minutos OU até o 1º movimento (+ alguns segundos para ler) */
export const HINT_MAX_MS = 180_000;
export const HINT_AFTER_MOVE_MS = 6_000;

export function hintVisible(sinceStartMs: number, sinceFirstMoveMs: number | null): boolean {
  if (sinceStartMs > HINT_MAX_MS) return false;
  return sinceFirstMoveMs === null || sinceFirstMoveMs < HINT_AFTER_MOVE_MS;
}

export function hintText(touch: boolean): string {
  // rodada 11 — cursor sempre visível: clique interage, botão direito + arrastar gira a câmera
  return touch ? 'joystick mover · arraste para olhar' : 'W A S D mover · clique interage · botão direito + arrastar câmera · G roda · Esc menu';
}
