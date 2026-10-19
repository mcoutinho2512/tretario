/**
 * Pinta um `Design` (designs.ts) em canvas 2D — fonte ÚNICA das texturas de bandeiras, cartazes, faixas, carros
 * de som, caminhões, telões, palcos e camisas. Sem imagens externas (licença limpa, sem logotipos).
 *
 * `DesignAtlas`: todos os designs de um alvo numa só textura em grade → bandeiras/cartazes distantes podem ser
 * desenhados como InstancedMesh com um offset de UV por instância (um draw call para centenas de itens).
 */
import * as THREE from 'three';
import { DESIGNS, DESIGN_BY_ID, type Design, type DesignTarget } from './designs';

type Ctx = CanvasRenderingContext2D;

function fitText(ctx: Ctx, text: string, maxW: number, maxH: number, weight = 900): number {
  let size = maxH;
  ctx.font = `${weight} ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size = Math.max(6, Math.floor(size * (maxW / w)));
  ctx.font = `${weight} ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  return size;
}

/** padrão de fundo */
function paintPattern(ctx: Ctx, d: Design, x: number, y: number, w: number, h: number) {
  const p = d.palette;
  ctx.fillStyle = p.bg;
  ctx.fillRect(x, y, w, h);
  const acc = p.accent ?? p.fg;
  switch (d.pattern) {
    case 'brazil': {
      // bandeira nacional (domínio público): retângulo verde, losango amarelo, círculo azul com faixa branca
      ctx.fillStyle = p.accent ?? '#ffdf00';
      const mx = w * 0.085, my = h * 0.12;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + my); ctx.lineTo(x + w - mx, y + h / 2); ctx.lineTo(x + w / 2, y + h - my); ctx.lineTo(x + mx, y + h / 2);
      ctx.closePath(); ctx.fill();
      const r = Math.min(w, h) * 0.25;
      ctx.fillStyle = p.fg;
      ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = p.third ?? '#ffffff'; ctx.lineWidth = r * 0.18;
      ctx.beginPath(); ctx.arc(x + w / 2 - r * 0.15, y + h / 2 + r * 1.9, r * 2.1, Math.PI * 1.32, Math.PI * 1.72); ctx.stroke();
      // estrelas (pontos)
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 22; i++) {
        const a = (i * 137.5 * Math.PI) / 180, rr = r * (0.25 + ((i * 53) % 60) / 100);
        ctx.fillRect(x + w / 2 + Math.cos(a) * rr * 0.9, y + h / 2 + Math.sin(a) * rr * 0.55 + r * 0.25, r * 0.035, r * 0.035);
      }
      ctx.restore();
      break;
    }
    case 'h_stripes':
    case 'hoops': {
      const n = d.pattern === 'hoops' ? 8 : 5;
      ctx.fillStyle = acc;
      for (let i = 1; i < n; i += 2) ctx.fillRect(x, y + (h * i) / n, w, h / n);
      break;
    }
    case 'v_stripes': {
      const n = 9;
      ctx.fillStyle = acc;
      for (let i = 1; i < n; i += 2) ctx.fillRect(x + (w * i) / n, y, w / n, h);
      break;
    }
    case 'tricolor_v': {
      const n = 9, cols = [p.bg, p.third ?? '#ffffff', p.accent ?? p.fg];
      for (let i = 0; i < n; i++) { ctx.fillStyle = cols[i % 3]; ctx.fillRect(x + (w * i) / n, y, w / n + 1, h); }
      break;
    }
    case 'sash': {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = acc; ctx.lineWidth = Math.min(w, h) * 0.18;
      ctx.beginPath(); ctx.moveTo(x - w * 0.1, y - h * 0.05); ctx.lineTo(x + w * 1.1, y + h * 1.05); ctx.stroke();
      ctx.restore();
      break;
    }
    // rodada 10 — torcidas (só cores/padrões; sem escudo nem texto próprio)
    case 'hoops_top': {
      const n = 7; // começa e termina em `bg`
      ctx.fillStyle = acc;
      for (let i = 1; i < n; i += 2) ctx.fillRect(x, y + (h * i) / n, w, h / n + 0.5);
      break;
    }
    case 'sash_l': {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = acc; ctx.lineWidth = Math.min(w, h) * 0.26;
      ctx.beginPath(); ctx.moveTo(x + w * 1.1, y - h * 0.05); ctx.lineTo(x - w * 0.1, y + h * 1.05); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'stripes_pin':
    case 'stripes_eq': {
      const n = 9, sw = w / n;
      for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? acc : p.bg; ctx.fillRect(x + sw * i, y, sw + 0.5, h); }
      if (d.pattern === 'stripes_pin') {
        ctx.fillStyle = p.third ?? '#ffffff';
        const pw = Math.max(1, sw * 0.1);
        for (let i = 1; i < n; i++) ctx.fillRect(x + sw * i - pw / 2, y, pw, h);
      }
      break;
    }
    case 'split_v':
      ctx.fillStyle = acc; ctx.fillRect(x + w / 2, y, w / 2, h);
      break;
    case 'split_h':
      ctx.fillStyle = acc; ctx.fillRect(x, y + h * 0.72, w, h * 0.28);
      break;
    case 'border': {
      const b = Math.min(w, h) * 0.06;
      ctx.strokeStyle = acc; ctx.lineWidth = b;
      ctx.strokeRect(x + b / 2, y + b / 2, w - b, h - b);
      break;
    }
    case 'solid':
    default:
      break;
  }
}

