/**
 * Palco de debate no MUNDO (rodada 9): marcas dos lugares na frente do palco (src/events/debate.ts debateSeats — a
 * mesma conta do servidor; sem física nova) e a plateia NPC reagindo. Muda só quando chega o estado `dbt`
 * (≤ 2 Hz): nada por quadro além do pulso do lugar de quem fala (uma escala, sem DOM).
 */
import * as THREE from 'three';
import { debateSeats, crowdReactionSeed, type DebateStateWire } from './debate';
import { ACTION_BY_KEY } from '../social/actions';
import type { RallyCrowd } from '../social/RallyCrowd';

const FREE = 0x8fd8ff, TAKEN = 0xffffff, SPEAKER = 0xffcc33;
/** ações de plateia por reação (ações existentes) */
const NPC_ACTIONS = {
  aplauso: ['clap', 'rhythm_clap'],
  positiva: ['cheer', 'arms_up', 'thumbs_up'],
  negativa: ['talk'],
} as const;

export class DebateStage {
  readonly group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private mats: THREE.MeshBasicMaterial[] = [];
  private t = 0;
  private last: DebateStateWire | null = null;
  stats = { npcReactions: 0, states: 0 };

  constructor(readonly spot: { id: string; x: number; z: number; heading: number }, seats: number, heightAt: (x: number, z: number) => number, private crowd: RallyCrowd | null) {
    this.group.name = 'debate_stage';
    this.group.userData.category = 'world/event';
    const geo = new THREE.RingGeometry(0.42, 0.6, 28);
    geo.rotateX(-Math.PI / 2);
    for (const p of debateSeats(spot, seats)) {
      const mat = new THREE.MeshBasicMaterial({ color: FREE, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, heightAt(p.x, p.z) + 0.04, p.z);
      m.renderOrder = 2;
      this.group.add(m);
      this.rings.push(m); this.mats.push(mat);
    }
    this.group.visible = false;
  }

  /** estado novo do servidor: cores dos lugares e reação da plateia NPC à contagem que subiu */
  apply(st: DebateStateWire | null) {
    const prev = this.last;
    this.last = st;
    this.stats.states++;
    this.group.visible = !!st?.active;
    if (!st) return;
    st.seats.forEach((n, i) => {
      const mat = this.mats[i];
      if (!mat) return;
      mat.color.setHex(i === 0 && n ? SPEAKER : n ? TAKEN : FREE);
      mat.opacity = n ? 0.85 : 0.45;
    });
    if (!this.crowd || !prev || prev.inst !== st.inst || prev.turn !== st.turn) return;
    // a plateia NPC acompanha a reação que mais subiu desde o último estado (determinística: mesma semente em todos)
    let best: keyof typeof NPC_ACTIONS | null = null, gain = 0;
    for (const k of Object.keys(NPC_ACTIONS) as (keyof typeof NPC_ACTIONS)[]) {
      const d = st.reactions[k] - prev.reactions[k];
      if (d > gain) { gain = d; best = k; }
    }
    if (!best) return;
    const ids = NPC_ACTIONS[best].map((k) => ACTION_BY_KEY.get(k)?.id ?? 0).filter(Boolean);
    const total = st.reactions.aplauso + st.reactions.positiva + st.reactions.negativa;
    // negativas: poucos NPCs (discordância discreta); aplauso/positiva: mais gente, crescendo com o volume
    const share = best === 'negativa' ? 0.12 : Math.min(0.7, 0.25 + gain * 0.08);
    this.stats.npcReactions += this.crowd.react(`stage_${this.spot.id}`, ids, crowdReactionSeed(st.inst, st.turn, total), share);
  }

  /** pulso do lugar de quem fala (só escala) */
  update(dt: number) {
    if (!this.group.visible || !this.last?.speaker) return;
    this.t += dt;
    const s = 1 + Math.sin(this.t * 4) * 0.12;
    this.rings[0]?.scale.set(s, 1, s);
  }
}
