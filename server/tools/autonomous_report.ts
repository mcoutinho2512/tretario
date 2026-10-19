/**
 * Rodada 12 — relatório de HUMANIZAÇÃO dos autônomos: `npx tsx server/tools/autonomous_report.ts [agentes] [minutos]`
 * (padrão 100 × 10 min de relógio simulado). Grava docs/bench/round12_humanization.json (PV_OUT muda o arquivo).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHumanization } from '../src/autonomous/report.ts';

const agents = Number(process.argv[2] ?? 100), minutes = Number(process.argv[3] ?? 10);
const rep = runHumanization({ agents, minutes, seed: Number(process.env.PV_SEED ?? 12) });
const out = process.env.PV_OUT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/bench/round12_humanization.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), tool: 'server/tools/autonomous_report.ts', ...rep }, null, 2) + '\n');
console.log(JSON.stringify(rep, null, 2));
console.log(`→ ${out}`);