/** textos (nome/palavra de ordem, número, sigla) e a marca "SIMULAÇÃO" */
function paintText(ctx: Ctx, d: Design, x: number, y: number, w: number, h: number, target: DesignTarget) {
  if (target === 'shirt') return; // camisas: só cores/padrões (sem texto, sem escudo)
  const lines = d.lines ?? [];
  const hasNum = !!d.number;
  ctx.fillStyle = d.palette.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pad = w * 0.08;
  // distribuição vertical: nome(s) em cima, número grande no meio/baixo, sigla pequena
  const blocks: { text: string; weight: number; rel: number }[] = [];
  for (const l of lines) blocks.push({ text: l, weight: 900, rel: lines.length > 1 ? 0.8 : 1 });
  if (hasNum) blocks.push({ text: d.number!, weight: 900, rel: 1.9 });
  if (d.small) blocks.push({ text: d.small, weight: 800, rel: 0.55 });
  if (!blocks.length) return;
  const totalRel = blocks.reduce((s, b) => s + b.rel, 0);
  const usable = h * (d.simulationTag ? 0.78 : 0.86);
  let cy = y + (h - usable) / 2 - (d.simulationTag ? h * 0.04 : 0);
  for (const b of blocks) {
    const bh = (usable * b.rel) / totalRel;
    fitText(ctx, b.text, w - pad * 2, bh * 0.82, b.weight);
    ctx.fillText(b.text, x + w / 2, cy + bh / 2);
    cy += bh;
  }
  if (d.simulationTag) {
    const s = Math.max(6, Math.floor(h * 0.045));
    ctx.font = `600 ${s}px Arial, sans-serif`;
    ctx.globalAlpha = 0.75;
    ctx.fillText('SIMULAÇÃO · PRESIDENTE VARGAS 3D', x + w / 2, y + h - s * 1.1);
    ctx.globalAlpha = 1;
  }
}

/** pinta o design num retângulo do canvas */
export function paintDesign(ctx: Ctx, d: Design, x: number, y: number, w: number, h: number, target: DesignTarget) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  paintPattern(ctx, d, x, y, w, h);
  paintText(ctx, d, x, y, w, h, target);
  ctx.restore();
}

/** proporção (largura/altura) padrão de cada alvo */
export const TARGET_ASPECT: Record<DesignTarget, number> = {
  flag: 1.43, sign: 0.75, banner: 3.4, truck: 2.6, screen: 1.78, stage: 4, shirt: 1,
};

const texCache = new Map<string, THREE.CanvasTexture>();
/** textura de UM design para um alvo (cacheada; para objetos próximos/únicos: caminhão, telão, palco) */
export function designTexture(designId: number, target: DesignTarget, height = 256): THREE.CanvasTexture {
  const key = `${designId}:${target}:${height}`;
  let t = texCache.get(key);
  if (t) return t;
  const d = DESIGN_BY_ID.get(designId) ?? DESIGNS[0];
  const c = document.createElement('canvas');
  c.height = height;
  c.width = Math.round(height * TARGET_ASPECT[target]);
  paintDesign(c.getContext('2d')!, d, 0, 0, c.width, c.height, target);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = `design_${d.key}_${target}`;
  texCache.set(key, t);
  return t;
}

/**
 * Atlas de todos os designs de um alvo (grade). `uv(designId)` → [u0, v0, du, dv] para o shader/instância.
 * Uma textura por alvo; designs desconhecidos caem na célula 0.
 */
export class DesignAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly cols: number;
  readonly rows: number;
  private cell = new Map<number, number>();

  constructor(readonly target: DesignTarget, cellH = 128, designs: Design[] = DESIGNS.filter((d) => d.targets.includes(target))) {
    const n = Math.max(1, designs.length);
    const cw = Math.round(cellH * TARGET_ASPECT[target]);
    this.cols = Math.ceil(Math.sqrt(n * (cellH / cw)));
    this.rows = Math.ceil(n / this.cols);
    const c = document.createElement('canvas');
    c.width = cw * this.cols; c.height = cellH * this.rows;
    const ctx = c.getContext('2d')!;
    designs.forEach((d, i) => {
      this.cell.set(d.id, i);
      paintDesign(ctx, d, (i % this.cols) * cw, Math.floor(i / this.cols) * cellH, cw, cellH, target);
    });
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.name = `design_atlas_${target}`;
  }

  /** [u0, v0, du, dv] (v de baixo para cima, convenção do three) */
  uv(designId: number): [number, number, number, number] {
    const i = this.cell.get(designId) ?? 0;
    const du = 1 / this.cols, dv = 1 / this.rows;
    const col = i % this.cols, row = Math.floor(i / this.cols);
    return [col * du, 1 - (row + 1) * dv, du, dv];
  }
}

const atlases = new Map<DesignTarget, DesignAtlas>();
export function designAtlas(target: DesignTarget): DesignAtlas {
  let a = atlases.get(target);
  if (!a) { a = new DesignAtlas(target); atlases.set(target, a); }
  return a;
}
