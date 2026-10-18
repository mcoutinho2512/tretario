/**
 * Golpe em NPC de AMBIENTE (decisão do dono 2026-10-18: "bater em todos") — só no CLIENTE. Pedestres
 * (src/npc/PedestrianSystem.ts) e a multidão de concentração (src/social/RallyCrowd.ts) são locais de cada cliente:
 * o servidor não os conhece nem os valida, e o golpe neles não afeta ninguém mais.
 *
 *  alvo      a MESMA definição do golpe (public/gameplay/combat.json: alcance + folga, arco + folga), mais perto
 *            primeiro, no máximo `maxTargets` (padrão 1; spray 3) e nunca mais que NPC_HIT.maxTargets
 *  reação    'stagger' cambaleia e recua · 'down' cai deitado ~3,4 s e levanta (chute final, empurrão, taco, barra)
 *            · 'flinch' mãos nos olhos (spray) — `npcReaction` da ação ou derivada do impacto. Sem sangue/lesão.
 *  custo     só quando a janela ativa do golpe LOCAL chega; cada sistema entrega só os NPCs perto (caixa de poucos m)
 *
 * Puro (sem three.js/DOM): escolha e linha do tempo da reação são testáveis (tests/npcHits.test.ts).
 */
import { inArc } from './data';
import type { CombatActionDefinition } from './types';

export type NpcReactionKind = 'stagger' | 'down' | 'flinch';

export const NPC_HIT = {
  /** teto de NPCs por golpe (custo limitado) */
  maxTargets: 3,
  /** caindo → deitado → levantando (s) */
  fallS: 0.35, downS: 3.4, getupS: 0.8,
  /** cambaleio e mãos nos olhos (s) — durações dos clipes `stagger`/`disoriented` */
  staggerS: 0.8, flinchS: 2.4,
  /** recuo: parte do empurrão do golpe nos primeiros instantes (m mínimos) */
  minKnockM: 0.3,
} as const;

/** NPC candidato (posição) e a reação aplicada pelo sistema dono dele */
export interface NpcTarget { x: number; z: number; react(kind: NpcReactionKind, dx: number, dz: number, knockM: number): void }
/** sistema com NPCs atingíveis: põe em `out` os NPCs a até `r` m de (x, z) */
export interface NpcHittable { npcTargetsNear(x: number, z: number, r: number, out: NpcTarget[]): void }

/** reação de um golpe em NPC (dado `npcReaction`; senão: spray → flinch, queda → down, resto → stagger) */
export function npcReactionFor(def: Pick<CombatActionDefinition, 'npcReaction' | 'impact'>): NpcReactionKind {
  if (def.npcReaction) return def.npcReaction;
  if (def.impact.disorientMs) return 'flinch';
  if (def.impact.state === 'KNOCKED_DOWN') return 'down';
  return 'stagger';
}

/**
 * índices dos alvos atingidos (pura): dentro de alcance + folga e arco + folga à frente de `h`, mais perto primeiro,
 * até min(maxTargets da ação, NPC_HIT.maxTargets)
 */
export function selectNpcTargets(
  o: { x: number; z: number; h: number },
  def: Pick<CombatActionDefinition, 'range' | 'arcDeg' | 'maxTargets'>,
  slack: { rangeSlackM: number; arcSlackDeg: number },
  cands: readonly { x: number; z: number }[],
): number[] {
  const reach = def.range + slack.rangeSlackM;
  const max = Math.min(NPC_HIT.maxTargets, Math.max(1, def.maxTargets ?? 1));
  const hit: { i: number; d: number }[] = [];
  cands.forEach((c, i) => {
    const d = Math.hypot(c.x - o.x, c.z - o.z);
    if (d <= reach && inArc(o.x, o.z, o.h, c.x, c.z, def.arcDeg, slack.arcSlackDeg)) hit.push({ i, d });
  });
  return hit.sort((a, b) => a.d - b.d).slice(0, max).map((x) => x.i);
}

/** golpe local na janela ativa: junta candidatos dos sistemas, escolhe, aplica; devolve quantos reagiram */
export function hitNpcs(
  systems: readonly (NpcHittable | null | undefined)[],
  o: { x: number; z: number; h: number },
  def: CombatActionDefinition,
  slack: { rangeSlackM: number; arcSlackDeg: number },
): number {
  const cands: NpcTarget[] = [];
  const r = def.range + slack.rangeSlackM;
  for (const s of systems) s?.npcTargetsNear(o.x, o.z, r, cands);
  if (!cands.length) return 0;
  const kind = npcReactionFor(def);
  const sel = selectNpcTargets(o, def, slack, cands);
  for (const i of sel) {
    const c = cands[i], dx0 = c.x - o.x, dz0 = c.z - o.z, l = Math.hypot(dx0, dz0);
    const dx = l > 0.05 ? dx0 / l : Math.sin(o.h), dz = l > 0.05 ? dz0 / l : Math.cos(o.h);
    c.react(kind, dx, dz, kind === 'flinch' ? 0 : Math.max(NPC_HIT.minKnockM, def.impact.knockback));
  }
  return sel.length;
}

/** reação em curso de um NPC (null = normal) */
export interface NpcReaction { kind: NpcReactionKind; t: number; dur: number; dx: number; dz: number; knockM: number; moved: number }

export function startNpcReaction(kind: NpcReactionKind, dx: number, dz: number, knockM: number): NpcReaction {
  const dur = kind === 'down' ? NPC_HIT.fallS + NPC_HIT.downS + NPC_HIT.getupS : kind === 'flinch' ? NPC_HIT.flinchS : NPC_HIT.staggerS;
  return { kind, t: 0, dur, dx, dz, knockM, moved: 0 };
}

/**
 * avança a reação: `tilt` (rad; + = deitado de costas até π/2, − = curvado para a frente), deslocamento deste quadro
 * na direção do golpe (o sistema confere calçada/parede) e se acabou
 */
export function stepNpcReaction(r: NpcReaction, dt: number): { tilt: number; step: number; done: boolean } {
  r.t += dt;
  // recuo nos primeiros 0,3 s (desacelerando)
  const kbT = 0.3, want = r.knockM * (1 - (1 - Math.min(1, r.t / kbT)) ** 2);
  const step = Math.max(0, want - r.moved);
  r.moved = want;
  let tilt = 0;
  if (r.kind === 'down') {
    const a = NPC_HIT.fallS, b = a + NPC_HIT.downS;
    tilt = r.t < a ? (Math.PI / 2) * (r.t / a) ** 2 : r.t < b ? Math.PI / 2 : (Math.PI / 2) * Math.max(0, 1 - (r.t - b) / NPC_HIT.getupS);
  } else if (r.kind === 'stagger') tilt = 0.28 * Math.sin(Math.PI * Math.min(1, r.t / r.dur));
  else tilt = -0.22 * Math.min(1, r.t / 0.3, Math.max(0, (r.dur - r.t) / 0.4));
  return { tilt, step, done: r.t >= r.dur };
}
