/**
 * Câmeras do ESPECTADOR (rodada 8): sem avatar, sem física. Uma pose (foco no chão + órbita) suavizada até a pose-alvo
 * do modo escolhido; tudo preso aos limites do mapa e à faixa de altitude (src/spectator/bounds.ts).
 *   livre       WASD / joystick movem o foco; arrastar gira; roda/pinça aproxima — LIMITADA ao mapa e à altitude
 *   central / campo / candelaria   pontos fixos das zonas (public/world/zones.json) e dos marcos
 *   trio        acompanha o trio elétrico (ou o palco do evento, se não houver trio)
 *   aerea       altitude máxima sobre o meio da avenida
 * Transições suaves (amortecimento exponencial); qualquer movimento do usuário passa para a câmera livre.
 */
import * as THREE from 'three';
import { clampPose, poseToCamera, PITCH_RANGE, SPECTATOR, type Bounds, type SpecPose } from './bounds';

export type SpecCamMode = 'livre' | 'central' | 'campo' | 'candelaria' | 'trio' | 'aerea';

export const SPEC_CAMS: readonly { id: SpecCamMode; label: string; key: string }[] = [
  { id: 'livre', label: 'CÂMERA LIVRE', key: '1' },
  { id: 'central', label: 'CENTRAL', key: '2' },
  { id: 'campo', label: 'CAMPO DE SANTANA', key: '3' },
  { id: 'candelaria', label: 'CANDELÁRIA', key: '4' },
  { id: 'trio', label: 'TRIO/PALCO', key: '5' },
  { id: 'aerea', label: 'CÂMERA AÉREA', key: '6' },
];

export interface SpecAnchors {
  central: SpecPose;
  campo: SpecPose;
  candelaria: SpecPose;
  aerea: SpecPose;
  /** palco do evento (reserva do modo trio) */
  stage: SpecPose;
}

const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class SpectatorCamera {
  mode: SpecCamMode = 'central';
  /** pose desenhada (suavizada) e pose-alvo */
  readonly pose: SpecPose;
  readonly target: SpecPose;
  /** suavização (1/s): maior = transição mais rápida */
  smoothing = 2.6;
  private focusY = 0;
  /** distância visível (m) depois da oclusão por edifícios (suavizada: aproxima rápido, afasta devagar) */
  private shownDist = -1;
  /** oclusão: fração [0..1] do segmento foco→câmera livre de edifícios (CollisionWorld.raycast); sem ela, nada */
  occlusion: ((ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number) | null = null;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private bounds: Bounds,
    private ground: (x: number, z: number) => number,
    private anchors: SpecAnchors,
    /** pose atual do trio (null = sem trio na vista) */
    private follow: () => { x: number; z: number; heading: number } | null,
  ) {
    this.target = { ...anchors.central };
    this.pose = { ...anchors.central };
    this.focusY = ground(this.pose.x, this.pose.z);
  }

  setAnchors(a: SpecAnchors) { this.anchors = a; if (this.mode !== 'livre' && this.mode !== 'trio') this.setMode(this.mode); }

  setMode(m: SpecCamMode) {
    this.mode = m;
    if (m === 'livre') return; // continua de onde está
    if (m === 'trio') {
      const t = this.follow();
      // atrás do trio, ao longo da avenida (lado aberto), um pouco acima da multidão
      Object.assign(this.target, t ? { x: t.x, z: t.z, yaw: t.heading + 0.35, pitch: 0.4, dist: 40 } : this.anchors.stage);
      return;
    }
    Object.assign(this.target, this.anchors[m]);
  }

  /** câmera livre apontada para um ponto (minimapa, QA) */
  goTo(x: number, z: number, dist?: number) {
    this.mode = 'livre';
    this.target.x = x; this.target.z = z;
    if (dist) this.target.dist = dist;
  }

  /** corte seco (sem transição): primeira pose e QA */
  snap() { Object.assign(this.pose, clampPose(this.target, this.bounds)); this.focusY = this.ground(this.pose.x, this.pose.z); }

  /**
   * entrada do usuário (já em unidades de jogo): mover (x = direita, y = frente), girar (rad), zoom (log), correr.
   * Mover passa para a câmera livre; girar/aproximar ajusta a pose do modo atual.
   */
  input(move: { x: number; y: number }, look: { dx: number; dy: number }, zoom: number, run: boolean, dt: number) {
    const t = this.target;
    if (look.dx || look.dy) {
      t.yaw -= look.dx;
      t.pitch = Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], t.pitch + look.dy));
    }
    if (zoom) t.dist = Math.min(SPECTATOR.maxDist, Math.max(SPECTATOR.minDist, t.dist * Math.exp(zoom)));
    if (move.x || move.y) {
      if (this.mode !== 'livre') this.mode = 'livre';
      // velocidade proporcional à distância (de perto devagar, do alto rápido)
      const v = (8 + t.dist * 0.9) * (run ? 2.5 : 1) * dt;
      const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
      t.x += (fx * move.y - fz * move.x) * v;
      t.z += (fz * move.y + fx * move.x) * v;
    }
    Object.assign(t, clampPose(t, this.bounds));
  }

  update(dt: number) {
    if (this.mode === 'trio') {
      const f = this.follow();
      if (f) { this.target.x = f.x; this.target.z = f.z; }
    }
    const k = 1 - Math.exp(-this.smoothing * dt);
    const p = this.pose, t = this.target;
    p.x += (t.x - p.x) * k;
    p.z += (t.z - p.z) * k;
    p.yaw += wrap(t.yaw - p.yaw) * k;
    p.pitch += (t.pitch - p.pitch) * k;
    // distância em escala logarítmica: aproximar de 280 m para 40 m não "despenca"
    p.dist = Math.exp(Math.log(p.dist) + (Math.log(t.dist) - Math.log(p.dist)) * k);
    Object.assign(p, clampPose(p, this.bounds));
    const gy = this.ground(p.x, p.z);
    this.focusY += (gy - this.focusY) * Math.min(1, k * 2);
    const c = poseToCamera(p);
    const fy = this.focusY + 1.5;
    // edifício entre o foco e a câmera: aproxima a câmera (rápido) e volta devagar quando libera
    let want = p.dist;
    const free = this.occlusion ? this.occlusion(p.x, fy, p.z, c.x, this.focusY + c.y, c.z) : 1;
    if (free < 1) want = Math.max(SPECTATOR.minDist * 0.5, p.dist * free - 2);
    if (this.shownDist < 0) this.shownDist = want;
    this.shownDist += (want - this.shownDist) * (1 - Math.exp(-(want < this.shownDist ? 12 : 2) * dt));
    const k2 = Math.min(1, this.shownDist / p.dist);
    const cx = p.x + (c.x - p.x) * k2, cz = p.z + (c.z - p.z) * k2;
    // nunca abaixo do chão sob a própria câmera
    const camY = Math.max(fy + (this.focusY + c.y - fy) * k2, this.ground(cx, cz) + 1.2);
    this.camera.position.set(cx, camY, cz);
    this.camera.lookAt(p.x, fy, p.z);
  }

  /** foco atual (chão) — centro da área de interesse enviada ao servidor */
  get focus() { return { x: this.pose.x, y: this.focusY, z: this.pose.z }; }
  /** altitude da câmera acima do foco (m) */
  get altitude() { return this.camera.position.y - this.focusY; }
}
