/**
 * Vida social da multidão de NPCs (puro, determinístico, testável): quem carrega o quê, quando faz qual ação.
 *
 *  - Perfil por agente (semente): item (bandeira, cartaz…) e design — com pesos do EVENTO (dados).
 *  - Agenda irregular: pausas e ações de duração variável; início desfasado por semente (40 pessoas nunca começam
 *    a bater palmas no mesmo quadro).
 *  - Ponto de concentração por perto (trio, carro de som): pesos do ponto somam-se aos do evento.
 *  - Andando: só ações que permitem movimento (andar com bandeira/cartaz, palmas, acenar).
 *
 * NEUTRALIDADE: o peso de uma família de designs (`family:campaign`) é dividido IGUALMENTE entre os designs dela;
 * nenhuma campanha recebe mais presença que outra a não ser que o operador do evento configure explicitamente
 * (por chave de design) — e isso fica nos dados do evento, não no código.
 */
import { ACTIONS, ACTION_BY_KEY, type ActionDefinition } from './actions';
import { PROPS, PROP_BY_ID } from './props';
import { DESIGNS, type Design } from './designs';
import { RALLY_DEFAULT_WEIGHTS, type RallyPoint } from './rally';

export interface SocialCrowdConfig {
  /** fração do tempo parado em que o NPC está fazendo alguma ação (0..1) */
  activity: number;
  /** fração dos NPCs que carregam um item */
  propShare: number;
  /** pesos de ações por chave (somam-se aos pesos padrão `crowdWeight`; 0 desliga) */
  actionWeights?: Record<string, number>;
  /** pesos de itens por kind (padrão: `crowdWeight` do item) */
  propWeights?: Record<string, number>;
  /** pesos de designs por chave ou por família (`family:campaign`, `family:brasil`…); padrão: `crowdWeight` */
  designWeights?: Record<string, number>;
  /** multidão de concentração (instanciada) ao redor do trio/carros de som/palco — referência para o preset ALTO */
  rallyCrowd?: number;
}

export const DEFAULT_SOCIAL: SocialCrowdConfig = { activity: 0.25, propShare: 0.06 };

/** PRNG pequeno e determinístico (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(items: T[], weight: (t: T) => number, u: number): T | null {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return null;
  let r = u * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r < 0) return it;
  }
  return items[items.length - 1] ?? null;
}

/** peso de um design para o evento (família dividida igualmente entre seus membros) */
export function designWeight(d: Design, cfg: SocialCrowdConfig, familySize: Map<string, number>): number {
  const w = cfg.designWeights;
  if (w && d.key in w) return w[d.key];
  const fam = `family:${d.family}`;
  if (w && fam in w) return w[fam] / Math.max(1, familySize.get(d.family) ?? 1);
  return d.crowdWeight ?? 0;
}

export interface SocialProfile { prop: number; design: number }

/** item e design de um NPC (determinístico pela semente) */
export function pickProfile(seed: number, cfg: SocialCrowdConfig): SocialProfile {
  const r = rng(seed ^ 0x9e3779b9);
  if (r() >= cfg.propShare) return { prop: 0, design: 0 };
  const props = PROPS.filter((p) => (cfg.propWeights?.[p.kind] ?? p.crowdWeight) > 0);
  const p = pickWeighted(props, (x) => cfg.propWeights?.[x.kind] ?? x.crowdWeight, r());
  if (!p) return { prop: 0, design: 0 };
  if (!p.designSlot) return { prop: p.id, design: 0 };
  const pool = DESIGNS.filter((d) => d.targets.includes(p.designSlot!));
  const famSize = new Map<string, number>();
  for (const d of pool) famSize.set(d.family, (famSize.get(d.family) ?? 0) + 1);
  const d = pickWeighted(pool, (x) => designWeight(x, cfg, famSize), r());
  return { prop: p.id, design: d?.id ?? 0 };
}

/** a ação é possível para este NPC agora? (item exigido, movimento) */
export function actionFits(a: ActionDefinition, prop: number, moving: boolean): boolean {
  if (moving && !a.allowMove) return false;
  if (a.needs) {
    const p = PROP_BY_ID.get(prop);
    if (!p || !a.needs.includes(p.kind)) return false;
  }
  return true;
}

/** escolhe uma ação (ou nenhuma) com os pesos do evento + ponto de concentração */
export function pickAction(u: number, prop: number, moving: boolean, cfg: SocialCrowdConfig, rally?: RallyPoint | null): ActionDefinition | null {
  const rallyW = rally ? { ...RALLY_DEFAULT_WEIGHTS[rally.kind], ...(rally.actionWeights ?? {}) } : null;
  const w = (a: ActionDefinition) => {
    if (!actionFits(a, prop, moving)) return 0;
    let x = cfg.actionWeights?.[a.key] ?? a.crowdWeight ?? 0;
    if (rallyW) x += rallyW[a.key] ?? 0;
    // quem carrega item prefere usá-lo (levantar/balançar)
    if (a.needs && prop) x *= 3;
    return x;
  };
  return pickWeighted(ACTIONS as ActionDefinition[], w, u);
}

/**
 * Agenda de um NPC: alterna "nada" e ações com durações irregulares. `update` devolve a ação corrente
 * (0 = nenhuma) e o instante de início (s) — o chamador aplica ao personagem só quando muda.
 */
export class SocialSchedule {
  act = 0;
  startedAt = 0;
  private until = 0;
  private r: () => number;

  constructor(seed: number, private cfg: SocialCrowdConfig, public profile: SocialProfile = pickProfile(seed, cfg)) {
    this.r = rng(seed);
    // início desfasado: cada NPC "acorda" num momento diferente
    this.until = this.r() * 6;
  }

  setConfig(cfg: SocialCrowdConfig) { this.cfg = cfg; }

  /** t: segundos (relógio local); moving: andando agora; rally: ponto ativo por perto (aumenta a atividade) */
  update(t: number, moving: boolean, rally: RallyPoint | null): boolean {
    const cur = this.act ? ACTION_BY_KEY.get(ACTIONS.find((a) => a.id === this.act)?.key ?? '') : null;
    // andar interrompe ação que não permite movimento
    if (cur && moving && !cur.allowMove) { this.end(t); return true; }
    if (t < this.until) return false;
    if (this.act) { this.end(t); return true; }
    const activity = Math.min(0.95, this.cfg.activity + (rally ? 0.35 * rally.strength : 0));
    if (this.r() > activity) { this.until = t + 2 + this.r() * 6; return false; }
    const a = pickAction(this.r(), this.profile.prop, moving, this.cfg, rally);
    if (!a) { this.until = t + 3 + this.r() * 5; return false; }
    this.act = a.id;
    this.startedAt = t;
    this.until = t + (a.mode === 'once' ? (a.duration ?? 2) : 4 + this.r() * (rally ? 14 : 8));
    return true;
  }

  /** rodada 9 — reação a um estímulo (plateia do debate): ação `id` de `t` por `dur` s, depois a agenda normal segue */
  force(t: number, id: number, dur: number) {
    this.act = id;
    this.startedAt = t;
    this.until = t + dur;
  }

  private end(t: number) {
    this.act = 0;
    this.startedAt = t;
    this.until = t + 1 + this.r() * 5; // pausa irregular
  }
}
