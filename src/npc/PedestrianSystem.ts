/**
 * Pedestres NPC de ambiente (simulados no cliente, determinísticos por semente — ADR-003).
 *
 * - Nascem em calçadas/praças/canteiros num anel ao redor do jogador, preferencialmente fora da vista.
 * - Andam só onde é calçada (mapa de superfícies), desviam de prédios (raycast), uns dos outros e do jogador.
 * - Param às vezes (olham vitrines/esperam), velocidade conforme o corpo (idosos mais lentos).
 * - LOD: animação a cada N quadros conforme a distância, sombra só perto, culling manual por frustum.
 * - Com o CrowdDirector (orçamento único de humanos): cada pedestre é um agente que disputa o esqueleto com os
 *   jogadores remotos; fora do orçamento vira multidão instanciada, e a população cede lugar à multidão da rede
 *   (total de humanos limitado pelo preset).
 * Os mesmos personagens esqueletais do jogador → base pronta para NPCs autoritativos no servidor (fase 3/4).
 */
import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { createCharacter } from '../characters/CharacterMesh';
import { CharacterAnimator } from '../characters/CharacterAnimator';
import { BODY_TYPES, randomAppearance, type BodyType, type CharacterAppearance } from '../characters/bodyTypes';
import { packLook } from '../characters/garments';
import { HumanCharacter } from '../characters/human/HumanCharacter';
import type { Lod } from '../characters/human/HumanAssets';
import { createAgent, type CrowdAgent } from '../characters/crowd/crowdBudget';
import type { CrowdDirector } from '../characters/crowd/CrowdDirector';
import { pushOutOfBox } from '../net/rules';
import { DEFAULT_SOCIAL, SocialSchedule, pickProfile, rng, type SocialCrowdConfig } from '../social/crowdSocial';
import { rallyPoints, RallyRegistry, type RallyPoint } from '../social/rally';
import { ACTIONS } from '../social/actions';
import { PROPS } from '../social/props';
import type { SocialState } from '../social/types';
import { startNpcReaction, stepNpcReaction, type NpcHittable, type NpcReaction, type NpcReactionKind, type NpcTarget } from '../combat/npcHits';
import { seeded, turnToward } from './gait';

/** clipes que os NPCs carregam: locomoção + todos os de ações/itens (camada social) */
export const NPC_CLIPS = [...new Set(['idle', 'walk', 'jog', ...ACTIONS.map((a) => a.clip), ...PROPS.map((p) => p.carryClip)])];

const BODY_INDEX: Record<BodyType, number> = { homem: 0, mulher: 1, idoso: 2, idosa: 3 };
/** pedestres mínimos mesmo com multidão grande da rede (vida na calçada fora da manifestação) */
const MIN_PEDS = 4;

/** visual de um pedestre: personagem humano (LOD por distância) ou, se falhar, o procedural antigo */
interface PedVisual {
  mesh: THREE.Object3D;
  body: BodyType;
  setAppearance(a: CharacterAppearance): void;
  setShadow(on: boolean): void;
  setLod(d: number): void;
  /** ação social / item (no-op no personagem procedural antigo) */
  setSocial(s: SocialState): void;
  /** LOD decidido pelo orçamento da multidão */
  setLodDirect(l: Lod): void;
  /** clipe avulso (stagger/disoriented — golpe recebido); no-op no procedural antigo */
  playClip(name: string): void;
  /** individualidade da animação (fase, balanço do parado); no-op no procedural antigo */
  setVariant(seed: number): void;
  /** já há malha visível */
  ready(): boolean;
}
interface PedAnim { update(speed: number, grounded: boolean, dt: number): void }

function legacyVisual(app: CharacterAppearance): { rig: PedVisual; anim: PedAnim } {
  const r = createCharacter(app);
  const anim = new CharacterAnimator(r);
  return { rig: { mesh: r.mesh, body: r.body, setAppearance: (a) => r.setAppearance(a), setShadow: (on) => { r.mesh.castShadow = on; }, setLod() {}, setLodDirect() {}, setSocial() {}, playClip() {}, setVariant() {}, ready: () => true }, anim };
}
import type { PedCrossing } from '../world/types';
import type { SignalController } from '../traffic/SignalController';

