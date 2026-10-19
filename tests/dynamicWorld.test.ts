/**
 * Rodada 12 — MUNDO DINÂMICO (server/src/world/DynamicWorldDirector.ts) contra uma WorldView SIMULADA
 * (server/src/world/SimWorldView.ts — dublê fiel ao contrato AutonomousWorldView; o sistema real é do AGENTE C):
 * concentração orgânica; escalada em ordem com adesões graduais; orçamento/cooldown; reações por personalidade;
 * neutralidade das torcidas; humanos só como lado quando agridem; frequência em 1 h; custo com 250 autônomos;
 * integração com o EventRuntime (agenda/evt_pts) e o formato `dyn`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DynamicWorldDirector, seededRng, type DynHistory } from '../server/src/world/DynamicWorldDirector';
import { SimWorldView, type SimOptions } from '../server/src/world/SimWorldView';
import { DYNAMIC_DEFAULTS, loadDynamicWorld, mergeConfig, type DynamicWorldConfig } from '../server/src/world/dynamicConfig';
import { EventRuntime } from '../server/src/events/EventRuntime';
import type { EventHost } from '../server/src/events/runner';
import type { Escalation, Personality } from '../server/src/autonomous/types';
import { joinAction } from '../src/events/agendaFormat';
import type { AgendaEntry, DynamicSignalWire, EventPointWire } from '../src/events/schedule';

const AXIS: [number, number][] = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
const LV: Escalation[] = ['CALMO', 'TENSAO', 'CONFRONTO', 'GENERALIZADO'];
const T0 = 1_000_000;

interface Run { sim: SimWorldView; d: DynamicWorldDirector; now: () => number; run(ms: number, each?: () => void): void; sent: { type: string; msg: any }[] }
function world(sim: Partial<SimOptions> & { n: number }, seed = 1, cfg: DynamicWorldConfig = DYNAMIC_DEFAULTS, axis: [number, number][] | undefined = undefined, prep?: (s: SimWorldView) => void): Run {
  const rng = seededRng(seed);
  // um humano observador no meio da área (o diretor sonda perto dos humanos; sem eixo nem humano não há sondas)
  const ar = sim.area ?? { x0: -200, x1: 200, z0: -40, z1: 40 };
  const s = new SimWorldView({ rng, humans: [{ id: 'obs', x: (ar.x0 + ar.x1) / 2, z: (ar.z0 + ar.z1) / 2 }], ...sim });
  prep?.(s);
  let now = T0;
  const sent: Run['sent'] = [];
  const d = new DynamicWorldDirector(cfg, s, { broadcast: (type, msg) => sent.push({ type, msg }), zoneAt: () => 'CENTRAL' }, { clock: () => now, rng, ...(axis ? { axis } : {}) });
  return {
    sim: s, d, sent, now: () => now,
    run(ms, each) { for (let t = 0; t < ms; t += 100) { now += 100; s.step(100, now); d.tick(now); each?.(); } },
  };
}
const byEvent = (h: DynHistory[]) => { const m = new Map<string, DynHistory[]>(); for (const x of h) { const a = m.get(x.id) ?? []; a.push(x); m.set(x.id, a); } return m; };
/** subidas de nível de um foco, na ordem */
const ups = (h: DynHistory[]) => { const out: Escalation[] = []; let cur = -1; for (const x of h) { const i = LV.indexOf(x.level); if (x.ev === 'start' || (x.ev === 'level' && i > cur)) out.push(x.level); if (x.ev === 'start' || x.ev === 'level') cur = i; } return out; };
const isConflict = (k: string) => k === 'DISCUSSAO' || k === 'BRIGA' || k === 'BRIGA_GENERALIZADA';

