/**
 * Rodada 10 — API da TORCIDA da conta (só a conta da sessão; mesmo limite de taxa e capacidade do grupo do evento):
 *  GET /api/me/supporter   → { current, pending, sup, neutralId, cooldownS, groups } (`sup` = valor de NetPlayer.sup)
 *  PUT /api/me/supporter   { group: <id da torcida> | <neutralId> } → aplica já, ou fica PENDENTE durante evento
 *                          competitivo (`deferred: true`), ou 429 `cooldown` (retryInS). Visitante sem conta escolhe
 *                          só localmente (não chega aqui).
 * Torcida é dado PÚBLICO do perfil (docs/PRIVACY_ARCHITECTURE.md) e nunca dá vantagem.
 */
import { router, type ApiResponse } from './router';
import { rateLimited, withUser } from './profile';
import { loadSupporter, requestSupporter, supporters, supWire } from '../supporters/service';
import type { SupporterState } from '../../../src/supporters/data';

const err = (status: number, error: string, extra: Record<string, unknown> = {}): ApiResponse => ({ status, body: { error, ...extra } });
const view = (st: SupporterState) => ({ current: st.current, pending: st.pending, sup: supWire(st.current) });

router.add('GET', '/api/me/supporter', (req) => withUser(req, null, async ({ user, store }) => {
  const data = supporters();
  const st = await loadSupporter(store, user.id);
  if (!data || !st) return err(409, 'perfil_inexistente');
  return { body: { ...view(st), neutralId: data.neutralId, cooldownS: data.changePolicy.cooldownS, groups: data.groups.map((g) => g.id) } };
}));

router.add('PUT', '/api/me/supporter', (req) => withUser(req, 'group.join', async ({ user, store }) => {
  if (rateLimited(`sup:${user.id}`)) return err(429, 'muitas_alteracoes');
  const r = await requestSupporter(store, user.id, req.body?.group);
  if (!r) return err(409, 'perfil_inexistente');
  if (r.kind === 'invalid') return err(400, 'torcida_invalida');
  if (r.kind === 'cooldown') return err(429, 'cooldown', { retryInS: r.retryInS });
  return { body: { ...view(r.state), deferred: r.kind === 'deferred' } };
}));
