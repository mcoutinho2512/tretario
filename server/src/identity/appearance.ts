/**
 * Aparência e grupo de um jogador AUTENTICADO na sala (rodada 8): vêm do banco (DataStore), nunca das opções do
 * cliente. Sem aparência salva → padrão do corpo homem. Puro em relação à sala (testável sem Colyseus).
 */
import type { DataStore } from '../data/types';
import { DEFAULT_PLAYER_APPEARANCE, type CharacterAppearance } from '../../../src/characters/bodyTypes';
import { validateAppearance } from '../../../src/characters/validateAppearance';
import { groupKeyOf } from '../../../src/events/groups';

export async function loadPlayerLook(store: DataStore, userId: string, eventId: string): Promise<{ appearance: CharacterAppearance; groupKey: string | null }> {
  const [rec, mem] = await Promise.all([store.appearances.get(userId), store.events.membership(userId, eventId)]);
  const appearance = (rec && validateAppearance(rec.data)) || { ...DEFAULT_PLAYER_APPEARANCE.homem, accessory: 'nenhum' as const };
  return { appearance, groupKey: mem ? groupKeyOf(mem.groupId) : null };
}
