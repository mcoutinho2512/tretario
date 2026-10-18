/**
 * Golpe em NPC de ambiente (src/combat/npcHits.ts, só cliente): escolha pura dos alvos pela MESMA definição do golpe
 * (alcance + folga, arco + folga, maxTargets, teto), reação por ação e linha do tempo (cai ~3,4 s e levanta).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CombatTable, parseCombatData } from '../src/combat/data';
import { NPC_HIT, hitNpcs, npcReactionFor, selectNpcTargets, startNpcReaction, stepNpcReaction, type NpcTarget } from '../src/combat/npcHits';

const T = new CombatTable(parseCombatData(JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8'))));
const slack = T.tuning;
const def = (k: string) => T.byKey.get(k)!;
const O = { x: 0, z: 0, h: 0 }; // olhando para +z

describe('NPC: escolha dos alvos (pura)', () => {
  it('soco: só à frente, dentro de alcance + folga; o mais perto primeiro; 1 alvo', () => {
    const soco = def('soco'), reach = soco.range + slack.rangeSlackM;
    const c = [{ x: 0, z: reach + 0.1 }, { x: 0, z: -1 }, { x: 0, z: 1.2 }, { x: 0.1, z: 0.8 }, { x: 1.2, z: 0.1 }];
    expect(selectNpcTargets(O, soco, slack, c)).toEqual([3]);
  });
  it('arco + folga decide o lado', () => {
    const soco = def('soco'), half = ((soco.arcDeg / 2 + slack.arcSlackDeg) * Math.PI) / 180;
    const at = (a: number) => ({ x: Math.sin(a), z: Math.cos(a) });
    expect(selectNpcTargets(O, soco, slack, [at(half - 0.05)])).toEqual([0]);
    expect(selectNpcTargets(O, soco, slack, [at(half + 0.05)])).toEqual([]);
  });
  it('spray atinge vários (maxTargets) e o teto limita', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ x: (i - 4) * 0.1, z: 1 + i * 0.1 }));
    const n = selectNpcTargets(O, def('spray'), slack, many).length;
    expect(n).toBe(Math.min(NPC_HIT.maxTargets, def('spray').maxTargets ?? 1));
    expect(selectNpcTargets(O, { ...def('spray'), maxTargets: 50 }, slack, many).length).toBe(NPC_HIT.maxTargets);
  });
  it('hitNpcs junta os sistemas, aplica a reação com a direção do golpe; nada perto = 0', () => {
    const got: { k: string; dx: number; dz: number; kb: number }[] = [];
    const sys = (pts: { x: number; z: number }[]) => ({ npcTargetsNear: (_x: number, _z: number, _r: number, out: NpcTarget[]) => { for (const p of pts) out.push({ ...p, react: (k, dx, dz, kb) => got.push({ k, dx, dz, kb }) }); } });
    expect(hitNpcs([sys([{ x: 0, z: 5 }]), null], O, def('soco'), slack)).toBe(0);
    expect(hitNpcs([sys([{ x: 0, z: 1.4 }]), sys([{ x: 0, z: 1 }])], O, def('chute'), slack)).toBe(1);
    expect(got).toEqual([{ k: 'down', dx: 0, dz: 1, kb: def('chute').impact.knockback }]); // rodada 9.1: chute derruba
  });
});

describe('NPC: reação', () => {
  it('por ação: soco cambaleia; chute, chute final, empurrão, taco, barra derrubam; spray = mãos nos olhos', () => {
    expect(npcReactionFor(def('soco'))).toBe('stagger');
    for (const k of ['chute', 'chute_final', 'empurrao', 'golpe_taco', 'golpe_barra']) expect(npcReactionFor(def(k))).toBe('down');
    expect(npcReactionFor(def('spray'))).toBe('flinch');
  });
  it('queda: deita (π/2) por ~3,2 s, levanta e acaba; recuo total = empurrão', () => {
    const r = startNpcReaction('down', 0, 1, 1.6);
    let moved = 0, lying = 0, last = { tilt: 0, step: 0, done: false };
    for (let t = 0; t < 10 && !last.done; t += 0.05) { last = stepNpcReaction(r, 0.05); moved += last.step; if (last.tilt >= Math.PI / 2 - 1e-6) lying += 0.05; }
    expect(last.done).toBe(true);
    expect(last.tilt).toBeCloseTo(0, 5);
    expect(moved).toBeCloseTo(1.6, 5);
    expect(lying).toBeGreaterThan(3); expect(lying).toBeLessThan(4);
    expect(r.dur).toBeGreaterThanOrEqual(3); expect(r.dur).toBeLessThanOrEqual(5);
  });
  it('cambaleio inclina pouco e acaba em 0,8 s; spray curva para a frente', () => {
    const s = startNpcReaction('stagger', 1, 0, 0.35);
    const mid = stepNpcReaction(s, 0.4);
    expect(mid.tilt).toBeGreaterThan(0); expect(mid.tilt).toBeLessThan(0.5);
    expect(stepNpcReaction(s, 0.5).done).toBe(true);
    expect(stepNpcReaction(startNpcReaction('flinch', 0, 1, 0), 0.5).tilt).toBeLessThan(0);
  });
});

import { aimHeading } from '../src/combat/CombatClient';
describe('mira assistida (rodada 9.1)', () => {
  it('vira para o alvo mais perto à frente; ignora atrás e longe', () => {
    // olhando para +z (heading 0); alvo à direita-frente a 1,5 m e outro atrás
    const h = aimHeading(0, 0, 0, 1.8, [{ x: 1, z: 1.1 }, { x: 0, z: -1 }, { x: 0, z: 9 }]);
    expect(h).toBeCloseTo(Math.atan2(1, 1.1), 3);
    expect(aimHeading(0, 0, 0, 1.8, [{ x: 0, z: -1 }])).toBe(0); // só atrás: mantém
    expect(aimHeading(0, 0, 0, 1.8, [{ x: 0, z: 5 }])).toBe(0); // longe demais: mantém
  });
});

import { npcDownPhase } from '../src/combat/npcHits';
import { aimTarget } from '../src/combat/CombatClient';
describe('queda com esqueleto e avanço curto (rodada 9.1)', () => {
  it('fase do clipe: cai/fica (npc_down) e depois levanta (getup); só para queda', () => {
    const r = startNpcReaction('down', 0, 1, 1);
    expect(npcDownPhase(r)).toBe('down');
    stepNpcReaction(r, 3.6);
    expect(npcDownPhase(r)).toBe('getup');
    expect(npcDownPhase(startNpcReaction('stagger', 0, 1, 0.3))).toBeNull();
  });
  it('alvo da mira devolve distância (avanço só um pouco além do alcance)', () => {
    expect(aimTarget(0, 0, 0, 1.2, [{ x: 0, z: 1.6 }]).d).toBeCloseTo(1.6, 5);
    expect(aimTarget(0, 0, 0, 1.2, [{ x: 0, z: -1 }]).d).toBe(Infinity);
  });
});
