/**
 * Rodada 10 — TORCIDAS: leitura/validação PURA de `public/gameplay/supporters.json` (contrato em ./types.ts) e as regras
 * genéricas que cliente e servidor compartilham:
 *  - `parseSupporterData`  valida ids, categoria, cores, designs (existentes e do alvo certo), política de troca
 *  - `supIndex`/`supAt`    campo de rede `NetPlayer.sup` (u8): 0 = neutro/sem torcida, i+1 = índice em `groups`
 *  - `decideSupporterChange` / `settlePending`  política de troca (cooldown; PENDENTE durante evento competitivo)
 *
 * NEUTRALIDADE: nenhuma função recebe um id concreto de torcida; todas tratam os grupos pela posição/lista dos DADOS.
 * Torcida é separada de grupo político e de grupo de evento: nada aqui lê ou infere grupo político.
 */
import { DESIGN_BY_ID } from '../social/designs';
import type { DesignTarget } from '../social/designs';
import type { SupporterData, SupporterGroupDefinition } from './types';

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9_-]{2,32}$/;
const CATEGORY: SupporterGroupDefinition['category'] = 'SUPPORTERS';
/** teto do campo de rede u8 (0 = neutro) */
export const MAX_SUPPORTER_GROUPS = 254;

export interface SupporterParse { data: SupporterData | null; errors: string[] }

function designOk(id: unknown, target: DesignTarget): boolean {
  const d = typeof id === 'number' ? DESIGN_BY_ID.get(id) : undefined;
  return !!d && d.targets.includes(target);
}

/** valida o JSON das torcidas. Grupo inválido é DESCARTADO (com erro); arquivo inválido devolve `data: null` */
export function parseSupporterData(raw: unknown): SupporterParse {
  const errors: string[] = [];
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!o) return { data: null, errors: ['arquivo não é um objeto'] };
  const neutralId = typeof o.neutralId === 'string' && ID.test(o.neutralId) ? o.neutralId : null;
  if (!neutralId) errors.push('neutralId ausente/inválido');
  const cp = (o.changePolicy ?? {}) as Record<string, unknown>;
  const cooldownS = typeof cp.cooldownS === 'number' && Number.isFinite(cp.cooldownS) && cp.cooldownS >= 0 ? cp.cooldownS : 60;
  const defer = Array.isArray(cp.deferDuringEventKinds) ? cp.deferDuringEventKinds.filter((k): k is string => typeof k === 'string') : [];
  const groups: SupporterGroupDefinition[] = [];
  const seen = new Set<string>();
  for (const [i, gRaw] of (Array.isArray(o.groups) ? o.groups : []).entries()) {
    const g = gRaw as SupporterGroupDefinition;
    const where = `groups[${i}]`;
    const bad = (m: string) => errors.push(`${where}: ${m}`);
    if (!g || typeof g !== 'object') { bad('não é objeto'); continue; }
    if (typeof g.id !== 'string' || !ID.test(g.id)) { bad('id inválido'); continue; }
    if (g.id === neutralId || seen.has(g.id)) { bad(`id repetido/reservado (${g.id})`); continue; }
    if (g.category !== CATEGORY) { bad('categoria deve ser de torcida'); continue; }
    if (typeof g.displayName !== 'string' || !g.displayName.trim() || typeof g.shortName !== 'string' || !g.shortName.trim()) { bad('nomes ausentes'); continue; }
    const colors = [...(g.primaryColors ?? []), ...(g.secondaryColors ?? [])];
    if (!Array.isArray(g.primaryColors) || !g.primaryColors.length || !colors.every((c) => typeof c === 'string' && HEX.test(c))) { bad('cores inválidas'); continue; }
    const cs = g.clothingSet;
    if (!cs || !designOk(cs.shirtDesign, 'shirt')) { bad('camisa (design de camisa) inexistente'); continue; }
    if ((cs.bottomColor && !HEX.test(cs.bottomColor)) || (cs.shoeColor && !HEX.test(cs.shoeColor))) { bad('cores sugeridas inválidas'); continue; }
    if (!(g.flagSet ?? []).every((d) => designOk(d, 'flag')) || !(g.bannerSet ?? []).every((d) => designOk(d, 'banner'))) { bad('bandeira/faixa inexistente'); continue; }
    if (!(g.allowedCosmetics ?? []).every((d) => typeof d === 'number' && DESIGN_BY_ID.has(d))) { bad('cosmético inexistente'); continue; }
    if (groups.length >= MAX_SUPPORTER_GROUPS) { bad('grupos demais'); continue; }
    seen.add(g.id);
    groups.push(g);
  }
  if (!neutralId) return { data: null, errors };
  return { data: { version: typeof o.version === 'number' ? o.version : 1, neutralId, changePolicy: { cooldownS, deferDuringEventKinds: defer }, groups }, errors };
}

/** id escolhido é válido? (grupo ou o neutro) */
export function isSupporterChoice(data: SupporterData, id: unknown): id is string {
  return typeof id === 'string' && (id === data.neutralId || data.groups.some((g) => g.id === id));
}

