/** WebGL2 renderer + pós-processamento opcional (GTAO + SMAA no preset ALTO). */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualityPreset } from '../core/settings';
import { renderQuality } from './quality';
import { assetManager } from '../core/AssetManager';

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private preset: QualityPreset;
  /** tempo de GPU (ms) via EXT_disjoint_timer_query_webgl2, quando o navegador expõe; senão null */
  gpuMs: number | null = null;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private queries: WebGLQuery[] = [];

  constructor(canvas: HTMLCanvasElement, preset: QualityPreset) {
    this.preset = preset;
    renderQuality.level = preset.level;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!this.renderer.capabilities.isWebGL2) throw new Error('WebGL2 indisponível neste navegador.');
    // a partir daqui as cópias na CPU de texturas/geometrias estáticas podem ser soltas após o upload
    // (a prévia do avatar — outro contexto WebGL — já foi descartada quando o jogo cria o renderer)
    assetManager.cpuRelease = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.info.autoReset = false;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.setPixelRatio();
  }

  /** escala de resolução dinâmica (0,5–1) sobre o pixel ratio do preset */
  resolutionScale = 1;
  private setPixelRatio() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio) * this.resolutionScale);
  }

  /** muda a escala de resolução (resolução dinâmica) sem recriar nada */
  setResolutionScale(s: number) {
    const v = Math.max(0.5, Math.min(1, s));
    if (Math.abs(v - this.resolutionScale) < 0.01) return;
    this.resolutionScale = v;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.resize(size.x, size.y);
  }

  setup(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.composer?.dispose();
    this.composer = null;
    this.gtao = null;
    if (this.preset.ambientOcclusion || this.preset.postAA) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.preset.postAA ? 0 : 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(scene, camera));
      if (this.preset.ambientOcclusion) {
        this.gtao = new GTAOPass(scene, camera, size.x, size.y);
        this.gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.4, thickness: 2.0, scale: 1.0, samples: 12 });
        this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
        this.gtao.blendIntensity = 0.9;
        this.composer.addPass(this.gtao);
      }
      this.composer.addPass(new OutputPass());
      if (this.preset.postAA) this.composer.addPass(new SMAAPass(size.x, size.y));
    }
  }

  resize(w: number, h: number) {
    this.setPixelRatio();
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer.info.reset();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const ext = this.timerExt;
    let q: WebGLQuery | null = null;
    if (ext && this.queries.length < 4) { q = gl.createQuery(); if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    if (this.composer) this.composer.render();
    else this.renderer.render(scene, camera);
    if (q && ext) { gl.endQuery(ext.TIME_ELAPSED_EXT); this.queries.push(q); }
    // resultados chegam alguns frames depois
    if (ext && this.queries.length) {
      const first = this.queries[0];
      if (gl.getQueryParameter(first, gl.QUERY_RESULT_AVAILABLE)) {
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (!disjoint) {
          const ns = gl.getQueryParameter(first, gl.QUERY_RESULT) as number;
          const ms = ns / 1e6;
          this.gpuMs = this.gpuMs === null ? ms : this.gpuMs * 0.9 + ms * 0.1;
        }
        gl.deleteQuery(first);
        this.queries.shift();
      }
    }
  }
}
