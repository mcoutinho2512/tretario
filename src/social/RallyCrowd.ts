/**
 * Multidão de CONCENTRAÇÃO (ambiente, só instanciada): centenas de pessoas ao redor dos pontos de concentração
 * (trio, carros de som, palco) — dançando, batendo palmas, com bandeiras e cartazes — custando o mesmo que a
 * multidão instanciada da rede (VAT + itens instanciados; nenhum esqueleto, nenhuma física).
 *
 *  - Quantidade pelos DADOS do evento (`social.rallyCrowd`, referência para o preset ALTO) e sempre dentro do teto de
 *    humanos do preset: cede lugar à multidão real da rede (jogadores) quando ela cresce.
 *  - Lugares no anel de cada ponto, distribuição orgânica (mais gente perto do veículo); fora de prédios.
 *  - Mesma agenda social dos pedestres (crowdSocial.ts): ações irregulares e desfasadas, itens/designs pelo evento.
 *  - O ponto andou (trio em movimento)? Cada pessoa caminha até o novo lugar (sem teletransporte).
 *  - Rodada 9.1: os mais PRÓXIMOS da câmera disputam o esqueleto no orçamento (como pedestres e remotos) e ganham um
 *    HumanCharacter de um pool por corpo — antes eram sempre instanciados (LOD2/LOD3 a 2–5 m do jogador: facetados).
 */
import { BODY, type BodyRef } from '../physics/bodies'; // rodada 12 — colisão
import { staggerClipFor } from '../combat/animSelect';
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { HumanCharacter } from '../characters/human/HumanCharacter';
import type { Lod } from '../characters/human/HumanAssets';
import { packLook } from '../characters/garments';
import { NPC_CLIPS } from '../npc/PedestrianSystem';
import { seeded, turnToward } from '../npc/gait';
import type { CharacterAppearance } from '../characters/bodyTypes';
import type { CrowdDirector } from '../characters/crowd/CrowdDirector';
import { createAgent, type CrowdAgent } from '../characters/crowd/crowdBudget';
import { randomAppearance, type BodyType } from '../characters/bodyTypes';
import { SocialSchedule, rng, type SocialCrowdConfig, type SocialProfile } from './crowdSocial';
import { supAt, supporterData, supporterOutfit } from '../supporters/data'; // rodada 10 — concentrações de torcida
import { PROP_BY_KIND } from './props';
import { RallyRegistry, rallyPoints } from './rally';
import { startNpcReaction, stepNpcReaction, type NpcHittable, type NpcReaction, type NpcTarget, npcDownPhase } from '../combat/npcHits';

const BODIES: BodyType[] = ['homem', 'mulher', 'homem', 'mulher', 'idoso', 'idosa'];
const BODY_INDEX: Record<BodyType, number> = { homem: 0, mulher: 1, idoso: 2, idosa: 3 };
const BODIES_OF: BodyType[] = ['homem', 'mulher', 'idoso', 'idosa'];

interface Member {
  agent: CrowdAgent;
  schedule: SocialSchedule;
  seed: number;
  point: string;
  /** lugar no anel (ângulo/raio sorteados): segue o ponto quando ele anda */
  u1: number; u2: number;
  x: number; z: number; heading: number; speed: number;
  /** desvio individual de rumo (ninguém olha exatamente para o mesmo ponto) */
  look: number;
  /** golpe recebido (src/combat/npcHits.ts): recua/cai/curva-se e depois volta ao lugar no anel */
  react: NpcReaction | null;
  app: CharacterAppearance;
  /** esqueleto emprestado do pool (só quando o orçamento concede) */
  skin: Skin | null;
}

/** personagem com esqueleto do pool (reaproveitado entre membros do mesmo corpo) */
interface Skin { human: HumanCharacter; body: BodyType; lod: number; acc: number; social: string; downPh?: 'down' | 'getup' | null }
/** fração do orçamento de esqueletos que a concentração pode ocupar, e até que distância da câmera (m) */
const RALLY_SKIN_SHARE = 0.5;
const RALLY_SKIN_DIST = 10;
/** esqueletos livres guardados por corpo (além disso são descartados) */
const POOL_SPARE = 3;

export class RallyCrowd implements NpcHittable {
  private members: Member[] = [];
  private version = -1;
  private ids = '';
  private time = 0;
  /** referência do evento para o preset ALTO (0 = desligado) */
  private target = 0;
  stats = { members: 0, submitted: 0, points: 0, reacted: 0, hits: 0, reacting: 0, skinned: 0, pool: 0 };

