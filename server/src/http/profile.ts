/**
 * API de perfil, aparência, preferências e grupo do evento (rodada 8). O servidor é a autoridade:
 *  GET/PUT    /api/me/appearance            aparência salva (validada pelo MESMO validador da sala)
 *  GET/PUT    /api/me/preferences           preferências (lista fechada de campos)
 *  GET        /api/profile/:nickname        perfil PÚBLICO mínimo (PublicProfile: sem e-mail, ids ou datas exatas)
 *  GET        /api/events/current           evento atual + grupos escolhíveis (+ grupo do usuário, com sessão)
 *  PUT/DELETE /api/events/current/membership  escolher/sair do grupo — SÓ neste evento (não é atributo da conta)
 * Cada rota só lê/escreve dados da conta da SESSÃO (cookie): não existe parâmetro de "outro usuário" para editar.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { router, type ApiRequest, type ApiResponse } from './router';
import { accessStateOf, requireUser, type AuthedUser } from './session';
import { services } from '../services';
import type { DataStore } from '../data/types';
import { can, type Capability } from '../../../src/access/policy';
import type { CharacterAppearance } from '../../../src/characters/bodyTypes';
import { validateAppearance } from '../../../src/characters/validateAppearance';
import type { EventDef } from '../../../src/events/types';
import { groupRecordId, groupKeyOf, joinableGroups, type CurrentEventResponse } from '../../../src/events/groups';
import type { PlayerPreferences, PublicProfile } from '../../../src/identity/types';
import { textModeration } from '../../../src/moderation/text';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');

// ------------------------------------------------------------------ evento atual (dados)
let evCache: EventDef | null = null;
/** evento atual: PV_EVENT ou o padrão de public/events/index.json (o mesmo que a sala usa) */
export function currentEvent(): EventDef {
  if (evCache) return evCache;
  const idx = JSON.parse(readFileSync(`${PUBLIC}/events/index.json`, 'utf8')) as { default: string };
  const id = process.env.PV_EVENT ?? idx.default;
  const f = `${PUBLIC}/events/${id}.json`;
  evCache = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as EventDef) : { id, name: id, category: 'cotidiano' };
  return evCache;
}
/** testes: troca o evento atual */
export function setCurrentEventForTests(ev: EventDef | null) { evCache = ev; seeded = null; }

let seeded: Promise<void> | null = null;
/** grava Event/EventGroup dos dados no banco (idempotente; uma vez por processo) — membership referencia o grupo */
export function ensureEventGroups(store: DataStore): Promise<void> {
  const ev = currentEvent();
  return (seeded ??= store.events.upsert({
    id: ev.id, name: ev.name,
    groups: joinableGroups(ev).map((g, i) => ({ id: groupRecordId(ev.id, g.key), key: g.key, name: g.name, designKey: g.designKey, neutral: g.neutral, sort: i })),
  }).catch((e) => { seeded = null; throw e; }));
}

// ------------------------------------------------------------------ utilidades
const err = (status: number, error: string): ApiResponse => ({ status, body: { error } });

