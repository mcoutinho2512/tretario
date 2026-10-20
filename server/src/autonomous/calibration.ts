/**
 * Rodada 12 (agente G) — CALIBRAÇÃO do mundo dinâmico com o mundo INTEGRADO (puro, sem rede): população de autônomos
 * no mapa real (paredes/eixo/pontos do manifesto), o DIRETOR de eventos ligado como na sala, humanos PARADOS (um perto
 * da Central, um no meio do eixo, um perto do palco e um longe do eixo, ~270 m, numa vaga de bicicletas), um deles
 * provocando de vez em quando. Relógio simulado a 10 Hz; o SimHost tem a proteção de retorno da sala (5 s ao aparecer e
 * ao levantar). Nada é forçado: tudo o que acontece EMERGE.
 *
 * Mede: discussões / brigas com golpes trocados / generalizadas (picos de participantes, adesões por avaliação),
 * revide × fuga por personalidade quando um humano agride, tamanho e curva das concentrações (quantas pessoas de fato
 * em volta do centro), autônomos perto de cada humano (inclusive o longe do eixo), distribuição de comportamento nos
 * 10 primeiros minutos e por janela de 10 min, custo de IA. `server/tools/autonomous_report.ts calib` grava
 * docs/bench/round12_calibration.json.
 */
import { loadWorld } from '../world.ts';
import { AutonomousSystem, ACTIVITIES, type Activity } from './AutonomousSystem.ts';
import { SimHost, manifestHotspots } from './simHost.ts';
import { supporters } from '../supporters/service.ts';
import { EVENT_VEHICLE_KINDS } from '../../../src/net/rules.ts';
import { DynamicWorldDirector, type DynHistory } from '../world/DynamicWorldDirector.ts';
import { loadDynamicWorld, type DynamicWorldConfig } from '../world/dynamicConfig.ts';
import type { Personality } from './types.ts';

export type { ConflictEpisode, GatheringEpisode, CalibrationReport } from './calibrationTypes.ts';
import type { ConflictEpisode, GatheringEpisode, CalibrationReport } from './calibrationTypes.ts';

const LV = ['CALMO', 'TENSAO', 'CONFRONTO', 'GENERALIZADO'];
const pct = (t: Record<Activity, number>) => { const tot = ACTIVITIES.reduce((s, a) => s + t[a], 0) || 1; return Object.fromEntries(ACTIVITIES.map((a) => [a, +(100 * t[a] / tot).toFixed(1)])); };

