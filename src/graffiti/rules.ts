/**
 * Regras AUTORITATIVAS da pichação/grafite — puras e testáveis (o servidor as aplica; o cliente usa as mesmas para
 * avisar antes de enviar). Estados, limites, validação do conteúdo, cota/cooldown e máquina de moderação.
 * Ver docs/GRAFFITI.md.
 */
import { CANVAS_H, CANVAS_W, PALETTE, SYMBOLS, WIDTHS, decodeGraffiti, type GraffitiContent } from './codec';
import { distanceToSurface, rectInside, type GraffitiSurface } from './surfaces';
import { checkText, MAX_TEXT_CHARS } from './textFilter';

export const GF_STATE = { ACTIVE: 0, REPORTED: 1, HIDDEN: 2, REMOVED: 3, EXPIRED: 4 } as const;
export type GraffitiState = (typeof GF_STATE)[keyof typeof GF_STATE];
export const GF_STATE_NAME = ['ACTIVE', 'REPORTED', 'HIDDEN', 'REMOVED', 'EXPIRED'] as const;
/** estados que os clientes desenham (HIDDEN/REMOVED/EXPIRED nunca são enviados) */
export const isVisibleState = (s: number) => s === GF_STATE.ACTIVE || s === GF_STATE.REPORTED;

const envNum = (k: string, d: number) => {
  const v = typeof process !== 'undefined' ? Number(process.env?.[k]) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : d;
};

/** limites (o servidor lê overrides de ambiente para testes; o cliente usa os padrões) */
export const GF_RULES = {
  /** distância máxima (m, horizontal) do autor ao retângulo pintado */
  reachM: 3,
  /** bytes do conteúdo codificado */
  maxBytes: 4096,
  maxItems: 64,
  maxPoints: 1500,
  maxTexts: 2,
  maxTextChars: MAX_TEXT_CHARS,
  /** tamanho do retângulo (m) */
  minRectW: 0.3,
  maxRectW: 2.4,
  /** intervalo mínimo entre grafites do MESMO jogador (sessão OU id anônimo do aparelho) */
  cooldownMs: envNum('PV_GRAFFITI_COOLDOWN_MS', 20_000),
  /** grafites ativos simultâneos por jogador (id anônimo) */
  maxActivePerPlayer: envNum('PV_GRAFFITI_MAX_ACTIVE', 6),
  /** criações por hora por jogador */
  maxPerHour: envNum('PV_GRAFFITI_MAX_HOUR', 12),
  /** total no mundo; acima disso o mais antigo TEMPORÁRIO sai (permanentes nunca são despejados) */
  maxTotal: envNum('PV_GRAFFITI_MAX_TOTAL', 2000),
  /** TTL padrão dos temporários (manifestação) */
  ttlMs: envNum('PV_GRAFFITI_TTL_MS', 6 * 3600_000),
  /** denúncias distintas que ocultam automaticamente */
  reportThreshold: envNum('PV_GRAFFITI_REPORTS', 3),
  /** denúncias por jogador por minuto */
  reportsPerMinute: 10,
};
export type GraffitiRules = typeof GF_RULES;

export type DenyReason =
  | 'superficie' | 'distancia' | 'lado' | 'formato' | 'tamanho' | 'retangulo' | 'itens' | 'texto_bloqueado' | 'texto'
  | 'cooldown' | 'cota' | 'cota_hora' | 'superficie_cheia' | 'estado' | 'mundo_cheio';

/** valida o conteúdo vetorial (sem contexto de jogador): formato, tamanhos, paleta, texto */
export function validateContent(bytes: unknown, sf: GraffitiSurface, rules: GraffitiRules = GF_RULES): { ok: true; content: GraffitiContent; hasText: boolean } | { ok: false; reason: DenyReason } {
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: 'formato' };
  if (bytes.length > rules.maxBytes) return { ok: false, reason: 'tamanho' };
  const c = decodeGraffiti(bytes);
  if (!c) return { ok: false, reason: 'formato' };
  const r = c.rect;
  if (!rectInside(sf, r) || r.w < rules.minRectW || r.w > rules.maxRectW || Math.abs(r.w - r.h * 2) > 0.05) return { ok: false, reason: 'retangulo' };
  if (!c.items.length || c.items.length > rules.maxItems) return { ok: false, reason: 'itens' };
  let points = 0, texts = 0;
  for (const it of c.items) {
    if (it.color >= PALETTE.length) return { ok: false, reason: 'formato' };
    if (it.k === 'line') {
      if (it.width >= WIDTHS.length || it.pts.length < 2) return { ok: false, reason: 'formato' };
      points += it.pts.length >> 1;
      for (let i = 1; i < it.pts.length; i += 2) if (it.pts[i] >= CANVAS_H) return { ok: false, reason: 'formato' };
    } else if (it.k === 'stamp') {
      if (it.sym >= SYMBOLS.length || it.size < 8 || it.y >= CANVAS_H) return { ok: false, reason: 'formato' };
      points += 4;
    } else {
      texts++;
      if (it.size < 8 || it.y >= CANVAS_H || it.x >= CANVAS_W) return { ok: false, reason: 'formato' };
      if (Array.from(it.text).length > rules.maxTextChars) return { ok: false, reason: 'texto' };
      const v = checkText(it.text);
      if (!v.ok) return { ok: false, reason: v.reason === 'bloqueado' || v.reason === 'spam' ? 'texto_bloqueado' : 'texto' };
    }
  }
  if (points > rules.maxPoints) return { ok: false, reason: 'tamanho' };
  if (texts > rules.maxTexts) return { ok: false, reason: 'texto' };
  return { ok: true, content: c, hasText: texts > 0 };
}

