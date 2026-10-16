/**
 * Painéis de LED virtuais nas fachadas (locais escolhidos pelo pipeline: fachadas altas voltadas para a avenida,
 * concentradas nos grandes cruzamentos). Conteúdo trocável em runtime — texto gerado, imagem ou vídeo por URL —
 * preparado para vir do backend (agenda de anúncios/eventos). Painéis com o mesmo conteúdo compartilham textura.
 */
import * as THREE from 'three';
import type { BillboardSlot } from '../world/types';
import type { BillboardContent, BillboardPlan } from './types';

interface Panel { slot: BillboardSlot; screen: THREE.Mesh; group: THREE.Group; contentKey: string }

export class BillboardSystem {
  readonly group = new THREE.Group();
  private panels: Panel[] = [];
  private textures = new Map<string, THREE.Texture>();
  private plan: BillboardPlan = {};
  private t = 0;
  private lastRotation = -1;
  private overrides = new Map<string, BillboardContent>();

  constructor(slots: BillboardSlot[]) {
    this.group.name = 'billboards';
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.5, metalness: 0.6 });
    for (const slot of slots) {
      const g = new THREE.Group();
      g.position.set(slot.p[0], slot.y, slot.p[1]);
      g.rotation.y = slot.r;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(slot.w + 0.5, slot.h + 0.5, 0.45), frameMat);
      frame.position.z = 0.05;
      frame.castShadow = true;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(slot.w, slot.h), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      screen.position.z = 0.29;
      screen.name = `led_${slot.id}`;
      g.add(frame, screen);
      this.group.add(g);
      this.panels.push({ slot, screen, group: g, contentKey: '' });
    }
  }

  get count() { return this.panels.length; }

  /** aplica o plano de conteúdo de um evento */
  setPlan(plan: BillboardPlan | undefined) {
    this.plan = plan ?? {};
    this.lastRotation = -1;
    this.refresh();
  }

  /** API para o backend/admin: conteúdo de um painel específico (id) ou de todos ('*') */
  setPanelContent(id: string, content: BillboardContent | null) {
    if (content) this.overrides.set(id, content); else this.overrides.delete(id);
    this.refresh();
  }

  private contentFor(p: Panel, rot: number, idx: number): BillboardContent {
    const ov = this.overrides.get(p.slot.id) ?? this.overrides.get('*');
    if (ov) return ov;
    const pl = this.plan;
    if (pl.byPanel?.[p.slot.id]) return pl.byPanel[p.slot.id];
    if (pl.byZone?.[p.slot.zone]) return pl.byZone[p.slot.zone];
    if (pl.playlist?.length) return pl.playlist[(rot + idx) % pl.playlist.length];
    return pl.default ?? { type: 'text', text: 'PRESIDENTE VARGAS 3D', subtext: 'Painel digital', colors: ['#101820', '#ffcc33'] };
  }

  private refresh() {
    const period = this.plan.rotateSeconds ?? 0;
    const rot = period > 0 ? Math.floor(this.t / period) : 0;
    this.lastRotation = rot;
    this.panels.forEach((p, i) => {
      const c = this.contentFor(p, rot, i);
      const key = JSON.stringify(c) + (c.type === 'text' ? `|${p.slot.w > p.slot.h ? 'h' : 'v'}` : '');
      if (key === p.contentKey) return;
      p.contentKey = key;
      (p.screen.material as THREE.MeshBasicMaterial).map = this.textureFor(c, key, p.slot.w / p.slot.h);
      (p.screen.material as THREE.MeshBasicMaterial).needsUpdate = true;
    });
  }

  private textureFor(c: BillboardContent, key: string, aspect: number): THREE.Texture {
    const cached = this.textures.get(key);
    if (cached) return cached;
    let tex: THREE.Texture;
    if (c.type === 'image' && c.url) {
      tex = new THREE.TextureLoader().setCrossOrigin('anonymous').load(c.url);
    } else if (c.type === 'video' && c.url) {
      const v = document.createElement('video');
      Object.assign(v, { src: c.url, muted: true, loop: true, playsInline: true, autoplay: true, crossOrigin: 'anonymous' });
      void v.play().catch(() => { /* autoplay bloqueado: tenta no próximo gesto */ });
      tex = new THREE.VideoTexture(v);
    } else {
      tex = textCanvas(c, aspect);
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, tex);
    return tex;
  }

  update(dt: number, cam: THREE.Vector3) {
    this.t += dt;
    const period = this.plan.rotateSeconds ?? 0;
    if (period > 0 && Math.floor(this.t / period) !== this.lastRotation) this.refresh();
    for (const p of this.panels) {
      const d = Math.hypot(p.slot.p[0] - cam.x, p.slot.p[1] - cam.z);
      p.group.visible = d < 900;
    }
  }
}

/** Conteúdo de texto em canvas (fundo, título, subtítulo, faixa de LED). */
function textCanvas(c: BillboardContent, aspect: number): THREE.CanvasTexture {
  const W = aspect >= 1 ? 1024 : 512, H = aspect >= 1 ? Math.round(1024 / aspect) : Math.round(512 / aspect);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d')!;
  const [bg, fg] = c.colors ?? ['#101820', '#ffcc33'];
  const grad = x.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, shade(bg, -0.35));
  x.fillStyle = grad;
  x.fillRect(0, 0, W, H);
  // textura de pixels de LED
  x.fillStyle = 'rgba(0,0,0,0.18)';
  for (let yy = 0; yy < H; yy += 4) x.fillRect(0, yy, W, 1);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const lines = wrap(x, c.text ?? '', W * 0.9, aspect >= 1 ? 120 : 84);
  const size = lines.size;
  x.font = `900 ${size}px Arial Black, Arial, sans-serif`;
  lines.lines.forEach((l, i) => x.fillText(l, W / 2, H * 0.42 + (i - (lines.lines.length - 1) / 2) * size * 1.05));
  if (c.subtext) {
    x.font = `600 ${Math.round(size * 0.36)}px Arial, sans-serif`;
    x.fillStyle = shade(fg, 0.1);
    x.fillText(c.subtext, W / 2, H * 0.8, W * 0.92);
  }
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}

function wrap(x: CanvasRenderingContext2D, text: string, maxW: number, start: number) {
  let size = start;
  for (;;) {
    x.font = `900 ${size}px Arial Black, Arial, sans-serif`;
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const tryLine = cur ? `${cur} ${w}` : w;
      if (x.measureText(tryLine).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tryLine;
    }
    if (cur) lines.push(cur);
    if ((lines.length <= 2 && lines.every((l) => x.measureText(l).width <= maxW)) || size < 30) return { lines, size };
    size -= 6;
  }
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
}
