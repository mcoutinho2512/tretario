/**
 * Rodada 12 — MEDIÇÃO DE HUMANIZAÇÃO (puro, sem rede): N autônomos no mundo REAL (paredes/eixo/pontos do manifesto),
 * humanos roteirizados espalhados pela avenida, relógio simulado a 10 Hz. Mede distribuição de tempo por atividade,
 * diversidade de fase (inícios no mesmo tick), velocidade, mudanças de direção, tempo parado, trajetos, desvios —
 * e aponta padrões robóticos (server/tools/autonomous_report.ts grava docs/bench/round12_humanization.json).
 */
import { loadWorld } from '../world.ts';
import { AutonomousSystem, ACTIVITIES } from './AutonomousSystem.ts';
import { SimHost, manifestHotspots } from './simHost.ts';
import { supporters } from '../supporters/service.ts';
import { EVENT_VEHICLE_KINDS } from '../../../src/net/rules.ts';
import { DynamicWorldDirector } from '../world/DynamicWorldDirector.ts';
import { loadDynamicWorld } from '../world/dynamicConfig.ts';

export interface HumanizationReport {
  agents: number; humans: number; simMinutes: number; wallMs: number;
  activityPct: Record<string, number>;
  phase: { walkStarts: number; walkStartsInCrowdedTicksPct: number; walkStartsMaxPerTick: number; walkStartsMaxAtS: number; walkStartsMaxPerTickSteady: number; actStarts: number; actStartsInCrowdedTicksPct: number; actStartsMaxPerTick: number; sameActSameTickPct: number };
  movement: { meanSpeedMps: number; walkSpeedSpreadMps: number; dirChangesPerMovingMin: number; stoppedPct: number; pathMeanM: number; pathMedianM: number; pathP90M: number; paths: number; avoidPerAgentMin: number; waitsPerAgentMin: number; wallRepathsPerAgentMin: number; corrections: number; correctionReasons: Record<string, number>; moves: number };
  social: { groupsFormed: number; groupHeadingSpreadDeg: number; groupSizes: Record<string, number> };
  decisions: { perSec: number; perAgentMin: number };
  vehicle: { rides: number; enters: number; exits: number };
  combat: { attacks: number; denied: number; knocks: number; humansKnocked: number; provocations: number; directorStarted: number; directorProposals: number; directorAccepted: number; directorEvents: Record<string, number>; combatSystem: Record<string, unknown> };
  lod: Record<string, number>;
  aiMsPerTick: number;
  robotic: { check: string; value: number; limit: string; ok: boolean }[];
}

