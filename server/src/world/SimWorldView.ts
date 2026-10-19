/**
 * Rodada 12 — MUNDO SIMULADO para testes e medição do diretor do mundo dinâmico (tests/dynamicWorld.test.ts). Implementa
 * a `AutonomousWorldView` do contrato com N agentes, personalidades e torcidas, sem física nem rede: anda em linha reta
 * até o alvo, aceita propostas conforme a personalidade e cansa de brigar (stamina). NÃO é o sistema de autônomos do
 * AGENTE C — é só um dublê fiel à INTERFACE (o diretor não sabe a diferença).
 */
import type { AutonomousWorldView, Goal, GoalKind, Personality } from '../autonomous/types';

export interface SimAgent {
  id: string; x: number; z: number; personality: Personality; sup: number; group?: string;
  goal: GoalKind; until: number; target?: string; tx?: number; tz?: number; eventId?: string;
  /** briga: segundos brigando e quanto aguenta (stamina) */
  fightS: number; stamina: number; speed: number;
}

export interface SimOptions {
  n: number;
  rng: () => number;
  /** retângulo onde nascem e passeiam */
  area?: { x0: number; x1: number; z0: number; z1: number };
  /** personalidade sorteada por peso (ausente = uniforme) */
  mix?: Partial<Record<Personality, number>>;
  /** fração com torcida e quantas torcidas (índices 1..k) */
  supShare?: number; sups?: number;
  /** fração com grupo de amigos (ids g0..gK) */
  groupShare?: number; groups?: number;
  humans?: { id: string; x: number; z: number }[];
}

const ALL: Personality[] = ['SOCIAL', 'OBSERVADOR', 'AGITADO', 'TORCEDOR', 'MANIFESTANTE', 'EXPLORADOR', 'CURIOSO', 'CONFRONTADOR', 'CAUTELOSO'];
/** aceitação por personalidade (o "cérebro" do dublê) — brigar depende muito dela; o resto quase sempre aceita */
const FIGHT_ACCEPT: Record<Personality, number> = { SOCIAL: 0.5, OBSERVADOR: 0.3, AGITADO: 0.95, TORCEDOR: 0.8, MANIFESTANTE: 0.5, EXPLORADOR: 0.4, CURIOSO: 0.4, CONFRONTADOR: 1, CAUTELOSO: 0.1 };
const STAMINA: Record<Personality, number> = { SOCIAL: 20, OBSERVADOR: 15, AGITADO: 45, TORCEDOR: 35, MANIFESTANTE: 25, EXPLORADOR: 20, CURIOSO: 15, CONFRONTADOR: 60, CAUTELOSO: 8 };

export class SimWorldView implements AutonomousWorldView {
  agents: SimAgent[] = [];
  humansList: { id: string; x: number; z: number }[];
  now = 0;
  proposals = 0;
  private byId = new Map<string, SimAgent>();
  private area: NonNullable<SimOptions['area']>;

  constructor(private o: SimOptions) {
    this.area = o.area ?? { x0: -200, x1: 200, z0: -40, z1: 40 };
    this.humansList = o.humans ?? [];
    const mix = o.mix ?? Object.fromEntries(ALL.map((p) => [p, 1]));
    const keys = Object.keys(mix) as Personality[];
    const tot = keys.reduce((s, k) => s + (mix[k] ?? 0), 0);
    for (let i = 0; i < o.n; i++) {
      let x = o.rng() * tot, p: Personality = keys[0];
      for (const k of keys) { x -= mix[k] ?? 0; if (x < 0) { p = k; break; } }
      const sup = o.rng() < (o.supShare ?? 0) ? 1 + Math.floor(o.rng() * (o.sups ?? 2)) : 0;
      const group = o.rng() < (o.groupShare ?? 0) ? `g${Math.floor(o.rng() * (o.groups ?? 10))}` : undefined;
      this.add({ id: `a${i}`, x: this.rx(), z: this.rz(), personality: p, sup, ...(group ? { group } : {}) });
    }
  }

  private rx() { return this.area.x0 + this.o.rng() * (this.area.x1 - this.area.x0); }
  private rz() { return this.area.z0 + this.o.rng() * (this.area.z1 - this.area.z0); }

  add(a: Pick<SimAgent, 'id' | 'x' | 'z' | 'personality' | 'sup'> & Partial<SimAgent>): SimAgent {
    const s: SimAgent = { goal: 'WANDER', until: 0, fightS: 0, stamina: STAMINA[a.personality], speed: 1.2 + this.o.rng() * 0.4, ...a };
    this.agents.push(s); this.byId.set(s.id, s);
    return s;
  }
  get(id: string) { return this.byId.get(id); }