describe('mundo dinâmico — dados', () => {
  it('public/gameplay/dynamic_world.json tem exatamente a forma dos padrões (nada ignorado em silêncio)', () => {
    const raw = JSON.parse(readFileSync('public/gameplay/dynamic_world.json', 'utf8'));
    delete raw._doc;
    expect(loadDynamicWorld()).toEqual(DYNAMIC_DEFAULTS);
    expect(raw).toEqual(JSON.parse(JSON.stringify(DYNAMIC_DEFAULTS)));
  });
  it('valores inválidos ficam no padrão; números são presos', () => {
    const c = mergeConfig(DYNAMIC_DEFAULTS, { director: { probesPerS: 'x', eventEvalMs: -5 }, gathering: { growS: [300, 100] }, budget: { conflict: { perHour: { BRIGA: 1e12 } } } });
    expect(c.director.probesPerS).toBe(2);
    expect(c.director.eventEvalMs).toBe(0);
    expect(c.gathering.growS).toEqual([100, 300]);
    expect(c.budget.conflict.perHour.BRIGA).toBe(1e6);
  });
});

describe('mundo dinâmico — reuniões orgânicas', () => {
  it('concentração nasce de um núcleo pequeno, cresce por adesões (≤ invitePerEval por avaliação), esvazia e termina', () => {
    const W = world({ n: 160, area: { x0: -60, x1: 60, z0: -30, z1: 30 }, mix: { SOCIAL: 3, CURIOSO: 1, OBSERVADOR: 1 } }, 5);
    const series = new Map<string, number[]>();
    W.run(20 * 60_000, () => { for (const e of W.d.list()) if (e.kind !== 'CORRIDA_IMPROVISADA' && !isConflict(e.kind)) { const a = series.get(e.id) ?? []; if (a.at(-1) !== e.participants || a.length === 0) a.push(e.participants); series.set(e.id, a); } });
    const ev = byEvent(W.d.history);
    const gatherings = [...ev.entries()].filter(([, h]) => h[0].ev === 'start' && !isConflict(h[0].kind) && h[0].kind !== 'CORRIDA_IMPROVISADA');
    expect(gatherings.length).toBeGreaterThan(0);
    let sawGrow = false;
    for (const [id, h] of gatherings) {
      expect(h[0].n, 'nasce pequena (núcleo)').toBeLessThanOrEqual(DYNAMIC_DEFAULTS.gathering.coreMin + 4);
      const s = series.get(id) ?? [];
      const peak = Math.max(...s);
      if (peak >= h[0].n * 2 && peak >= 10) sawGrow = true;
      // entre duas avaliações a contagem só sobe por convites aceitos
      for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeLessThanOrEqual(DYNAMIC_DEFAULTS.gathering.invitePerEval);
      const end = h.find((x) => x.ev === 'end');
      if (end) expect(end.at - h[0].at, 'dura no máximo cresce+pico+esvazia').toBeLessThanOrEqual((240 + 180 + 150 + 60) * 1000);
    }
    expect(sawGrow).toBe(true);
    const ended = gatherings.filter(([, h]) => h.some((x) => x.ev === 'end' && (x.detail === 'esvaziou')));
    expect(ended.length).toBeGreaterThan(0);
    // ninguém foi criado: a população é a mesma do começo
    expect(W.sim.agents.length).toBe(160);
  });

  it('composição reclassifica: muitos manifestantes → MANIFESTAÇÃO (e pode sair em CAMINHADA pelo eixo); torcidas diferentes → ENCONTRO', () => {
    const p = { x: AXIS[10][0], z: AXIS[10][1] };
    const W = world({ n: 140, area: { x0: p.x - 50, x1: p.x + 50, z0: p.z - 30, z1: p.z + 30 }, mix: { MANIFESTANTE: 4, SOCIAL: 1 } }, 9, mergeConfig(DYNAMIC_DEFAULTS, { gathering: { manifest: { walkChance: 1 } } }), AXIS);
    W.run(15 * 60_000);
    const kinds = new Set(W.d.history.map((h) => h.kind));
    expect(kinds.has('MANIFESTACAO')).toBe(true);
    expect(kinds.has('CAMINHADA')).toBe(true);
    const T = world({ n: 160, area: { x0: -50, x1: 50, z0: -30, z1: 30 }, mix: { TORCEDOR: 3, SOCIAL: 2 }, supShare: 0.9, sups: 2 }, 4);
    T.run(10 * 60_000);
    expect(new Set(T.d.history.map((h) => h.kind)).has('ENCONTRO_TORCIDAS')).toBe(true);
  });
});

