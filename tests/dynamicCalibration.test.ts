/**
 * Rodada 12 (agente G) — CALIBRAÇÃO do mundo dinâmico no mundo INTEGRADO simulado (server/src/autonomous/calibration.ts):
 * mapa real (paredes/eixo/pontos do manifesto), 180 autônomos, diretor de eventos ligado como na sala, humanos parados
 * (Central, meio do eixo, palco e um LONGE do eixo, ~270 m), proteção de retorno de 5 s como na sala. Nada forçado.
 * Prova: discussões → brigas com golpes trocados → generalizada por ADESÕES graduais dentro dos orçamentos; revide ×
 * fuga pela personalidade; concentração ≥ 15 que cresce e esvazia; gente perto de quem joga longe do eixo;
 * distribuição de comportamento variada. E o defeito da queda: o 1º empurrão (que derruba) não encerra mais a briga.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { CalibrationReport } from '../server/src/autonomous/calibrationTypes';
import { DYNAMIC_DEFAULTS } from '../server/src/world/dynamicConfig';
import { AutonomousSystem } from '../server/src/autonomous/AutonomousSystem';
import { SimHost } from '../server/src/autonomous/simHost';
import { parseAutonomousConfig } from '../server/src/autonomous/config';
import { DynamicWorldDirector, seededRng } from '../server/src/world/DynamicWorldDirector';
import { readFileSync } from 'node:fs';
import type { Personality } from '../server/src/autonomous/types';

// calibration.ts importa o mundo do servidor (imports .ts): carregado em tempo de execução, como o report.ts
type Rep = CalibrationReport;
let rep: Rep | null = null;
let runCalibration: (o: Record<string, unknown>) => Rep;
const report = (): Rep => (rep ??= runCalibration({ agents: 180, minutes: 60, seed: 31 }));
beforeAll(async () => { ({ runCalibration } = await import(/* @vite-ignore */ `../server/src/autonomous/${'calibration.ts'}`)); });

describe('rodada 12 (G) — 60 min simulados no mundo integrado (180 autônomos, humanos parados)', () => {
  it('discussões, brigas com golpes trocados e uma generalizada por adesões graduais — dentro dos orçamentos', () => {
    const c = report().conflicts;
    const B = DYNAMIC_DEFAULTS.budget.conflict;
    const spont = c.episodes.filter((e) => !e.humanSide);
    expect(spont.length).toBeGreaterThanOrEqual(6); // discussões espontâneas
    expect(spont.length).toBeLessThanOrEqual(B.perHour.DISCUSSAO);
    const fights = spont.filter((e) => e.maxLevel !== 'TENSAO');
    expect(fights.length).toBeLessThanOrEqual(B.perHour.BRIGA);
    expect(spont.filter((e) => e.maxLevel !== 'TENSAO' && e.attackers >= 2 && e.hits >= 2).length).toBeGreaterThanOrEqual(2);
    const gen = c.episodes.filter((e) => e.maxLevel === 'GENERALIZADO');
    expect(gen.length).toBeGreaterThanOrEqual(1);
    expect(gen.length).toBeLessThanOrEqual(B.perHour.BRIGA_GENERALIZADA);
    for (const g of gen) {
      // passou por DISCUSSÃO → BRIGA → GENERALIZADA, cresceu aos poucos (nunca 2 → 10 de uma vez) e teve gente olhando
      expect(g.kinds).toEqual(['DISCUSSAO', 'BRIGA', 'BRIGA_GENERALIZADA']);
      expect(g.peakFighters).toBeGreaterThanOrEqual(DYNAMIC_DEFAULTS.conflict.fight.generalizeAt);
      for (let i = 1; i < g.fighterSteps.length; i++) expect(g.fighterSteps[i] - g.fighterSteps[i - 1]).toBeLessThanOrEqual(2 * DYNAMIC_DEFAULTS.conflict.general.maxJoinPerEval);
      expect(g.attackers).toBeGreaterThanOrEqual(4);
      expect(g.peakWatchers).toBeGreaterThan(0);
    }
    // nada "a cada minuto": inícios espontâneos espaçados pelo intervalo global
    const starts = spont.map((e) => e.startMin).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect((starts[i] - starts[i - 1]) * 60).toBeGreaterThanOrEqual(B.globalCooldownS - 1);
  }, 60_000);

  it('revide × fuga pela personalidade quando um humano agride', () => {
    const P = report().provocation.byPersonality;
    const sum = (ks: string[], f: 'revide' | 'fuga' | 'n') => ks.reduce((s, k) => s + (P[k]?.[f] ?? 0), 0);
    const hot = ['CONFRONTADOR', 'AGITADO', 'TORCEDOR'];
    expect(sum(hot, 'n')).toBeGreaterThan(5);
    expect(sum(hot, 'revide') / sum(hot, 'n')).toBeGreaterThan(0.6);
    expect(report().provocation.total).toBeGreaterThan(30);
    expect((P.CAUTELOSO?.revide ?? 0)).toBe(0);
  }, 60_000);

  it('concentrações reconhecíveis (≥ 15 pessoas) que crescem e esvaziam', () => {
    const g = report().gatherings;
    expect(g.withAtLeast15).toBeGreaterThanOrEqual(4);
    const big = g.episodes.filter((e) => e.peakCrowd >= 15 && e.end === 'esvaziou');
    expect(big.length).toBeGreaterThanOrEqual(3);
    // nasce de um núcleo pequeno, cresce por adesões e esvazia aos poucos (não some de uma vez)
    for (const e of big) { expect(e.members[0]).toBeLessThanOrEqual(DYNAMIC_DEFAULTS.gathering.coreMin + 2); expect(e.peakMembers).toBeGreaterThan(e.members[0] + 5); expect(e.durS).toBeGreaterThan(120); }
    // espaçadas: não saem todas nos primeiros minutos
    expect(Math.max(...g.episodes.map((e) => e.startMin))).toBeGreaterThan(35);
  }, 60_000);

  it('gente perto de QUALQUER humano — inclusive de quem joga longe do eixo (~270 m)', () => {
    const r = report();
    const far = r.humans.find((h) => h.id === 'h_longe')!;
    expect(far.lat).toBeGreaterThan(200);
    for (const [id, q] of Object.entries(r.nearHumans)) { expect(q.avgWithin60, id).toBeGreaterThan(3); expect(q.zeroSamplesPct, id).toBeLessThan(10); }
    expect(r.lod.NEAR + r.lod.MID + r.lod.FAR).toBeLessThanOrEqual(220 - 3 * r.humans.length); // orçamento
  }, 60_000);

  it('distribuição variada (nem todo mundo fazendo a mesma coisa) e custo de IA baixo', () => {
    const r = report();
    for (const w of [r.activity10min, r.activityTotal]) {
      expect(Math.max(...Object.values(w))).toBeLessThan(40);
      for (const k of ['idle', 'walk', 'social', 'event']) expect(w[k], k).toBeGreaterThan(5);
    }
    expect(r.activityTotal.fight + r.activityTotal.watch).toBeGreaterThan(0.2);
    expect(r.cost.aiMsPerTick).toBeLessThan(2);
    expect(r.cost.directorMsPerTick).toBeLessThan(0.5);
  }, 60_000);
});

