/**
 * Rastreador de zona (rodada 8): em que trecho da Presidente Vargas está um ponto (jogador, câmera de espectador,
 * alvo de missão na rodada 9), com HISTERESE — não pisca na fronteira.
 *
 * Duas proteções:
 *  - margem: enquanto o ponto estiver na zona atual ALARGADA (`marginT` no eixo, `marginM` na lateral), fica nela;
 *  - permanência: uma zona nova (ou "fora de todas") só vale depois de `dwellMs` contínuos como candidata.
 * Puro (sem DOM/three.js). Custo: uma projeção no eixo por `update` — chame a 2–5 Hz, não por quadro.
 */
import { projectOnAxis, type ZoneDefinition } from './zones';

type XZ = [number, number];

export interface ZoneTrackerOptions {
  /** tempo contínuo (ms) como candidata antes de trocar */
  dwellMs?: number;
  /** margem no eixo (fração do comprimento) que a zona atual ganha */
  marginT?: number;
  /** margem lateral (m) que a zona atual ganha */
  marginM?: number;
}

export interface ZoneChange {
  from: ZoneDefinition | null;
  to: ZoneDefinition | null;
}

export class ZoneTracker {
  current: ZoneDefinition | null = null;
  private candidate: ZoneDefinition | null = null;
  private candidateSince = 0;
  private started = false;
  private readonly dwellMs: number;
  private readonly marginT: number;
  private readonly marginM: number;

  constructor(private zones: readonly ZoneDefinition[], private axis: XZ[], opts: ZoneTrackerOptions = {}) {
    this.dwellMs = opts.dwellMs ?? 1200;
    this.marginT = opts.marginT ?? 0.006;
    this.marginM = opts.marginM ?? 20;
  }

  /** zona "crua" (sem histerese) em (x, z), com a zona atual alargada pela margem */
  rawAt(x: number, z: number): ZoneDefinition | null {
    const p = projectOnAxis(this.axis, x, z);
    const cur = this.current;
    if (cur && p.t >= cur.from - this.marginT && p.t <= cur.to + this.marginT && p.dist <= cur.halfWidth + this.marginM) return cur;
    for (const zn of this.zones) if (p.t >= zn.from && p.t <= zn.to && p.dist <= zn.halfWidth) return zn;
    return null;
  }

  /** atualiza com a posição em `nowMs`; devolve a troca (já com histerese) ou null */
  update(x: number, z: number, nowMs: number): ZoneChange | null {
    const raw = this.rawAt(x, z);
    if (!this.started) {
      // primeira amostra: entra direto (o aviso inicial mostra onde o jogador nasceu)
      this.started = true;
      this.candidate = raw;
      this.candidateSince = nowMs;
      if (raw === this.current) return null;
      const ch = { from: this.current, to: raw };
      this.current = raw;
      return ch;
    }
    if (raw === this.current) { this.candidate = raw; this.candidateSince = nowMs; return null; }
    if (raw !== this.candidate) { this.candidate = raw; this.candidateSince = nowMs; return null; }
    if (nowMs - this.candidateSince < this.dwellMs) return null;
    const ch = { from: this.current, to: raw };
    this.current = raw;
    return ch;
  }

  /** troca de alvo (ex.: espectador mudou de câmera): esquece a histerese e entra direto na próxima amostra */
  reset() { this.started = false; this.candidate = null; }
}

/** carrega `public/world/zones.json` */
export async function loadZones(base: string): Promise<ZoneDefinition[]> {
  const r = await fetch(`${base}zones.json`);
  if (!r.ok) throw new Error(`zones.json: ${r.status}`);
  const d = (await r.json()) as { zones?: ZoneDefinition[] };
  return Array.isArray(d.zones) ? d.zones : [];
}