export function runCalibration(opts: { agents?: number; minutes?: number; seed?: number; provokeEveryS?: number; config?: DynamicWorldConfig; farHuman?: boolean } = {}): CalibrationReport {
  const W = loadWorld();
  const m = W.manifest;
  const axis = (m.pvAxis ?? []) as [number, number][];
  const vehicles = (m.vehicleSpawns ?? []).filter((v) => !EVENT_VEHICLE_KINDS.has(v.kind)).map((v) => ({ id: v.id, kind: v.kind, x: v.x, z: v.z, heading: v.heading }));
  const host = new SimHost({ walls: W.walls, bounds: m.bounds as [number, number, number, number], axis, hotspots: manifestHotspots(m), vehicles });
  const N = opts.agents ?? 180, minutes = opts.minutes ?? 60, seed0 = opts.seed ?? 12;
  let dyn: DynamicWorldDirector | null = null;
  const sys = new AutonomousSystem(host, { population: N, seed: seed0, supporters: supporters(), roleOf: (id) => dyn?.roleOf(id) ?? null });
  host.onHumanHit = (by, tgt, x, z) => dyn?.onAggression(by, tgt, x, z, host.t);
  let seed = seed0 * 7919;
  dyn = new DynamicWorldDirector(opts.config ?? loadDynamicWorld(), sys, { broadcast: () => {} }, { clock: () => host.t, axis, rng: () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) });
  // golpes: atribuídos ao foco de quem bateu/apanhou (papel no diretor) — e revide de quem foi provocado
  const hitsBy = new Map<string, { hits: number; attackers: Set<string> }>();
  const actsBy = new Map<string, number>();
  host.sys = {
    onSelfMessage: (id, t, msg) => sys.onSelfMessage(id, t, msg),
    onCombat: (kind, by, tgt, r, now) => {
      sys.onCombat(kind, by, tgt, r, now);
      const bid = sys.idOfNid(by) ?? '';
      if (kind === 'act' && bid) actsBy.set(bid, host.t);
      if (kind !== 'hit' || r !== 'hit') return;
      const tid = tgt ? sys.idOfNid(tgt) ?? '' : '';
      const ev = dyn!.roleOf(bid)?.eventId ?? dyn!.roleOf(tid)?.eventId;
      if (!ev) return;
      const h = hitsBy.get(ev) ?? { hits: 0, attackers: new Set() };
      h.hits++; h.attackers.add(bid); hitsBy.set(ev, h);
    },
  };
  // humanos PARADOS: Central, meio do eixo, perto do palco e (opcional) longe do eixo numa vaga a ~270 m
  const A = sys.axis;
  const spots: { id: string; x: number; z: number }[] = [];
  const central = m.landmarks?.find((l: { name: string }) => /Central/.test(l.name)) as { center: [number, number] } | undefined;
  const c0 = central ? A.at(A.project(central.center[0], central.center[1]).s, 8) : A.at(A.len * 0.2, 6);
  spots.push({ id: 'h_central', x: c0.x, z: c0.z });
  const mid = A.at(A.len * 0.5, -6); spots.push({ id: 'h_meio', x: mid.x, z: mid.z });
  const st = manifestHotspots(m).find((h) => h.kind === 'stage');
  spots.push({ id: 'h_palco', x: (st?.x ?? A.at(A.len * 0.85).x) + 6, z: (st?.z ?? A.at(A.len * 0.85).z) + 4 });
  if (opts.farHuman !== false) {
    // vaga de veículos do mundo mais perto de 270 m do eixo (onde o jogador estaciona longe da avenida)
    let far: { x: number; z: number } | null = null, best = Infinity;
    for (const v of vehicles) { const d = Math.abs(A.project(v.x, v.z).d - 270); if (d < best && host.clear(v.x, v.z, v.x + 1, v.z)) { best = d; far = { x: v.x + 2, z: v.z + 2 }; } }
    if (far) spots.push({ id: 'h_longe', ...far });
  }
  for (const s of spots) host.addHuman(s.id, s.x, s.z);
  const provoker = 'h_meio';
  const ticks = Math.round(minutes * 600);
  const t0 = performance.now();
  let aiMs = 0, aiMax = 0;
  // acompanhamento por foco/reunião
  const conf = new Map<string, ConflictEpisode & { lastF: number; startAt: number }>();
  const gath = new Map<string, GatheringEpisode & { startAt: number }>();
  const near = new Map<string, { min: number; sum60: number; sum100: number; zero: number; n: number }>();
  const tmp: { id: string; x: number; z: number; personality: Personality; sup: number; goal: never; group?: string }[] = [];
  const prov: { at: number; target: string; personality: Personality; outcome: '' | 'revide' | 'fuga' | 'outro' }[] = [];
  const windows: Record<string, number>[] = [];
  let last10: Record<Activity, number> = { ...sys.stats.timeMs };
  let activity10min: Record<string, number> = {};
  const every = opts.provokeEveryS ?? 75;
  let hold = 0;
  for (let k = 0; k < ticks; k++) {
    host.advance(100);
    const now = host.t;
    // provocação: o humano do meio vai até o autônomo livre mais perto (≤ 60 m) e dá um soco
    if (every > 0 && k % (every * 10) === every * 5 && k > 3000) {
      const h = host.ents.get(provoker)!;
      let best: { id: string; d: number; x: number; z: number } | null = null;
      for (const e of host.ents.values()) { if (e.human || e.status !== 0 || e.vehicle) continue; const d = Math.hypot(e.x - h.x, e.z - h.z); if (d < 60 && (!best || d < best.d) && !dyn.roleOf(e.id)?.role.match(/FIGHT|ARGUE/)) best = { id: e.id, d, x: e.x, z: e.z }; }
      if (best) {
        const e = host.ents.get(best.id)!;
        h.x = e.x - Math.sin(e.heading) * 0.9; h.z = e.z - Math.cos(e.heading) * 0.9; h.last = { x: h.x, y: 0, z: h.z, t: now }; h.immuneUntil = 0;
        if (host.humanAttack(provoker, 1, Math.atan2(e.x - h.x, e.z - h.z))) { const d = sys.debug(best.id)!; prov.push({ at: now, target: best.id, personality: d.personality, outcome: '' }); hold = k + 150; }
      }
    }
    // provocado: revidou (golpeou), fugiu (AVOID_FIGHT) ou outro — decidido em até 12 s
    for (const p of prov) {
      if (p.outcome || now - p.at > 12_000) { if (!p.outcome) p.outcome = 'outro'; continue; }
      if ((actsBy.get(p.target) ?? 0) > p.at + 50) p.outcome = 'revide';
      else if (sys.debug(p.target)?.goal === 'AVOID_FIGHT') p.outcome = 'fuga';
    }
    // o provocador volta para o lugar depois (fica parado como os outros)
    if (hold && k === hold) { const h = host.ents.get(provoker)!; const s = spots.find((x) => x.id === provoker)!; h.x = s.x; h.z = s.z; h.last = { x: s.x, y: 0, z: s.z, t: now }; hold = 0; }
    dyn.tick(now);
    const a0 = performance.now();
    sys.tick(100);
    const dt = performance.now() - a0; aiMs += dt; if (dt > aiMax) aiMax = dt;
    if (k % 10 !== 0) continue;
    // 1 Hz: focos e reuniões
    for (const e of dyn.list()) {
      const d = dyn.debug(e.id)!;
      if (d.family === 'conflict') {
        let c = conf.get(e.id);
        if (!c) { c = { id: e.id, startMin: +((k / 600).toFixed(2)), durS: 0, maxLevel: e.escalation, kinds: [e.kind], peakFighters: 0, peakWatchers: 0, hits: 0, attackers: 0, maxJoinPerEval: 0, fighterSteps: [], humanSide: !!d.human, end: '', origin: '', crowdAtStart: sys.near(e.x, e.z, 18, tmp as never), lastF: 0, startAt: now }; conf.set(e.id, c); }
        if (!c.kinds.includes(e.kind)) c.kinds.push(e.kind);
        if (LV.indexOf(e.escalation) > LV.indexOf(c.maxLevel)) c.maxLevel = e.escalation;
        const f = (d.roles.FIGHT ?? 0) + (d.human && e.escalation !== 'TENSAO' ? 1 : 0);
        if (f !== c.lastF) { if (f > c.lastF) c.maxJoinPerEval = Math.max(c.maxJoinPerEval, f - c.lastF); c.fighterSteps.push(f); c.lastF = f; }
        c.peakFighters = Math.max(c.peakFighters, f); c.peakWatchers = Math.max(c.peakWatchers, d.roles.WATCH ?? 0);
        c.durS = Math.round((now - c.startAt) / 1000);
      } else if (d.family === 'gathering') {
        let g = gath.get(e.id);
        if (!g) { g = { id: e.id, kinds: [e.kind], startMin: +((k / 600).toFixed(2)), durS: 0, peakMembers: 0, peakArrived: 0, peakCrowd: 0, curve: [], members: [e.participants], end: '', startAt: now }; gath.set(e.id, g); }
        if (!g.kinds.includes(e.kind)) g.kinds.push(e.kind);
        const crowd = sys.near(e.x, e.z, e.r, tmp as never);
        g.peakMembers = Math.max(g.peakMembers, e.participants); g.peakArrived = Math.max(g.peakArrived, d.arrived); g.peakCrowd = Math.max(g.peakCrowd, crowd);
        if (k % 300 === 0) { g.curve.push(crowd); g.members.push(e.participants); }
        g.durS = Math.round((now - g.startAt) / 1000);
      }
    }
    // autônomos perto de cada humano
    for (const s of spots) {
      const h = host.ents.get(s.id)!;
      let n60 = 0, n100 = 0;
      for (const e of host.ents.values()) { if (e.human) continue; const dd = Math.hypot(e.x - h.x, e.z - h.z); if (dd < 100) { n100++; if (dd < 60) n60++; } }
      const q = near.get(s.id) ?? { min: Infinity, sum60: 0, sum100: 0, zero: 0, n: 0 };
      if (k > 1200) { q.min = Math.min(q.min, n60); q.sum60 += n60; q.sum100 += n100; if (n60 === 0) q.zero++; q.n++; }
      near.set(s.id, q);
    }
    // janelas de 10 min
    if (k > 0 && k % 6000 === 0) {
      const cur = sys.stats.timeMs, w = {} as Record<Activity, number>;
      for (const a of ACTIVITIES) w[a] = cur[a] - last10[a];
      windows.push(pct(w));
      if (windows.length === 1) activity10min = windows[0];
      last10 = { ...cur };
    }
  }
  const ends = new Map<string, string>(), origins = new Map<string, string>();
  for (const h of dyn.history as DynHistory[]) { if (h.ev === 'end') ends.set(h.id, h.detail ?? ''); if (h.ev === 'start') origins.set(h.id, h.detail ?? 'espontanea'); }
  const episodes: ConflictEpisode[] = [...conf.values()].map(({ lastF: _l, startAt: _s, ...c }) => ({ ...c, hits: hitsBy.get(c.id)?.hits ?? 0, attackers: hitsBy.get(c.id)?.attackers.size ?? 0, end: ends.get(c.id) ?? 'vivo', origin: origins.get(c.id) ?? '' }));
  const gEpisodes: GatheringEpisode[] = [...gath.values()].map(({ startAt: _s, ...g }) => ({ ...g, end: ends.get(g.id) ?? 'vivo' }));
  const arrivedSorted = gEpisodes.map((g) => g.peakCrowd).sort((a, b) => a - b);
  const byP: CalibrationReport['provocation']['byPersonality'] = {};
  for (const p of prov) { const b = (byP[p.personality] ??= { n: 0, revide: 0, fuga: 0, outro: 0 }); b.n++; b[p.outcome || 'outro']++; }
  const rep: CalibrationReport = {
    agents: N, humans: spots.map((s) => ({ ...s, lat: +A.project(s.x, s.z).d.toFixed(0) })), simMinutes: minutes, wallMs: Math.round(performance.now() - t0), seed: seed0,
    conflicts: {
      discussions: episodes.length,
      fights: episodes.filter((c) => LV.indexOf(c.maxLevel) >= 2).length,
      fightsWithExchange: episodes.filter((c) => LV.indexOf(c.maxLevel) >= 2 && c.attackers >= 2 && c.hits >= 2).length,
      generalized: episodes.filter((c) => c.maxLevel === 'GENERALIZADO').length,
      provoked: episodes.filter((c) => c.humanSide).length,
      spontaneous: episodes.filter((c) => !c.humanSide).length,
      peakFighters: Math.max(0, ...episodes.map((c) => c.peakFighters)), peakWatchers: Math.max(0, ...episodes.map((c) => c.peakWatchers)),
      episodes, seedFunnel: { ...dyn.stats.seed }, reactions: { ...dyn.stats.reactions },
    },
    provocation: { total: prov.length, byPersonality: byP },
    gatherings: { count: gEpisodes.length, peakArrivedMax: arrivedSorted.at(-1) ?? 0, peakArrivedMedian: arrivedSorted[Math.floor(arrivedSorted.length / 2)] ?? 0, withAtLeast15: arrivedSorted.filter((x) => x >= 15).length, episodes: gEpisodes },
    nearHumans: Object.fromEntries([...near].map(([id, q]) => [id, { minWithin60: q.min === Infinity ? 0 : q.min, avgWithin60: +(q.sum60 / Math.max(1, q.n)).toFixed(1), avgWithin100: +(q.sum100 / Math.max(1, q.n)).toFixed(1), zeroSamplesPct: +(100 * q.zero / Math.max(1, q.n)).toFixed(1) }])),
    activity10min, activityTotal: pct(sys.stats.timeMs), activityWindows: windows,
    lod: { ...sys.lodCount },
    cost: { aiMsPerTick: +(aiMs / ticks).toFixed(3), aiMsMaxTick: +aiMax.toFixed(2), directorMsPerTick: +dyn.avgMs.toFixed(3), directorMsMax: +dyn.stats.msMax.toFixed(2), decisionsPerSec: +(sys.stats.decisions / (minutes * 60)).toFixed(1) },
  };
  sys.dispose();
  return rep;
}
