/**
 * Diretor da multidão: ponto ÚNICO onde todos os humanos do quadro (jogadores remotos, multidão distante da rede,
 * pedestres NPC) disputam o orçamento do preset (ver crowdBudget.ts).
 *
 * Ciclo por quadro:
 *   1. cada sistema atualiza seus agentes (posição, velocidade) e chama `submit(agente)`; e já APLICA o tier que o
 *      agente recebeu no quadro anterior (esqueleto visível ou não, LOD, frequência da animação) — um quadro de atraso
 *      na troca de representação é imperceptível e evita depender da ordem dos sistemas
 *   2. `end(câmera, dt)`: distância e visibilidade (frustum por esfera), atribuição de tiers, desenho dos instanciados
 * O jogador local não passa por aqui (sempre LOD0 com esqueleto).
 */
import * as THREE from 'three';
import type { QualityLevel } from '../../core/settings';
import type { Lod } from '../human/HumanAssets';
import { CROWD_BUDGETS, assignTiers, type CrowdAgent, type CrowdBudget, type TierStats } from './crowdBudget';
import { CrowdRenderer } from './CrowdRenderer';

export type AgentSource = 'net' | 'far' | 'ped';

export class CrowdDirector {
  readonly budget: CrowdBudget;
  readonly renderer: CrowdRenderer;
  private list: CrowdAgent[] = [];
  private draw: CrowdAgent[] = [];
  private order: number[] = [];
  private rank = new Float64Array(1024);
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
  private counts = { net: 0, far: 0, ped: 0 };
  /** LOD mais detalhado permitido AGORA (o jogo adia o LOD0 nos primeiros segundos); combinado com o do preset */
  detailFloor: Lod = 0;
  /** contador de quadros (escalonamento da animação) */
  frame = 0;
  /** humanos de OUTRAS fontes (rede) no último quadro — os pedestres NPC cedem lugar a eles */
  othersCount = 0;
  stats: TierStats & { submitted: number; net: number; far: number; ped: number; drawnInstanced: number; instancedCalls: number; ms: number } =
    { skinned: 0, instanced: 0, hidden: 0, lod: [0, 0, 0, 0], submitted: 0, net: 0, far: 0, ped: 0, drawnInstanced: 0, instancedCalls: 0, ms: 0 };

  constructor(level: QualityLevel, parent: THREE.Object3D) {
    this.budget = { ...(CROWD_BUDGETS[level] ?? CROWD_BUDGETS.medium) };
    // QA/ajuste fino: ?crowdSkinned=N&crowdTotal=N sobrescrevem o orçamento do preset
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    const num = (k: string) => { const v = q?.get(k); return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
    this.budget.skinned = num('crowdSkinned') ?? this.budget.skinned;
    this.budget.total = num('crowdTotal') ?? this.budget.total;
    this.renderer = new CrowdRenderer(this.budget.total, this.budget.instancedLod2Dist > 0);
    parent.add(this.renderer.group);
    void this.renderer.init();
  }

  submit(a: CrowdAgent, src: AgentSource) {
    this.list.push(a);
    this.counts[src]++;
  }

  /** a animação do esqueleto deste agente deve ser atualizada neste quadro? (escalonada por id) */
  shouldAnimate(a: CrowdAgent) { return (this.frame + a.id) % a.animEvery === 0; }

  end(camera: THREE.Camera, dt: number) {
    const t0 = performance.now();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (const a of this.list) {
      a.dist = Math.hypot(a.x - cx, a.y - cy, a.z - cz);
      this.sphere.center.set(a.x, a.y + 0.9, a.z);
      a.inView = this.frustum.intersectsSphere(this.sphere);
    }
    const maxDetail = this.budget.maxDetail;
    this.budget.maxDetail = Math.max(maxDetail, this.detailFloor) as Lod;
    const st = assignTiers(this.list, this.budget, this.order, this.rank);
    this.budget.maxDetail = maxDetail;
    if (this.rank.length < this.list.length) this.rank = new Float64Array(this.list.length * 2);
    // instanciados visíveis + com esqueleto ainda carregando (o instanciado cobre a troca)
    this.draw.length = 0;
    for (const a of this.list) if (a.inView && (a.tier === 1 || (a.tier === 2 && !a.skinReady))) this.draw.push(a);
    this.renderer.draw(this.draw, dt);
    Object.assign(this.stats, st, {
      submitted: this.list.length, net: this.counts.net, far: this.counts.far, ped: this.counts.ped,
      drawnInstanced: this.renderer.stats.drawn, instancedCalls: this.renderer.stats.calls, ms: +(performance.now() - t0).toFixed(3),
    });
    this.othersCount = this.counts.net + this.counts.far;
    this.list.length = 0;
    this.counts.net = this.counts.far = this.counts.ped = 0;
    this.frame++;
  }

  dispose() { this.renderer.dispose(); }
}
