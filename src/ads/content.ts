/**
 * AdSlots (rodada 9) — validação e escolha PURAS do conteúdo INTERNO dos telões/painéis (servidor escolhe; cliente
 * revalida antes de desenhar). Nada externo: nenhuma URL de fora, nenhum vídeo, nenhum upload. docs/AD_SLOTS.md.
 */
import type { AdContent, AdFormat, AdSlotDefinition } from './types';
import type { AgendaEntry } from '../events/schedule';

/** formatos que ESTA rodada serve (os outros ficam declarados no slot para o futuro) */
export const INTERNAL_FORMATS: readonly AdFormat[] = ['SYSTEM', 'EVENT', 'CAMPAIGN'];

/** caminho de arte do PRÓPRIO jogo (relativo, pastas conhecidas, extensão de imagem) — qualquer outra coisa é recusada */
export function internalAssetPath(url: unknown): boolean {
  if (typeof url !== 'string' || url.length > 160) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.includes('..') || url.includes('\\')) return false; // http:, data:, javascript:, //host
  return /^\/?(designs|ui|events|landmarks)\/[\w\-/]+\.(png|webp|jpg)$/.test(url);
}

const SAFE_TEXT = /^[^<>{}\u0000-\u001f‪-‮⁦-⁩]{1,80}$/u;

/** conteúdo aceitável? (IMAGE só com arte interna; texto curto e limpo; nada de vídeo/URL externa) */
export function validAdContent(c: unknown): c is AdContent {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  switch (o.kind) {
    case 'SYSTEM': return typeof o.text === 'string' && SAFE_TEXT.test(o.text) && (o.sub === undefined || (typeof o.sub === 'string' && SAFE_TEXT.test(o.sub)));
    case 'EVENT': return typeof o.inst === 'string' && o.inst.length <= 80 && (o.name === undefined || (typeof o.name === 'string' && SAFE_TEXT.test(o.name)));
    case 'CAMPAIGN': return typeof o.designKey === 'string' && /^[a-z0-9_]{1,40}$/.test(o.designKey);
    case 'IMAGE': return internalAssetPath(o.url);
    default: return false;
  }
}

export interface AdSlotsFile {
  slots: AdSlotDefinition[];
  /** avisos do sistema (texto neutro) */
  notices?: { text: string; sub?: string }[];
  /** dicas de missão/jogo (texto neutro) */
  tips?: { text: string; sub?: string }[];
}

export interface AdSources {
  /** agenda atual (eventos acontecendo/próximos) */
  agenda(now: number): AgendaEntry[];
  /** chaves de design para telões: campanhas cadastradas (todas, ordem fixa) + arte neutra do jogo */
  designs(): string[];
}

/**
 * candidatos de um slot, em ordem estável: avisos/dicas (SYSTEM), eventos da agenda (EVENT; os da zona do slot
 * primeiro) e designs (CAMPAIGN — cada design cadastrado aparece o MESMO número de vezes). Só formatos internos.
 */
export function slotPool(slot: AdSlotDefinition, file: AdSlotsFile, src: AdSources, now: number): AdContent[] {
  const f = new Set(slot.formats.filter((x) => INTERNAL_FORMATS.includes(x)));
  const out: AdContent[] = [];
  if (f.has('EVENT')) {
    const evs = src.agenda(now).filter((e) => e.state !== 'FINISHED' && e.state !== 'CANCELLED')
      .sort((a, b) => Number(b.zone === slot.zone) - Number(a.zone === slot.zone) || a.startsAt - b.startsAt).slice(0, 3);
    for (const e of evs) out.push({ kind: 'EVENT', inst: e.inst, name: e.name, format: String(e.format), zone: e.zone, state: e.state, startsAt: e.startsAt, count: e.count, capacity: e.capacity });
  }
  if (f.has('SYSTEM')) {
    for (const n of file.notices ?? []) out.push({ kind: 'SYSTEM', text: n.text, ...(n.sub ? { sub: n.sub } : {}) });
    for (const n of file.tips ?? []) out.push({ kind: 'SYSTEM', text: n.text, ...(n.sub ? { sub: n.sub } : {}) });
  }
  if (f.has('CAMPAIGN')) for (const k of src.designs()) out.push({ kind: 'CAMPAIGN', designKey: k });
  return out.filter(validAdContent);
}

/** escolha do slot no instante: rodízio por rotateSeconds, deslocado pelo índice do slot (painéis vizinhos diferem) */
export function pickAd(pool: readonly AdContent[], slot: AdSlotDefinition, slotIndex: number, now: number): AdContent | null {
  if (!pool.length) return null;
  const k = Math.floor(now / 1000 / Math.max(3, slot.rotateSeconds));
  return pool[(k + slotIndex) % pool.length];
}

/** chave de igualdade do conteúdo (EVENT muda quando muda o estado/contagem) */
export const adKey = (c: AdContent | null) => (c ? JSON.stringify(c) : '');