  /** esqueletos dos membros mais próximos (adicionar à cena) */
  readonly group = new THREE.Group();
  private pool: Skin[] = [];
  /** sombra dos esqueletos até esta distância (m; preset) */
  shadowDistance = 0;

  constructor(private world: CollisionWorld, private crowd: CrowdDirector, private cfg: SocialCrowdConfig) {
    this.group.name = 'rally_skinned';
  }

  private acquire(m: Member): Skin {
    const body = BODIES_OF[m.agent.body];
    const i = this.pool.findIndex((k) => k.body === body);
    let k: Skin;
    if (i >= 0) { k = this.pool.splice(i, 1)[0]; k.human.resetPose(); k.human.setAppearance(m.app); k.human.setVariant(m.seed); }
    else {
      const human = new HumanCharacter(m.app, { lod: 2, castShadow: false, clips: NPC_CLIPS, seed: m.seed });
      human.root.rotation.order = 'YXZ'; // rumo, depois a inclinação da queda
      this.group.add(human.root);
      k = { human, body, lod: 2, acc: 0, social: '' };
    }
    k.human.root.visible = false;
    k.social = '';
    m.skin = k;
    return k;
  }

  private release(m: Member) {
    const k = m.skin;
    if (!k) return;
    m.skin = null;
    k.human.root.visible = false;
    k.human.root.rotation.x = 0;
    k.human.animator?.stopClip(); k.downPh = null;
    if (this.pool.filter((x) => x.body === k.body).length >= POOL_SPARE) k.human.dispose();
    else this.pool.push(k);
  }

  /** um quadro do esqueleto de um membro (o orçamento concedeu tier 2 no quadro anterior) */
  private drawSkin(m: Member, tilt: number, nowS: number) {
    const ag = m.agent;
    const k = m.skin ?? this.acquire(m);
    const h = k.human;
    if (ag.lod !== k.lod) { h.setLod(ag.lod as Lod); k.lod = ag.lod; }
    // sombra só bem perto: na concentração densa os esqueletos são muitos e cada sombra é mais um passe por camada
    h.setShadow(ag.dist < Math.min(this.shadowDistance, 12));
    // ação/item da agenda: só quando muda (a fase segue o relógio local da ação)
    const key = `${ag.act}:${ag.prop}:${ag.design}:${Math.round(ag.actAt * 10)}`;
    if (key !== k.social) {
      k.social = key;
      h.setSocial({ act: ag.act, phase: Math.max(0, nowS - ag.actAt), variation: m.seed & 7, prop: ag.prop, design: ag.design });
    }
    ag.skinReady = h.showingDetail;
    h.root.visible = ag.skinReady;
    // rodada 9.1: derrubado com esqueleto → clipes (cai sentado `npc_down`, levanta `getup`), sem inclinar rígido
    const ph = npcDownPhase(m.react);
    if (ph !== (k.downPh ?? null)) {
      if (ph === 'down') h.animator?.playClip('npc_down', true);
      else if (ph === 'getup') { h.animator?.stopClip('npc_down'); h.animator?.playClip('getup'); }
      else h.animator?.stopClip('npc_down');
      k.downPh = ph;
    }
    const down = m.react?.kind === 'down';
    h.root.position.set(ag.x, ag.y + (tilt > 0 && !down ? 0.12 * Math.sin(tilt) : 0), ag.z);
    h.root.rotation.y = ag.heading;
    h.root.rotation.x = down ? 0 : -tilt;
    k.acc += this.dt;
    if (this.crowd.shouldAnimate(ag)) { h.animator?.update(ag.speed, true, k.acc); h.updateProps(k.acc); k.acc = 0; }
  }
  private dt = 0;
  private near: number[] = [];

  /** escala do preset (também vale para os NPCs reservados dos pontos de evento) */
  private scale = 1;

  setConfig(cfg: SocialCrowdConfig | undefined, presetScale: number) {
    this.cfg = cfg ?? { activity: 0.25, propShare: 0.06 };
    this.scale = presetScale;
    this.target = Math.round((cfg?.rallyCrowd ?? 0) * presetScale);
    this.version = -1; this.ids = '\u0000'; // redistribui
  }