describe('mundo dinâmico — escalada', () => {
  const fightWorld = (seed: number, prep?: (s: SimWorldView) => void) => world({ n: 120, area: { x0: -30, x1: 30, z0: -30, z1: 30 }, supShare: 0.7, sups: 2, groupShare: 0.4, groups: 6, mix: { TORCEDOR: 3, AGITADO: 2, CONFRONTADOR: 1, SOCIAL: 2, OBSERVADOR: 1, CAUTELOSO: 1 } }, seed, DYNAMIC_DEFAULTS, undefined, prep);

  it('briga generalizada passa por TENSÃO → CONFRONTO → GENERALIZADO em ordem e cresce por adesões graduais (nunca 2 → 50)', () => {
    for (const seed of [1, 2, 3]) {
      const W = fightWorld(seed);
      const id = W.d.force('BRIGA_GENERALIZADA', 0, 0, W.now())!;
      let prev = 2, maxDelta = 0, peak = 0, atGen = -1;
      W.run(90_000, () => {
        const e = W.d.get(id);
        if (!e) return;
        const f = W.d.debug(id)!.roles.FIGHT ?? 0;
        maxDelta = Math.max(maxDelta, f - prev); prev = f; peak = Math.max(peak, f);
        if (atGen < 0 && e.escalation === 'GENERALIZADO') atGen = f;
      });
      const h = W.d.history.filter((x) => x.id === id);
      expect(ups(h), `semente ${seed}`).toEqual(['TENSAO', 'CONFRONTO', 'GENERALIZADO']);
      expect(maxDelta, 'adesões por avaliação').toBeLessThanOrEqual(DYNAMIC_DEFAULTS.conflict.general.maxJoinPerEval);
      expect(atGen).toBeGreaterThanOrEqual(DYNAMIC_DEFAULTS.conflict.fight.generalizeAt);
      expect(peak).toBeLessThanOrEqual(DYNAMIC_DEFAULTS.conflict.general.maxFighters);
      expect(peak).toBeGreaterThan(atGen);
      // desescalada: termina (cansaço/dispersão) descendo os níveis
      expect(h.at(-1)!.ev).toBe('end');
      const downs = h.filter((x) => x.ev === 'level').map((x) => x.level);
      expect(downs.slice(downs.indexOf('GENERALIZADO') + 1).every((l, i, a) => i === 0 || LV.indexOf(l) <= LV.indexOf(a[i - 1]))).toBe(true);
    }
  });

  it('focos espontâneos nunca pulam nível e cada subida respeita o tempo mínimo do nível anterior', () => {
    const W = world({ n: 220, area: { x0: -120, x1: 120, z0: -40, z1: 40 }, mix: { AGITADO: 2, CONFRONTADOR: 1, TORCEDOR: 2, SOCIAL: 1 }, supShare: 0.6, sups: 3, groupShare: 0.4 }, 11,
      mergeConfig(DYNAMIC_DEFAULTS, { budget: { conflict: { globalCooldownS: 20, regionCooldownS: 30, perHour: { DISCUSSAO: 200, BRIGA: 200, BRIGA_GENERALIZADA: 50 } } }, conflict: { seedChance: 0.2 } }));
    W.run(30 * 60_000);
    const foci = [...byEvent(W.d.history).values()].filter((h) => h[0].ev === 'start' && isConflict(h[0].kind));
    expect(foci.length).toBeGreaterThan(10);
    let confronts = 0;
    for (const h of foci) {
      const u = ups(h);
      expect(LV.slice(1, 1 + u.length)).toEqual(u); // TENSAO, CONFRONTO, GENERALIZADO — prefixo, sem pular
      if (u.includes('CONFRONTO')) confronts++;
      let last = h[0];
      for (const x of h.filter((y) => y.ev === 'level')) {
        if (LV.indexOf(x.level) > LV.indexOf(last.level)) {
          const min = last.level === 'TENSAO' ? DYNAMIC_DEFAULTS.conflict.tension.minS : DYNAMIC_DEFAULTS.conflict.fight.minS;
          expect(x.at - last.at).toBeGreaterThanOrEqual(min * 1000 - 1000);
        }
        last = x;
      }
    }
    expect(confronts).toBeGreaterThan(0);
  });

  it('orçamento/cooldown: em 1 h simulada com gente esquentada, inícios dentro do teto por hora, do intervalo global e por região', () => {
    const W = world({ n: 250, area: { x0: -400, x1: 400, z0: -50, z1: 50 }, mix: { AGITADO: 2, CONFRONTADOR: 2, TORCEDOR: 2 }, supShare: 0.7, sups: 4, humans: [{ id: 'h1', x: 0, z: 0 }, { id: 'h2', x: 200, z: 0 }] }, 21);
    W.run(60 * 60_000);
    const B = DYNAMIC_DEFAULTS.budget.conflict;
    const starts = W.d.history.filter((h) => h.ev === 'start' && h.kind === 'DISCUSSAO' && !h.detail);
    const brigas = W.d.history.filter((h) => h.ev === 'level' && h.level === 'CONFRONTO' && LV.indexOf(h.level) === 2);
    const gens = W.d.history.filter((h) => h.ev === 'level' && h.level === 'GENERALIZADO');
    expect(starts.length).toBeGreaterThan(0);
    expect(starts.length).toBeLessThanOrEqual(B.perHour.DISCUSSAO);
    // "subidas" para CONFRONTO (as descidas da dispersão passam por CONFRONTO de novo — não contam)
    const upsTo = (lv: Escalation) => [...byEvent(W.d.history).values()].reduce((s, h) => s + (ups(h).includes(lv) ? 1 : 0), 0);
    expect(upsTo('CONFRONTO')).toBeLessThanOrEqual(B.perHour.BRIGA);
    expect(upsTo('GENERALIZADO')).toBeLessThanOrEqual(B.perHour.BRIGA_GENERALIZADA);
    void brigas; void gens;
    for (let i = 1; i < starts.length; i++) expect(starts[i].at - starts[i - 1].at).toBeGreaterThanOrEqual(B.globalCooldownS * 1000);
    // frequência baixa: nunca "uma briga por minuto"
    expect(starts.length).toBeLessThan(60 / 3);
    // reuniões e corridas também dentro do teto
    const g = W.d.history.filter((h) => h.ev === 'start' && !isConflict(h.kind) && h.kind !== 'CORRIDA_IMPROVISADA');
    expect(g.length).toBeLessThanOrEqual(DYNAMIC_DEFAULTS.budget.gathering.perHour);
    expect(W.d.history.filter((h) => h.ev === 'start' && h.kind === 'CORRIDA_IMPROVISADA').length).toBeLessThanOrEqual(DYNAMIC_DEFAULTS.budget.race.perHour);
    // o teto é DADO: com 2/h, no máximo 2
    const W2 = world({ n: 250, area: { x0: -400, x1: 400, z0: -50, z1: 50 }, mix: { AGITADO: 2, CONFRONTADOR: 2 } }, 21, mergeConfig(DYNAMIC_DEFAULTS, { budget: { conflict: { perHour: { DISCUSSAO: 2 } } } }));
    W2.run(60 * 60_000);
    expect(W2.d.history.filter((h) => h.ev === 'start' && h.kind === 'DISCUSSAO').length).toBeLessThanOrEqual(2);
  });

  it('mesma região: segundo foco só depois do cooldown regional', () => {
    const W = world({ n: 200, area: { x0: -35, x1: 35, z0: -35, z1: 35 }, mix: { AGITADO: 1, CONFRONTADOR: 1 } }, 8, mergeConfig(DYNAMIC_DEFAULTS, { budget: { conflict: { globalCooldownS: 10, perHour: { DISCUSSAO: 100 } } }, conflict: { seedChance: 1 } }));
    W.run(40 * 60_000);
    const size = DYNAMIC_DEFAULTS.regions.sizeM;
    const starts = W.d.history.filter((h) => h.ev === 'start' && h.kind === 'DISCUSSAO');
    expect(starts.length).toBeGreaterThan(1);
    // área ⊂ 1–4 regiões: com 600 s por região, ≤ 4 × (40 min / 10 min) + 4
    expect(starts.length).toBeLessThanOrEqual(4 * 4 + 4);
    void size;
  });
});

