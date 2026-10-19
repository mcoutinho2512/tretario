/**
 * Rodada 11 — API do TÍTULO equipado (só a conta da sessão; mesmo limite de taxa do perfil):
 *  GET /api/me/title   → { title, titles }  (equipado e os ganhos)
 *  PUT /api/me/title   { title: <texto de um título ganho> | null } → { title } · 403 `bloqueado` (não ganhou) ·
 *                      400 `titulo_invalido`. Título equipado é PÚBLICO (NetPlayer.title, docs/PRIVACY_ARCHITECTURE.md).
 */
import { router, type ApiResponse } from './router';
import { rateLimited, withUser } from './profile';
import { equippedTitle, requestTitle, titlesFor } from '../progression/titles';

const err = (status: number, error: string): ApiResponse => ({ status, body: { error } });

router.add('GET', '/api/me/title', (req) => withUser(req, null, async ({ user, store }) => ({
  body: { title: await equippedTitle(store, user.id), titles: await titlesFor(store, user.id) },
})));

router.add('PUT', '/api/me/title', (req) => withUser(req, 'profile.edit', async ({ user, store }) => {
  if (rateLimited(`title:${user.id}`)) return err(429, 'muitas_alteracoes');
  const r = await requestTitle(store, user.id, req.body?.title);
  if (!r.ok) return r.reason === 'bloqueado' ? err(403, 'bloqueado') : r.reason === 'perfil_inexistente' ? err(409, 'perfil_inexistente') : err(400, 'titulo_invalido');
  return { body: { title: r.title } };
}));
