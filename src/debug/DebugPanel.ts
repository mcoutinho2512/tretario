/** Painel DEBUG (F3): FPS, frame time, draw calls, triângulos, texturas, geometrias, posição, lat/lon, chunk. */
import type * as THREE from 'three';

export interface DebugInfo {
  x: number; y: number; z: number;
  lat: number; lon: number;
  chunk: string;
  lod: string;
  nearest: string;
  quality: string;
  chunks: string;
  props: number;
  heading: number;
  locomotion: string;
}

export class DebugPanel {
  readonly el: HTMLDivElement;
  visible = false;
  private frames: number[] = [];
  private last = performance.now();
  private acc = 0;
  fps = 0;
  frameMs = 0;
  worstMs = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'debug-panel';
    this.el.style.display = 'none';
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  /** chamar uma vez por frame */
  tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    this.frames.push(dt);
    if (this.frames.length > 120) this.frames.shift();
    this.acc += dt;
  }

  update(renderer: THREE.WebGLRenderer, info: DebugInfo) {
    if (this.acc < 250) return;
    this.acc = 0;
    const avg = this.frames.reduce((a, b) => a + b, 0) / Math.max(1, this.frames.length);
    this.fps = 1000 / avg;
    this.frameMs = avg;
    this.worstMs = Math.max(...this.frames);
    if (!this.visible) return;
    const r = renderer.info;
    const fmt = (n: number) => n.toLocaleString('pt-BR');
    this.el.innerHTML = `
      <b>PRESIDENTE VARGAS 3D — DEBUG</b><br>
      FPS <b>${this.fps.toFixed(0)}</b> · frame ${avg.toFixed(1)} ms (pior ${this.worstMs.toFixed(1)})<br>
      draw calls ${fmt(r.render.calls)} · tris ${fmt(r.render.triangles)}<br>
      texturas ${r.memory.textures} · geometrias ${r.memory.geometries} · programas ${r.programs?.length ?? 0}<br>
      qualidade ${info.quality} · chunks ${info.chunks} · props ${fmt(info.props)}<br>
      <hr>
      XYZ ${info.x.toFixed(1)}, ${info.y.toFixed(2)}, ${info.z.toFixed(1)} m<br>
      lat ${info.lat.toFixed(6)} · lon ${info.lon.toFixed(6)}<br>
      rumo ${((((Math.atan2(Math.sin(info.heading), -Math.cos(info.heading)) * 180) / Math.PI) + 360) % 360).toFixed(0)}° · ${info.locomotion}<br>
      chunk ${info.chunk} (${info.lod})<br>
      ponto de validação: <b>${info.nearest}</b>
    `;
  }
}