/** limite simples por usuário e rota (memória): evita gravação em rajada */
const hits = new Map<string, number[]>();
function rateLimited(key: string, max = 20, windowMs = 60_000, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

type Authed = AuthedUser & { store: DataStore };
async function withUser(req: ApiRequest, cap: Capability | null, fn: (a: Authed) => Promise<ApiResponse>): Promise<ApiResponse> {
  const store = services().store;
  const a = await requireUser(req, store);
  if (!a) return err(401, 'sem_sessao');
  if (cap && !can(await accessStateOf(store, a.user, currentEvent().id), cap)) return err(403, 'sem_permissao');
  return fn({ ...a, store });
}

const NAMES = ['TODOS', 'PROXIMOS', 'NENHUM'] as const;
const QUALITIES = ['auto', 'low', 'medium', 'high', 'ultra'];
/** preferências: só campos conhecidos com valores da lista */
export function sanitizePreferences(raw: unknown): PlayerPreferences {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: PlayerPreferences = {};
  if ((NAMES as readonly unknown[]).includes(o.names)) out.names = o.names as PlayerPreferences['names'];
  if (typeof o.chatCollapsed === 'boolean') out.chatCollapsed = o.chatCollapsed;
  if (typeof o.quality === 'string' && QUALITIES.includes(o.quality)) out.quality = o.quality;
  return out;
}

/** aparência salva da conta (validada de novo na leitura: dados antigos/listas mudaram) */
export async function savedAppearance(store: DataStore, userId: string): Promise<CharacterAppearance | null> {
  const rec = await store.appearances.get(userId);
  return rec ? validateAppearance(rec.data) : null;
}

/** campos de perfil para GET /api/me (o módulo de autenticação inclui na MeResponse) */
export async function meExtras(store: DataStore, userId: string) {
  await ensureEventGroups(store);
  const ev = currentEvent();
  const [appearance, profile, mem] = await Promise.all([savedAppearance(store, userId), store.profiles.byUserId(userId), store.events.membership(userId, ev.id)]);
  return {
    appearance,
    preferences: sanitizePreferences(profile?.preferences),
    membership: mem ? { eventId: ev.id, groupKey: groupKeyOf(mem.groupId) } : null,
  };
}

// ------------------------------------------------------------------ aparência
router.add('GET', '/api/me/appearance', (req) => withUser(req, null, async ({ user, store }) => {
  const rec = await store.appearances.get(user.id);
  return { body: { appearance: rec ? validateAppearance(rec.data) : null, version: rec?.version ?? 0 } };
}));

router.add('PUT', '/api/me/appearance', (req) => withUser(req, 'profile.edit', async ({ user, store }) => {
  if (rateLimited(`ap:${user.id}`)) return err(429, 'muitas_alteracoes');
  const raw = req.body?.appearance ?? req.body;
  const app = validateAppearance(raw);
  if (!app) return err(400, 'aparencia_invalida');
  await store.appearances.put(user.id, app);
  const rec = await store.appearances.get(user.id);
  return { body: { appearance: app, version: rec?.version ?? 1 } };
}));

// ------------------------------------------------------------------ preferências
router.add('GET', '/api/me/preferences', (req) => withUser(req, null, async ({ user, store }) => {
  const p = await store.profiles.byUserId(user.id);
  return { body: { preferences: sanitizePreferences(p?.preferences) } };
}));

router.add('PUT', '/api/me/preferences', (req) => withUser(req, null, async ({ user, store }) => {
  if (rateLimited(`pref:${user.id}`, 40)) return err(429, 'muitas_alteracoes');
  const p = await store.profiles.byUserId(user.id);
  if (!p) return err(409, 'perfil_inexistente');
  const preferences = { ...sanitizePreferences(p.preferences), ...sanitizePreferences(req.body?.preferences ?? req.body) };
  await store.profiles.update(user.id, { preferences });
  return { body: { preferences } };
}));

// ------------------------------------------------------------------ perfil público
router.add('GET', '/api/profile/:nickname', async (req) => {
  const store = services().store;
  const nick = textModeration.sanitize(req.params.nickname, 'nickname');
  const key = nick ? textModeration.nicknameKey(nick) : '';
  if (key.length < 3) return err(404, 'nao_encontrado');
  const p = await store.profiles.byNicknameKey(key);
  const u = p ? await store.users.byId(p.userId) : null;
  if (!p || !u || u.status === 'BANNED') return err(404, 'nao_encontrado');
  const out: PublicProfile = {
    nickname: p.nickname, displayName: p.displayName,
    appearance: await savedAppearance(store, p.userId),
    since: new Date(p.createdAt).toISOString().slice(0, 7),
  };
  return { body: out };
});

// ------------------------------------------------------------------ evento atual e grupos
router.add('GET', '/api/events/current', async (req) => {
  const store = services().store;
  const ev = currentEvent();
  const a = await requireUser(req, store);
  let membership: CurrentEventResponse['membership'] = null;
  if (a) {
    await ensureEventGroups(store);
    const m = await store.events.membership(a.user.id, ev.id);
    if (m) membership = { eventId: ev.id, groupKey: groupKeyOf(m.groupId) };
  }
  const body: CurrentEventResponse = { event: { id: ev.id, name: ev.name, category: ev.category }, groups: joinableGroups(ev), membership };
  return { body };
});

router.add('PUT', '/api/events/current/membership', (req) => withUser(req, 'group.join', async ({ user, store }) => {
  if (rateLimited(`grp:${user.id}`)) return err(429, 'muitas_alteracoes');
  const ev = currentEvent();
  const key = typeof req.body?.groupKey === 'string' ? req.body.groupKey : '';
  if (!joinableGroups(ev).some((g) => g.key === key)) return err(400, 'grupo_invalido');
  await ensureEventGroups(store);
  await store.events.setMembership(user.id, ev.id, groupRecordId(ev.id, key));
  return { body: { membership: { eventId: ev.id, groupKey: key } } };
}));

router.add('DELETE', '/api/events/current/membership', (req) => withUser(req, null, async ({ user, store }) => {
  await store.events.clearMembership(user.id, currentEvent().id);
  return { body: { membership: null } };
}));
