/**
 * Minimapa da Presidente Vargas (rodada 8) — canvas 2D, norte para cima.
 *
 * Camadas:
 *  - estática (uma vez): ruas do OSM (`manifest.minimapRoads`), a Pres. Vargas e a Rio Branco em destaque, o Campo de
 *    Santana (miolo da Praça da República); rodada 9: faixa tingida das zonas COMBAT/CONTESTED (zones.json);
 *  - calor (1–2 Hz): densidade da multidão agregada numa grade grossa (`DensityGrid`, 1 px por célula, borrada e
 *    ampliada com suavização) — manchas, nunca um ponto por pessoa;
 *  - marcadores (a cada redesenho, ≤ 10 Hz): Central, Candelária, nomes das zonas, trio (posição ao vivo), carros de
 *    som, palco, pontos de concentração, jogador + cone da câmera.
 * Visão compacta (segue o jogador) e expandida (M ou clique/toque: o corredor inteiro).
 * `stats` mede o custo (ms) de cada redesenho e de cada amostra de densidade.
 */
import type { WorldManifest } from '../../world/types';
import { pointOnAxis, type ZoneDefinition } from '../../world/zones';
import { rallyPoints } from '../../social/rally';
import { DensityGrid, heatLevel } from './densityGrid';
import { uiZoom } from '../uiPrefs'; // rodada 11 — escala da interface

type XZ = [number, number];
interface Label { text: string; x: number; z: number; kind: 'landmark' | 'zone'; /** largura aproximada (px a u = 1) */ w: number }

const STATIC_PPM = 0.5; // px por metro na camada estática
const DENSITY_CELL = 10; // m por célula da grade de calor
const COMPACT_PPM = 0.32; // px CSS por metro na visão compacta (~575 m de lado)

export class Minimap {
  /** rodada 9 — marcas de eventos agendados (escritas pelo EventClient; desenhadas no próximo quadro do mapa) */
  eventMarks: { x: number; z: number; color: string; label?: string; r?: number; ring?: string }[] = [];
  /**
   * rodada 12 — focos de eventos DINÂMICOS (src/events/dynamicPresentation.ts): uma marca AGREGADA por foco, com
   * anel pulsando pela intensidade. A população (autônomos inclusive) continua só no calor da densidade — nunca um
   * ponto por pessoa.
   */
  dynamicMarks: { x: number; z: number; color: string; label?: string; r: number; ring?: string; pulse: number }[] = [];
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private caption: HTMLDivElement;
  private staticLayer: HTMLCanvasElement;
  private heat: HTMLCanvasElement;
  private heatCtx: CanvasRenderingContext2D;
  private heatImg: ImageData;
  private blurA: Float32Array;
  private blurB: Float32Array;
  readonly density: DensityGrid;
  private labels: Label[] = [];
  private bounds: [number, number, number, number];
  /** retângulo do corredor (visão expandida) */
  private corridor: [number, number, number, number];
  expanded = false;
  private cssSize = 0;
  private cssW = 0;
  private cssH = 0;
  private compactSize: number;
  stats = { drawMs: 0, densityMs: 0, draws: 0, samples: 0, densityTotal: 0, densityPeak: 0 };

