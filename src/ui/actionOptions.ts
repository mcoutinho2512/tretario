/**
 * Opções de ação/item a partir dos registros (actions.ts / props.ts) — FONTE ÚNICA da roda de ações (G) e da barra de
 * ações (rodada 9.1). Cada opção já traz o `pick` que chama o SocialController: nenhuma lógica de ação duplicada na UI.
 */
import { ACTIONS, type ActionCategory } from '../social/actions';
import { PROP_BY_ID, SOCIAL_PROPS } from '../social/props';

export interface ActionOption {
  label: string;
  active: boolean;
  disabled: boolean;
  pick: () => void;
  /** a roda fecha depois (ação `once` ou que não pede item) */
  closes: boolean;
  /** id da ação/item (QA) */
  id: number;
}

export interface SocialLike {
  prop: number;
  act: number;
  requestProp(id: number, design?: number): void;
  requestAction(id: number): void;
}

/** ITENS: "Mãos vazias" + sociais + `extra` (itens de confronto possuídos/livres). Tocar no item na mão o larga (alternar) */
export function itemOptions(s: SocialLike, extra: readonly number[] = []): ActionOption[] {
  return [
    { id: 0, label: 'Mãos vazias', active: s.prop === 0, disabled: false, closes: false, pick: () => { if (s.prop) s.requestProp(0); } },
    ...[...SOCIAL_PROPS, ...extra.map((id) => PROP_BY_ID.get(id)!).filter(Boolean)].map((p) => ({
      id: p.id, label: p.label, active: p.id === s.prop, disabled: false, closes: false, pick: () => s.requestProp(p.id),
    })),
  ];
}

/** ações de uma categoria (gestos, manifestação, dança); as que pedem item que não está na mão aparecem apagadas */
export function actionOptions(s: SocialLike, cat: ActionCategory): ActionOption[] {
  const held = PROP_BY_ID.get(s.prop);
  return ACTIONS.filter((a) => a.category === cat).map((a) => ({
    id: a.id,
    label: a.label,
    active: a.id === s.act,
    disabled: !!a.needs && !(held && a.needs.includes(held.kind)),
    closes: a.mode === 'once' || !a.needs,
    pick: () => s.requestAction(a.id),
  }));
}