describe('mundo dinâmico — reações por personalidade', () => {
  /** dois brigando no centro (forçado) e um anel de 40 espectadores parados, de UMA personalidade */
  const ring = (p: Personality, friends: boolean, seed = 3) => {
    const W = world({ n: 0 }, seed, DYNAMIC_DEFAULTS, undefined, (s) => {
      s.add({ id: 'f0', x: -0.6, z: 0, personality: 'CONFRONTADOR', sup: 0, goal: 'IDLE', ...(friends ? { group: 'turma' } : {}) });
      s.add({ id: 'f1', x: 0.6, z: 0, personality: 'CONFRONTADOR', sup: 0, goal: 'IDLE' });
      for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, r = 5 + (i % 5) * 2; s.add({ id: `b${i}`, x: Math.cos(a) * r, z: Math.sin(a) * r, personality: p, sup: 0, goal: 'IDLE', ...(friends ? { group: 'turma' } : {}) }); }
    });
    const id = W.d.force('BRIGA', 0, 0, W.now())!;
    W.run(40_000);
    expect(W.d.history.some((h) => h.id === id && h.level === 'CONFRONTO')).toBe(true);
    const r = W.d.stats.reactions, tot = r.join + r.watch + r.flee + r.ignore;
    return { ...r, tot };
  };

  it('CAUTELOSO foge, OBSERVADOR olha, CONFRONTADOR entra — e os pesos vêm dos dados', () => {
    const c = ring('CAUTELOSO', false), o = ring('OBSERVADOR', false), k = ring('CONFRONTADOR', false);
    expect(c.tot).toBeGreaterThan(10);
    expect(c.join).toBe(0);
    expect(c.flee / c.tot).toBeGreaterThan(0.5);
    expect(o.watch / o.tot).toBeGreaterThan(0.5);
    expect(k.join).toBeGreaterThan(0);
    expect(k.join / k.tot).toBeGreaterThan(c.join / c.tot);
    // reações distribuídas: nem todos fazem a mesma coisa
    for (const r of [c, o, k]) expect(Math.max(r.join, r.watch, r.flee, r.ignore)).toBeLessThan(r.tot);
  });

  it('amigos (mesmo grupo de quem briga) entram mais que estranhos', () => {
    const s = ring('TORCEDOR', false, 5), f = ring('TORCEDOR', true, 5);
    expect(f.join / f.tot).toBeGreaterThan(s.join / s.tot);
  });
});

