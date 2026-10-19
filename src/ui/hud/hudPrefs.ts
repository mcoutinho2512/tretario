/**
 * Preferências do HUD (rodada 8): nomes dos jogadores, auto-ocultar, chat recolhido, som (legado; volumes em src/audio/settings.ts).
 * Guardadas no navegador; com sessão, os campos do perfil (`PlayerPreferences`: names/chatCollapsed/quality/reduceEffects) também
 * vão para PUT /api/me/preferences (sem sessão ou rota ausente: só local, em silêncio).
 */
import { API, type PlayerPreferences } from '../../identity/types';
import type { NamesMode } from '../../net/nameLod';

export interface HudPrefs {
  names: NamesMode;
  hudAutoHide: boolean;
  chatCollapsed: boolean;
  /** legado (rodada 8, sem efeito): o áudio da rodada 10 usa os volumes de src/audio/settings.ts (`pv3d.audio`) */
  sound: boolean;
  /** rodada 9 — acessibilidade: efeitos de tela fortes (desorientação) viram só ícone + tom leve */
  reduceEffects: boolean;
}

export const DEFAULT_HUD_PREFS: HudPrefs = { names: 'PROXIMOS', hudAutoHide: true, chatCollapsed: true, sound: true, reduceEffects: false };
const KEY = 'pv3d.hud';
const NAMES: NamesMode[] = ['TODOS', 'PROXIMOS', 'NENHUM'];

/** valida/mescla um objeto qualquer sobre as preferências (dado inválido é ignorado campo a campo) */
export function mergePrefs(base: HudPrefs, raw: unknown): HudPrefs {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (NAMES.includes(r.names as NamesMode)) out.names = r.names as NamesMode;
  for (const k of ['hudAutoHide', 'chatCollapsed', 'sound', 'reduceEffects'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  return out;
}

type Listener = (p: HudPrefs) => void;

export class HudPrefsStore {
  private p: HudPrefs;
  private listeners = new Set<Listener>();
  private pushTimer = 0;
  /** com sessão (descoberto em GET /api/me): sincroniza com o perfil */
  authenticated = false;

  constructor() {
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* sem storage */ }
    this.p = mergePrefs(DEFAULT_HUD_PREFS, saved);
  }

  get value(): Readonly<HudPrefs> { return this.p; }

  onChange(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  set(patch: Partial<HudPrefs>) {
    const next = mergePrefs(this.p, patch);
    if (JSON.stringify(next) === JSON.stringify(this.p)) return;
    this.p = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem storage */ }
    for (const fn of this.listeners) fn(next);
    this.schedulePush();
  }

  /** preferências do perfil (GET /api/me) — o servidor vence o local */
  applyServer(p: PlayerPreferences | undefined) {
    if (!p) return;
    const next = mergePrefs(this.p, p);
    if (JSON.stringify(next) === JSON.stringify(this.p)) return;
    this.p = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem storage */ }
    for (const fn of this.listeners) fn(next);
  }

  /** descobre a sessão e puxa as preferências do perfil (falha = só local) */
  async syncFromServer() {
    try {
      const r = await fetch(API.me, { credentials: 'same-origin' });
      if (!r.ok) return;
      const me = (await r.json()) as { authenticated?: boolean; preferences?: PlayerPreferences };
      this.authenticated = !!me.authenticated;
      if (this.authenticated) this.applyServer(me.preferences);
    } catch { /* sem API */ }
  }

  private schedulePush() {
    if (!this.authenticated) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => {
      const body: PlayerPreferences = { names: this.p.names, chatCollapsed: this.p.chatCollapsed, reduceEffects: this.p.reduceEffects };
      void fetch(API.preferences, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => { /* só local */ });
    }, 800);
  }
}
