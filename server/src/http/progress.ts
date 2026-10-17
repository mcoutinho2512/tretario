/**
 * GET /api/me/progress (rodada 9) — nível, XP e itens liberados da PRÓPRIA conta (cookie de sessão): o editor de
 * personagem mostra cadeado + requisito nos itens bloqueados. Só leitura; quem concede é o ProgressionService da sala.
 * Conta conectada: vale o estado em memória (recompensa recém-ganha antes da gravação em lote).
 */
import { router } from './router';
import { requireUser } from './session';
import { services } from '../services';
import { entitlementsFor } from '../progression/entitlements';
import { levelBounds, levelForXp } from '../../../src/progression/engine';
import { loadCatalog } from '../progression/catalog';

router.add('GET', '/api/me/progress', async (req) => {
  const store = services().store;
  const a = await requireUser(req, store);
  if (!a) return { status: 401, body: { error: 'sem_sessao' } };
  const [rec, ent] = await Promise.all([store.progression.load(a.user.id), entitlementsFor(store, a.user.id)]);
  const cat = loadCatalog();
  const level = levelForXp(cat.levels, rec?.xp ?? 0), b = levelBounds(cat.levels, level);
  return {
    body: {
      level, xp: rec?.xp ?? 0, xpLevel: b.cur, xpNext: b.next,
      unlocks: [...(ent.items ?? [])], completedMissions: (rec?.completed ?? []).map((c) => c.missionId), achievements: (rec?.achievements ?? []).map((x) => x.achievementId),
    },
  };
});