interface Ped {
  rig: PedVisual;
  anim: PedAnim;
  x: number; z: number; y: number;
  heading: number;
  /** rumo VISÍVEL do corpo: segue `heading` com giro limitado (rodada 9.1 — sem virar de uma vez) */
  face: number;
  speed: number;
  cruise: number;
  idleTimer: number;
  walkTimer: number;
  animAcc: number;
  frame: number;
  active: boolean;
  /** walk/wait/cross: calçada e faixas · rally: indo para a concentração · gather: na concentração · react: atingido */
  mode: 'walk' | 'wait' | 'cross' | 'rally' | 'gather' | 'react';
  /** golpe recebido (src/combat/npcHits.ts): cambaleio/queda/mãos nos olhos em curso */
  react: NpcReaction | null;
  target: [number, number] | null;
  crossing: PedCrossing | null;
  waitTime: number;
  crossCooldown: number;
  /** ponta de faixa de pedestres para onde está indo */
  approach: [number, number] | null;
  /** contador de atualizações de comportamento (independe da animação/visibilidade) */
  tick: number;
  /** agente no orçamento de humanos (CrowdDirector) */
  agent: CrowdAgent;
  /** vida social (ações irregulares, item, design) — determinística por semente */
  schedule: SocialSchedule;
  /** semente deste pedestre (perfil social, lugar na concentração) */
  socialSeed: number;
  /** concentração: ponto, lugar no anel e até quando fica */
  rally: { id: string; spot: [number, number]; until: number } | null;
}

const BODY_MIX: BodyType[] = ['homem', 'mulher', 'homem', 'mulher', 'idoso', 'idosa', 'homem', 'mulher'];

export class PedestrianSystem implements NpcHittable {
  readonly group = new THREE.Group();
  private peds: Ped[] = [];
  private seed = 1;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  radius = 95;
  shadowDistance = 35;
  /** LOD mais detalhado permitido para NPCs (preset): 0 no HIGH/ULTRA, 1 no MEDIUM, 2 no LOW */
  maxDetail: Lod = 1;
  /** orçamento único de humanos (opcional: sem ele, todos os pedestres têm esqueleto, como antes) */
  crowd: CrowdDirector | null = null;
  stats = { active: 0, visible: 0, crossing: 0, waiting: 0, skinned: 0, limit: 0, hits: 0, reacting: 0, down: 0 };
  private crossings: PedCrossing[] = [];
  private crossGrid = new Map<string, number[]>();
  private signals: SignalController | null = null;

  /** vida social do evento ativo (dados do evento: atividade, itens, designs, pesos de ações) */
  private social: SocialCrowdConfig = DEFAULT_SOCIAL;
  setSocialConfig(cfg: SocialCrowdConfig | undefined) {
    this.social = cfg ?? DEFAULT_SOCIAL;
    for (const ped of this.peds) ped.active = false; // redistribui itens/designs
  }

  /** cores de grupos do evento ativo: parte dos NPCs se veste com elas */
  private palettes: { colors: number[]; share: number }[] = [];
  setGroupPalettes(p: { colors: number[]; share: number }[]) {
    this.palettes = p;
    for (const ped of this.peds) ped.active = false; // reveste a população
  }

  setCrossings(c: PedCrossing[], signals: SignalController) {
    this.crossings = c;
    this.signals = signals;
    c.forEach((x, i) => {
      for (const e of [x.a, x.b]) {
        const k = `${Math.floor(e[0] / 20)},${Math.floor(e[1] / 20)}`;
        (this.crossGrid.get(k) ?? this.crossGrid.set(k, []).get(k)!).push(i);
      }
    });
  }

