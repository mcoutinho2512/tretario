/** Rodada 7 — vida social da multidão de NPCs: determinismo, neutralidade, sem sincronia artificial. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SocialSchedule, pickProfile, pickAction, type SocialCrowdConfig } from '../src/social/crowdSocial';
import { DESIGN_BY_ID, registerCampaigns } from '../src/social/designs';
import { PROP_BY_ID } from '../src/social/props';
import { ACTION_BY_ID } from '../src/social/actions';

registerCampaigns(JSON.parse(readFileSync('public/designs/campaigns.json', 'utf8')));
const manif = JSON.parse(readFileSync('public/events/manifestacao.json', 'utf8')).social as SocialCrowdConfig;

describe('perfil social (item + design)', () => {
  it('determinístico pela semente', () => {
    expect(pickProfile(1234, manif)).toEqual(pickProfile(1234, manif));
  });
  it('parcela com item ≈ propShare do evento; design sempre compatível com o item', () => {
    let withProp = 0;
    for (let s = 0; s < 4000; s++) {
      const p = pickProfile(s * 2654435761, manif);
      if (!p.prop) continue;
      withProp++;
      const def = PROP_BY_ID.get(p.prop)!;
      expect(def.kind).not.toBe('bat'); // taco nunca na multidão do ato
      if (def.designSlot) expect(DESIGN_BY_ID.get(p.design)!.targets).toContain(def.designSlot);
    }
    expect(withProp / 4000).toBeGreaterThan(manif.propShare * 0.85);
    expect(withProp / 4000).toBeLessThan(manif.propShare * 1.15);
  });
  it('NEUTRO: campanhas configuradas aparecem com a mesma frequência (±15 %)', () => {
    const count = new Map<string, number>();
    for (let s = 0; s < 30000; s++) {
      const p = pickProfile(s * 2654435761, manif);
      const d = DESIGN_BY_ID.get(p.design);
      if (d?.family === 'campaign') count.set(d.key, (count.get(d.key) ?? 0) + 1);
    }
    const v = [...count.values()];
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...v) / Math.max(...v)).toBeGreaterThan(0.85);
  });
});

describe('ações dos NPCs', () => {
  it('andando: só ações que permitem movimento; sem item: nada que exija item', () => {
    for (let i = 0; i < 500; i++) {
      const a = pickAction(i / 500, 0, true, manif, null);
      if (!a) continue;
      expect(a.allowMove).toBe(true);
      expect(a.needs).toBeUndefined();
    }
  });
  it('perto do trio: mais dança e braços para cima do que longe', () => {
    const trio = { id: 't', kind: 'trio' as const, x: 0, z: 0, inner: 6, radius: 25, strength: 1 };
    const danceShare = (rally: typeof trio | null) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) { const a = pickAction((i + 0.5) / 2000, 0, false, manif, rally); if (a?.category === 'danca') n++; }
      return n / 2000;
    };
    expect(danceShare(trio)).toBeGreaterThan(danceShare(null) * 1.5);
  });
  it('sem sincronia artificial: 40 NPCs não começam a mesma ação no mesmo instante', () => {
    const scheds = Array.from({ length: 40 }, (_, i) => new SocialSchedule(1000 + i * 7919, manif));
    const starts = new Map<string, number>();
    for (let t = 0; t < 120; t += 1 / 30) {
      for (const s of scheds) {
        if (s.update(t, false, null) && s.act) {
          const k = `${s.act}@${t.toFixed(3)}`;
          starts.set(k, (starts.get(k) ?? 0) + 1);
        }
      }
    }
    expect(Math.max(...starts.values())).toBeLessThanOrEqual(3);
    // e há atividade de fato (não ficam todos parados)
    expect(starts.size).toBeGreaterThan(80);
  });
  it('ação que não permite movimento termina quando o NPC volta a andar', () => {
    const s = new SocialSchedule(7, { ...manif, activity: 1, actionWeights: { dance_simple: 100 } });
    let t = 0;
    while (!s.act && t < 60) { s.update(t, false, null); t += 0.1; }
    expect(ACTION_BY_ID.get(s.act)?.allowMove).toBe(false);
    expect(s.update(t + 0.1, true, null)).toBe(true);
    expect(s.act).toBe(0);
  });
});
