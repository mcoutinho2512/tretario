/**
 * Filtro BÁSICO (lista PT-BR) usado pelo serviço central src/moderation/text.ts — não importe direto fora dele, exceto o
 * grafite legado. Texto curto do grafite: saneamento + filtro BÁSICO de palavrões/ódio em PT-BR — módulo puro (cliente avisa antes,
 * servidor decide). É um filtro de primeira linha, não moderação completa: o texto continua MODERÁVEL (denúncia,
 * ocultação automática, remoção pelo admin — ver docs/GRAFFITI.md). Desenho livre não tem filtro automático.
 *
 * A lista é curta de propósito (menos falso-positivo): raízes comparadas por PALAVRA depois de normalizar
 * acentos, "leetspeak" (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s) e letras repetidas ("porrrra" → "pora").
 */

export const MAX_TEXT_CHARS = 24;

/** palavra inteira (normalizada) */
const EXACT = [
  'cu', 'fdp', 'vsf', 'tnc', 'pqp', 'krl', 'pnc', 'pica', 'bicha', 'viado', 'traveco', 'sapatao', 'puta', 'puto', 'foda', 'fode',
  'nazi', 'nazista', 'hitler', 'heil', 'sieg', 'pora', 'corno', 'corna',
];
/** início de palavra (pega flexões: "caralho", "caralhada", "putaria", "fudido"…) */
const PREFIX = [
  'caralh', 'bucet', 'bocet', 'putar', 'putinh', 'foder', 'fodid', 'fodas', 'fudid', 'fude', 'cuza', 'merd', 'bost', 'pirok', 'piroc',
  'xoxot', 'xerec', 'punhet', 'arombad', 'babac', 'otari', 'vagabund', 'vadi', 'cacet', 'desgracad', 'viadinh', 'viadag', 'crioul',
  'retardad', 'mongoloid', 'estupr', 'escrot', 'prostitut', 'piranh', 'safad',
];
/** também procurados no texto inteiro SEM espaços ("p o r r a", "pau-no-cu") */
const JOINED = ['caralh', 'bucet', 'porra', 'fdp', 'paunocu', 'filhodaputa', 'vaitomarnocu', 'vtnc', 'foda-se', 'fodase', 'hitler', 'nazis', 'estupr'];
/** propaganda/spam: link, @arroba de rede, telefone */
const SPAM = [/https?/, /www/, /\.(com|net|org|br|io|gg|xyz)\b/, /\d{8,}/];

const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

export function normalizeForFilter(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
}

/** saneia: remove controles/invisíveis/emoji, junta espaços, corta em MAX_TEXT_CHARS (pontos de código) */
export function sanitizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const clean = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/[^\p{L}\p{N} !?.,:;'"()#&+\-/*=]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, MAX_TEXT_CHARS).join('').trim();
}

export type TextVerdict = { ok: true; text: string } | { ok: false; reason: 'vazio' | 'longo' | 'bloqueado' | 'spam' | 'caracteres' };

/** veredito do texto (o servidor exige que o texto recebido já esteja saneado: igual a sanitizeText(texto)) */
export function checkText(raw: string): TextVerdict {
  const text = sanitizeText(raw);
  if (!text) return { ok: false, reason: 'vazio' };
  if (text !== raw) return Array.from(raw).length > MAX_TEXT_CHARS ? { ok: false, reason: 'longo' } : { ok: false, reason: 'caracteres' };
  const norm = normalizeForFilter(text);
  if (SPAM.some((r) => r.test(text.toLowerCase().replace(/\s+/g, '')))) return { ok: false, reason: 'spam' };
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    const c = collapse(w);
    if (EXACT.includes(w) || EXACT.includes(c)) return { ok: false, reason: 'bloqueado' };
    if (PREFIX.some((p) => c.startsWith(p) || w.startsWith(p))) return { ok: false, reason: 'bloqueado' };
  }
  const joined = norm.replace(/[^a-z]/g, '');
  if (JOINED.some((j) => { const jj = j.replace(/[^a-z]/g, ''); return joined.includes(jj) || collapse(joined).includes(jj); })) return { ok: false, reason: 'bloqueado' };
  return { ok: true, text };
}