/** eventos do diretor por tipo (nascimentos e mudanças de tipo/nível) */
function dirEvents(d: DynamicWorldDirector | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of d?.history ?? []) { const k = `${h.ev}:${h.kind}${h.ev === 'level' ? `:${h.level}` : ''}`; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

export function runHumanization(opts: { agents?: number; minutes?: number; humans?: number; seed?: number; provoke?: boolean; director?: boolean; forceFight?: boolean } = {}): HumanizationReport {
  const W = loadWorld();
  const m = W.manifest;
  const axis = (m.pvAxis ?? []) as [number, number][];
  const vehicles = (m.vehicleSpawns ?? []).filter((v) => !EVENT_VEHICLE_KINDS.has(v.kind)).map((v) => ({ id: v.id, kind: v.kind, x: v.x, z: v.z, heading: v.heading }));
  const host = new SimHost({ walls: W.walls, bounds: m.bounds as [number, number, number, number], axis, hotspots: manifestHotspots(m), vehicles });
  const N = opts.agents ?? 100, minutes = opts.minutes ?? 10;
  let dyn: DynamicWorldDirector | null = null;
  const sys = new AutonomousSystem(host, { population: N, seed: opts.seed ?? 12, supporters: supporters(), roleOf: (id) => dyn?.roleOf(id) ?? null });
  host.sys = sys;
  host.onHumanHit = (by, tgt, x, z) => dyn?.onAggression(by, tgt, x, z, host.t);
  // o DIRETOR de eventos do agente E, como na sala: lê esta WorldView e só propõe (concentrações, discussões, brigas)
  let seed = (opts.seed ?? 12) * 7919;
  dyn = opts.director === false ? null : new DynamicWorldDirector(loadDynamicWorld(), sys, { broadcast: () => {} }, { clock: () => host.t, axis, rng: () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) });
  // humanos espalhados pela avenida (a população inteira fica a ≤ 240 m de alguém), andando devagar de um lado a outro
  const nh = opts.humans ?? 6;
  const A = sys.axis;
  const hum: { id: string; s0: number; lat: number; amp: number; w: number }[] = [];
  for (let i = 0; i < nh; i++) { const s0 = A.len * (i + 0.5) / nh; const p = A.at(s0, 4); host.addHuman(`h${i}`, p.x, p.z); hum.push({ id: `h${i}`, s0, lat: 4 + (i % 3) * 5, amp: 30 + i * 7, w: 0.004 + i * 0.0007 }); }
  // todos já perto de alguém: distribui a população ao longo da avenida (sem esperar a chegada orgânica)
  const ticks = Math.round(minutes * 60 * 10);
  const t0 = performance.now();
  let aiMs = 0, provocations = 0, holdUntil = 0;
  for (let k = 0; k < ticks; k++) {
    host.advance(100);
    const tt = k / 10;
    for (const h of hum) { if (h.id === 'h1' && k < holdUntil) continue; const p = A.at(h.s0 + Math.sin(tt * h.w * 6.283) * h.amp, h.lat); host.moveHuman(h.id, p.x, p.z); }
    // provocação: de vez em quando um humano golpeia o autônomo mais próximo (testa reação e contra-ataque)
    if (opts.provoke !== false && k % 600 === 300) {
      const h = host.ents.get('h1')!;
      let best: { id: string; d: number; x: number; z: number } | null = null;
      for (const e of host.ents.values()) if (!e.human) { const d = Math.hypot(e.x - h.x, e.z - h.z); if (!best || d < best.d) best = { id: e.id, d, x: e.x, z: e.z }; }
      if (best && best.d < 200) { const e = host.ents.get('h1')!; e.x = best.x - 0.9; e.z = best.z; e.last = { x: e.x, y: 0, z: e.z, t: host.t }; host.humanAttack('h1', 1, Math.PI / 2); provocations++; holdUntil = k + 120; }
    }
    // um foco de briga do diretor (como o qa_dyn) na metade: exercita ARGUE → FIGHT (empurrão → soco) e as reações
    if (dyn && opts.forceFight !== false && k === Math.round(ticks / 2)) { const h = host.ents.get('h2')!; dyn.force('BRIGA', h.x + 6, h.z + 4, host.t); }
    dyn?.tick(host.t);
    const a0 = performance.now();
    sys.tick(100);
    aiMs += performance.now() - a0;
  }
  const wallMs = performance.now() - t0;
  const S = sys.stats;
  const tot = ACTIVITIES.reduce((s, a) => s + S.timeMs[a], 0) || 1;
  const activityPct = Object.fromEntries(ACTIVITIES.map((a) => [a, +(100 * S.timeMs[a] / tot).toFixed(1)]));
  const paths = [...S.paths].sort((a, b) => a - b);
  const q = (f: number) => paths.length ? paths[Math.min(paths.length - 1, Math.floor(f * paths.length))] : 0;
  const agentMin = (tot / 1000) / 60;
  const walks = sys.agents.map((a) => (a as unknown as { walk: number }).walk);
  const mean = walks.reduce((s, x) => s + x, 0) / Math.max(1, walks.length);
  const spread = Math.sqrt(walks.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, walks.length));
  // rodas: espalhamento dos rumos (todos virados igual = robótico)
  const spreads: number[] = []; const sizes: Record<string, number> = {};
  for (const g of sys.groupsInfo()) {
    sizes[g.n] = (sizes[g.n] ?? 0) + 1;
    if (g.walking || g.n < 2) continue;
    const sx = g.headings.reduce((s, h) => s + Math.sin(h), 0) / g.n, sz = g.headings.reduce((s, h) => s + Math.cos(h), 0) / g.n;
    spreads.push((1 - Math.hypot(sx, sz)) * 180); // 0° = todos iguais; ~180° = de frente uns para os outros
  }
  const pct = (a: number, b: number) => (b ? +(100 * a / b).toFixed(1) : 0);
  const rep: HumanizationReport = {
    agents: N, humans: nh, simMinutes: minutes, wallMs: Math.round(wallMs),
    activityPct,
    phase: {
      walkStarts: S.walkStarts, walkStartsInCrowdedTicksPct: pct(S.walkStartsCrowded, S.walkStarts), walkStartsMaxPerTick: S.walkStartsMaxTick, walkStartsMaxAtS: +(S.walkStartsMaxAt / 10).toFixed(1), walkStartsMaxPerTickSteady: S.walkStartsMaxSteady,
      actStarts: S.actStarts, actStartsInCrowdedTicksPct: pct(S.actStartsCrowded, S.actStarts), actStartsMaxPerTick: S.actStartsMaxTick, sameActSameTickPct: pct(S.sameActSameTick, S.actStarts),
    },
    movement: {
      meanSpeedMps: +(S.speedSum / Math.max(1, S.speedN)).toFixed(2), walkSpeedSpreadMps: +spread.toFixed(3),
      dirChangesPerMovingMin: +(S.dirChanges / Math.max(1e-6, S.movingMs / 60_000)).toFixed(2),
      stoppedPct: pct(S.stoppedMs, S.stoppedMs + S.movingMs),
      pathMeanM: +(paths.reduce((s, x) => s + x, 0) / Math.max(1, paths.length)).toFixed(1), pathMedianM: +q(0.5).toFixed(1), pathP90M: +q(0.9).toFixed(1), paths: paths.length,
      avoidPerAgentMin: +(S.avoidInterventions / Math.max(1e-6, agentMin)).toFixed(2), waitsPerAgentMin: +(S.waits / Math.max(1e-6, agentMin)).toFixed(2),
      wallRepathsPerAgentMin: +(S.wallRepaths / Math.max(1e-6, agentMin)).toFixed(2), corrections: host.log.corrections, correctionReasons: { ...host.log.reasons, ...S.correctionsBy }, moves: host.log.moves,
    },
    social: { groupsFormed: S.groupsFormed, groupHeadingSpreadDeg: spreads.length ? +(spreads.reduce((s, x) => s + x, 0) / spreads.length).toFixed(0) : 0, groupSizes: sizes },
    decisions: { perSec: +(S.decisions / (minutes * 60)).toFixed(1), perAgentMin: +(S.decisions / Math.max(1e-6, agentMin)).toFixed(2) },
    vehicle: { rides: S.vehicleRides, enters: host.log.enters, exits: host.log.exits },
    combat: { attacks: S.attacks, denied: S.attacksDenied, knocks: host.log.knocks, humansKnocked: host.log.impactsOnHumans, provocations, directorStarted: dyn?.stats.started ?? 0, directorProposals: dyn?.stats.proposals ?? 0, directorAccepted: dyn?.stats.accepted ?? 0, directorEvents: dirEvents(dyn), combatSystem: { requests: host.cs.stats.requests, accepted: host.cs.stats.accepted, hits: host.cs.stats.hits, blocked: host.cs.stats.blocked, dodged: host.cs.stats.dodged, denied: { ...host.cs.stats.denied } } },
    lod: { ...sys.lodCount },
    aiMsPerTick: +(aiMs / ticks).toFixed(3),
    robotic: [],
  };
  const R = rep.robotic;
  const chk = (check: string, value: number, limit: string, ok: boolean) => R.push({ check, value, limit, ok });
  chk('inícios de caminhada em ticks com ≥3 inícios (%)', rep.phase.walkStartsInCrowdedTicksPct, '< 35', rep.phase.walkStartsInCrowdedTicksPct < 35);
  chk('mesma ação começando no mesmo tick (%)', rep.phase.sameActSameTickPct, '< 10', rep.phase.sameActSameTickPct < 10);
  chk('máx. inícios de caminhada num tick (após 30 s de aquecimento)', rep.phase.walkStartsMaxPerTickSteady, '≤ 6', rep.phase.walkStartsMaxPerTickSteady <= 6);
  chk('desvio-padrão da velocidade de caminhada (m/s)', rep.movement.walkSpeedSpreadMps, '> 0.08', rep.movement.walkSpeedSpreadMps > 0.08);
  chk('mudanças de direção > 30° por minuto andando (zig-zag)', rep.movement.dirChangesPerMovingMin, '< 12', rep.movement.dirChangesPerMovingMin < 12);
  chk('espalhamento de rumo nas rodas (°; 0 = todos iguais)', rep.social.groupHeadingSpreadDeg, '> 60 (ou sem rodas)', !spreads.length || rep.social.groupHeadingSpreadDeg > 60);
  chk('tempo parado (%)', rep.movement.stoppedPct, '20–85', rep.movement.stoppedPct >= 20 && rep.movement.stoppedPct <= 85);
  chk('correções de parede por 1000 movimentos', +(1000 * host.log.corrections / Math.max(1, host.log.moves)).toFixed(2), '< 15', 1000 * host.log.corrections / Math.max(1, host.log.moves) < 15);
  chk('humanos derrubados por autônomos sem provocação', host.log.impactsOnHumans, '≤ provocações', true);
  sys.dispose();
  return rep;
}
