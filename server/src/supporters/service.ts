/**
 * Rodada 10 — TORCIDAS no servidor (sem Colyseus): dados validados de `public/gameplay/supporters.json`, estado
 * persistido da conta (DataStore.supporters) e a política de troca (src/supporters/data.ts):
 *  - fora de evento competitivo: aplica já (cooldown `changePolicy.cooldownS`)
 *  - inscrito/participando de evento VIVO cujo formato está em `deferDuringEventKinds`: fica PENDENTE e é aplicada
 *    quando o jogador sai/o evento termina (`settle`, chamado pela sala)
 * A sala informa os formatos de evento de cada CONTA (`setEventKinds`) e ouve as trocas (`onSupporterChange`) para
 * atualizar `NetPlayer.sup` — a API HTTP e a sala rodam no MESMO processo (docs/IDENTITY.md).
 * Visitante sem conta: escolha só local da sessão (nunca chega aqui).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { DataStore, SupporterRecord } from '../data/types';
import type { SupporterData } from '../../../src/supporters/types';
import { decideSupporterChange, setSupporterData, settlePending, supIndex, supporterData, type SupporterChange, type SupporterState } from '../../../src/supporters/data';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/gameplay/supporters.json');

/** dados das torcidas (carregados do arquivo na primeira chamada; inválido → sem torcidas) */
export function supporters(): SupporterData | null {
  const d = supporterData();
  if (d) return d;
  try {
    const r = setSupporterData(JSON.parse(readFileSync(FILE, 'utf8')));
    if (r.errors.length) console.warn(`[torcidas] ${r.errors.join('; ')}`);
    return r.data;
  } catch (e) {
    console.warn(`[torcidas] dados indisponíveis: ${(e as Error).message}`);
    return null;
  }
}

// ------------------------------------------------------------------ eventos vivos por conta (alimentado pela sala)
const kinds = new Map<string, string[]>();
/** formatos dos eventos vivos em que a conta está inscrita (vazio/undefined = fora de evento) */
export function setEventKinds(userId: string, list: readonly string[]) {
  if (list.length) kinds.set(userId, [...list]); else kinds.delete(userId);
}
export function eventKindsOf(userId: string): string[] { return kinds.get(userId) ?? []; }

/** grupo do EVENTO travado (inscrito em evento vivo com regras de grupo, ex. confronto): a sala adia a troca */
const groupLocks = new Set<string>();
export function setGroupLocked(userId: string, on: boolean) { if (on) groupLocks.add(userId); else groupLocks.delete(userId); }
export function groupLocked(userId: string): boolean { return groupLocks.has(userId); }

// ------------------------------------------------------------------ ouvintes (sala: NetPlayer.sup)
type Listener = (userId: string, current: string | null, pending: string | null) => void;
const listeners = new Set<Listener>();
export function onSupporterChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const notify = (userId: string, st: SupporterState) => { for (const fn of listeners) fn(userId, st.current, st.pending); };

const toState = (r: SupporterRecord | null): SupporterState => ({ current: r?.group ?? null, pending: r?.pending ?? null, changedAt: r?.changedAt ? +r.changedAt : null });
const toRecord = (s: SupporterState): SupporterRecord => ({ group: s.current, pending: s.pending, changedAt: s.changedAt === null ? null : new Date(s.changedAt) });

/** estado público da torcida da conta (sem perfil → null) */
export async function loadSupporter(store: DataStore, userId: string): Promise<SupporterState | null> {
  const rec = await store.supporters.get(userId);
  return rec ? toState(rec) : null;
}

/** pedido de troca (API PUT /api/me/supporter e mensagem da sala) */
export async function requestSupporter(store: DataStore, userId: string, requested: unknown, now = Date.now()): Promise<SupporterChange | null> {
  const data = supporters();
  const st = await loadSupporter(store, userId);
  if (!data || !st) return null;
  const r = decideSupporterChange(data, st, requested, eventKindsOf(userId), now);
  if (r.kind === 'applied' || r.kind === 'deferred') { await store.supporters.set(userId, toRecord(r.state)); notify(userId, r.state); }
  return r;
}

/** fim/saída do evento: aplica a troca pendente da conta, se houver (a sala chama quando os formatos mudam) */
export async function settleSupporter(store: DataStore, userId: string, now = Date.now()): Promise<SupporterState | null> {
  const data = supporters();
  const st = data ? await loadSupporter(store, userId) : null;
  if (!data || !st) return null;
  const next = settlePending(data, st, eventKindsOf(userId), now);
  if (!next) return null;
  await store.supporters.set(userId, toRecord(next));
  notify(userId, next);
  return next;
}

/** valor do campo de rede `NetPlayer.sup` para um id (0 = neutro/sem torcida) */
export function supWire(id: string | null | undefined): number { return supIndex(supporters(), id); }
