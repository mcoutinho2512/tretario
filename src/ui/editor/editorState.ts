/**
 * Rodada 11 — ESTADO do editor de personagem (puro: sem DOM nem three.js; tests/editorState.test.ts).
 *  - abas/categorias e o que cada uma edita (`EDITOR_TABS`, `tabOfField`)
 *  - escolhas como funções puras sobre a aparência (`pick*`) — as mesmas regras de antes (camisa de time só no modelo
 *    camiseta; cor lisa tira a camisa de time; cabelo coerente com a idade do corpo)
 *  - histórico com desfazer/refazer/restaurar (`EditorHistory`) sobre um instantâneo {aparência, torcida}
 *  - cadeados: chave do item (`itemKey`) e o motivo da progressão (`lockInfo`) — quem decide é o servidor
 * O validador ÚNICO (validateAppearance + direitos) continua sendo aplicado por quem usa (main.ts) antes de mostrar
 * e de salvar: o que se vê é o que o servidor aceita.
 */
import { DEFAULT_PLAYER_APPEARANCE, HAIR_OLD, type Accessory, type BodyType, type CharacterAppearance } from '../../characters/bodyTypes';
import { SLOT_FIELD, type GarmentSlot } from '../../characters/garments';
import { isAvailable, type ItemEntitlements, type ItemKey } from '../../characters/unlocks';
import { sameAppearance } from '../../characters/validateAppearance';

export type EditorTabId = 'CORPO' | 'CABELO' | 'CAMISA' | 'CALCA' | 'CALCADO' | 'ACESSORIOS' | 'TORCIDA';
export type ColorKey = 'skin' | 'hair' | 'top' | 'bottom' | 'shoes' | 'acc';

export type EditorSection =
  | { kind: 'body' }
  | { kind: 'name' }
  | { kind: 'color'; key: ColorKey }
  | { kind: 'style'; slot: GarmentSlot }
  | { kind: 'designs' }
  | { kind: 'accessory' }
  | { kind: 'supporter' };

export interface EditorTab { id: EditorTabId; label: string; sections: EditorSection[] }

/** abas na ordem da interface (desktop: trilho vertical; celular: faixa rolável) */
export const EDITOR_TABS: readonly EditorTab[] = [
  { id: 'CORPO', label: 'Corpo', sections: [{ kind: 'body' }, { kind: 'name' }, { kind: 'color', key: 'skin' }] },
  { id: 'CABELO', label: 'Cabelo', sections: [{ kind: 'style', slot: 'HAIR' }, { kind: 'color', key: 'hair' }] },
  { id: 'CAMISA', label: 'Camisa', sections: [{ kind: 'style', slot: 'SHIRT' }, { kind: 'color', key: 'top' }, { kind: 'designs' }] },
  { id: 'CALCA', label: 'Calça / short', sections: [{ kind: 'style', slot: 'PANTS' }, { kind: 'color', key: 'bottom' }] },
  { id: 'CALCADO', label: 'Calçado', sections: [{ kind: 'style', slot: 'SHOES' }, { kind: 'color', key: 'shoes' }] },
  { id: 'ACESSORIOS', label: 'Acessórios', sections: [{ kind: 'accessory' }, { kind: 'color', key: 'acc' }] },
  { id: 'TORCIDA', label: 'Torcida', sections: [{ kind: 'supporter' }] },
];
export const TAB_IDS: readonly EditorTabId[] = EDITOR_TABS.map((t) => t.id);

/** campo da aparência → aba que o edita (destaque de "alterado" e atalhos) */
const FIELD_TAB: Partial<Record<keyof CharacterAppearance, EditorTabId>> = {
  body: 'CORPO', skin: 'CORPO', scale: 'CORPO',
  hair: 'CABELO', hairStyle: 'CABELO',
  top: 'CAMISA', topStyle: 'CAMISA', shirtDesign: 'CAMISA',
  bottom: 'CALCA', bottomStyle: 'CALCA',
  shoes: 'CALCADO', shoeStyle: 'CALCADO',
  accessory: 'ACESSORIOS', acc: 'ACESSORIOS',
};
export function tabOfField(f: keyof CharacterAppearance): EditorTabId | null { return FIELD_TAB[f] ?? null; }

/** abas com diferença entre duas aparências (e a torcida) */
export function changedTabs(a: EditorSnapshot, b: EditorSnapshot): Set<EditorTabId> {
  const out = new Set<EditorTabId>();
  for (const k of Object.keys(FIELD_TAB) as (keyof CharacterAppearance)[]) {
    if ((a.app[k] ?? null) !== (b.app[k] ?? null)) out.add(FIELD_TAB[k]!);
  }
  if ((a.sup ?? null) !== (b.sup ?? null)) out.add('TORCIDA');
  return out;
}

// ------------------------------------------------------------------ escolhas (puras)
const isOld = (b: BodyType) => b === 'idoso' || b === 'idosa';
/** camada da peça → prefixo do ItemKey (src/characters/unlocks.ts) */
export const STYLE_ITEM: Record<GarmentSlot, 'top' | 'bottom' | 'shoes' | 'hair'> = { SHIRT: 'top', PANTS: 'bottom', SHOES: 'shoes', HAIR: 'hair' };

