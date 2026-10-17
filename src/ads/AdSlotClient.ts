/**
 * AdSlots no CLIENTE (rodada 9): recebe `ads {slots:[{id, c}]}` do servidor e desenha pelos caminhos que JÁ existem —
 * telões pelo canal de slides (src/events/screenFeed.ts, slides 'system'/'event'/'design') e painéis de LED pela
 * textura de texto (src/events/Billboards.ts setPanelContent). Revalida o conteúdo (src/ads/content.ts): nada externo,
 * nenhum vídeo. Só na mudança (servidor ≤ 1 Hz) — nada por quadro.
 */
import type { AdContent, AdSlotDefinition } from './types';
import type { BillboardContent } from '../events/types';
import type { ScreenSlide } from '../events/screenFeed';
import { internalAssetPath, validAdContent } from './content';
import { STATE_LABEL, entryTitle } from '../events/agendaFormat';

export interface AdTargets {
  billboard(id: string, c: BillboardContent | null): void;
  /** false = telão inexistente neste cliente */
  screen(target: string, s: ScreenSlide | null): boolean;
}

/** painel de LED: texto estático (o painel não redesenha a cada segundo — a contagem fica para os telões) */
export function adToBillboard(c: AdContent | null, zoneName?: (id: string) => string | undefined): BillboardContent | null {
  if (!c || !validAdContent(c)) return null;
  switch (c.kind) {
    case 'SYSTEM': return { type: 'text', text: c.text, subtext: c.sub, colors: ['#0d1b2a', '#ffcc33'] };
    case 'EVENT': {
      const when = c.state === 'ACTIVE' ? 'ACONTECENDO AGORA' : c.startsAt ? `${c.state ? STATE_LABEL[c.state].toUpperCase() : 'AGENDA'} · ${new Date(c.startsAt).toTimeString().slice(0, 5)}` : 'AGENDA DA AVENIDA';
      return { type: 'text', text: entryTitle({ name: c.name ?? '', format: c.format ?? 'evento' }), subtext: [when, c.zone ? zoneName?.(c.zone) : ''].filter(Boolean).join(' · '), colors: c.state === 'ACTIVE' ? ['#0f3d2e', '#9cf5b8'] : ['#0b2545', '#8fd8ff'] };
    }
    case 'IMAGE': return internalAssetPath(c.url) ? { type: 'image', url: c.url } : null;
    case 'CAMPAIGN': return null; // painel de fachada: só texto nesta rodada
  }
}

/** telão: slide do canal */
export function adToSlide(c: AdContent | null): ScreenSlide | null {
  if (!c || !validAdContent(c)) return null;
  switch (c.kind) {
    case 'SYSTEM': return { type: 'system', text: c.text, sub: c.sub };
    case 'EVENT': return { type: 'event', inst: c.inst, name: c.name ?? '', format: c.format ?? 'evento', zone: c.zone, state: c.state ?? 'SCHEDULED', startsAt: c.startsAt ?? 0, count: c.count, capacity: c.capacity };
    case 'CAMPAIGN': return { type: 'design', design: c.designKey };
    case 'IMAGE': return null; // telão não carrega imagem nesta rodada
  }
}

export class AdSlotClient {
  private byId = new Map<string, AdSlotDefinition>();
  readonly current = new Map<string, AdContent | null>();
  stats = { applied: 0, rejected: 0 };

  constructor(defs: AdSlotDefinition[], private targets: AdTargets, private zoneName?: (id: string) => string | undefined) {
    for (const d of defs) this.byId.set(d.id, d);
  }

  attach(net: { on(type: string, fn: (m: any) => void): void }) { net.on('ads', (m: { slots?: { id: string; c: AdContent | null }[] }) => this.apply(m)); }

  apply(m: { slots?: { id: string; c: AdContent | null }[] } | null | undefined) {
    for (const s of m?.slots ?? []) {
      const d = this.byId.get(s?.id);
      if (!d) continue;
      const c = s.c && validAdContent(s.c) ? s.c : null;
      if (s.c && !c) this.stats.rejected++;
      this.current.set(d.id, c);
      if (d.surface === 'billboard') this.targets.billboard(d.target, adToBillboard(c, this.zoneName));
      else this.targets.screen(d.target, adToSlide(c));
      this.stats.applied++;
    }
  }
}
