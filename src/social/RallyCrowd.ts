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
 */
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { CrowdDirector } from '../characters/crowd/CrowdDirector';
import { createAgent, type CrowdAgent } from '../characters/crowd/crowdBudget';
import { randomAppearance, type BodyType } from '../characters/bodyTypes';
import { SocialSchedule, rng, type SocialCrowdConfig } from './crowdSocial';
import { RallyRegistry, rallyPoints } from './rally';
import { startNpcReaction, stepNpcReaction, type NpcHittable, type NpcReaction, type NpcTarget } from '../combat/npcHits';

const BODIES: BodyType[] = ['homem', 'mulher', 'homem', 'mulher', 'idoso', 'idosa'];
const BODY_INDEX: Record<BodyType, number> = { homem: 0, mulher: 1, idoso: 2, idosa: 3 };

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
}

export class RallyCrowd implements NpcHittable {
  private members: Member[] = [];
  private version = -1;
  private ids = '';
  private time = 0;
  /** referência do evento para o preset ALTO (0 = desligado) */
  private target = 0;
  stats = { members: 0, submitted: 0, points: 0, reacted: 0, hits: 0, reacting: 0 };

  constructor(private world: CollisionWorld, private crowd: CrowdDirector, private cfg: SocialCrowdConfig) {}

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
    this.members = [];
    const pts = rallyPoints.all().filter((p) => p.strength > 0);
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
        const agent = createAgent({ maxTier: 1, body: BODY_INDEX[body], skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, scale: app.scale, x: spot.x, z: spot.z });
        this.members.push({
          agent, seed, point: p.id, u1, u2, x: spot.x, z: spot.z, heading: Math.atan2(p.x - spot.x, p.z - spot.z), speed: 0,
          look: (r() - 0.5) * 0.5, schedule: new SocialSchedule(seed, this.cfg), react: null,
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
    let reacting = 0;
    for (let i = 0; i < n; i++) {
      const m = this.members[i];
      const p = rallyPoints.get(m.point);
      if (!p) continue;
      if (m.react) {
        // atingido: recua na direção do golpe, inclina (instanciado: tilt), sem ação/item; no fim volta a pé ao lugar
        reacting++;
        const st = stepNpcReaction(m.react, dt);
        if (st.step > 0 && !this.blocked(m.x + m.react.dx * st.step, m.z + m.react.dz * st.step)) { m.x += m.react.dx * st.step; m.z += m.react.dz * st.step; }
        const ag = m.agent;
        ag.x = m.x; ag.z = m.z; ag.y = this.world.groundHeight(m.x, m.z); ag.heading = m.heading; ag.speed = 0;
        ag.tilt = st.done ? 0 : st.tilt; ag.act = 0; ag.prop = 0;
        if (st.done) m.react = null;
        this.crowd.submit(ag, 'ped');
        continue;
      }
      // lugar atual no anel (o ponto pode ter andado): vai a pé até lá
      const spot = RallyRegistry.spotFor(p, m.u1, m.u2);
      const dx = spot.x - m.x, dz = spot.z - m.z, d = Math.hypot(dx, dz);
      if (d > 0.6) {
        m.speed += (1.2 - m.speed) * (1 - Math.exp(-3 * dt));
        const st = Math.min(d, m.speed * dt);
        m.x += (dx / d) * st; m.z += (dz / d) * st;
        m.heading = Math.atan2(dx, dz);
      } else {
        m.speed = Math.max(0, m.speed - dt * 3);
        const want = Math.atan2(p.x - m.x, p.z - m.z) + m.look;
        let dh = want - m.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        m.heading += dh * (1 - Math.exp(-2 * dt));
      }
      const sc = m.schedule;
      sc.update(this.time, m.speed > 0.3, p);
      const ag = m.agent;
      ag.x = m.x; ag.z = m.z; ag.y = this.world.groundHeight(m.x, m.z); ag.heading = m.heading; ag.speed = m.speed;
      ag.act = sc.act; ag.actAt = nowS - Math.max(0, this.time - sc.startedAt);
      ag.prop = sc.profile.prop; ag.design = sc.profile.design;
      this.crowd.submit(ag, 'ped');
    }
    this.stats.submitted = n;
    this.stats.reacting = reacting;
  }

  /** membros desenhados agora a até `r` m (caixa) — atingíveis pelo golpe local (src/combat/npcHits.ts) */
  npcTargetsNear(x: number, z: number, r: number, out: NpcTarget[]) {
    for (let i = 0; i < this.stats.submitted && i < this.members.length; i++) {
      const m = this.members[i];
      if (m.react?.kind === 'down' || Math.abs(m.x - x) > r || Math.abs(m.z - z) > r) continue;
      out.push({ x: m.x, z: m.z, react: (k, dx, dz, kb) => {
        m.react = startNpcReaction(k, dx, dz, kb);
        if (k === 'down') m.heading = Math.atan2(-dx, -dz); // cai de costas, de frente para quem bateu
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
