/**
 * PUT /api/me/appearance — versão MÍNIMA (rodada 8, módulo de autenticação) só para o teste de persistência
 * (tools/qa/persistence_e2e.mjs). O dono do perfil/aparência (onboarding) substitui ou estende este módulo; se outro
 * módulo registrar a mesma rota antes, o roteador usa o primeiro registro. Validação = os mesmos saneadores da sala.
 */
import { router } from '../http/router';
import { API } from '../../../src/identity/types';
import type { CharacterAppearance } from '../../../src/characters/bodyTypes';
import { BODIES, NET_ACCESSORIES, sanitizeColor, sanitizeShirtDesign, sanitizeStyle } from '../../../src/net/protocol';
import { can } from '../../../src/access/policy';
import { auth } from '../auth/routes';
import { services } from '../services';

export function sanitizeAppearance(o: Record<string, unknown>): CharacterAppearance | null {
  if (!o || typeof o !== 'object' || !(BODIES as readonly string[]).includes(o.body as string)) return null;
  const scale = typeof o.scale === 'number' && Number.isFinite(o.scale) ? Math.min(1.06, Math.max(0.94, o.scale)) : 1;
  const a: CharacterAppearance = {
    body: o.body as CharacterAppearance['body'], scale,
    skin: sanitizeColor(o.skin, 0xb98a68), hair: sanitizeColor(o.hair, 0x1d1714), top: sanitizeColor(o.top, 0x2f6f8f),
    bottom: sanitizeColor(o.bottom, 0x2c3a52), shoes: sanitizeColor(o.shoes, 0xe8e8e2),
    accessory: (NET_ACCESSORIES as readonly string[]).includes(o.accessory as string) ? (o.accessory as CharacterAppearance['accessory']) : 'nenhum',
    acc: sanitizeColor(o.acc, 0x222222), shirtDesign: sanitizeShirtDesign(o.shirtDesign),
  };
  for (const f of ['topStyle', 'bottomStyle', 'shoeStyle', 'hairStyle'] as const) {
    const v = sanitizeStyle(f, o[f]);
    if (v) (a as unknown as Record<string, string>)[f] = v;
  }
  return a;
}

router.add('PUT', API.appearance, async (req) => {
  const s = await auth().session(req);
  if (!s) return { status: 401, body: { error: 'sem_sessao' } };
  if (!can((await auth().accessOf(s.user)).state, 'profile.edit')) return { status: 403, body: { error: 'sem_permissao' } };
  const a = sanitizeAppearance(req.body?.appearance ?? req.body);
  if (!a) return { status: 400, body: { error: 'aparencia_invalida' } };
  await services().store.appearances.put(s.user.id, a);
  return { body: { ok: true, appearance: a } };
});
