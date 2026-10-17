/**
 * Rodada 9 — AdSlots (fundação, sem venda): rodízio por rotateSeconds, só conteúdo INTERNO, URL externa recusada,
 * designs cadastrados em rodízio igual, slots ligados a superfícies reais, conversão para telão/painel no cliente.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AdSlotService, loadAdSlots } from '../server/src/ads/AdSlotService';
import { internalAssetPath, pickAd, slotPool, validAdContent, type AdSlotsFile } from '../src/ads/content';
import { adToBillboard, adToSlide, AdSlotClient } from '../src/ads/AdSlotClient';
import type { AdSlotDefinition } from '../src/ads/types';
import type { AgendaEntry } from '../src/events/schedule';

const slot = (o: Partial<AdSlotDefinition> = {}): AdSlotDefinition => ({ id: 'S1', surface: 'screen', target: 'screen0', zone: 'CENTRO', formats: ['SYSTEM', 'EVENT', 'CAMPAIGN', 'IMAGE', 'VIDEO'], rotateSeconds: 10, ...o });
const entry = (o: Partial<AgendaEntry> = {}): AgendaEntry => ({ id: 'd', inst: 'd@0', format: 'debate', name: 'Debate no palco', zone: 'RIO_BRANCO', state: 'ACTIVE', startsAt: 0, endsAt: 60_000, count: 2, capacity: 20, ...o });
const FILE: AdSlotsFile = { slots: [slot()], notices: [{ text: 'AVISO UM' }], tips: [{ text: 'DICA', sub: 'sub' }] };

describe('AdSlots — conteúdo interno', () => {
  it('URL externa (http, //, data:, javascript:) recusada; arte do próprio jogo aceita', () => {
    for (const u of ['https://exemplo.com/a.png', 'http://x/y.png', '//cdn.exemplo.com/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '/designs/../../etc.png', 'designs/a.gif'])
      expect(validAdContent({ kind: 'IMAGE', url: u })).toBe(false);
    expect(internalAssetPath('/designs/ato.png')).toBe(true);
    expect(validAdContent({ kind: 'IMAGE', url: 'ui/logo_jogo.webp' })).toBe(true);
    expect(validAdContent({ kind: 'VIDEO', url: '/v.mp4' })).toBe(false); // vídeo: nunca nesta rodada
    expect(validAdContent({ kind: 'SYSTEM', text: '<script>' })).toBe(false);
    expect(adToBillboard({ kind: 'IMAGE', url: 'https://exemplo.com/a.png' } as never)).toBeNull();
  });

  it('pool só com formatos internos (SYSTEM, EVENT da agenda, CAMPAIGN) — nada de IMAGE/VIDEO servido', () => {
    const pool = slotPool(slot(), FILE, { agenda: () => [entry(), entry({ inst: 'x@1', state: 'FINISHED' })], designs: () => ['ato_pv', 'campanha_a', 'campanha_b'] }, 0);
    expect(pool.map((c) => c.kind)).toEqual(['EVENT', 'SYSTEM', 'EVENT', 'SYSTEM', 'EVENT', 'CAMPAIGN', 'EVENT', 'CAMPAIGN', 'EVENT', 'CAMPAIGN']); // evento intercalado
    expect(pool.every((c) => c.kind !== 'IMAGE')).toBe(true);
    expect(pool[0]).toMatchObject({ kind: 'EVENT', inst: 'd@0', name: 'Debate no palco', state: 'ACTIVE' }); // encerrado não entra
    // cada design cadastrado aparece o mesmo número de vezes (rodízio igual)
    const counts = new Map<string, number>();
    for (const c of pool) if (c.kind === 'CAMPAIGN') counts.set(c.designKey, (counts.get(c.designKey) ?? 0) + 1);
    expect(new Set(counts.values())).toEqual(new Set([1]));
  });

  it('rodízio por rotateSeconds, deslocado por slot; serviço só avisa o que mudou', () => {
    const s = slot({ rotateSeconds: 10 });
    const pool = slotPool(s, FILE, { agenda: () => [], designs: () => ['a', 'b'] }, 0);
    expect(pickAd(pool, s, 0, 0)).toEqual(pool[0]);
    expect(pickAd(pool, s, 0, 9_999)).toEqual(pool[0]);
    expect(pickAd(pool, s, 0, 10_000)).toEqual(pool[1]);
    expect(pickAd(pool, s, 1, 0)).toEqual(pool[1]);
    const svc = new AdSlotService({ ...FILE, slots: [s, slot({ id: 'S2', target: 'screen1' })] }, { agenda: () => [], designs: () => ['a', 'b'] });
    expect(svc.update(0, true)).toHaveLength(2);
    expect(svc.update(5_000)).toHaveLength(0);
    expect(svc.update(10_000).map((w) => w.id)).toEqual(['S1', 'S2']);
    expect(svc.snapshot()).toHaveLength(2);
  });

  it('adslots.json: slots ligados a superfícies REAIS (telões do manifest, trio, painéis de LED) e nomes pedidos', () => {
    const f = loadAdSlots();
    const m = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as { eventSpots: { id: string }[]; billboards: { id: string }[]; vehicleSpawns: { id: string }[] };
    const ids = new Set([...m.eventSpots.map((s) => s.id), ...m.billboards.map((b) => b.id), ...m.vehicleSpawns.map((v) => v.id)]);
    for (const s of f.slots) expect(ids.has(s.target), `${s.id} → ${s.target}`).toBe(true);
    for (const id of ['CENTRAL_SCREEN_01', 'CANDELARIA_SCREEN_01', 'TRIO_SIDE_01', 'STAGE_SCREEN_01']) expect(f.slots.some((s) => s.id === id)).toBe(true);
    expect(f.slots.filter((s) => s.surface === 'billboard').length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(f)).not.toMatch(/https?:|\/\//);
  });

  it('cliente: telão vira slide (system/event/design); painel vira texto; conteúdo inválido limpa a superfície', () => {
    expect(adToSlide({ kind: 'SYSTEM', text: 'OI', sub: 'x' })).toEqual({ type: 'system', text: 'OI', sub: 'x' });
    expect(adToSlide({ kind: 'CAMPAIGN', designKey: 'ato_pv' })).toEqual({ type: 'design', design: 'ato_pv' });
    expect(adToSlide({ kind: 'EVENT', inst: 'd@0', name: 'Debate', format: 'debate', state: 'ACTIVE', startsAt: 0 })).toMatchObject({ type: 'event', name: 'Debate', state: 'ACTIVE' });
    expect(adToBillboard({ kind: 'EVENT', inst: 'd@0', name: 'Debate no palco', state: 'ACTIVE', zone: 'RIO_BRANCO' }, () => 'Av. Rio Branco')).toMatchObject({ type: 'text', text: 'DEBATE NO PALCO', subtext: 'ACONTECENDO AGORA · Av. Rio Branco' });
    const got: [string, unknown][] = [];
    const cl = new AdSlotClient([slot(), slot({ id: 'B1', surface: 'billboard', target: 'bb_1' })], { billboard: (id, c) => got.push([id, c]), screen: (t, s) => { got.push([t, s]); return true; } });
    cl.apply({ slots: [{ id: 'S1', c: { kind: 'SYSTEM', text: 'AVISO' } }, { id: 'B1', c: { kind: 'IMAGE', url: 'https://x/y.png' } as never }, { id: 'NAO', c: { kind: 'SYSTEM', text: 'x' } }] });
    expect(got).toEqual([['screen0', { type: 'system', text: 'AVISO', sub: undefined }], ['bb_1', null]]);
    expect(cl.stats.rejected).toBe(1);
  });
});
