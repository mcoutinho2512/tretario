/**
 * Minimapa de desenvolvimento (canvas 2D) — valida a correspondência mundo 3D ↔ geografia.
 * Norte para cima. Mostra ruas (OSM), Presidente Vargas em destaque, Central, Candelária,
 * pontos de validação e o jogador. Tecla M alterna entre visão local e corredor inteiro.
 */
import type { WorldManifest } from '../world/types';

export class Minimap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private expanded = false;
  private static: HTMLCanvasElement;
  private staticScale = 0.5; // px por metro no cache
  private origin: [number, number];

  constructor(private manifest: WorldManifest) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    const label = document.createElement('div');
    label.className = 'minimap-label';
    label.textContent = 'N ↑ · M: expandir';
    this.el.appendChild(label);
    this.ctx = this.canvas.getContext('2d')!;
    // camada estática pré-renderizada (ruas)
    const [x0, z0, x1, z1] = manifest.bounds;
    this.origin = [x0, z0];
    this.static = document.createElement('canvas');
    this.static.width = Math.ceil((x1 - x0) * this.staticScale);
    this.static.height = Math.ceil((z1 - z0) * this.staticScale);
    const g = this.static.getContext('2d')!;
    g.fillStyle = '#1b1f24';
    g.fillRect(0, 0, this.static.width, this.static.height);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const draw = (pv: boolean) => {
      for (const r of manifest.minimapRoads) {
        if (!!r.pv !== pv) continue;
        g.strokeStyle = pv ? '#e0483c' : '#59616b';
        g.lineWidth = Math.max(1.2, r.w * this.staticScale);
        g.beginPath();
        r.pts.forEach((p, i) => {
          const x = (p[0] - x0) * this.staticScale, y = (p[1] - z0) * this.staticScale;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.stroke();
      }
    };
    draw(false);
    draw(true);
    this.resize();
  }

  toggleExpanded() {
    this.expanded = !this.expanded;
    this.el.classList.toggle('expanded', this.expanded);
    this.resize();
  }

  private resize() {
    const size = this.expanded ? Math.min(window.innerWidth, window.innerHeight) * 0.8 : 210;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
  }

  draw(px: number, pz: number, heading: number, camYaw: number) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const [x0, z0, x1, z1] = this.manifest.bounds;
    // escala (px por metro) e centro
    const ppm = this.expanded ? Math.min(W / (x1 - x0), H / (z1 - z0)) * 0.98 : (W / 210) * 0.42;
    const cx = this.expanded ? (x0 + x1) / 2 : px;
    const cz = this.expanded ? (z0 + z1) / 2 : pz;
    const toS = (x: number, z: number): [number, number] => [W / 2 + (x - cx) * ppm, H / 2 + (z - cz) * ppm];
    c.fillStyle = '#14171b';
    c.fillRect(0, 0, W, H);
    const [sx, sy] = toS(this.origin[0], this.origin[1]);
    const k = ppm / this.staticScale;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.static, sx, sy, this.static.width * k, this.static.height * k);
    // pontos de validação
    c.font = `${Math.round(10 * (W / 210))}px system-ui`;
    for (const v of this.manifest.validation) {
      const isLm = v.key.startsWith('LANDMARK');
      if (!isLm && !this.expanded && Math.hypot(v.p[0] - px, v.p[1] - pz) > 300) continue;
      const [x, y] = toS(v.p[0], v.p[1]);
      c.fillStyle = isLm ? '#ffcc33' : '#7fb3ff';
      c.beginPath();
      c.arc(x, y, (isLm ? 5 : 2.5) * (W / 210), 0, Math.PI * 2);
      c.fill();
      if (isLm || this.expanded) {
        c.fillStyle = isLm ? '#ffe9a8' : '#b9cff5';
        const label = v.key === 'LANDMARK_CENTRAL' ? 'Central' : v.key === 'LANDMARK_CANDELARIA' ? 'Candelária' : v.key.replace(/^(INTERSECTION_|METRO_)/, '').slice(0, 18);
        c.fillText(label, x + 7, y + 4);
      }
    }
    // landmarks (footprints)
    c.strokeStyle = '#ffcc33';
    c.lineWidth = 1.5;
    for (const l of this.manifest.landmarks) {
      c.beginPath();
      l.footprint.forEach((p, i) => {
        const [x, y] = toS(p[0], p[1]);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.closePath();
      c.stroke();
    }
    // cone de visão da câmera
    const [ppx, ppy] = toS(px, pz);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.beginPath();
    c.moveTo(ppx, ppy);
    const fov = 0.6, len = 60 * (W / 210);
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    for (const s of [-1, 1]) {
      const a = Math.atan2(fz, fx) + s * fov;
      c.lineTo(ppx + Math.cos(a) * len, ppy + Math.sin(a) * len);
    }
    c.closePath();
    c.fill();
    // jogador
    c.save();
    c.translate(ppx, ppy);
    c.rotate(-heading);
    c.fillStyle = '#3df5a6';
    c.beginPath();
    const s = 7 * (W / 210);
    c.moveTo(0, s);
    c.lineTo(s * 0.6, -s * 0.6);
    c.lineTo(-s * 0.6, -s * 0.6);
    c.closePath();
    c.fill();
    c.restore();
  }
}
