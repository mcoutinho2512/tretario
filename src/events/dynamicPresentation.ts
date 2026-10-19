/**
 * Rodada 12 — APRESENTAÇÃO dos eventos dinâmicos no cliente (puro). O diretor de eventos dinâmicos do servidor
 * (AGENTE E; server/src/autonomous/types.ts `DynamicEventState`) decide o que acontece; aqui só se traduz para:
 *   minimapa  uma marca AGREGADA por foco (nunca um ponto por pessoa): cor/tamanho pela intensidade, rótulo genérico
 *             (a escalada interna — CALMO/TENSAO/CONFRONTO/GENERALIZADO — nunca aparece literalmente)
 *   áudio     intensidade de multidão, comemoração e confronto no ponto (CrowdAudioAggregator: calor da célula)
 *
 * Interface TOLERANTE: aceita a lista crua (array ou `{ events: [...] }`), ignora o que não entende, limita a 32 focos.
 * Campos opcionais `crowdIntensity`/`cheering`/`combatIntensity` (0..1) mandados pelo servidor têm prioridade sobre a
 * dedução por tipo + escalada. Mensagem esperada: `dyn_events` (src/core/Game.ts) — combinar com o AGENTE E.
 */

export interface DynamicEventView {
  id: string;
  kind: string;
  x: number;
  z: number;
  r: number;
  escalation?: string;
  participants?: number;
  watchers?: number;
  crowdIntensity?: number;
  cheering?: number;
  combatIntensity?: number;
}

export interface DynamicAudio { crowd: number; cheer: number; combat: number }

export const DYN_MAX_EVENTS = 32;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const unit = (v: unknown): number | undefined => { const n = num(v); return n === undefined ? undefined : Math.max(0, Math.min(1, n)); };

/** lista crua do servidor → focos válidos (sem lançar) */
export function normalizeDynamicEvents(msg: unknown): DynamicEventView[] {
  const arr = Array.isArray(msg) ? msg : msg && typeof msg === 'object' && Array.isArray((msg as { events?: unknown }).events) ? (msg as { events: unknown[] }).events : [];
  const out: DynamicEventView[] = [];
  for (const e of arr) {
    if (out.length >= DYN_MAX_EVENTS) break;
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const x = num(o.x), z = num(o.z);
    if (x === undefined || z === undefined) continue;
    out.push({
      id: typeof o.id === 'string' ? o.id.slice(0, 64) : String(out.length),
      kind: typeof o.kind === 'string' ? o.kind.slice(0, 32).toUpperCase() : 'CONCENTRACAO',
      x, z, r: Math.max(4, Math.min(200, num(o.r) ?? 20)),
      escalation: typeof o.escalation === 'string' ? o.escalation.toUpperCase() : undefined,
      participants: num(o.participants), watchers: num(o.watchers),
      crowdIntensity: unit(o.crowdIntensity), cheering: unit(o.cheering), combatIntensity: unit(o.combatIntensity),
    });
  }
  return out;
}

/** perfil de cada tipo: [multidão, comemoração, confronto] na escalada calma */
const KIND_AUDIO: Record<string, [number, number, number]> = {
  CONCENTRACAO: [0.6, 0.2, 0], CAMINHADA: [0.5, 0.15, 0], MANIFESTACAO: [0.8, 0.35, 0], ENCONTRO_TORCIDAS: [0.8, 0.6, 0.05],
  DISCUSSAO: [0.4, 0, 0.25], BRIGA: [0.5, 0, 0.7], BRIGA_GENERALIZADA: [0.8, 0, 1], CORRIDA_IMPROVISADA: [0.4, 0.4, 0], FESTA: [0.7, 0.9, 0],
};
/** a escalada só soma tensão (confronto) e massa — nunca vira texto para o jogador */
const ESCALATION_BOOST: Record<string, number> = { CALMO: 0, TENSAO: 0.25, CONFRONTO: 0.55, GENERALIZADO: 0.85 };

export function dynamicEventAudio(ev: DynamicEventView): DynamicAudio {
  const [c0, h0, k0] = KIND_AUDIO[ev.kind] ?? [0.5, 0.2, 0];
  const esc = ESCALATION_BOOST[ev.escalation ?? 'CALMO'] ?? 0;
  const people = (ev.participants ?? 0) + (ev.watchers ?? 0) * 0.5;
  const mass = people > 0 ? Math.min(1, Math.sqrt(people / 60)) : 1;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  return {
    crowd: ev.crowdIntensity ?? cl((c0 + esc * 0.3) * (0.5 + 0.5 * mass)),
    cheer: ev.cheering ?? cl(h0 * (1 - esc * 0.6)),
    combat: ev.combatIntensity ?? cl(k0 + esc * (k0 > 0 ? 0.6 : 0.35)),
  };
}

/** rótulo genérico do minimapa (sem nome de grupo, sem escalada literal) */
const KIND_LABEL: Record<string, string> = {
  CONCENTRACAO: 'Concentração', CAMINHADA: 'Caminhada', MANIFESTACAO: 'Ato', ENCONTRO_TORCIDAS: 'Torcidas',
  DISCUSSAO: 'Agito', BRIGA: 'Confusão', BRIGA_GENERALIZADA: 'Confusão', CORRIDA_IMPROVISADA: 'Corrida', FESTA: 'Festa',
};

export interface DynamicMark { x: number; z: number; color: string; label?: string; r: number; ring?: string; pulse: number }

/** marca agregada do foco no minimapa: tamanho pela massa, cor pelo tom (festa/ato âmbar → confusão vermelha) */
export function dynamicEventMark(ev: DynamicEventView): DynamicMark {
  const a = dynamicEventAudio(ev);
  const hot = a.combat > 0.45;
  const r = 3 + Math.round(4 * a.crowd);
  return {
    x: ev.x, z: ev.z, r,
    color: hot ? '#ff5a4a' : a.cheer > 0.5 ? '#ffd34d' : '#ffb35c',
    ring: hot ? 'rgba(255, 90, 74, 0.35)' : 'rgba(255, 200, 110, 0.28)',
    label: KIND_LABEL[ev.kind],
    pulse: Math.max(a.combat, a.cheer * 0.6),
  };
}