export function pickBody(a: CharacterAppearance, body: BodyType): CharacterAppearance {
  return { ...a, body, hair: isOld(body) === HAIR_OLD.includes(a.hair) ? a.hair : DEFAULT_PLAYER_APPEARANCE[body].hair };
}
export function pickColor(a: CharacterAppearance, key: ColorKey, c: number): CharacterAppearance {
  const n = { ...a, [key]: c };
  if (key === 'top') n.shirtDesign = 0; // cor lisa escolhida: sai da camisa de time
  return n;
}
export function pickStyle(a: CharacterAppearance, slot: GarmentSlot, style: string): CharacterAppearance {
  const n = { ...a, [SLOT_FIELD[slot]]: style } as CharacterAppearance;
  if (slot === 'SHIRT' && style !== 'camiseta') n.shirtDesign = 0; // camisa de time é modelo camiseta
  return n;
}
/** camisa de futebol (design): modelo camiseta e a cor de fundo do design; null = nenhuma */
export function pickDesign(a: CharacterAppearance, d: { id: number; palette: { bg: string } } | null): CharacterAppearance {
  if (!d) return { ...a, shirtDesign: 0 };
  return { ...a, shirtDesign: d.id, topStyle: 'camiseta', top: parseInt(d.palette.bg.slice(1), 16) };
}
export function pickAccessory(a: CharacterAppearance, acc: Accessory): CharacterAppearance { return { ...a, accessory: acc }; }
/** "vestir as cores" da torcida (supporterOutfit): camisa da torcida + cores sugeridas, o resto igual */
export function wearOutfit(a: CharacterAppearance, outfit: { shirtDesign: number; top: number; bottom?: number; shoes?: number }): CharacterAppearance {
  return { ...a, topStyle: 'camiseta', ...outfit };
}

// ------------------------------------------------------------------ cadeados
export type ItemRef =
  | { kind: 'style'; slot: GarmentSlot; style: string }
  | { kind: 'design'; id: number }
  | { kind: 'accessory'; acc: Accessory };
export function itemKey(r: ItemRef): ItemKey {
  if (r.kind === 'style') return `${STYLE_ITEM[r.slot]}:${r.style}` as ItemKey;
  if (r.kind === 'design') return `shirt:${r.id}`;
  return `acc:${r.acc}`;
}
export interface LockInfo { locked: boolean; reason: string }
/** bloqueado? e por quê (requisito da progressão: "Nível 4", "Missão: …"; sem loja) */
export function lockInfo(item: ItemKey, ent: ItemEntitlements, requirement: (item: string) => string | null): LockInfo {
  if (isAvailable(item, ent)) return { locked: false, reason: '' };
  return { locked: true, reason: requirement(item) || 'Liberado por progressão' };
}

// ------------------------------------------------------------------ histórico
/** o que o editor edita: a aparência e a escolha de torcida (null = sem torcida) */
export interface EditorSnapshot { app: CharacterAppearance; sup: string | null }
export function sameSnapshot(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return sameAppearance(a.app, b.app) && (a.sup ?? null) === (b.sup ?? null);
}

/** desfazer/refazer/restaurar. `saved` = o que está salvo (servidor/aparelho); `restore()` volta a ele (desfazível) */
export class EditorHistory {
  static readonly MAX = 60;
  private past: EditorSnapshot[] = [];
  private future: EditorSnapshot[] = [];
  private cur: EditorSnapshot;
  private saved: EditorSnapshot;

  constructor(initial: EditorSnapshot, saved: EditorSnapshot = initial) {
    this.cur = clone(initial);
    this.saved = clone(saved);
  }
  get current(): EditorSnapshot { return this.cur; }
  get savedState(): EditorSnapshot { return this.saved; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  /** há alterações em relação ao salvo */
  get dirty() { return !sameSnapshot(this.cur, this.saved); }
  get canRestore() { return this.dirty; }

  /** novo estado (igual ao atual: nada muda, o histórico não cresce). Devolve se mudou */
  push(next: EditorSnapshot): boolean {
    if (sameSnapshot(next, this.cur)) return false;
    this.past.push(this.cur);
    if (this.past.length > EditorHistory.MAX) this.past.shift();
    this.future = [];
    this.cur = clone(next);
    return true;
  }
  undo(): boolean {
    const p = this.past.pop();
    if (!p) return false;
    this.future.push(this.cur);
    this.cur = p;
    return true;
  }
  redo(): boolean {
    const f = this.future.pop();
    if (!f) return false;
    this.past.push(this.cur);
    this.cur = f;
    return true;
  }
  /** volta ao salvo (pode ser desfeito) */
  restore(): boolean { return this.push(this.saved); }
  /** depois de salvar: o atual vira o salvo (o servidor pode ter ajustado: `accepted`) */
  markSaved(accepted: EditorSnapshot = this.cur) {
    this.cur = clone(accepted);
    this.saved = clone(accepted);
  }
  /** reabre do zero */
  reset(initial: EditorSnapshot, saved: EditorSnapshot = initial) {
    this.past = []; this.future = [];
    this.cur = clone(initial);
    this.saved = clone(saved);
  }
}
const clone = (s: EditorSnapshot): EditorSnapshot => ({ app: { ...s.app }, sup: s.sup ?? null });