  /** distribui as pessoas entre os pontos ativos, proporcional à força × área do anel */
  private rebuild() {
    for (const m of this.members) this.release(m);
    this.members = [];
    // rodada 10: pontos com NPCs RESERVADOS (eventos agendados: caminhada, torcidas) primeiro — o teto do preset corta o
    // fim da lista, e o público reservado de um evento não deve sumir atrás da multidão de ambiente dos trios
    const pts = rallyPoints.all().filter((p) => p.strength > 0).sort((a, b) => (b.crowd ? 1 : 0) - (a.crowd ? 1 : 0));
    this.stats.points = pts.length;
    // pontos com NPCs reservados (eventos agendados, rodada 9) ficam fora da divisão proporcional de rallyCrowd
    if ((!this.target && !pts.some((p) => p.crowd)) || !pts.length) return;
    const w = pts.map((p) => (p.crowd ? 0 : p.strength * (p.radius * p.radius - p.inner * p.inner)));
    const tw = w.reduce((s, x) => s + x, 0) || 1;
    let seed = 7;
    pts.forEach((p, k) => {
      const n = p.crowd ? Math.round(p.crowd * this.scale) : Math.round((this.target * w[k]) / tw);
      for (let i = 0; i < n; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const r = rng(seed);
        // lugar fora de prédios: algumas tentativas no anel
        let u1 = r(), u2 = r(), spot = RallyRegistry.spotFor(p, u1, u2);
        for (let t = 0; t < 6 && this.blocked(spot.x, spot.z); t++) { u1 = r(); u2 = r(); spot = RallyRegistry.spotFor(p, u1, u2); }
        if (this.blocked(spot.x, spot.z)) continue;
        const body = BODIES[seed % BODIES.length];
        const app = randomAppearance(seed, body);
        // rodada 10 — concentração de TORCIDA (dados): a maioria veste a camisa, parte leva bandeira/faixa das cores
        const sup = p.sup ? supAt(supporterData(), p.sup) : null;
        let profile: SocialProfile | undefined;
        if (sup) {
          const o = supporterOutfit(sup);
          if (r() < 0.8) Object.assign(app, { topStyle: 'camiseta', shirtDesign: o.shirtDesign, top: o.top }, r() < 0.35 && o.bottom !== undefined ? { bottom: o.bottom } : {});
          const roll = r();
          const flags = sup.flagSet, banners = sup.bannerSet;
          if (roll < 0.4 && flags.length) profile = { prop: PROP_BY_KIND.get(roll < 0.12 ? 'flag_large' : 'flag_small')!.id, design: flags[Math.floor(r() * flags.length)] };
          else if (roll < 0.5 && banners.length) profile = { prop: PROP_BY_KIND.get('banner')!.id, design: banners[Math.floor(r() * banners.length)] };
          else if (roll < 0.9) profile = { prop: 0, design: 0 };
        }
        const agent = createAgent({ maxTier: 1, body: BODY_INDEX[body], skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, scale: app.scale, look: packLook(app), shirt: app.shirtDesign ?? 0, x: spot.x, z: spot.z });
        this.members.push({
          agent, seed, point: p.id, u1, u2, x: spot.x, z: spot.z, heading: Math.atan2(p.x - spot.x, p.z - spot.z), speed: 0,
          look: (r() - 0.5) * 0.5, schedule: new SocialSchedule(seed, this.cfg, profile), react: null, app, skin: null,
        });
      }
    });
    this.stats.members = this.members.length;
  }

  private blocked(x: number, z: number): boolean {
    const pos = { x, y: 0, z };
    this.world.resolveCircle(pos, 0.3, 1.7);
    return Math.hypot(pos.x - x, pos.z - z) > 0.05;
  }