/** grupo pelo id (neutro/desconhecido → null) */
export function supporterGroup(data: SupporterData | null, id: string | null | undefined): SupporterGroupDefinition | null {
  return (id && data?.groups.find((g) => g.id === id)) || null;
}

/** campo de rede `NetPlayer.sup`: 0 = neutro/sem torcida, i+1 = índice em `groups` */
export function supIndex(data: SupporterData | null, id: string | null | undefined): number {
  if (!data || !id) return 0;
  const i = data.groups.findIndex((g) => g.id === id);
  return i < 0 ? 0 : i + 1;
}

/** inverso de `supIndex` (0/fora da faixa → null) */
export function supAt(data: SupporterData | null, sup: number): SupporterGroupDefinition | null {
  return (data && sup > 0 && data.groups[sup - 1]) || null;
}

/** cor hex "#rrggbb" → inteiro 24 bits */
export const hexToInt = (c: string) => parseInt(c.slice(1), 16);

// ------------------------------------------------------------------ política de troca

/** estado persistido da torcida (Profile.supporterGroup/supporterPending/supporterChangedAt) */
export interface SupporterState { current: string | null; pending: string | null; changedAt: number | null }

export type SupporterChange =
  | { kind: 'applied'; state: SupporterState }
  | { kind: 'deferred'; state: SupporterState }
  | { kind: 'unchanged'; state: SupporterState }
  | { kind: 'cooldown'; retryInS: number; state: SupporterState }
  | { kind: 'invalid'; state: SupporterState };

/**
 * pedido de troca. `activeEventKinds` = formatos dos eventos ATIVOS/inscritos do jogador (vazio fora de evento).
 * Fora de evento listado em `deferDuringEventKinds`: aplica já (respeitando `cooldownS` desde a última troca).
 * Dentro: vira PENDENTE (aplicada por `settlePending` no fim/saída do evento). Pedir a atual cancela a pendência.
 */
export function decideSupporterChange(data: SupporterData, st: SupporterState, requested: unknown, activeEventKinds: readonly string[], now: number): SupporterChange {
  if (!isSupporterChoice(data, requested)) return { kind: 'invalid', state: st };
  const locked = activeEventKinds.some((k) => data.changePolicy.deferDuringEventKinds.includes(k));
  if (requested === st.current) return st.pending ? { kind: 'applied', state: { ...st, pending: null } } : { kind: 'unchanged', state: st };
  if (locked) return { kind: 'deferred', state: { ...st, pending: requested } };
  const wait = st.changedAt === null ? 0 : st.changedAt + data.changePolicy.cooldownS * 1000 - now;
  if (wait > 0) return { kind: 'cooldown', retryInS: Math.ceil(wait / 1000), state: st };
  return { kind: 'applied', state: { current: requested, pending: null, changedAt: now } };
}

/** fim/saída do evento: aplica a troca pendente (sem cooldown — o pedido foi feito antes). null = nada a fazer */
export function settlePending(data: SupporterData, st: SupporterState, activeEventKinds: readonly string[], now: number): SupporterState | null {
  if (!st.pending) return null;
  if (activeEventKinds.some((k) => data.changePolicy.deferDuringEventKinds.includes(k))) return null;
  if (!isSupporterChoice(data, st.pending)) return { ...st, pending: null };
  return { current: st.pending, pending: null, changedAt: now };
}

/** "vestir as cores": camisa da torcida + cores sugeridas (calção/tênis); neutro → nada muda */
export function supporterOutfit(g: SupporterGroupDefinition): { shirtDesign: number; top: number; bottom?: number; shoes?: number } {
  const d = DESIGN_BY_ID.get(g.clothingSet.shirtDesign);
  return {
    shirtDesign: g.clothingSet.shirtDesign,
    top: hexToInt(d?.palette.bg ?? g.primaryColors[0]),
    ...(g.clothingSet.bottomColor ? { bottom: hexToInt(g.clothingSet.bottomColor) } : {}),
    ...(g.clothingSet.shoeColor ? { shoes: hexToInt(g.clothingSet.shoeColor) } : {}),
  };
}

// ------------------------------------------------------------------ carga (cliente: fetch; servidor: arquivo)
let cache: SupporterData | null = null;
/** dados já carregados (null antes de `setSupporterData`) */
export function supporterData(): SupporterData | null { return cache; }
/** registra os dados validados (cliente após o fetch; servidor na partida; testes) */
export function setSupporterData(raw: unknown): SupporterParse {
  const r = parseSupporterData(raw);
  cache = r.data;
  return r;
}
/** cliente: carrega `/gameplay/supporters.json` uma vez (falha → sem torcidas; tudo neutro) */
let loading: Promise<SupporterData | null> | null = null;
export function loadSupporterData(url = '/gameplay/supporters.json'): Promise<SupporterData | null> {
  return (loading ??= fetch(url).then((r) => r.json()).then((j) => setSupporterData(j).data).catch(() => null));
}