/** o autor precisa estar perto da área pintada e do lado pintável */
export function validateReach(sf: GraffitiSurface, c: GraffitiContent, x: number, z: number, rules: GraffitiRules = GF_RULES): DenyReason | null {
  const d = distanceToSurface(sf, x, z, c.rect);
  if (!d.front) return 'lado';
  return d.d <= rules.reachM ? null : 'distancia';
}

// ------------------------------------------------------------------ cota e cooldown (por sessão e por id anônimo)
export interface AuthorLimits {
  /** últimos instantes de criação (janela de 1 h) */
  created: number[];
  lastAt: number;
  /** denúncias recentes (janela de 1 min) */
  reports: number[];
}
export const newAuthorLimits = (): AuthorLimits => ({ created: [], lastAt: -1e15, reports: [] });

export function checkQuota(lim: AuthorLimits, activeCount: number, now: number, rules: GraffitiRules = GF_RULES): DenyReason | null {
  if (now - lim.lastAt < rules.cooldownMs) return 'cooldown';
  if (activeCount >= rules.maxActivePerPlayer) return 'cota';
  if (lim.created.filter((t) => now - t < 3600_000).length >= rules.maxPerHour) return 'cota_hora';
  return null;
}

export function recordCreation(lim: AuthorLimits, now: number) {
  lim.lastAt = now;
  lim.created = [...lim.created.filter((t) => now - t < 3600_000), now];
}

// ------------------------------------------------------------------ moderação (máquina de estados)
export interface ModerationRec { state: number; reports: string[]; author: { clientId: string }; expiresAt: number }
export type ModEvent =
  | { k: 'report'; by: string }
  | { k: 'expire'; now: number }
  | { k: 'admin_remove' }
  | { k: 'admin_restore' }
  | { k: 'admin_hide' };

/**
 * Transições:
 *   ACTIVE ─report→ REPORTED ─(N denunciantes distintos)→ HIDDEN
 *   ACTIVE/REPORTED/HIDDEN ─expira→ EXPIRED (só temporários: expiresAt > 0)
 *   qualquer não-terminal ─admin_remove→ REMOVED · ─admin_hide→ HIDDEN · HIDDEN/REPORTED ─admin_restore→ ACTIVE
 *   REMOVED e EXPIRED são terminais. Autor não denuncia o próprio; o mesmo denunciante conta uma vez.
 * Retorna se mudou algo e o motivo de recusa (denúncia).
 */
export function moderate(rec: ModerationRec, ev: ModEvent, rules: GraffitiRules = GF_RULES): { changed: boolean; reason?: 'terminal' | 'proprio' | 'repetida' | 'oculto' } {
  const terminal = rec.state === GF_STATE.REMOVED || rec.state === GF_STATE.EXPIRED;
  if (terminal) return { changed: false, reason: 'terminal' };
  switch (ev.k) {
    case 'report': {
      if (ev.by === rec.author.clientId) return { changed: false, reason: 'proprio' };
      if (rec.state === GF_STATE.HIDDEN) return { changed: false, reason: 'oculto' };
      if (rec.reports.includes(ev.by)) return { changed: false, reason: 'repetida' };
      rec.reports.push(ev.by);
      rec.state = rec.reports.length >= Math.max(1, rules.reportThreshold) ? GF_STATE.HIDDEN : GF_STATE.REPORTED;
      return { changed: true };
    }
    case 'expire':
      if (rec.expiresAt > 0 && ev.now >= rec.expiresAt) { rec.state = GF_STATE.EXPIRED; return { changed: true }; }
      return { changed: false };
    case 'admin_remove': rec.state = GF_STATE.REMOVED; return { changed: true };
    case 'admin_hide': if (rec.state === GF_STATE.HIDDEN) return { changed: false }; rec.state = GF_STATE.HIDDEN; return { changed: true };
    case 'admin_restore':
      if (rec.state === GF_STATE.ACTIVE) return { changed: false };
      rec.state = GF_STATE.ACTIVE; rec.reports = [];
      return { changed: true };
  }
}

export function checkReportRate(lim: AuthorLimits, now: number, rules: GraffitiRules = GF_RULES): boolean {
  lim.reports = lim.reports.filter((t) => now - t < 60_000);
  if (lim.reports.length >= rules.reportsPerMinute) return false;
  lim.reports.push(now);
  return true;
}

/** expiração: permanentes (TTL 0) nunca expiram */
export const expiresAtFor = (sf: GraffitiSurface, now: number, rules: GraffitiRules = GF_RULES) => {
  if (sf.persistence === 'permanent') return 0;
  const ttl = sf.ttlMs ?? rules.ttlMs;
  return ttl > 0 ? now + ttl : 0;
};