  // ---------------------------------------------------------------- AutonomousWorldView
  near(x: number, z: number, r: number, out: Parameters<AutonomousWorldView['near']>[3]): number {
    const r2 = r * r;
    let n = 0;
    for (const a of this.agents) {
      const dx = a.x - x, dz = a.z - z;
      if (dx * dx + dz * dz > r2) continue;
      if (n >= out.length) break;
      const o = out[n++];
      o.id = a.id; o.x = a.x; o.z = a.z; o.personality = a.personality; o.sup = a.sup; o.goal = a.goal;
      if (a.group !== undefined) o.group = a.group; else delete o.group;
    }
    return n;
  }

  humans() { return this.humansList; }

  propose(id: string, goal: Omit<Goal, 'source'>, weight: number): boolean {
    this.proposals++;
    const a = this.byId.get(id);
    if (!a) return false;
    const base = goal.kind === 'JOIN_FIGHT' ? FIGHT_ACCEPT[a.personality] : 0.92;
    if (this.o.rng() >= base * (0.6 + 0.4 * weight)) return false;
    a.goal = goal.kind; a.until = goal.until; a.target = goal.target; a.eventId = goal.eventId;
    a.tx = goal.x; a.tz = goal.z;
    if (goal.kind === 'JOIN_FIGHT') a.fightS = 0;
    if (goal.kind === 'WANDER' || goal.kind === 'LEAVE_AREA' || goal.kind === 'AVOID_FIGHT') {
      const ang = this.o.rng() * Math.PI * 2;
      const fx = goal.x ?? a.x, fz = goal.z ?? a.z;
      a.tx = fx + Math.cos(ang) * 60; a.tz = fz + Math.sin(ang) * 60; a.target = undefined;
    }
    return true;
  }

  heat(x: number, z: number, r: number) {
    const r2 = r * r;
    let combatants = 0, crowd = 0;
    for (const a of this.agents) {
      const dx = a.x - x, dz = a.z - z;
      if (dx * dx + dz * dz > r2) continue;
      if (a.goal === 'JOIN_FIGHT') combatants++;
      else if (a.goal !== 'WANDER' && a.goal !== 'TRAVEL' && a.goal !== 'LEAVE_AREA') crowd++;
    }
    return { combatants, crowd, hitsPerMin: combatants >= 2 ? combatants * 8 : 0 };
  }

  // ---------------------------------------------------------------- passo
  step(dtMs: number, now: number) {
    this.now = now;
    const dt = dtMs / 1000;
    for (const a of this.agents) {
      if (a.goal === 'JOIN_FIGHT') {
        a.fightS += dt;
        if (a.fightS > a.stamina) { a.goal = 'LEAVE_AREA'; a.until = now + 30_000; a.target = undefined; a.tx = a.x + (this.o.rng() - 0.5) * 80; a.tz = a.z + (this.o.rng() - 0.5) * 80; }
      }
      if (a.until && now > a.until && a.goal !== 'WANDER') { a.goal = 'WANDER'; a.target = undefined; a.tx = this.rx(); a.tz = this.rz(); a.until = now + 120_000; }
      let tx = a.tx, tz = a.tz;
      if (a.target) { const t = this.byId.get(a.target) ?? this.humansList.find((h) => h.id === a.target); if (t) { tx = t.x; tz = t.z; } }
      if (a.goal === 'WANDER' && (tx === undefined || Math.hypot((tx ?? 0) - a.x, (tz ?? 0) - a.z) < 2)) { a.tx = this.rx(); a.tz = this.rz(); tx = a.tx; tz = a.tz; }
      if (tx === undefined || tz === undefined) continue;
      const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      // perto do alvo: para (reunião/briga/olhar); quem olha mantém distância
      const stopAt = a.goal === 'WATCH_FIGHT' || a.goal === 'WATCH_EVENT' ? 7 : a.goal === 'JOIN_FIGHT' || a.goal === 'SOCIALIZE' ? 1.2 : a.goal === 'TRAVEL' ? 0.5 : 3 + (a.id.length % 4);
      if (d <= stopAt) continue;
      const step = Math.min(d - stopAt, a.speed * (a.goal === 'AVOID_FIGHT' || a.goal === 'TRAVEL' ? 2.2 : 1) * dt);
      a.x += (dx / d) * step; a.z += (dz / d) * step;
    }
  }
}
