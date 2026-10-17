/**
 * Telões de evento (trio elétrico, palco, pontos da avenida): UM canal de conteúdo (`ScreenFeed`) — um canvas
 * 512×288 compartilhado por todos os telões, redesenhado em baixa frequência (2 Hz) e só quando algum telão está
 * perto da câmera. Conteúdo configurável e PRÓPRIO: designs estáticos (src/social/designs.ts, alvo 'screen'),
 * cartão de informações do jogo (hora do mundo, pessoas na avenida) e animações simples desenhadas no canvas
 * (equalizador, letreiro). Sem vídeo remoto, sem imagens externas.
 *
 * Longe (> `nearDistance`), o telão troca para um material liso (`farMaterial`): nada de textura nem atualização.
 */
import * as THREE from 'three';
import { DESIGN_BY_KEY, DESIGN_BY_ID, designsFor } from '../social/designs';
import { paintDesign } from '../social/designPainter';
import type { EventState } from './schedule';
import { entryStatus, entryTitle } from './agendaFormat';

export type ScreenSlide =
  | { type: 'design'; design: number | string }
  | { type: 'info' }
  | { type: 'eq'; text?: string }
  /** rodada 9 — AdSlots internos (src/ads): aviso do sistema/dica e evento da agenda (contagem ao vivo no relógio comum) */
  | { type: 'system'; text: string; sub?: string }
  | { type: 'event'; inst: string; name: string; format: string; zone?: string; state: EventState; startsAt: number; count?: number; capacity?: number };

export interface ScreenInfo { time: string; players: number; label?: string }

const W = 512, H = 288;

export class ScreenFeed {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  /** material do telão perto (sem tom/neblina: é luz emitida) */
  readonly material: THREE.MeshBasicMaterial;
  /** material do telão longe: cor média, sem textura */
  readonly farMaterial = new THREE.MeshBasicMaterial({ color: 0x1d2a44, toneMapped: false });
  playlist: ScreenSlide[];
  /** segundos por slide */
  rotateSeconds = 7;
  /** redesenhos por segundo (baixa frequência: o upload da textura é o custo) */
  hz = 2;
  nearDistance = 160;
  info: () => ScreenInfo = () => ({ time: '', players: 0 });
  /** relógio do servidor (worldClock) para a contagem do slide 'event' */
  now: () => number = () => Date.now();
  /** nome da zona (slide 'event') */
  zoneName: (id: string) => string | undefined = () => undefined;
  /** QA: quantos redesenhos */
  draws = 0;
  private acc = 1e9;
  private t = 0;
  private ctx: CanvasRenderingContext2D;

