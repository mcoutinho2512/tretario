import { describe, it, expect } from 'vitest';
import { assignTiers, createAgent, CROWD_BUDGETS, animEveryFor, type CrowdAgent } from '../src/characters/crowd/crowdBudget';

const ring = (n: number, step = 1): CrowdAgent[] =>
  Array.from({ length: n }, (_, i) => Object.assign(createAgent(), { dist: 1 + i * step, inView: true }));

describe('orçamento de humanos (crowdBudget)', () => {
  it('os mais próximos ganham esqueleto, até o limite do preset; o resto é instanciado; além do teto, nada', () => {
    const b = CROWD_BUDGETS.high;
    const a = ring(700, 0.1); // 700 agentes de 1 a 71 m
    const st = assignTiers([...a].reverse(), b); // ordem de entrada não importa
    expect(st.skinned).toBe(b.skinned);
    expect(st.instanced).toBe(b.total - b.skinned);
    expect(st.hidden).toBe(700 - b.total);
    expect(a.slice(0, b.skinned).every((x) => x.tier === 2)).toBe(true);
    expect(a[b.skinned].tier).toBe(1);
    expect(a.slice(b.total).every((x) => x.tier === 0)).toBe(true);
    // LOD0 limitado
    expect(st.lod[0]).toBe(b.lod0);
  });

  it('LOW nunca usa LOD mais detalhado que LOD2 e os instanciados usam só LOD3', () => {
    const a = ring(50, 0.5);
    assignTiers(a, CROWD_BUDGETS.low);
    expect(a.filter((x) => x.tier === 2).every((x) => x.lod >= 2)).toBe(true);
    expect(a.filter((x) => x.tier === 1).every((x) => x.lod === 3)).toBe(true);
  });

  it('esqueleto só até skinnedMaxDist; multidão distante da rede (maxTier 1) nunca ganha esqueleto', () => {
    const b = CROWD_BUDGETS.high;
    const a = ring(10, 0);
    a.forEach((x, i) => { x.dist = i < 5 ? 3 : b.skinnedMaxDist + 5; });
    a[0].maxTier = 1;
    assignTiers(a, b);
    expect(a[0].tier).toBe(1);
    expect(a.slice(1, 5).every((x) => x.tier === 2)).toBe(true);
    expect(a.slice(5).every((x) => x.tier === 1)).toBe(true);
  });

  it('histerese: quem já tem esqueleto não perde para um recém-chegado só um pouco mais perto', () => {
    const b = { ...CROWD_BUDGETS.high, skinned: 1 };
    const old = Object.assign(createAgent(), { dist: 10, inView: true, tier: 2 as const });
    const novo = Object.assign(createAgent(), { dist: 9.5, inView: true });
    assignTiers([novo, old], b);
    expect(old.tier).toBe(2);
    expect(novo.tier).toBe(1);
    novo.dist = 5; // bem mais perto: troca
    assignTiers([novo, old], b);
    expect(novo.tier).toBe(2);
  });

  it('fora da vista perde a disputa (exceto colado na câmera) e prioridade (caído/veículo) ganha', () => {
    const b = { ...CROWD_BUDGETS.high, skinned: 2 };
    const behind = Object.assign(createAgent(), { dist: 8, inView: false });
    const glued = Object.assign(createAgent(), { dist: 2, inView: false });
    const front = Object.assign(createAgent(), { dist: 15, inView: true });
    const down = Object.assign(createAgent(), { dist: 25, inView: true, priority: 0.5 });
    assignTiers([behind, glued, front, down], b);
    expect(glued.tier).toBe(2);
    expect(behind.tier).toBe(1);
    expect(front.tier === 2 || down.tier === 2).toBe(true);
    const c = { ...CROWD_BUDGETS.high, skinned: 1 };
    front.tier = 1; down.tier = 1;
    assignTiers([front, down], c);
    expect(down.tier).toBe(2); // 25 × 0,5 < 15
  });

  it('animação: perto todo quadro, longe a cada 4', () => {
    expect(animEveryFor(5)).toBe(1);
    expect(animEveryFor(20)).toBe(2);
    expect(animEveryFor(40)).toBe(3);
    expect(animEveryFor(80)).toBe(4);
  });
});
