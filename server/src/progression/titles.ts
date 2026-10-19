/**
 * Rodada 11 — TÍTULO EQUIPADO (docs/INVENTORY.md, docs/DATABASE.md): a conta escolhe UM dos títulos que GANHOU
 * (recompensas `title` de missão/conquista → RewardGrant "title:<texto>") para exibir publicamente (NetPlayer.title,
 * painel da pessoa). O servidor valida contra os grants — o cliente nunca inventa um título.
 *
 *  titlesFor        títulos ganhos (conta conectada: estado vivo da sala; senão o registro do banco)
 *  equippedTitle    o salvo (Profile.titleKey), revalidado (grant inexistente → nenhum)
 *  requestTitle     PUT /api/me/title e mensagem `title` da sala: valida, grava, avisa as salas (onTitleChange)
 */
import type { DataStore } from '../data/types';
import { validateTitle } from '../../../src/inventory/equipRules';
import { liveProgression } from './entitlements';

export async function titlesFor(store: Pick<DataStore, 'progression'>, userId: string): Promise<string[]> {
  for (const s of liveProgression) { const t = s.titlesOfUser(userId); if (t) return t; }
  const rec = await store.progression.load(userId).catch(() => null);
  return (rec?.grants ?? []).filter((g) => g.item.startsWith('title:')).map((g) => g.item.slice(6));
}

export async function equippedTitle(store: Pick<DataStore, 'progression' | 'titles'>, userId: string): Promise<string | null> {
  const t = await store.titles.get(userId).catch(() => null);
  if (!t) return null;
  const v = validateTitle(await titlesFor(store, userId), t);
  return v.ok ? v.title : null;
}

type Listener = (userId: string, title: string | null) => void;
const listeners = new Set<Listener>();
/** a sala ouve: troca feita pela API vale já para a entidade da conta */
export function onTitleChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }

export type TitleResult = { ok: true; title: string | null } | { ok: false; reason: 'invalido' | 'bloqueado' | 'perfil_inexistente' };

export async function requestTitle(store: Pick<DataStore, 'progression' | 'titles' | 'profiles'>, userId: string, raw: unknown): Promise<TitleResult> {
  const v = validateTitle(await titlesFor(store, userId), raw);
  if (!v.ok) return v;
  if (!(await store.profiles.byUserId(userId))) return { ok: false, reason: 'perfil_inexistente' };
  await store.titles.set(userId, v.title);
  for (const f of listeners) f(userId, v.title);
  return v;
}