  update(dt: number) {
    this.time += dt;
    this.dt = dt;
    // redistribui quando o CONJUNTO de pontos ativos muda (andar não muda: cada um acompanha a pé)
    if (this.version !== rallyPoints.version) {
      this.version = rallyPoints.version;
      const ids = rallyPoints.all().filter((p) => p.strength > 0).map((p) => p.id).sort().join(',');
      if (ids !== this.ids) { this.ids = ids; this.rebuild(); }
    }
    // teto do preset: a multidão real (rede) tem prioridade
    const room = Math.max(0, Math.floor(this.crowd.budget.total * 0.75) - this.crowd.othersCount);
    const n = Math.min(this.members.length, room);
    const nowS = performance.now() / 1000;
    let reacting = 0, skinned = 0;
    for (let i = n; i < this.members.length; i++) if (this.members[i].skin) this.release(this.members[i]);
    // só os K mais próximos da câmera (distância do quadro anterior) PODEM disputar o esqueleto: a concentração é
    // densa e, sem teto, ocupava todo o orçamento do preset (24–32 esqueletos de NPC: CPU 6 → 15 ms no ALTO); metade do orçamento, até 10 m
    const k = Math.max(2, Math.round(this.crowd.budget.skinned * RALLY_SKIN_SHARE));
    this.near.length = 0;
    for (let i = 0; i < n; i++) { const a = this.members[i].agent; if (a.dist < RALLY_SKIN_DIST) this.near.push(i); }
    if (this.near.length > k) this.near.sort((x, y) => this.members[x].agent.dist - this.members[y].agent.dist);
    for (let i = 0; i < n; i++) this.members[i].agent.maxTier = 1;
    for (let j = 0; j < Math.min(k, this.near.length); j++) this.members[this.near[j]].agent.maxTier = 2;
    for (let i = 0; i < n; i++) {
      const m = this.members[i];
      const p = rallyPoints.get(m.point);
      if (!p) { if (m.skin) this.release(m); continue; }
      const ag = m.agent;
      let tilt = 0;
      if (m.react) {
        // atingido: recua na direção do golpe, inclina (instanciado: tilt), sem ação/item; no fim volta a pé ao lugar
        reacting++;
        const st = stepNpcReaction(m.react, dt);
        if (st.step > 0 && !this.blocked(m.x + m.react.dx * st.step, m.z + m.react.dz * st.step)) { m.x += m.react.dx * st.step; m.z += m.react.dz * st.step; }
        ag.x = m.x; ag.z = m.z; ag.y = this.world.groundHeight(m.x, m.z); ag.heading = m.heading; ag.speed = 0;
        tilt = ag.tilt = st.done ? 0 : st.tilt; ag.act = 0; ag.prop = 0;
        if (st.done) m.react = null;
      } else {
        // lugar atual no anel (o ponto pode ter andado): vai a pé até lá, no ritmo próprio, girando o corpo aos poucos
        const spot = RallyRegistry.spotFor(p, m.u1, m.u2);
        const dx = spot.x - m.x, dz = spot.z - m.z, d = Math.hypot(dx, dz);
        if (d > 0.6) {
          const pace = 1.05 + seeded(m.seed, 1) * 0.3;
          // chegando: desacelera nos últimos ~1,5 m (sem parar de golpe e patinar)
          m.speed += (pace * Math.min(1, d / 1.5 + 0.25) - m.speed) * (1 - Math.exp(-3 * dt));
          m.heading = turnToward(m.heading, Math.atan2(dx, dz), dt);
          // anda na direção do corpo (com o giro limitado, sem andar de lado), corrigindo para o lugar
          const st = Math.min(d, m.speed * dt);
          const hx = Math.sin(m.heading), hz = Math.cos(m.heading), dot = Math.max(0, (hx * dx + hz * dz) / d);
          m.x += (hx * 0.6 + (dx / d) * 0.4) * st * dot; m.z += (hz * 0.6 + (dz / d) * 0.4) * st * dot;
        } else {
          m.speed = Math.max(0, m.speed - dt * 2.2);
          const want = Math.atan2(p.x - m.x, p.z - m.z) + m.look;
          m.heading = turnToward(m.heading, want, dt, 2, 1.5);
        }
        const sc = m.schedule;
        sc.update(this.time, m.speed > 0.3, p);
        ag.x = m.x; ag.z = m.z; ag.y = this.world.groundHeight(m.x, m.z); ag.heading = m.heading; ag.speed = m.speed;
        ag.act = sc.act; ag.actAt = nowS - Math.max(0, this.time - sc.startedAt);
        ag.prop = sc.profile.prop; ag.design = sc.profile.design;
      }
      this.crowd.submit(ag, 'ped');
      // esqueleto concedido pelo orçamento (quadro anterior) e à vista; senão o instanciado desenha
      if (ag.tier === 2 && (ag.inView || ag.dist < 3)) { this.drawSkin(m, tilt, nowS); skinned++; }
      else { ag.skinReady = false; if (m.skin) this.release(m); }
    }
    this.stats.submitted = n;
    this.stats.reacting = reacting;
    this.stats.skinned = skinned;
    this.stats.pool = this.pool.length;
  }