  constructor(playlist?: ScreenSlide[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.name = 'event_screen_feed';
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.material.name = 'event_screen';
    this.playlist = playlist ?? ScreenFeed.defaultPlaylist();
    this.draw();
  }

  /** padrão neutro: arte do ato, informações, equalizador; campanhas só se o evento configurar */
  static defaultPlaylist(): ScreenSlide[] {
    const neutral = designsFor('screen').filter((d) => d.family !== 'campaign' && d.key !== 'neutro_liso').map((d) => ({ type: 'design' as const, design: d.id }));
    return [{ type: 'design', design: 'ato_pv' }, { type: 'info' }, ...neutral.filter((s) => s.design !== DESIGN_BY_KEY.get('ato_pv')?.id), { type: 'eq', text: 'AO VIVO · PRESIDENTE VARGAS' }];
  }

  setPlaylist(list: ScreenSlide[] | undefined) {
    this.playlist = list?.length ? list : ScreenFeed.defaultPlaylist();
    this.acc = 1e9;
  }

  /** `anyNear`: algum telão perto e visível — senão nada é redesenhado */
  update(dt: number, anyNear: boolean) {
    this.t += dt;
    this.acc += dt;
    if (!anyNear || this.acc < 1 / this.hz) return;
    this.acc = 0;
    this.draw();
  }

  get slideIndex() { return this.playlist.length ? Math.floor(this.t / this.rotateSeconds) % this.playlist.length : 0; }

  private draw() {
    const x = this.ctx, s = this.playlist[this.slideIndex] ?? { type: 'info' };
    x.save();
    x.fillStyle = '#05070c'; x.fillRect(0, 0, W, H);
    if (s.type === 'design') {
      const d = typeof s.design === 'string' ? DESIGN_BY_KEY.get(s.design) : DESIGN_BY_ID.get(s.design);
      if (d) paintDesign(x, d, 0, 0, W, H, 'screen');
    } else if (s.type === 'info') this.drawInfo();
    else if (s.type === 'system') this.drawCard('AVISO', s.text, s.sub ?? '', '#f2c230');
    else if (s.type === 'event') {
      const e = { id: s.inst, inst: s.inst, name: s.name, format: s.format, zone: s.zone ?? '', state: s.state, startsAt: s.startsAt, endsAt: 0, count: s.count ?? 0, capacity: s.capacity ?? 0 };
      this.drawCard(s.state === 'ACTIVE' ? 'ACONTECENDO AGORA' : 'AGENDA DA AVENIDA', entryTitle(e), [entryStatus(e, this.now()), s.zone ? this.zoneName(s.zone) : ''].filter(Boolean).join(' · '), s.state === 'ACTIVE' ? '#6fdc8c' : '#4fc3ff');
    } else this.drawEq(s.text ?? '');
    // moldura de LED: pontinho "ao vivo" piscando (animação própria, barata)
    if (Math.floor(this.t * 2) % 2 === 0) { x.fillStyle = '#ff2b2b'; x.beginPath(); x.arc(W - 22, 20, 7, 0, Math.PI * 2); x.fill(); }
    x.restore();
    this.texture.needsUpdate = true;
    this.draws++;
  }

  private drawInfo() {
    const x = this.ctx, i = this.info();
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b2545'); g.addColorStop(1, '#13315c');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#f2c230'; x.fillRect(0, 0, W, 46);
    x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '900 28px "Arial Black", Arial, sans-serif'; x.fillText(i.label ?? 'AV. PRESIDENTE VARGAS', W / 2, 24);
    x.fillStyle = '#ffffff';
    x.font = '900 96px "Arial Black", Arial, sans-serif'; x.fillText(i.time || '--:--', W / 2, 130);
    x.font = '700 34px Arial, sans-serif';
    x.fillText(`${i.players} ${i.players === 1 ? 'pessoa' : 'pessoas'} na avenida`, W / 2, 222);
    x.font = '600 14px Arial, sans-serif'; x.globalAlpha = 0.7;
    x.fillText('SIMULAÇÃO · PRESIDENTE VARGAS 3D', W / 2, 270);
    x.globalAlpha = 1;
  }

  /** cartão de texto (avisos e agenda): faixa colorida, título grande em até 2 linhas, linha de estado */
  private drawCard(kicker: string, title: string, sub: string, color: string) {
    const x = this.ctx;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1b2a'); g.addColorStop(1, '#1b263b');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = color; x.fillRect(0, 0, W, 44);
    x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '900 24px "Arial Black", Arial, sans-serif'; x.fillText(kicker, W / 2, 23, W - 40);
    x.fillStyle = '#ffffff';
    let size = 58;
    const words = title.split(' ');
    let lines: string[] = [];
    for (; size >= 30; size -= 4) {
      x.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
      lines = [];
      let cur = '';
      for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width > W - 40 && cur) { lines.push(cur); cur = w; } else cur = t; }
      if (cur) lines.push(cur);
      if (lines.length <= 2 && lines.every((l) => x.measureText(l).width <= W - 40)) break;
    }
    lines.slice(0, 2).forEach((l, i, a) => x.fillText(l, W / 2, 132 + (i - (a.length - 1) / 2) * size * 1.05, W - 30));
    x.font = '700 28px Arial, sans-serif'; x.fillStyle = color;
    x.fillText(sub, W / 2, 228, W - 30);
    x.font = '600 14px Arial, sans-serif'; x.fillStyle = '#ffffff'; x.globalAlpha = 0.7;
    x.fillText('PRESIDENTE VARGAS 3D · CONTEÚDO DO JOGO', W / 2, 270);
    x.globalAlpha = 1;
  }

  private drawEq(text: string) {
    const x = this.ctx;
    x.fillStyle = '#0a0a12'; x.fillRect(0, 0, W, H);
    const n = 24, bw = W / n;
    for (let k = 0; k < n; k++) {
      // "música" própria: soma de senos (nenhum áudio é analisado — é só animação)
      const v = 0.25 + 0.75 * Math.abs(Math.sin(this.t * 2.1 + k * 0.7) * Math.cos(this.t * 1.3 + k * 0.23));
      const h = v * (H - 90);
      x.fillStyle = `hsl(${(k * 12 + this.t * 40) % 360}, 85%, 55%)`;
      x.fillRect(k * bw + 3, H - 60 - h, bw - 6, h);
    }
    x.fillStyle = '#ffffff'; x.textBaseline = 'middle';
    x.font = '800 30px Arial, sans-serif';
    const tw = x.measureText(text).width + 80;
    const off = (this.t * 90) % tw;
    for (let px = -off; px < W; px += tw) x.fillText(text, px, H - 28);
  }
}

let shared: ScreenFeed | null = null;
/** canal único do jogo (trio, palco e telões da avenida mostram o mesmo conteúdo, como numa transmissão) */
export function screenFeed(): ScreenFeed {
  return (shared ??= new ScreenFeed());
}