describe('mundo dinâmico — torcidas (neutralidade) e humanos', () => {
  it('tensão entre torcidas DIFERENTES só aumenta a chance — simétrica e igual para qualquer par de torcidas', () => {
    const d = new DynamicWorldDirector();
    const A = (sup: number) => ({ personality: 'TORCEDOR' as Personality, sup });
    const diff = d.tensionChance(A(1), A(2));
    expect(d.tensionChance(A(2), A(1))).toBe(diff);
    expect(d.tensionChance(A(3), A(4))).toBe(diff);
    expect(d.tensionChance(A(4), A(1))).toBe(diff);
    const same = d.tensionChance(A(1), A(1));
    expect(d.tensionChance(A(2), A(2))).toBe(same);
    expect(d.tensionChance(A(0), A(2))).toBe(same); // sem torcida não é "rival"
    expect(diff).toBeGreaterThan(same);
    expect(diff / same).toBeCloseTo(DYNAMIC_DEFAULTS.conflict.differentSupMult);
    expect(diff).toBeLessThan(0.1); // probabilidade baixa, nunca combate automático
  });

  it('trocar os grupos (permutar os índices de torcida) dá EXATAMENTE a mesma história', () => {
    const run = (perm: number[]) => {
      const W = world({ n: 200, area: { x0: -80, x1: 80, z0: -40, z1: 40 }, mix: { TORCEDOR: 3, AGITADO: 1, SOCIAL: 2, CONFRONTADOR: 1 }, supShare: 0.8, sups: 3 }, 17, DYNAMIC_DEFAULTS, undefined, (s) => { for (const a of s.agents) a.sup = perm[a.sup]; });
      W.run(30 * 60_000);
      return W.d.history.map((h) => `${h.at}|${h.id}|${h.ev}|${h.kind}|${h.level}|${h.n}`);
    };
    const a = run([0, 1, 2, 3]), b = run([0, 2, 3, 1]);
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
  });

  it('encontro de torcidas não vira briga sozinho: cada foco nasce como DISCUSSÃO (TENSÃO) e só escala depois', () => {
    const W = world({ n: 160, area: { x0: -40, x1: 40, z0: -30, z1: 30 }, mix: { TORCEDOR: 4, AGITADO: 1 }, supShare: 0.95, sups: 2 }, 6);
    W.d.force('ENCONTRO_TORCIDAS', 0, 0, W.now());
    W.run(10 * 60_000);
    for (const h of byEvent(W.d.history).values()) if (isConflict(h[0].kind)) { expect(h[0].level).toBe('TENSAO'); expect(h[0].kind).toBe('DISCUSSAO'); }
  });

  it('humano nunca recebe proposta nem vira alvo — só depois de AGREDIR um autônomo', () => {
    const W = world({ n: 200, area: { x0: -40, x1: 40, z0: -30, z1: 30 }, mix: { AGITADO: 2, CONFRONTADOR: 2, TORCEDOR: 1 }, humans: [{ id: 'humano', x: 0, z: 0 }] }, 13, mergeConfig(DYNAMIC_DEFAULTS, { conflict: { seedChance: 0.5 }, budget: { conflict: { globalCooldownS: 5, regionCooldownS: 5, perHour: { DISCUSSAO: 500, BRIGA: 500 } } } }));
    const targets: string[] = [];
    const orig = W.sim.propose.bind(W.sim);
    W.sim.propose = (id, g, w) => { if (id === 'humano') throw new Error('proposta a humano'); if (g.target) targets.push(g.target); return orig(id, g, w); };
    W.run(10 * 60_000);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).not.toContain('humano');
    // agressão: alvo CONFRONTADOR perto do humano reage; o foco tem o humano como lado e escala em ordem
    // a reação é sorteada pela personalidade (revida/foge/ignora): tenta alvos novos respeitando o intervalo por humano
    let t = W.sim.add({ id: 'alvo0', x: 0.8, z: 0, personality: 'CONFRONTADOR', sup: 0, goal: 'IDLE' });
    let ev: DynHistory | undefined;
    for (let i = 1; i <= 8 && !ev; i++) {
      W.d.onAggression('humano', t.id, t.x, t.z, W.now());
      ev = W.d.history.find((h) => h.detail === 'provocado');
      if (!ev) { W.run(DYNAMIC_DEFAULTS.conflict.provocation.cooldownPerHumanS * 1000 + 100); t = W.sim.add({ id: `alvo${i}`, x: 0.8, z: 0, personality: 'CONFRONTADOR', sup: 0, goal: 'IDLE' }); }
    }
    expect(ev).toBeTruthy();
    W.run(6000);
    W.d.onAggression('humano', t.id, 0.8, 0, W.now()); // bateu de novo
    W.run(4000);
    const h = W.d.history.filter((x) => x.id === ev!.id);
    expect(ups(h).slice(0, 2)).toEqual(['TENSAO', 'CONFRONTO']);
    expect(targets).toContain('humano');
    // provocação não gasta o orçamento espontâneo e tem intervalo por humano
    const before = W.d.history.filter((x) => x.detail === 'provocado').length;
    const t2 = W.sim.add({ id: 'alvo2', x: 1, z: 1, personality: 'CONFRONTADOR', sup: 0, goal: 'IDLE' });
    W.d.onAggression('humano', t2.id, 1, 1, W.now());
    expect(W.d.history.filter((x) => x.detail === 'provocado').length).toBe(before);
  });
});

