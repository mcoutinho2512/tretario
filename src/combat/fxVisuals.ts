/**
 * Visuais dos efeitos temporários (rodada 9, bits FX de src/combat/types.ts) — sutis, sem flash, sem tremor:
 *  - PROTECTED: casca translúcida com faixas subindo devagar em volta do personagem (geometria e material ÚNICOS,
 *    compartilhados por todos; relógio no onBeforeRender — nenhum custo por personagem além de um draw);
 *  - DISORIENTED (só para quem sofre): véu de tela (CSS: desfoque/dessaturação/vinheta moderados, entra e sai em
 *    0,6 s), ou, com "Reduzir efeitos visuais", só um ícone pequeno e um tom leve. O DOM só muda quando o estado muda.
 */
import * as THREE from 'three';

const uniforms = { uTime: { value: 0 } };
let auraGeo: THREE.BufferGeometry | null = null;
let auraMat: THREE.ShaderMaterial | null = null;

function sharedAura() {
  if (!auraGeo) {
    auraGeo = new THREE.CylinderGeometry(0.44, 0.4, 1.9, 28, 1, true);
    auraGeo.translate(0, 0.95, 0);
    auraGeo.name = 'fx_protected_aura';
  }
  if (!auraMat) {
    auraMat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // brilho fraco (≤ 0,16), mais forte nos pés; faixas lentas subindo; pulso de ~2,5 s com amplitude pequena
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float h = vUv.y;
          float band = 0.55 + 0.45 * sin(h * 16.0 - uTime * 2.2);
          float pulse = 0.85 + 0.15 * sin(uTime * 2.5);
          float a = 0.16 * pow(1.0 - h, 1.6) * band * pulse;
          gl_FragColor = vec4(vec3(0.62, 0.86, 1.0) * a, a);
        }`,
    });
    auraMat.name = 'fx_protected_aura';
  }
  return { geo: auraGeo, mat: auraMat };
}

/** casca de proteção presa à raiz do personagem (liga/desliga sem recriar) */
export class ProtectedAura {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D) {
    const { geo, mat } = sharedAura();
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'fx_protected';
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = true;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = () => { uniforms.uTime.value = performance.now() / 1000; };
    parent.add(this.mesh);
  }
  set(on: boolean) { this.mesh.visible = on; }
  get on() { return this.mesh.visible; }
  dispose() { this.mesh.removeFromParent(); } // geometria/material compartilhados ficam
}

/** véu de tela do desorientado (só o jogador local) */
export class DisorientOverlay {
  readonly el: HTMLDivElement;
  private on = false;
  private reduced = false;
  /** QA: trocas de estado (o DOM só é tocado nelas) */
  writes = 0;
  constructor(parent: HTMLElement) {
    const el = (this.el = document.createElement('div'));
    el.className = 'fx-disorient';
    el.setAttribute('aria-hidden', 'true');
    const badge = document.createElement('div');
    badge.className = 'fx-badge';
    // ícone: olho semicerrado (SVG simples, sem marca)
    badge.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 12c3-4.5 7-6 10-6s7 1.5 10 6c-3 4.5-7 6-10 6s-7-1.5-10-6z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 12h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span>Visão turva</span>';
    el.appendChild(badge);
    parent.prepend(el); // por baixo do resto do HUD
  }
  set(on: boolean, reduced: boolean) {
    if (on === this.on && reduced === this.reduced) return;
    this.on = on; this.reduced = reduced;
    this.el.classList.toggle('on', on);
    this.el.classList.toggle('reduced', reduced);
    this.writes++;
  }
  get state() { return { on: this.on, reduced: this.reduced, writes: this.writes }; }
}