  /**
   * rodada 12 — colisão (src/physics/LocalBodies.ts): membros a ≤ r de (x, z) CEDEM ao corpo do jogador (até `maxStep`
   * m por chamada, nunca para dentro de prédio) e entram em `out` como corpos MACIOS. Voltam a pé ao lugar no anel:
   * concentração densa resiste a quem passa, sem bloquear para sempre. Caído não é corpo. Devolve quantos.
   */
  yieldBodies(x: number, z: number, selfR: number, r: number, maxStep: number, soft: number, out: BodyRef[]): number {
    let n = 0;
    for (let i = 0; i < this.stats.submitted && i < this.members.length; i++) {
      const m = this.members[i];
      if (m.react?.kind === 'down' || Math.abs(m.x - x) > r || Math.abs(m.z - z) > r) continue;
      const dx = m.x - x, dz = m.z - z, d = Math.hypot(dx, dz), R = selfR + BODY.radius;
      if (d < R && d > 1e-4) {
        const st = Math.min(R - d, maxStep);
        const nx = m.x + (dx / d) * st, nz = m.z + (dz / d) * st;
        if (!this.blocked(nx, nz)) { m.x = nx; m.z = nz; }
      }
      out.push({ id: `rally:${i}`, x: m.x, z: m.z, r: BODY.radius, soft });
      n++;
    }
    return n;
  }

  /** QA: membros a até `r` m de (x, z) — representação decidida pelo orçamento */
  qaNear(x: number, z: number, r = 8) {
    return this.members.filter((m) => Math.hypot(m.x - x, m.z - z) < r).map((m) => ({ x: +m.x.toFixed(1), z: +m.z.toFixed(1), tier: m.agent.tier, lod: m.agent.lod, inView: m.agent.inView, dist: +m.agent.dist.toFixed(1), skin: !!m.skin, ready: m.agent.skinReady }));
  }

  /** membros desenhados agora a até `r` m (caixa) — atingíveis pelo golpe local (src/combat/npcHits.ts) */
  npcTargetsNear(x: number, z: number, r: number, out: NpcTarget[]) {
    for (let i = 0; i < this.stats.submitted && i < this.members.length; i++) {
      const m = this.members[i];
      if (m.react?.kind === 'down' || Math.abs(m.x - x) > r || Math.abs(m.z - z) > r) continue;
      out.push({ x: m.x, z: m.z, react: (k, dx, dz, kb) => {
        m.react = startNpcReaction(k, dx, dz, kb);
        if (k === 'down') m.heading = Math.atan2(-dx, -dz); // cai de costas, de frente para quem bateu
        // com esqueleto: sem ação/item durante a reação e o mesmo clipe dos pedestres (cambaleio / desorientado)
        if (m.skin) {
          m.skin.human.setSocial({ act: 0, phase: 0, variation: 0, prop: 0, design: 0 }); m.skin.social = '';
          if (k !== 'down') m.skin.human.animator?.playClip(k === 'flinch' ? 'disoriented' : staggerClipFor(dx, dz, m.heading)); // rodada 10: direcional
        }
        this.stats.hits++;
      } });
    }
  }

  /**
   * rodada 9 — a plateia NPC de um ponto REAGE (aplauso/comemoração do debate): uma fração determinística dos membros
   * (semente comum → todos os clientes veem o mesmo grupo) entra na ação com fases desfasadas. Local, sem rede.
   */
  react(pointId: string, actionIds: readonly number[], seed: number, share = 0.45, dur = 3.2): number {
    if (!actionIds.length) return 0;
    let n = 0;
    for (const m of this.members) {
      if (m.point !== pointId) continue;
      const h = Math.imul((m.seed ^ seed) >>> 0, 2654435761) >>> 0;
      if ((h % 1000) / 1000 >= share) continue;
      const phase = ((h >>> 10) % 700) / 1000; // fase desfasada: ninguém bate palma em uníssono
      m.schedule.force(this.time - phase, actionIds[(h >>> 4) % actionIds.length], dur + ((h >>> 16) % 900) / 1000);
      n++;
    }
    this.stats.reacted += n;
    return n;
  }

  /** escala do preset em relação ao ALTO (teto total de humanos) */
  static presetScale(total: number): number {
    return Math.max(0.15, Math.min(1.4, total / 600));
  }
}