describe('mundo dinâmico — saída (sinais, agenda, pontos) e custo', () => {
  it('sinais `dyn` ≤ 1 Hz, só na mudança, com os campos do contrato; agenda "acontecendo agora" e evt_pts pelo EventRuntime', () => {
    const W = world({ n: 120, area: { x0: -40, x1: 40, z0: -30, z1: 30 }, mix: { SOCIAL: 1, TORCEDOR: 1 } }, 2);
    W.d.force('CONCENTRACAO', 0, 0, W.now());
    W.d.force('BRIGA', 30, 20, W.now());
    W.run(30_000);
    const dyn = W.sent.filter((s) => s.type === 'dyn');
    expect(dyn.length).toBeGreaterThan(3);
    expect(dyn.length).toBeLessThanOrEqual(31);
    const list = dyn.at(-1)!.msg.list as DynamicSignalWire[];
    for (const s of list) {
      expect(Object.keys(s).sort()).toEqual(['ch', 'ci', 'cb', 'e', 'id', 'k', 'n', 'r', 'w', 'x', 'z'].sort());
      for (const v of [s.ci, s.ch, s.cb]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
    const fight = list.find((s) => s.k === 'BRIGA' || s.k === 'DISCUSSAO')!;
    expect(fight.cb).toBeGreaterThan(0);
    const crowd = list.find((s) => s.k === 'CONCENTRACAO' || s.k === 'FESTA')!;
    expect(crowd.cb).toBe(0);
    expect(crowd.ci).toBeGreaterThan(0);
    // EventRuntime: mesma agenda e mesmos pontos (sem agenda paralela)
    const sent: { sid: string; type: string; msg: any }[] = [];
    const host: EventHost = { participant: () => null, players: () => ['s1'], send: (sid, type, msg) => sent.push({ sid, type, msg }), emit: () => {}, zoneOf: () => null, extraAgenda: (now) => W.d.agenda(now), extraRallies: () => W.d.rallies() };
    const rt = new EventRuntime([], host, AXIS, { clock: W.now });
    rt.tick(W.now());
    const ag = sent.filter((s) => s.type === 'agenda').at(-1)!.msg.list as AgendaEntry[];
    const dynEntry = ag.find((e) => e.format === 'dinamico')!;
    expect(dynEntry).toMatchObject({ state: 'ACTIVE', capacity: 0 });
    expect(joinAction(dynEntry)).toBeNull(); // participar é ir até lá
    const pts = sent.filter((s) => s.type === 'evt_pts').at(-1)!.msg.list as EventPointWire[];
    expect(pts.some((p) => p.id.startsWith('dyn_') && p.crowd === 0)).toBe(true); // nenhum NPC reservado: só quem já está lá
    expect(rt.rallies().some((p) => p.id.startsWith('dyn_'))).toBe(true);
    // conexão nova recebe a lista atual
    const hello: string[] = [];
    W.d.hello((t) => hello.push(t));
    expect(hello).toEqual(['dyn']);
  });

  it('QA: forçar num mundo vazio cria foco "fantasma" que passa pelos níveis (só sinais) e some depois', () => {
    const W = world({ n: 0 }, 1);
    const id = W.d.force('BRIGA_GENERALIZADA', 10, 10, W.now())!;
    expect(id).toBeTruthy();
    expect(W.d.force('NADA' as never, 0, 0)).toBeNull();
    W.run(DYNAMIC_DEFAULTS.qa.forcedMinS * 1000 + 120_000);
    expect(ups(W.d.history.filter((h) => h.id === id))).toEqual(['TENSAO', 'CONFRONTO', 'GENERALIZADO']);
    expect(W.d.get(id)).toBeUndefined();
  });

  it('custo: 250 autônomos simulados — ms por avaliação e por tick da sala', () => {
    const W = world({ n: 250, area: { x0: -1100, x1: 800, z0: -60, z1: 60 }, supShare: 0.5, sups: 4, groupShare: 0.3, humans: [{ id: 'h1', x: -900, z: 400 }, { id: 'h2', x: 0, z: 0 }] }, 31, DYNAMIC_DEFAULTS, AXIS);
    // concentra parte da população perto dos humanos (onde o diretor sonda)
    for (const a of W.sim.agents.slice(0, 120)) { a.x = -900 + (a.x % 60); a.z = 400 + (a.z % 30); }
    W.d.force('BRIGA_GENERALIZADA', -900, 400, W.now());
    W.run(10 * 60_000);
    const s = W.d.stats;
    const perEval = s.msTotal / Math.max(1, s.evals + s.probes);
    // eslint-disable-next-line no-console
    console.log(`[mundo dinâmico] 250 autônomos · 10 min · ${s.ticks} ticks · ${s.evals} avaliações + ${s.probes} sondas · ${s.nearCalls} near() · média ${W.d.avgMs.toFixed(4)} ms/tick · ${perEval.toFixed(4)} ms/avaliação · pior tick ${s.msMax.toFixed(3)} ms`);
    expect(W.d.avgMs).toBeLessThan(0.5);
    expect(perEval).toBeLessThan(1);
  });
});
