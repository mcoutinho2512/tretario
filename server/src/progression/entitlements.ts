/**
 * Direitos cosméticos de uma CONTA (rodada 9) para o validador único de aparência (src/characters/validateAppearance.ts)
 * fora da sala (API PUT/GET /api/me/appearance, carga do visual no onAuth): RewardGrant + itens do nível.
 * Conta conectada agora: vale o estado em memória da sala (a recompensa recém-ganha conta antes da gravação em lote).
 */
import type { DataStore } from '../data/types';
import type { ItemEntitlements } from '../../../src/characters/unlocks';
import { levelForXp, levelUnlocks } from '../../../src/progression/engine';
import type { ProgressionService } from './ProgressionService';
import { loadCatalog } from './catalog';

/** serviços de progressão vivos (um por sala) */
export const liveProgression = new Set<ProgressionService>();

export async function entitlementsFor(store: Pick<DataStore, 'progression'>, userId: string): Promise<ItemEntitlements> {
  for (const s of liveProgression) { const e = s.entitlementsOfUser(userId); if (e) return { items: e }; }
  const rec = await store.progression.load(userId).catch(() => null);
  const cat = loadCatalog();
  const items = new Set(levelUnlocks(cat, levelForXp(cat.levels, rec?.xp ?? 0)));
  for (const g of rec?.grants ?? []) if (!g.item.startsWith('title:')) items.add(g.item);
  return { items };
}
