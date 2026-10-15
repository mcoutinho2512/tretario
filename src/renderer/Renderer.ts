/** WebGL2 renderer + pós-processamento opcional (GTAO + SMAA no preset ALTO). */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualityPreset } from '../core/settings';

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private gtao: GTAOPass | null = null;
  private preset: QualityPreset;

  constructor(canvas: HTMLCanvasElement, preset: QualityPreset) {
    this.preset = preset;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!this.renderer.capabilities.isWebGL2) throw new Error('WebGL2 indisponível neste navegador.');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.info.autoReset = false;
    this.setPixelRatio();
  }

  private setPixelRatio() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
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
    if (this.composer) this.composer.render();
    else this.renderer.render(scene, camera);
  }
}