  constructor(manifest: WorldManifest, zones: readonly ZoneDefinition[], opts: { compactSize?: number } = {}) {
    this.compactSize = opts.compactSize ?? 184;
    this.el = document.createElement('div');
    this.el.className = 'minimap hud-fadeable';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Minimapa da Avenida Presidente Vargas');
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.caption = document.createElement('div');
    this.caption.className = 'minimap-caption';
    this.el.appendChild(this.caption);
    this.ctx = this.canvas.getContext('2d')!;
    this.bounds = manifest.bounds as [number, number, number, number];
    const [x0, z0, x1, z1] = this.bounds;
    // corredor: eixo da avenida + folga (a parte jogável do mapa)
    let ax0 = Infinity, az0 = Infinity, ax1 = -Infinity, az1 = -Infinity;
    for (const [x, z] of manifest.pvAxis) { ax0 = Math.min(ax0, x); az0 = Math.min(az0, z); ax1 = Math.max(ax1, x); az1 = Math.max(az1, z); }
    const m = 170;
    this.corridor = [Math.max(x0, ax0 - m), Math.max(z0, az0 - m), Math.min(x1, ax1 + m), Math.min(z1, az1 + m)];

    // ---- camada estática
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = Math.ceil((x1 - x0) * STATIC_PPM);
    this.staticLayer.height = Math.ceil((z1 - z0) * STATIC_PPM);
    const g = this.staticLayer.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const toS = (p: XZ): XZ => [(p[0] - x0) * STATIC_PPM, (p[1] - z0) * STATIC_PPM];
    // rodada 9: faixa tingida das zonas de CONFRONTO (vermelho) e DISPUTA (âmbar) ao longo do eixo — fraca, por baixo de tudo
    for (const zn of zones) {
      const pol = zn.combatPolicy === 'CONTESTED' ? 'CONTESTED' : 'COMBAT'; // rodada 12: não há zona de paz
      g.strokeStyle = pol === 'COMBAT' ? 'rgba(224, 70, 56, 0.22)' : 'rgba(240, 170, 60, 0.18)';
      g.lineWidth = Math.min(zn.halfWidth, 120) * 2 * STATIC_PPM;
      g.lineCap = 'butt';
      g.beginPath();
      for (let t = zn.from, i = 0; t <= zn.to + 1e-6; t += 0.004, i++) {
        const q = pointOnAxis(manifest.pvAxis, Math.min(t, zn.to));
        const [x, y] = toS([q.x, q.z]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.lineCap = 'round';
    // Campo de Santana: miolo do anel da Praça da República (dado do mapa, não posição fixa)
    const pr = manifest.minimapRoads.filter((r) => r.name === 'Praça da República').flatMap((r) => r.pts);
    if (pr.length) {
      let sx = 0, sz = 0;
      for (const p of pr) { sx += p[0]; sz += p[1]; }
      const c: XZ = [sx / pr.length, sz / pr.length];
      let rad = 0;
      for (const p of pr) rad += Math.hypot(p[0] - c[0], p[1] - c[1]);
      rad = (rad / pr.length) * 0.82;
      const [cx, cy] = toS(c);
      g.fillStyle = 'rgba(86, 140, 92, 0.42)';
      g.beginPath();
      g.arc(cx, cy, rad * STATIC_PPM, 0, Math.PI * 2);
      g.fill();
    }
    const stroke = (pick: (r: WorldManifest['minimapRoads'][number]) => boolean, color: string, wk: number, minW: number) => {
      g.strokeStyle = color;
      for (const r of manifest.minimapRoads) {
        if (!pick(r)) continue;
        g.lineWidth = Math.max(minW, r.w * STATIC_PPM * wk);
        g.beginPath();
        r.pts.forEach((p, i) => { const [x, y] = toS(p); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
        g.stroke();
      }
    };
    stroke((r) => !r.pv && r.name !== 'Avenida Rio Branco', 'rgba(150, 160, 170, 0.55)', 1, 1);
    stroke((r) => r.name === 'Avenida Rio Branco', 'rgba(232, 214, 170, 0.85)', 1.1, 2);
    stroke((r) => !!r.pv, 'rgba(224, 72, 60, 0.9)', 0.7, 3);
    // landmarks: contorno
    g.fillStyle = 'rgba(255, 204, 51, 0.55)';
    for (const l of manifest.landmarks) {
      g.beginPath();
      l.footprint.forEach((p, i) => { const [x, y] = toS(p as XZ); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.closePath();
      g.fill();
    }

    // ---- rótulos (zonas + landmarks)
    const lm = (k: string) => manifest.landmarks.find((l) => l.key === k);
    const central = lm('LANDMARK_CENTRAL'), cand = lm('LANDMARK_CANDELARIA');
    if (central) this.labels.push({ text: 'Central do Brasil', x: central.center[0], z: central.center[1], kind: 'landmark', w: 0 });
    if (cand) this.labels.push({ text: 'Candelária', x: cand.center[0], z: cand.center[1], kind: 'landmark', w: 0 });
    for (const zn of zones) {
      if (zn.id === 'CENTRAL' || zn.id === 'CANDELARIA' || !zn.anchor) continue;
      // ponto de validação do mapa quando existe (o parque do Campo de Santana, a esquina da Rio Branco); senão a âncora
      const vp = manifest.validation.find((v) => v.key === zn.id || v.key === `INTERSECTION_${zn.id}`);
      const a = pointOnAxis(manifest.pvAxis, zn.anchor.t, zn.anchor.side);
      const p = vp ? { x: vp.p[0], z: vp.p[1] + (zn.id === 'RIO_BRANCO' ? 70 : 0) } : a;
      this.labels.push({ text: zn.name, x: p.x, z: p.z, kind: 'zone', w: zn.name.length * 7.2 });
    }

    // ---- calor
    this.density = new DensityGrid(x0, z0, x1, z1, DENSITY_CELL);
    this.heat = document.createElement('canvas');
    this.heat.width = this.density.cols;
    this.heat.height = this.density.rows;
    this.heatCtx = this.heat.getContext('2d')!;
    this.heatImg = this.heatCtx.createImageData(this.density.cols, this.density.rows);
    this.blurA = new Float32Array(this.density.cols * this.density.rows);
    this.blurB = new Float32Array(this.density.cols * this.density.rows);

    this.el.addEventListener('click', () => this.toggleExpanded());
    this.resize();
  }

  /** rodada 9 — destino escolhido na agenda / "Acontecendo agora" (anel pulsante + rótulo); null tira */
  target: { x: number; z: number; label: string } | null = null;
  setTarget(t: { x: number; z: number; label: string } | null) { this.target = t; }

  setCaption(text: string) { if (this.caption.textContent !== text) this.caption.textContent = text; }

  toggleExpanded(v = !this.expanded) {
    if (v === this.expanded) return;
    this.expanded = v;
    this.el.classList.toggle('expanded', v);
    this.resize();
  }

  resize() {
    // rodada 11 — escala da interface (CSS zoom no HUD): o canvas fica nítido e o mapa expandido cabe na tela
    const z = uiZoom();
    const dpr = Math.min(2, window.devicePixelRatio || 1) * z;
    if (this.expanded) {
      const [cx0, cz0, cx1, cz1] = this.corridor;
      const aspect = (cx1 - cx0) / (cz1 - cz0);
      const maxW = Math.min((window.innerWidth - 32) / z, 1100), maxH = Math.min((window.innerHeight - 120) / z, 640);
      let w = maxW, h = w / aspect;
      if (h > maxH) { h = maxH; w = h * aspect; }
      this.cssW = Math.round(w); this.cssH = Math.round(h);
    } else {
      this.cssW = this.cssH = this.compactSize;
    }
    this.cssSize = Math.min(this.cssW, this.cssH);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
  }

  set compact(size: number) { this.compactSize = size; if (!this.expanded) this.resize(); }

  /** amostra de densidade: lista de agentes {x,z} (todos os humanos submetidos à multidão no quadro) */
  sampleDensity(list: readonly { x: number; z: number }[]) {
    const t0 = performance.now();
    const d = this.density;
    d.clear();
    d.addAll(list);
    // borrão de caixa 3×3 separável, duas passadas (manchas suaves); depois mapa de cor → ImageData
    const W = d.cols, H = d.rows, a = this.blurA, b = this.blurB, c = d.counts;
    for (let i = 0; i < c.length; i++) a[i] = c[i];
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) {
        const o = y * W;
        for (let x = 0; x < W; x++) b[o + x] = (a[o + x] * 2 + (x > 0 ? a[o + x - 1] : 0) + (x < W - 1 ? a[o + x + 1] : 0)) * 0.25;
      }
      for (let y = 0; y < H; y++) {
        const o = y * W;
        for (let x = 0; x < W; x++) a[o + x] = (b[o + x] * 2 + (y > 0 ? b[o + x - W] : 0) + (y < H - 1 ? b[o + x + W] : 0)) * 0.25;
      }
    }
    const px = this.heatImg.data;
    for (let i = 0; i < a.length; i++) {
      const k = heatLevel(a[i], 8);
      const j = i * 4;
      if (k < 0.12) { px[j + 3] = 0; continue; }
      // âmbar claro (poucas pessoas) → laranja → quase branco na concentração
      px[j] = 255;
      px[j + 1] = Math.round(170 + 60 * k * k);
      px[j + 2] = Math.round(70 + 150 * k * k * k);
      px[j + 3] = Math.round(30 + 190 * k);
    }
    this.heatCtx.putImageData(this.heatImg, 0, 0);
    this.stats.densityTotal = d.total;
    this.stats.densityPeak = d.peak;
    this.stats.samples++;
    const ms = performance.now() - t0;
    this.stats.densityMs = this.stats.samples === 1 ? ms : this.stats.densityMs * 0.8 + ms * 0.2;
  }

  draw(px: number, pz: number, heading: number, camYaw: number) {
    const t0 = performance.now();
    const c = this.ctx;
    const dpr = this.canvas.width / this.cssW;
    const W = this.canvas.width, H = this.canvas.height;
    const [x0, z0] = this.bounds;
    let ppm: number, cx: number, cz: number;
    if (this.expanded) {
      const [a0, b0, a1, b1] = this.corridor;
      ppm = Math.min(W / (a1 - a0), H / (b1 - b0));
      cx = (a0 + a1) / 2; cz = (b0 + b1) / 2;
    } else {
      ppm = COMPACT_PPM * dpr * (this.cssSize / 184);
      cx = px; cz = pz;
    }
    const sx = (x: number) => W / 2 + (x - cx) * ppm;
    const sy = (z: number) => H / 2 + (z - cz) * ppm;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(16, 20, 24, 0.86)';
    c.fillRect(0, 0, W, H);
    const k = ppm / STATIC_PPM;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.staticLayer, sx(x0), sy(z0), this.staticLayer.width * k, this.staticLayer.height * k);
    // calor (densidade): 1 px por célula ampliado com suavização
    if (this.stats.samples) {
      c.drawImage(this.heat, sx(x0), sy(z0), this.heat.width * DENSITY_CELL * ppm, this.heat.height * DENSITY_CELL * ppm);
    }
    // unidade de desenho (px de tela); mapa expandido estreito (celular): letras um pouco menores e sem rótulo de carro de som
    const narrow = this.expanded && this.cssW < 640;
    const u = dpr * (this.expanded ? (narrow ? 0.95 : 1.15) : 1);
    const inView = (x: number, y: number, pad = 0) => x > -pad && y > -pad && x < W + pad && y < H + pad;
    // pontos de concentração / veículos de evento (posição ao vivo)
    for (const p of rallyPoints.all()) {
      const x = sx(p.x), y = sy(p.z);
      if (!inView(x, y, 20)) continue;
      if (p.kind === 'trio') this.marker(x, y, u, '#c45cff', 'TRIO', 6.5);
      else if (p.kind === 'soundcar') this.marker(x, y, u, '#ff8a3d', this.expanded && !narrow ? 'SOM' : '', 4.5);
      else if (p.kind === 'stage') this.marker(x, y, u, '#4fc3ff', 'PALCO', 5.5);
      else { c.fillStyle = 'rgba(255, 233, 168, 0.8)'; c.beginPath(); c.arc(x, y, 2.4 * u, 0, Math.PI * 2); c.fill(); }
    }
    // destino (agenda): anel dourado; fora da visão compacta, seta na borda apontando para ele
    if (this.target) {
      const t = this.target;
      let x = sx(t.x), y = sy(t.z);
      const off = !inView(x, y, -10 * u);
      if (off) { const a = Math.atan2(y - H / 2, x - W / 2), m = Math.min(W, H) / 2 - 12 * u; x = W / 2 + Math.cos(a) * m; y = H / 2 + Math.sin(a) * m; }
      c.strokeStyle = '#ffd34d'; c.lineWidth = 2.5 * u;
      c.beginPath(); c.arc(x, y, (off ? 5 : 9) * u, 0, Math.PI * 2); c.stroke();
      c.textBaseline = 'middle';
      if (!off || this.expanded) this.text(t.label, x + 12 * u, y, u, '#ffe9a8', 'left', true);
    }
    // rodada 9 — eventos agendados: concentração (caminhada/torcida) e checkpoints da corrida (src/events/EventClient.ts)
    for (const m of this.eventMarks) {
      const x = sx(m.x), y = sy(m.z);
      if (!inView(x, y, 20)) continue;
      // rodada 10 — concentração de torcida (agregada): anel na 2ª cor e sigla em claro (cores escuras somem no mapa)
      if (m.ring) { c.fillStyle = m.ring; c.beginPath(); c.arc(x, y, ((m.r ?? 3) + 2) * u, 0, Math.PI * 2); c.fill(); this.marker(x, y, u, m.color, '', m.r ?? 3); if (m.label) this.text(m.label, x, y - ((m.r ?? 3) + 9) * u, u, '#f4f1e8', 'center', true); }
      else this.marker(x, y, u, m.color, m.label ?? '', m.r ?? 3);
    }
    // rodada 12 — focos dinâmicos: anel pulsando (intensidade) + marca; rótulo genérico só na visão expandida
    if (this.dynamicMarks.length) {
      const ph = (performance.now() / 1000) % 1;
      for (const m of this.dynamicMarks) {
        const x = sx(m.x), y = sy(m.z);
        if (!inView(x, y, 30)) continue;
        if (m.ring) { c.fillStyle = m.ring; c.beginPath(); c.arc(x, y, (m.r + 2 + 6 * m.pulse * ph) * u, 0, Math.PI * 2); c.fill(); }
        this.marker(x, y, u, m.color, this.expanded && !narrow ? m.label ?? '' : '', m.r);
      }
    }
    // rótulos
    c.textBaseline = 'middle';
    for (const l of this.labels) {
      const x = sx(l.x), y = sy(l.z);
      if (!inView(x, y, 60 * u)) continue;
      // visão compacta: nome de zona cortado na borda não ajuda (a legenda embaixo já diz a zona atual)
      if (l.kind === 'zone' && !this.expanded && (x < l.w * u * 0.5 + 4 || x > W - l.w * u * 0.5 - 4 || y < 14 * u || y > H - 22 * u)) continue;
      if (l.kind === 'landmark') {
        c.fillStyle = '#ffcc33';
        c.beginPath(); c.moveTo(x, y - 5 * u); c.lineTo(x + 4 * u, y); c.lineTo(x, y + 5 * u); c.lineTo(x - 4 * u, y); c.closePath(); c.fill();
      }
      this.text(l.text, x + (l.kind === 'landmark' ? 7 * u : 0), y, u, l.kind === 'landmark' ? '#ffe9a8' : 'rgba(236, 232, 222, 0.85)', l.kind === 'zone' ? 'center' : 'left', l.kind === 'zone');
    }
    // cone da câmera + jogador
    const ppx = sx(px), ppy = sy(pz);
    c.fillStyle = 'rgba(255, 255, 255, 0.13)';
    c.beginPath();
    c.moveTo(ppx, ppy);
    const fov = 0.55, len = (this.expanded ? 34 : 46) * u;
    const ang = Math.atan2(Math.cos(camYaw), Math.sin(camYaw));
    c.arc(ppx, ppy, len, ang - fov, ang + fov);
    c.closePath();
    c.fill();
    c.save();
    c.translate(ppx, ppy);
    c.rotate(-heading);
    const s = 6.5 * u;
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    c.lineWidth = 1.5 * u;
    c.beginPath();
    c.moveTo(0, s);
    c.lineTo(s * 0.68, -s * 0.62);
    c.lineTo(0, -s * 0.25);
    c.lineTo(-s * 0.68, -s * 0.62);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    // norte
    this.text('N', W - 10 * u, 10 * u, u, 'rgba(236, 232, 222, 0.6)', 'center', false);
    const ms = performance.now() - t0;
    this.stats.draws++;
    this.stats.drawMs = this.stats.draws === 1 ? ms : this.stats.drawMs * 0.9 + ms * 0.1;
  }

  private marker(x: number, y: number, u: number, color: string, label: string, r: number) {
    const c = this.ctx;
    c.fillStyle = color;
    c.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    c.lineWidth = 1.2 * u;
    c.beginPath();
    c.arc(x, y, r * u, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    if (label) this.text(label, x, y - (r + 7) * u, u, color, 'center', true);
  }

  private text(t: string, x: number, y: number, u: number, color: string, align: CanvasTextAlign, caps: boolean) {
    const c = this.ctx;
    c.font = `${caps ? 700 : 600} ${Math.round((caps ? 9 : 10.5) * u)}px system-ui, sans-serif`;
    c.textAlign = align;
    const s = caps ? t.toUpperCase() : t;
    c.lineWidth = 3 * u;
    c.strokeStyle = 'rgba(10, 12, 14, 0.85)';
    c.strokeText(s, x, y);
    c.fillStyle = color;
    c.fillText(s, x, y);
  }
}
