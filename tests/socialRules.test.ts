/** Rodada 7 — ações sociais e itens: registro coerente e regras do servidor (puras). */
import { describe, it, expect } from 'vitest';
import { ACTIONS, ACTION_BY_KEY, ACTION_CATEGORIES } from '../src/social/actions';
import { PROPS, PROP_BY_KIND } from '../src/social/props';
import { readFileSync } from 'node:fs';
import { DESIGNS, DESIGN_BY_KEY, campaignDesign, designsFor, registerCampaigns } from '../src/social/designs';

// campanhas são DADOS (o código não conhece candidaturas)
const CAMPAIGNS = JSON.parse(readFileSync('public/designs/campaigns.json', 'utf8'));
registerCampaigns(CAMPAIGNS);
import { ACTION_RULES, applyAction, applyProp, cancelsOnMove, onceFinished, validateAction, validateProp, type ActionActor } from '../src/social/actionRules';
import { RallyRegistry } from '../src/social/rally';

const actor = (o: Partial<ActionActor> = {}): ActionActor => ({ act: 0, actAt: 0, prop: 0, design: 0, status: 0, vehicle: '', recent: [], ...o });

describe('registros', () => {
  it('ids únicos e estáveis (u8 ações/itens, u16 designs)', () => {
    for (const list of [ACTIONS, PROPS, DESIGNS] as readonly (readonly { id: number }[])[]) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
      expect(list.every((x) => x.id > 0)).toBe(true);
    }
    expect(ACTIONS.every((a) => a.id < 256) && PROPS.every((p) => p.id < 256) && DESIGNS.every((d) => d.id < 65536)).toBe(true);
  });
  it('≥ 10 gestos/ações e ≥ 4 danças, todas as categorias da roda', () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(20);
    expect(ACTIONS.filter((a) => a.category === 'danca').length).toBeGreaterThanOrEqual(4);
    for (const c of ACTION_CATEGORIES.filter((c) => c.key !== 'itens')) expect(ACTIONS.some((a) => a.category === c.key)).toBe(true);
  });
  it('ações com item só pedem itens existentes; nenhuma ação usa o taco (só visual)', () => {
    for (const a of ACTIONS) for (const k of a.needs ?? []) expect(PROP_BY_KIND.has(k)).toBe(true);
    expect(ACTIONS.some((a) => a.needs?.includes('bat'))).toBe(false);
  });
  it('campanhas são configuração: 13 e 22 viram designs sem geometria nova, com marca de simulação', () => {
    expect(CAMPAIGNS.length).toBeGreaterThanOrEqual(2);
    expect(registerCampaigns(CAMPAIGNS)).toBe(0); // ids repetidos não entram de novo
    for (const k of ['campanha_13', 'campanha_22']) {
      const d = DESIGN_BY_KEY.get(k)!;
      expect(d.family).toBe('campaign');
      expect(d.simulationTag).toBe(true);
      expect(d.targets).toEqual(expect.arrayContaining(['flag', 'sign', 'banner', 'truck', 'screen', 'stage']));
    }
    // qualquer outra candidatura entra do mesmo jeito
    const x = campaignDesign({ id: 999, key: 'x', name: 'FULANA', number: '77', party: 'ABC', palette: { bg: '#000', fg: '#fff' } });
    expect(x.lines).toEqual(['FULANA']);
    expect(x.simulationTag).toBe(true);
  });
  it('camisas de futebol: só cores/padrões (sem texto/escudo)', () => {
    const shirts = designsFor('shirt').filter((d) => d.family === 'football');
    expect(shirts.length).toBeGreaterThanOrEqual(4);
    for (const s of shirts) expect(s.lines ?? []).toEqual([]);
  });
});

describe('regras de ação (servidor)', () => {
  it('ação válida aplica; desconhecida, caído ou em veículo são negadas', () => {
    const a = actor();
    expect(validateAction(a, ACTION_BY_KEY.get('wave')!.id, 1000)).toEqual({ ok: true });
    expect(validateAction(a, 250, 1000)).toEqual({ ok: false, reason: 'acao_invalida' });
    expect(validateAction(actor({ status: 1 }), 1, 1000)).toEqual({ ok: false, reason: 'caido' });
    expect(validateAction(actor({ vehicle: 'car0' }), 1, 1000)).toEqual({ ok: false, reason: 'em_veiculo' });
    expect(validateAction(actor({ vehicle: 'trio0', onPlatform: true }), 1, 1000)).toEqual({ ok: true });
  });
  it('bandeira exige bandeira na mão; trocar de item encerra a ação dependente', () => {
    const a = actor();
    const flagWave = ACTION_BY_KEY.get('flag_wave')!.id;
    expect(validateAction(a, flagWave, 1000)).toEqual({ ok: false, reason: 'sem_item' });
    applyProp(a, PROP_BY_KIND.get('flag_small')!.id, DESIGN_BY_KEY.get('brasil')!.id, 1000);
    expect(validateAction(a, flagWave, 2000)).toEqual({ ok: true });
    applyAction(a, flagWave, 2000);
    applyProp(a, PROP_BY_KIND.get('megaphone')!.id, 0, 3000);
    expect(a.act).toBe(0);
  });
  it('design incompatível com o item é negado', () => {
    const a = actor();
    const shirtOnly = DESIGN_BY_KEY.get('fut_preta_lisa')!.id;
    expect(validateProp(a, PROP_BY_KIND.get('sign_small')!.id, shirtOnly, 0)).toEqual({ ok: false, reason: 'design_incompativel' });
  });
  it('anti-spam: cooldown e limite por janela', () => {
    const a = actor();
    applyAction(a, 1, 0);
    expect(validateAction(a, 1, 100)).toEqual({ ok: false, reason: 'rapido' });
    let t = 0;
    for (let i = 0; i < ACTION_RULES.rateMax; i++) { t += 300; applyAction(a, 2, t); }
    expect(validateAction(a, 1, t + 300)).toEqual({ ok: false, reason: 'spam' });
  });
  it('andar cancela dança, não cancela andar com bandeira; ação "once" expira', () => {
    expect(cancelsOnMove(ACTION_BY_KEY.get('dance_simple')!.id, 0.5)).toBe(true);
    expect(cancelsOnMove(ACTION_BY_KEY.get('flag_wave')!.id, 0.5)).toBe(false);
    expect(cancelsOnMove(ACTION_BY_KEY.get('dance_simple')!.id, 0.05)).toBe(false);
    const wave = ACTION_BY_KEY.get('wave')!;
    expect(onceFinished({ act: wave.id, actAt: 0 }, wave.duration! * 1000 + 1)).toBe(true);
    expect(onceFinished({ act: wave.id, actAt: 0 }, 100)).toBe(false);
  });
});

describe('pontos de concentração', () => {
  it('distribuição orgânica no anel (sem ninguém dentro do veículo) e atração por distância', () => {
    const r = new RallyRegistry();
    r.upsert({ id: 't', kind: 'trio', x: 0, z: 0, inner: 6, radius: 25, strength: 1 });
    for (let i = 0; i < 200; i++) {
      const s = RallyRegistry.spotFor(r.get('t')!, (i * 0.618) % 1, (i * 0.377) % 1);
      const d = Math.hypot(s.x, s.z);
      expect(d).toBeGreaterThanOrEqual(6 - 1e-9);
      expect(d).toBeLessThanOrEqual(25 + 1e-9);
    }
    expect(r.nearestActive(30, 0)?.id).toBe('t');
    expect(r.nearestActive(500, 0)).toBeNull();
  });
});
