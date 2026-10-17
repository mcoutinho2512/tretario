/**
 * Moderação de texto — serviço CENTRAL (rodada 8). Apelido, chat, texto de grafite e (futuro) cartaz personalizado
 * passam TODOS por aqui: uma lista, uma normalização, um lugar para trocar por um provedor melhor depois.
 * Puro (cliente avisa antes; o servidor decide).
 *
 * Contextos: cada um tem limite de tamanho e regras próprias (apelido: caracteres restritos e nomes reservados).
 */
import { checkText as basicCheck, normalizeForFilter, sanitizeText as basicSanitize } from './basicFilter';

export type TextContext = 'nickname' | 'chat' | 'graffiti' | 'sign';
export type TextRejection = 'vazio' | 'curto' | 'longo' | 'bloqueado' | 'spam' | 'caracteres' | 'reservado';
export type TextVerdict = { ok: true; text: string } | { ok: false; reason: TextRejection };

export const TEXT_LIMITS: Record<TextContext, { min: number; max: number }> = {
  nickname: { min: 3, max: 20 },
  chat: { min: 1, max: 200 },
  graffiti: { min: 1, max: 24 },
  sign: { min: 1, max: 32 },
};

export interface TextModerationProvider {
  /** saneia (controles, invisíveis, espaços) sem julgar o conteúdo */
  sanitize(raw: unknown, ctx: TextContext): string;
  /** veredito: o texto recebido precisa já estar saneado (igual a `sanitize`) */
  check(raw: string, ctx: TextContext): TextVerdict;
  /** chave de comparação de apelidos (unicidade e anti-imitação: acentos, maiúsculas, leet, símbolos) */
  nicknameKey(nick: string): string;
}

/** nomes que ninguém pode usar (nem variações: "Adm1n", "_MOD_", "suporte.oficial") */
const RESERVED_ANY = ['admin', 'administrador', 'administracao', 'moderador', 'moderacao', 'suporte', 'support', 'sistema', 'system', 'staff', 'oficial', 'official', 'equipepv', 'presidentevargas3d', 'pv3d', 'root', 'gamemaster'];
/** curtos demais para "contém": só exatos ou seguidos de dígitos ("mod", "mod2", "gm") */
const RESERVED_EXACT = ['mod', 'mods', 'adm', 'gm', 'dev', 'devs', 'bot', 'npc', 'servidor', 'server', 'equipe', 'team'];

const NICK_CHARS = /^[\p{L}\p{N}_.-]+$/u;

export class BasicTextModerationProvider implements TextModerationProvider {
  sanitize(raw: unknown, ctx: TextContext): string {
    if (ctx === 'graffiti') return basicSanitize(raw);
    if (typeof raw !== 'string') return '';
    const clean = raw
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return Array.from(clean).slice(0, TEXT_LIMITS[ctx].max).join('').trim();
  }

  nicknameKey(nick: string): string {
    return normalizeForFilter(nick).replace(/[^a-z0-9]/g, '');
  }

  check(raw: string, ctx: TextContext): TextVerdict {
    if (ctx === 'graffiti') return basicCheck(raw);
    const text = this.sanitize(raw, ctx);
    const lim = TEXT_LIMITS[ctx];
    if (!text) return { ok: false, reason: 'vazio' };
    if (Array.from(raw.trim()).length > lim.max) return { ok: false, reason: 'longo' };
    if (Array.from(text).length < lim.min) return { ok: false, reason: 'curto' };
    if (ctx === 'nickname') {
      if (text !== raw || !NICK_CHARS.test(text)) return { ok: false, reason: 'caracteres' };
      const key = this.nicknameKey(text);
      if (key.length < 3) return { ok: false, reason: 'caracteres' };
      if (RESERVED_ANY.some((r) => key.includes(r))) return { ok: false, reason: 'reservado' };
      if (RESERVED_EXACT.some((r) => key === r || new RegExp(`^${r}\\d*$`).test(key))) return { ok: false, reason: 'reservado' };
    }
    // palavrões/ódio/spam: mesma lista do grafite (aplicada ao texto todo, em pedaços curtos)
    const words = text.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = words.slice(i, i + 3).join(' ').slice(0, 24);
      const v = basicCheck(basicSanitize(chunk));
      if (!v.ok && v.reason !== 'vazio' && v.reason !== 'caracteres' && v.reason !== 'longo') return { ok: false, reason: v.reason };
    }
    return { ok: true, text };
  }
}

/** instância padrão (trocar aqui por um provedor externo no futuro — nenhum outro lugar muda) */
export const textModeration: TextModerationProvider = new BasicTextModerationProvider();
