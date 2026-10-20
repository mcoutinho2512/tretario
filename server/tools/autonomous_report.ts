/**
 * Rodada 12 — relatório dos autônomos:
 *  - HUMANIZAÇÃO: `npx tsx server/tools/autonomous_report.ts [agentes] [minutos]` (padrão 100 × 10 min) →
 *    docs/bench/round12_humanization.json
 *  - CALIBRAÇÃO (agente G): `npx tsx server/tools/autonomous_report.ts calib [agentes] [minutos] [sementes]` (padrão
 *    180 × 60 min, sementes 31,7,3,99,5,42,77,12) → docs/bench/round12_calibration.json: relatório completo da 1ª
 *    semente (discussões/brigas/generalizadas, picos, revide × fuga, concentrações, gente perto de cada humano,
 *    distribuição de 10 min, custo de IA) + resumo por semente (variância) + 150 e 220 autônomos.
 * PV_OUT muda o arquivo.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHumanization } from '../src/autonomous/report.ts';
import { runCalibration, type CalibrationReport } from '../src/autonomous/calibration.ts';
import { DYNAMIC_DEFAULTS } from '../src/world/dynamicConfig.ts';

const bench = (f: string) => resolve(dirname(fileURLToPath(import.meta.url)), `../../docs/bench/${f}`);
const save = (out: string, data: unknown) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(data, null, 2) + '\n'); console.log(`→ ${out}`); };

if (process.argv[2] === 'calib') {
  const agents = Number(process.argv[3] ?? 180), minutes = Number(process.argv[4] ?? 60);
  const seeds = (process.argv[5] ?? '31,7,3,99,5,42,77,12').split(',').map(Number);
  const brief = (r: CalibrationReport) => {
    const sp = r.conflicts.episodes.filter((e) => !e.humanSide);
    return {
      seed: r.seed, agents: r.agents, discussionsSpontaneous: sp.length, fightsSpontaneous: sp.filter((e) => e.maxLevel !== 'TENSAO').length,
      fightsWithExchange: sp.filter((e) => e.maxLevel !== 'TENSAO' && e.attackers >= 2 && e.hits >= 2).length, generalized: r.conflicts.generalized,
      peakFighters: r.conflicts.peakFighters, peakWatchers: r.conflicts.peakWatchers, provokedFoci: r.conflicts.provoked,
      gatherings: r.gatherings.count, gatheringsAtLeast15: r.gatherings.withAtLeast15, gatheringPeakMedian: r.gatherings.peakArrivedMedian, gatheringPeakMax: r.gatherings.peakArrivedMax,
      nearFarHumanAvg60: r.nearHumans.h_longe?.avgWithin60 ?? 0, aiMsPerTick: r.cost.aiMsPerTick, wallMs: r.wallMs,
    };
  };
  const runs: CalibrationReport[] = [];
  for (const seed of seeds) { const r = runCalibration({ agents, minutes, seed }); runs.push(r); console.log(JSON.stringify(brief(r))); }
  const pop: ReturnType<typeof brief>[] = [];
  for (const n of [150, 220]) { const r = runCalibration({ agents: n, minutes, seed: seeds[0] }); pop.push(brief(r)); console.log(JSON.stringify(brief(r))); }
  const per = runs.map(brief);
  const share = (f: (b: ReturnType<typeof brief>) => boolean) => +(per.filter(f).length / per.length).toFixed(2);
  save(process.env.PV_OUT ?? bench('round12_calibration.json'), {
    generatedAt: new Date().toISOString(), tool: 'server/tools/autonomous_report.ts calib',
    setup: { agents, minutes, seeds, humans: 'parados: Central, meio do eixo, palco, longe do eixo (~270 m, vaga de bicicletas); h_meio provoca (soco) a cada 75 s um autônomo livre ≤ 60 m', protection: 'proteção de retorno 5 s ao aparecer/levantar (como a sala)' },
    budgets: DYNAMIC_DEFAULTS.budget.conflict,
    targets: { discussions: '≥ 6/h', fightsWithExchange: '≥ 2/h', generalized: '≥ 1/h (teto 1/h)', gathering: '≥ 15 pessoas, cresce e esvazia' },
    acrossSeeds: { runs: per.length, discussionsAtLeast6: share((b) => b.discussionsSpontaneous >= 6), fightsWithExchangeAtLeast2: share((b) => b.fightsWithExchange >= 2), generalizedAtLeast1: share((b) => b.generalized >= 1), gatheringsAtLeast15: share((b) => b.gatheringsAtLeast15 >= 4) },
    perSeed: per, population: pop,
    report: runs[0],
  });
} else {
  const agents = Number(process.argv[2] ?? 100), minutes = Number(process.argv[3] ?? 10);
  const rep = runHumanization({ agents, minutes, seed: Number(process.env.PV_SEED ?? 12) });
  save(process.env.PV_OUT ?? bench('round12_humanization.json'), { generatedAt: new Date().toISOString(), tool: 'server/tools/autonomous_report.ts', ...rep });
  console.log(JSON.stringify(rep, null, 2));
}
