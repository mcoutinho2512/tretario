/**
 * `npm run dev:telemetry` — CLI do OPERADOR (não é rota pública): soma as linhas de server/data/telemetry.jsonl
 * (ou PV_TELEMETRY_FILE / --file=…) e imprime os agregados de gameplay. Só contadores, nada pessoal.
 * Opções: --file=<caminho> · --json (saída crua) · --since=<horas> (só períodos recentes)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aggregate } from '../src/telemetry/GameplayTelemetry.ts';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const file = arg('file') ?? process.env.PV_TELEMETRY_FILE ?? fileURLToPath(new URL('../data/telemetry.jsonl', import.meta.url));
if (!existsSync(file)) { console.log(`[telemetria] sem dados ainda (${file}) — o servidor grava uma linha por período com sessões`); process.exit(0); }
let lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
const since = Number(arg('since'));
if (since > 0) { const t0 = Date.now() - since * 3600e3; lines = lines.filter((l) => { try { return Date.parse(JSON.parse(l).to) >= t0; } catch { return false; } }); }
const a = aggregate(lines);
if (process.argv.includes('--json')) { console.log(JSON.stringify(a, null, 1)); process.exit(0); }
const c = a.c;
const avgMin = c.sessionsEnded ? (c.sessionMsTotal / c.sessionsEnded / 60e3).toFixed(1) : '—';
const top = (m: Record<string, number>, n = 12) => Object.entries(m).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
console.log(`Telemetria de gameplay — ${a.periods} períodos (${a.from ?? '—'} → ${a.to ?? '—'})
  sessões        ${c.sessionsStarted} iniciadas · ${c.sessionsEnded} encerradas · duração média ${avgMin} min · contas ${c.accountSessions} · visitantes ${c.visitorSessions}
  duração        ${top(c.duration)}
  atividades/sessão ${top(c.activity)}
  missões        ${c.missionsStarted} iniciadas · ${c.missionsCompleted} concluídas · conquistas ${c.achievements} · subidas de nível ${c.levelUps}
  por missão     ${top(c.missionCompletions)}
  eventos        ${c.eventsJoined} entradas · ${c.eventsCompleted} conclusões · corridas ${c.racesStarted} iniciadas / ${c.racesCompleted} concluídas
  debate         ${c.debateSessions} sessões assistiram · ${Math.round(c.debateWatchS / 60)} min no total
  confronto      ${c.combatSessions} sessões participaram
  zonas          ${top(c.zonesVisited)}
  eventos de gameplay ${top(c.gameplay, 20)}`);