describe('rodada 12 (G) — defeitos de escalada corrigidos', () => {
  const RAW = JSON.parse(readFileSync('public/gameplay/autonomous.json', 'utf8'));
  const only = (p: Personality) => { const r = structuredClone(RAW); r.personalities = { [p]: 1 }; return parseAutonomousConfig(r); };

  it('briga do diretor sobrevive à queda: quem derrubou espera o outro levantar (e a proteção de 5 s) e volta a bater', () => {
    const host = new SimHost();
    const sys = new AutonomousSystem(host, { population: 2, seed: 3, config: only('CONFRONTADOR') });
    host.sys = sys;
    const d = new DynamicWorldDirector(DYNAMIC_DEFAULTS, sys, { broadcast: () => {} }, { clock: () => host.t, rng: seededRng(5) });
    (sys as unknown as { roleOf: (id: string) => unknown }).roleOf = (id: string) => d.roleOf(id);
    host.addHuman('h', 20, 0);
    const [a, b] = sys.agents;
    const run = (ticks: number) => { for (let k = 0; k < ticks; k++) { host.advance(100); d.tick(host.t); sys.tick(100); } };
    run(10); sys.place(a.id, 0, 0); sys.place(b.id, 1.2, 0); run(60); // proteção de aparecer passa
    const id = d.force('BRIGA', 0.6, 0, host.t)!;
    let knocks = 0, maxLvl = '';
    for (let k = 0; k < 400; k++) { run(1); if (host.log.knocks > knocks) knocks = host.log.knocks; const e = d.get(id); if (e && e.escalation === 'CONFRONTO') maxLvl = e.escalation; }
    expect(maxLvl).toBe('CONFRONTO');
    expect(knocks).toBeGreaterThan(0); // o empurrão derrubou
    expect(host.cs.stats.hits).toBeGreaterThan(knocks); // e a troca continuou depois da queda
  });

  it('cambalear com um soco não é cair: sem sorteio de fuga a cada golpe recebido', () => {
    const host = new SimHost();
    const sys = new AutonomousSystem(host, { population: 2, seed: 9, config: only('TORCEDOR') });
    host.sys = sys;
    host.addHuman('h', 30, 0);
    const [a, b] = sys.agents;
    const run = (ticks: number) => { for (let k = 0; k < ticks; k++) { host.advance(100); sys.tick(100); } };
    run(10); sys.place(a.id, 0, 0); sys.place(b.id, 0.9, 0); run(60);
    sys.force(a.id, 'JOIN_FIGHT', { target: b.id });
    let staggered = 0;
    for (let k = 0; k < 120; k++) { run(1); if (host.ents.get(b.id)?.status === 3) staggered++; }
    if (staggered) expect(sys.debug(b.id)!.goal).not.toBe('AVOID_FIGHT'); // TORCEDOR apanhando de soco não sai correndo por cambalear
  });
});
