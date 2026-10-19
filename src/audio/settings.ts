/**
 * Rodada 10 — volumes do áudio (Ajustes → Som). Guardados no navegador em `pv3d.audio` (try/catch: sem storage o
 * jogo segue com o padrão). Dado inválido é ignorado campo a campo. Puro o bastante para teste (storage injetável).
 */

export type VolumeKey = 'master' | 'ambient' | 'crowd' | 'vehicles' | 'events' | 'sfx' | 'ui';
export interface AudioSettings extends Record<VolumeKey, number> { muted: boolean }

export const AUDIO_SETTINGS_KEY = 'pv3d.audio';
export const VOLUME_KEYS: VolumeKey[] = ['master', 'ambient', 'crowd', 'vehicles', 'events', 'sfx', 'ui'];
export const DEFAULT_AUDIO: AudioSettings = { master: 0.8, ambient: 0.7, crowd: 0.8, vehicles: 0.8, events: 0.75, sfx: 0.9, ui: 0.6, muted: false };

export function mergeAudio(base: AudioSettings, raw: unknown): AudioSettings {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const k of VOLUME_KEYS) { const v = r[k]; if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v)); }
  if (typeof r.muted === 'boolean') out.muted = r.muted;
  return out;
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
const browserStorage = (): KV | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

type Listener = (s: AudioSettings) => void;

export class AudioSettingsStore {
  private s: AudioSettings;
  private listeners = new Set<Listener>();
  constructor(private storage: KV | null = browserStorage()) {
    let saved: unknown = null;
    try { saved = JSON.parse(this.storage?.getItem(AUDIO_SETTINGS_KEY) ?? 'null'); } catch { /* corrompido/sem storage */ }
    this.s = mergeAudio(DEFAULT_AUDIO, saved);
  }
  get value(): Readonly<AudioSettings> { return this.s; }
  onChange(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  set(patch: Partial<AudioSettings>) {
    const next = mergeAudio(this.s, patch);
    if (VOLUME_KEYS.every((k) => next[k] === this.s[k]) && next.muted === this.s.muted) return;
    this.s = next;
    try { this.storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(next)); } catch { /* cheio/bloqueado: só nesta sessão */ }
    for (const fn of this.listeners) fn(next);
  }
  /** ganho final de uma categoria (o master entra no nó master; aqui só o da categoria) */
  bus(k: Exclude<VolumeKey, 'master'>) { return this.s[k]; }
  /** ganho do master (silenciar zera) */
  get masterGain() { return this.s.muted ? 0 : this.s.master; }
}

/** instância do jogo (painel de Ajustes e AudioManager leem a mesma) */
export const audioSettings = new AudioSettingsStore();
