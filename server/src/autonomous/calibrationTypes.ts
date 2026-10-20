/** Rodada 12 (agente G) — forma do relatório de calibração (server/src/autonomous/calibration.ts); sem imports do servidor (os testes leem o tipo). */
export interface ConflictEpisode {
  id: string; startMin: number; durS: number; maxLevel: string; kinds: string[];
  peakFighters: number; peakWatchers: number; hits: number; attackers: number; maxJoinPerEval: number;
  /** contagem de quem briga a cada avaliação em que mudou (adesões graduais) */
  fighterSteps: number[]; humanSide: boolean; end: string;
  /** como nasceu (sonda espontânea, encontro de torcidas, provocado) e quantas pessoas a ≤ 18 m no início */
  origin: string; crowdAtStart: number;
}
export interface GatheringEpisode {
  id: string; kinds: string[]; startMin: number; durS: number; peakMembers: number; peakArrived: number; peakCrowd: number;
  /** pessoas a ≤ r do centro a cada 30 s (crowd) e membros do evento no mesmo instante (cresce por adesões, esvazia) */
  curve: number[]; members: number[]; end: string;
}
export interface CalibrationReport {
  agents: number; humans: { id: string; x: number; z: number; lat: number }[]; simMinutes: number; wallMs: number; seed: number;
  conflicts: { discussions: number; fights: number; fightsWithExchange: number; generalized: number; provoked: number; spontaneous: number; peakFighters: number; peakWatchers: number; episodes: ConflictEpisode[]; seedFunnel: Record<string, number>; reactions: Record<string, number> };
  provocation: { total: number; byPersonality: Record<string, { n: number; revide: number; fuga: number; outro: number }> };
  gatherings: { count: number; peakArrivedMax: number; peakArrivedMedian: number; withAtLeast15: number; episodes: GatheringEpisode[] };
  nearHumans: Record<string, { minWithin60: number; avgWithin60: number; avgWithin100: number; zeroSamplesPct: number }>;
  activity10min: Record<string, number>; activityTotal: Record<string, number>; activityWindows: Record<string, number>[];
  lod: Record<string, number>; cost: { aiMsPerTick: number; aiMsMaxTick: number; directorMsPerTick: number; directorMsMax: number; decisionsPerSec: number };
}

