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

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;

  setup(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene; this.camera = camera;
    this.composer?.dispose();
    this.composer = null;
    this.gtao = null;
    if (this.preset.ambientOcclusion || this.preset.postAA) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      // MSAA no alvo HDR: explícito no preset (ULTRA) ou 4× quando há AO sem SMAA
      const samples = this.preset.msaaSamples > 0 ? this.preset.msaaSamples : this.preset.postAA ? 0 : 4;
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
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

  // rodada 11 — gráficos: troca de preset AO VIVO (resolução, pós-processamento, anisotropia) -----------------------
  /** aplica um preset sem recriar o contexto (o MSAA nativo do canvas, `antialias`, só muda ao recarregar) */
  applyPreset(p: QualityPreset) {
    const prev = this.preset;
    this.preset = p;
    renderQuality.level = p.level; // quarteirões construídos daqui em diante
    const size = this.renderer.getSize(new THREE.Vector2());
    this.resize(size.x, size.y);
    const post = (q: QualityPreset) => `${q.ambientOcclusion}|${q.postAA}|${q.msaaSamples}`;
    if (post(prev) !== post(p) && this.scene && this.camera) {
      for (const ps of this.composer?.passes ?? []) ps.dispose(); // GTAO/SMAA têm alvos próprios
      this.setup(this.scene, this.camera);
      this.resize(size.x, size.y);
    }
  }

  /**
   * anisotropia das texturas de superfície (as que os construtores já criam com anisotropia > 1): troca o parâmetro
   * direto na textura da GPU — sem reenviar a imagem (as cópias na CPU já foram soltas, `assetManager.cpuRelease`).
   * Devolve quantas texturas mudaram.
   */
  applyAnisotropy(scene: THREE.Object3D, level: number): number {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    const max = this.renderer.capabilities.getMaxAnisotropy();
    const target = Math.max(1, Math.min(level, max));
    const seen = new Set<THREE.Texture>();
    let changed = 0;
    const props = this.renderer.properties;
    const visit = (t: unknown) => {
      if (!(t instanceof THREE.Texture) || seen.has(t)) return;
      seen.add(t);
      const ud = t.userData as { r11BaseAniso?: number };
      ud.r11BaseAniso ??= t.anisotropy;
      if (ud.r11BaseAniso <= 1 || t.anisotropy === target || (t as THREE.CubeTexture).isCubeTexture) return;
      t.anisotropy = target;
      changed++;
      const tp = props.get(t) as { __webglTexture?: WebGLTexture; __currentAnisotropy?: number };
      if (!ext || !tp.__webglTexture) return; // ainda não enviada: vale o novo valor no envio
      const kind = (t as THREE.DataArrayTexture).isDataArrayTexture || (t as THREE.CompressedArrayTexture).isCompressedArrayTexture ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
      this.renderer.state.bindTexture(kind, tp.__webglTexture);
      gl.texParameterf(kind, ext.TEXTURE_MAX_ANISOTROPY_EXT, target);
      tp.__currentAnisotropy = target;
    };
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) for (const v of Object.values(mat)) visit(v);
    });
    this.renderer.state.bindTexture(gl.TEXTURE_2D, null);
    return changed;
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