  /** empurrão local (F sem jogador ao alcance; offline): o NPC à frente cai e levanta (mesma reação do golpe) */
  pushNear(x: number, z: number, dir: number, range = 1.8): boolean {
    for (const p of this.peds) {
      if (!p.active || p.react) continue;
      const dx = p.x - x, dz = p.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 1e-3) continue;
      if ((dx * Math.sin(dir) + dz * Math.cos(dir)) / d < 0.3) continue; // precisa estar à frente
      this.react(p, 'down', Math.sin(dir), Math.cos(dir), 0.9);
      return true;
    }
    return false;
  }

  /** NPCs atingíveis perto de (x, z) — só os ativos, caixa de `r` m (src/combat/npcHits.ts) */
  npcTargetsNear(x: number, z: number, r: number, out: NpcTarget[]) {
    for (const p of this.peds) {
      if (!p.active || p.react?.kind === 'down' || Math.abs(p.x - x) > r || Math.abs(p.z - z) > r) continue;
      out.push({ x: p.x, z: p.z, react: (k, dx, dz, kb) => this.react(p, k, dx, dz, kb) });
    }
  }

  /** QA: NPCs reagindo agora (posição, tipo, tempo) */
  reacting() { return this.peds.filter((p) => p.active && p.react).map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), kind: p.react!.kind, t: +p.react!.t.toFixed(2), skinned: p.rig.mesh.visible })); }

  /** golpe recebido: sai da calçada/faixa/concentração e reage; depois volta a passear */
  private react(p: Ped, kind: NpcReactionKind, dx: number, dz: number, knockM: number) {
    p.react = startNpcReaction(kind, dx, dz, knockM);
    p.mode = 'react'; p.target = null; p.approach = null; p.crossing = null; p.rally = null;
    p.speed = 0; p.idleTimer = 0;
    if (kind === 'down') p.heading = p.face = Math.atan2(-dx, -dz); // cai de costas, de frente para quem bateu
    p.rig.setSocial({ act: 0, phase: 0, variation: 0, prop: p.schedule.profile.prop, design: p.schedule.profile.design });
    p.agent.act = 0; p.agent.prop = 0; // instanciado inclinado: sem item solto no ar
    p.agent.priority = 0.5; // como jogador caído: disputa o esqueleto com vantagem
    if (kind !== 'down') p.rig.playClip(kind === 'flinch' ? 'disoriented' : 'stagger');
    this.stats.hits++;
  }

  /** um quadro da reação: recuo (calçada/parede), inclinação; no fim volta a andar */
  private stepReact(p: Ped, dt: number): number {
    const r = p.react!;
    const st = stepNpcReaction(r, dt);
    if (st.step > 0) {
      const pos = { x: p.x + r.dx * st.step, y: p.y, z: p.z + r.dz * st.step };
      this.world.resolveCircle(pos, 0.3, 1.7);
      if (this.world.isPedestrianWalkable(pos.x, pos.z)) { p.x = pos.x; p.z = pos.z; }
    }
    if (st.done) {
      p.react = null; p.mode = 'walk'; p.agent.priority = 1;
      p.speed = p.cruise; p.walkTimer = 4 + (p.tick % 5);
      this.applySocial(p);
      return 0;
    }
    return st.tilt;
  }

  /** posições de pedestres na pista (para os veículos frearem) */
  /** pedestres ativos a até `r` metros (veículos de jogadores param antes deles: ninguém é atropelado) */
  nearby(x: number, z: number, r: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const p of this.peds) if (p.active && Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) out.push({ x: p.x, z: p.z });
    return out;
  }

  /**
   * NPCs de ambiente abrem caminho para veículos de evento (trio, carro de som) em vez de travá-los: quem está
   * dentro da carroceria (+ folga) é empurrado para fora. Jogadores de verdade continuam bloqueando (servidor).
   */
  yieldTo(v: { x: number; z: number; heading: number; kind: string }) {
    for (const p of this.peds) {
      if (!p.active || Math.abs(p.x - v.x) > 9 || Math.abs(p.z - v.z) > 9) continue;
      const o = pushOutOfBox(p.x, p.z, v, 0.6);
      if (o) { p.x = o.x; p.z = o.z; }
    }
  }

  crossingPositions(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const p of this.peds) if (p.active && p.mode === 'cross') out.push({ x: p.x, z: p.z });
    return out;
  }

  /** procura uma ponta de faixa de pedestres a até `radius` metros */
  private nearCrossing(p: Ped, radius = 2.6): { c: PedCrossing; from: [number, number]; to: [number, number]; d: number } | null {
    const gx = Math.floor(p.x / 20), gz = Math.floor(p.z / 20);
    const r = Math.ceil(radius / 20);
    let best: { c: PedCrossing; from: [number, number]; to: [number, number]; d: number } | null = null;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      for (const i of this.crossGrid.get(`${gx + dx},${gz + dz}`) ?? []) {
        const c = this.crossings[i];
        for (const [from, to] of [[c.a, c.b], [c.b, c.a]] as const) {
          const d = Math.hypot(from[0] - p.x, from[1] - p.z);
          if (d < radius && (!best || d < best.d)) best = { c, from: [from[0], from[1]], to: [to[0], to[1]], d };
        }
      }
    }
    return best;
  }

  constructor(private world: CollisionWorld, private max: number) {
    this.group.name = 'pedestrians';
  }

  setMax(n: number) {
    this.max = n;
    for (let i = n; i < this.peds.length; i++) { this.peds[i].active = false; this.peds[i].rig.mesh.visible = false; }
  }

  private rnd() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private create(i: number): Ped {
    const body = BODY_MIX[i % BODY_MIX.length];
    const app = randomAppearance(1000 + i * 7919, body);
    const ped = {
      x: 0, z: 0, y: 0, heading: 0, face: 0, speed: 0, cruise: 1.3,
      idleTimer: 0, walkTimer: 0, animAcc: 0, frame: i, active: false,
      mode: 'walk', target: null, crossing: null, waitTime: 0, crossCooldown: 0, approach: null, tick: i * 13,
      agent: createAgent({ body: BODY_INDEX[body], skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, scale: app.scale, look: packLook(app), shirt: app.shirtDesign ?? 0 }),
      schedule: new SocialSchedule(i * 7919 + 17, this.social), socialSeed: i * 7919 + 17, rally: null, react: null,
    } as Omit<Ped, 'rig' | 'anim'> as Ped;
    const human = new HumanCharacter(app, { lod: 3, castShadow: false, clips: NPC_CLIPS, seed: i * 7919 + 17 });
    let lastLod = -1;
    ped.rig = {
      mesh: human.root, body,
      setAppearance: (a) => human.setAppearance(a),
      setShadow: (on) => human.setShadow(on),
      setLod: (d) => {
        const l = Math.max(this.maxDetail, d < 9 ? 0 : d < 24 ? 1 : d < 60 ? 2 : 3) as Lod;
        if (l !== lastLod) { human.setLod(l); lastLod = l; }
      },
      setLodDirect: (l) => { if (l !== lastLod) { human.setLod(l); lastLod = l; } },
      setSocial: (s) => human.setSocial(s),
      playClip: (n) => { human.animator?.playClip(n); },
      setVariant: (sd) => human.setVariant(sd),
      ready: () => human.showingDetail,
    };
    ped.anim = { update: (sp, g, dt) => { human.animator?.update(sp, g, dt); human.updateProps(dt); } };
    human.root.rotation.order = 'YXZ'; // rumo, depois a inclinação da queda (golpe recebido)
    this.group.add(human.root);
    human.ready.catch(() => {
      human.dispose();
      const lv = legacyVisual(app);
      this.group.add(lv.rig.mesh);
      lv.rig.mesh.visible = ped.active;
      lv.rig.mesh.rotation.order = 'YXZ';
      ped.rig = lv.rig;
      ped.anim = lv.anim;
    });
    return ped;
  }

  private spawn(p: Ped, cx: number, cz: number, camFwd: THREE.Vector3, initial: boolean): boolean {
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = this.rnd() * Math.PI * 2;
      const r = initial ? 6 + this.rnd() * (this.radius - 6) : 45 + this.rnd() * (this.radius - 45);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!this.world.isPedestrianWalkable(x, z)) continue;
      // não nascer encostado em outro pedestre
      if (this.peds.some((o) => o.active && o !== p && Math.abs(o.x - x) < 1.5 && Math.abs(o.z - z) < 1.5)) continue;
      // fora do campo de visão quando não é a população inicial
      if (!initial && r < 70 && (x - cx) * camFwd.x + (z - cz) * camFwd.z > 0) continue;
      p.x = x; p.z = z; p.y = this.world.groundHeight(x, z);
      p.heading = p.face = this.rnd() * Math.PI * 2;
      const bp = BODY_TYPES[p.rig.body];
      p.cruise = (1.15 + this.rnd() * 0.45) * bp.speedFactor;
      p.speed = 0;
      p.idleTimer = this.rnd() < 0.2 ? 1 + this.rnd() * 4 : 0;
      p.walkTimer = 6 + this.rnd() * 20;
      // num ato (evento com grupos) ~20 % de camisas de futebol; no dia a dia ~6 %
      const app = randomAppearance(Math.floor(this.rnd() * 1e9), p.rig.body, { football: this.palettes.length ? 0.2 : 0.06 });
      const roll = this.rnd();
      let cum = 0;
      for (const pal of this.palettes) {
        cum += pal.share;
        if (roll < cum) {
          app.top = pal.colors[0];
          app.shirtDesign = 0; // cor do grupo: camisa lisa
          if (pal.colors[1] !== undefined) app.acc = pal.colors[1];
          if (pal.colors[1] !== undefined && this.rnd() < 0.4) app.bottom = pal.colors[1];
          break;
        }
      }
      p.rig.setAppearance(app);
      Object.assign(p.agent, { skin: app.skin, hair: app.hair, top: app.top, bottom: app.bottom, scale: app.scale, look: packLook(app), shirt: app.shirtDesign ?? 0 });
      p.active = true;
      p.mode = 'walk'; p.target = null; p.crossing = null; p.crossCooldown = 3 + this.rnd() * 10; p.approach = null;
      // vida social: novo perfil (item/design) a cada nascimento, agenda desfasada
      p.socialSeed = Math.floor(this.rnd() * 2 ** 31);
      p.schedule = new SocialSchedule(p.socialSeed, this.social, pickProfile(p.socialSeed, this.social));
      p.rig.setVariant(p.socialSeed);
      p.rally = null;
      if (p.react) { p.react = null; p.agent.priority = 1; p.agent.tilt = 0; p.rig.mesh.rotation.x = 0; }
      this.applySocial(p);
      return true;
    }
    return false;
  }

  /** livre para andar `dist` metros na direção `h`? (calçada + sem parede no caminho) */
  private clear(x: number, z: number, h: number, dist: number, y: number): boolean {
    const nx = x + Math.sin(h) * dist, nz = z + Math.cos(h) * dist;
    if (!this.world.isPedestrianWalkable(nx, nz)) return false;
    const mx = x + Math.sin(h) * dist * 0.5, mz = z + Math.cos(h) * dist * 0.5;
    if (!this.world.isPedestrianWalkable(mx, mz)) return false;
    return this.world.raycast(x, y + 1, z, nx, y + 1, nz) >= 1;
  }

  private applySocial(p: Ped) {
    const sc = p.schedule;
    p.rig.setSocial({ act: sc.act, phase: Math.max(0, this.time - sc.startedAt), variation: p.socialSeed & 7, prop: sc.profile.prop, design: sc.profile.design });
    const ag = p.agent;
    ag.act = sc.act; ag.actAt = performance.now() / 1000 - Math.max(0, this.time - sc.startedAt); ag.prop = sc.profile.prop; ag.design = sc.profile.design;
  }

  /**
   * concentração: perto de um ponto ativo (trio, carro de som), parte dos pedestres vai para um lugar no anel ao
   * redor dele (andando — sem teletransporte), fica de frente para o centro e usa os pesos de ação do ponto.
   */
  private updateRally(p: Ped, dt: number, rally: RallyPoint | null) {
    if (p.mode === 'walk' && rally && !p.rally && (p.tick % 30) === 0) {
      const r = rng(p.socialSeed ^ p.tick);
      if (r() < 0.6 * rally.strength) {
        const s = RallyRegistry.spotFor(rally, r(), r());
        p.rally = { id: rally.id, spot: [s.x, s.z], until: this.time + 60 + r() * 180 };
        p.mode = 'rally'; p.approach = null;
      }
    }
    if (!p.rally) return;
    const pt = rallyPoints.get(p.rally.id);
    // ponto sumiu/desligou ou acabou o tempo: volta a passear
    if (!pt || pt.strength <= 0 || this.time > p.rally.until) { p.rally = null; p.mode = 'walk'; return; }
    const dx = p.rally.spot[0] - p.x, dz = p.rally.spot[1] - p.z, dist = Math.hypot(dx, dz);
    if (p.mode === 'rally') {
      if (dist < 0.8) { p.mode = 'gather'; return; }
      p.heading = Math.atan2(dx, dz);
      p.speed += (p.cruise - p.speed) * (1 - Math.exp(-3 * dt));
      const st = Math.min(dist, p.speed * dt);
      const pos = { x: p.x + (dx / dist) * st, y: p.y, z: p.z + (dz / dist) * st };
      this.world.resolveCircle(pos, 0.3, 1.7);
      p.x = pos.x; p.z = pos.z;
      if (pt && Math.hypot(pt.x - p.x, pt.z - p.z) < pt.inner) p.mode = 'gather'; // não entra no veículo
    } else if (p.mode === 'gather') {
      p.speed = Math.max(0, p.speed - dt * 4);
      // de frente para o centro (o trio/palco), com uma variação individual
      const want = Math.atan2(pt.x - p.x, pt.z - p.z) + ((p.socialSeed % 9) - 4) * 0.06;
      let dh = want - p.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      p.heading += dh * (1 - Math.exp(-2 * dt));
      // o ponto se move (trio andando): acompanha a pé
      if (dist > 3) p.mode = 'rally';
    }
  }

  update(dt: number, camera: THREE.Camera, player: { x: number; z: number }) {
    // população
    while (this.peds.length < this.max) this.peds.push(this.create(this.peds.length));
    const camFwd = this.tmp.set(0, 0, -1).applyQuaternion(camera.quaternion).clone();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const cx = player.x, cz = player.z;
    let active = 0, visible = 0, crossing = 0, waiting = 0, skinned = 0, reacting = 0, down = 0;
    const crowd = this.crowd;
    // total de humanos limitado pelo preset: com muita gente da rede, os NPCs cedem lugar
    const limit = crowd ? Math.min(this.max, Math.max(MIN_PEDS, crowd.budget.total - crowd.othersCount)) : this.max;

    for (let i = 0; i < this.max; i++) {
      const p = this.peds[i];
      if (i >= limit) {
        if (p.active) { p.active = false; p.rig.mesh.visible = false; }
        continue;
      }
      if (!p.active) {
        const initial = this.time < 1;
        if (!this.spawn(p, cx, cz, camFwd, initial)) { p.rig.mesh.visible = false; continue; }
      }
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d > this.radius + 20) { p.active = false; p.rig.mesh.visible = false; continue; }
      active++;

      p.tick++;
      // golpe recebido (mode 'react': nenhum dos comportamentos abaixo anda com ele)
      const tilt = p.react ? this.stepReact(p, dt) : 0;
      if (p.react) { reacting++; if (p.react.kind === 'down') down++; }
      // concentração (trio/carro de som) e vida social
      const rally = p.react ? null : rallyPoints.nearestActive(p.x, p.z);
      this.updateRally(p, dt, rally);
      if (!p.react && p.schedule.update(this.time, p.speed > 0.3, p.rally ? rallyPoints.get(p.rally.id) ?? null : null)) this.applySocial(p);

      // travessia de rua (faixas de pedestres reais do OSM)
      p.crossCooldown -= dt;
      // escolhe uma faixa próxima como destino de tempos em tempos
      if (p.mode === 'walk' && !p.approach && p.crossCooldown <= 0 && (p.tick % 60) === 0 && this.rnd() < 0.5) {
        const far = this.nearCrossing(p, 30);
        if (far && far.d > 2.6) p.approach = far.from;
      }
      if (p.mode === 'walk' && p.approach && p.idleTimer <= 0) {
        const dx = p.approach[0] - p.x, dz = p.approach[1] - p.z;
        if (Math.hypot(dx, dz) > 2.4) {
          const want = Math.atan2(dx, dz);
          if (this.clear(p.x, p.z, want, 1.5, p.y)) p.heading = want;
        }
        if (p.crossCooldown < -40) p.approach = null; // desistiu
      }
      if (p.mode === 'walk' && p.crossCooldown <= 0 && (p.tick & 3) === 0) {
        const nc = this.nearCrossing(p);
        if (nc) {
          p.approach = null;
          p.crossCooldown = 25;
          if (this.rnd() < 0.85) {
            p.mode = 'wait'; p.crossing = nc.c; p.target = nc.to; p.waitTime = 0;
            p.heading = Math.atan2(nc.to[0] - p.x, nc.to[1] - p.z);
          }
        }
      }
      if (p.mode === 'wait') {
        p.waitTime += dt;
        p.speed = Math.max(0, p.speed - dt * 4);
        const c = p.crossing!;
        let go: boolean;
        if (c.j >= 0 && this.signals) {
          const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
          go = this.signals.state(c.j, c.ph) === 'R' && this.signals.remaining(c.j, c.ph) > Math.min(len / p.cruise, 7);
        } else go = p.waitTime > 1.5 + (p.tick % 5);
        if (go) p.mode = 'cross';
        else if (p.waitTime > 60) { p.mode = 'walk'; p.heading += Math.PI / 2; }
      }
      if (p.mode === 'cross' && p.target) {
        const dx = p.target[0] - p.x, dz = p.target[1] - p.z;
        const dist = Math.hypot(dx, dz);
        p.heading = Math.atan2(dx, dz);
        p.speed += (p.cruise * 1.15 - p.speed) * (1 - Math.exp(-4 * dt));
        if (dist < 0.5) {
          // chegou: sobe na calçada e segue ao longo dela
          p.x += Math.sin(p.heading) * 1.2; p.z += Math.cos(p.heading) * 1.2;
          p.mode = 'walk'; p.target = null; p.crossing = null;
          p.heading += (this.rnd() < 0.5 ? 1 : -1) * Math.PI / 2;
        } else {
          const st = Math.min(dist, p.speed * dt);
          p.x += (dx / dist) * st; p.z += (dz / dist) * st;
        }
      }

      // comportamento
      if (p.mode === 'rally' || p.mode === 'gather') {
        // concentração: movimento decidido em updateRally
      } else if (p.mode !== 'walk') {
        // esperando/atravessando: sem desvio nem separação
      } else if (p.idleTimer > 0) {
        p.idleTimer -= dt;
        p.speed = Math.max(0, p.speed - dt * 3);
      } else {
        p.walkTimer -= dt;
        if (p.walkTimer < 0) {
          p.walkTimer = 8 + this.rnd() * 25;
          if (this.rnd() < 0.35) p.idleTimer = 1.5 + this.rnd() * 5;
        }
        // ritmo que oscila devagar (±6 %, período próprio): ninguém anda como metrônomo
        const wander = 1 + 0.06 * Math.sin(this.time * (0.2 + seeded(p.socialSeed, 3) * 0.25) + seeded(p.socialSeed, 4) * 6.28);
        p.speed += (p.cruise * wander - p.speed) * (1 - Math.exp(-3 * dt));
        // desvio de obstáculos: testa direções próximas à atual
        if (!this.clear(p.x, p.z, p.heading, 1.8, p.y)) {
          let found = false;
          const pref = this.rnd() < 0.5 ? 1 : -1;
          for (const off of [0.5, 1.0, 1.6, 2.3, 3.14]) {
            for (const s of [pref, -pref]) {
              const h = p.heading + off * s;
              if (this.clear(p.x, p.z, h, 2.5, p.y)) { p.heading = h; found = true; break; }
            }
            if (found) break;
          }
          if (!found) { p.speed = 0; p.heading += Math.PI * (0.5 + this.rnd()); }
        } else if (this.rnd() < dt * 0.15) {
          p.heading += (this.rnd() - 0.5) * 0.6; // leve variação de rumo
        }
      }
      // separação (outros pedestres e jogador)
      let sx = 0, sz = 0;
      if (p.mode === 'gather') {
        // na concentração só se afastam um pouco de quem está colado (sem andar pela calçada)
        for (let j = 0; j < this.max; j++) {
          const o = this.peds[j];
          if (j === i || !o?.active) continue;
          const dx = p.x - o.x, dz = p.z - o.z, dd = dx * dx + dz * dz;
          if (dd < 0.36 && dd > 1e-6) { const l = Math.sqrt(dd); p.x += (dx / l) * (0.6 - l) * 0.5 * dt * 4; p.z += (dz / l) * (0.6 - l) * 0.5 * dt * 4; }
        }
      }
      if (p.mode === 'walk') {
      for (let j = 0; j < this.max; j++) {
        if (j === i) continue;
        const o = this.peds[j];
        if (!o || !o.active) continue;
        const dx = p.x - o.x, dz = p.z - o.z;
        const dd = dx * dx + dz * dz;
        if (dd < 0.8 && dd > 1e-6) { const l = Math.sqrt(dd); sx += (dx / l) * (0.9 - l); sz += (dz / l) * (0.9 - l); }
      }
      {
        const dx = p.x - player.x, dz = p.z - player.z;
        const l = Math.hypot(dx, dz);
        if (l < 1.1 && l > 1e-6) { sx += (dx / l) * (1.1 - l) * 2; sz += (dz / l) * (1.1 - l) * 2; }
      }
      const vx = Math.sin(p.heading) * p.speed + sx * 2, vz = Math.cos(p.heading) * p.speed + sz * 2;
      const nx = p.x + vx * dt, nz = p.z + vz * dt;
      if (this.world.isPedestrianWalkable(nx, nz)) { p.x = nx; p.z = nz; }
      const pos = { x: p.x, y: p.y, z: p.z };
      this.world.resolveCircle(pos, 0.3, 1.7);
      if (this.world.isPedestrianWalkable(pos.x, pos.z)) { p.x = pos.x; p.z = pos.z; }
      }
      p.y = this.world.groundHeight(p.x, p.z);
      if (p.mode === 'cross') crossing++;
      if (p.mode === 'wait') waiting++;

      // visual + LOD
      const mesh = p.rig.mesh;
      // corpo gira para o rumo com velocidade angular limitada (parado/esperando: mais devagar)
      p.face = p.react ? p.heading : turnToward(p.face, p.heading, dt, p.speed > 0.3 ? 8 : 4, p.speed > 0.3 ? 4.5 : 2.5);
      mesh.position.set(p.x, p.y + (tilt > 0 ? 0.12 * Math.sin(tilt) : 0), p.z);
      mesh.rotation.y = p.face;
      mesh.rotation.x = -tilt;
      if (crowd) {
        // orçamento único: esqueleto só se o diretor concedeu (quadro anterior); senão a multidão instanciada desenha
        const ag = p.agent;
        ag.x = p.x; ag.y = p.y; ag.z = p.z; ag.heading = p.face; ag.speed = p.speed; ag.tilt = tilt;
        crowd.submit(ag, 'ped');
        const sk = ag.tier === 2 && (ag.inView || d < 3);
        // enquanto o esqueleto não tem o detalhe pedido, o instanciado cobre (sem os dois desenhados ao mesmo tempo)
        ag.skinReady = sk && p.rig.ready();
        mesh.visible = ag.skinReady;
        p.animAcc += dt;
        if (ag.inView) visible++;
        if (!sk) continue;
        skinned++;
        p.rig.setShadow(d < this.shadowDistance);
        p.rig.setLodDirect(ag.lod);
        if (crowd.shouldAnimate(ag)) { p.anim.update(p.speed, true, p.animAcc); p.animAcc = 0; }
        continue;
      }
      const inView = this.frustum.containsPoint(this.tmp.set(p.x, p.y + 1, p.z)) || d < 3;
      mesh.visible = inView;
      if (!inView) continue;
      visible++;
      p.rig.setShadow(d < this.shadowDistance);
      p.rig.setLod(d);
      const every = d < 25 ? 1 : d < 50 ? 2 : 4;
      p.animAcc += dt;
      if ((++p.frame) % every === 0) {
        p.anim.update(p.speed, true, p.animAcc);
        p.animAcc = 0;
      }
    }
    this.time += dt;
    this.stats.active = active;
    this.stats.visible = visible;
    this.stats.crossing = crossing;
    this.stats.waiting = waiting;
    this.stats.skinned = crowd ? skinned : visible;
    this.stats.limit = limit;
    this.stats.reacting = reacting;
    this.stats.down = down;
  }

  private time = 0;
}
