/**
 * AdSlots no SERVIDOR (rodada 9) — fundação, SEM venda: escolhe conteúdo INTERNO para cada telão/painel cadastrado
 * em public/gameplay/adslots.json (avisos, eventos da agenda, dicas, designs já cadastrados em rodízio igual, arte
 * neutra do jogo) e avisa os clientes só quando algum slot troca. Sem Colyseus (tests/adSlots.test.ts).
 *
 *  `ads {slots: [{id, c}], full?}` — ao entrar (full) e na troca (só os slots que mudaram); verificação a 1 Hz.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdContent, AdSlotDefinition } from '../../../src/ads/types';
import { adKey, pickAd, slotPool, validAdContent, type AdSlotsFile, type AdSources } from '../../../src/ads/content';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');

export function loadAdSlots(file = `${PUBLIC}/gameplay/adslots.json`): AdSlotsFile {
  if (!existsSync(file)) return { slots: [] };
  const j = JSON.parse(readFileSync(file, 'utf8')) as AdSlotsFile;
  const ids = new Set<string>();
  const slots = (j.slots ?? []).filter((s) => typeof s.id === 'string' && !ids.has(s.id) && ids.add(s.id) && (s.surface === 'billboard' || s.surface === 'screen') && s.rotateSeconds > 0);
  return { slots, notices: j.notices ?? [], tips: j.tips ?? [] };
}

export interface AdWire { id: string; c: AdContent | null }

export class AdSlotService {
  private current = new Map<string, string>();
  private wire = new Map<string, AdContent | null>();
  private last = 0;
  /** QA */
  stats = { changes: 0, rejected: 0 };

  constructor(readonly file: AdSlotsFile, private src: AdSources) {}

  get slots(): readonly AdSlotDefinition[] { return this.file.slots; }

  /** recalcula (≤ 1 Hz); devolve só os slots que trocaram (vazio = nada a enviar) */
  update(now = Date.now(), force = false): AdWire[] {
    if (!force && now - this.last < 1000) return [];
    this.last = now;
    const out: AdWire[] = [];
    this.file.slots.forEach((s, i) => {
      let c = pickAd(slotPool(s, this.file, this.src, now), s, i, now);
      if (c && !validAdContent(c)) { this.stats.rejected++; c = null; } // defesa: nunca sai conteúdo fora da regra
      const k = adKey(c);
      if (this.current.get(s.id) === k) return;
      this.current.set(s.id, k);
      this.wire.set(s.id, c);
      out.push({ id: s.id, c });
      this.stats.changes++;
    });
    return out;
  }

  /** tudo (quem acabou de entrar) */
  snapshot(): AdWire[] { return this.file.slots.map((s) => ({ id: s.id, c: this.wire.get(s.id) ?? null })); }
}
