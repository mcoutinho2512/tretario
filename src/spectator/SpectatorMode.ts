/**
 * Modo ESPECTADOR do jogo (rodada 8) — o Game só chama `create`, `mount` e `frame`: sem avatar, sem física, sem
 * interação; câmeras (SpectatorCamera) + seletor (CameraSwitcher, teclas 1–6) + selo. O foco da câmera vira o centro
 * da área de interesse no servidor (NetworkClient.spectatorFocus → spec_cam).
 */
import type * as THREE from 'three';
import type { InputManager } from '../input/InputManager';
import type { ZoneDefinition } from '../world/zones';
import { buildAnchors, type AnchorInputs } from './anchors';
import { SpectatorCamera, SPEC_CAMS, type SpecCamMode } from './SpectatorCamera';
import { CameraSwitcher, SpectatorBadge } from './SpectatorHud';
import type { Bounds } from './bounds';

export class SpectatorMode {
  readonly switcher = new CameraSwitcher();
  readonly badge = new SpectatorBadge();
  /** texto de estado ("MODO ESPECTADOR · câmera") para o HUD geral (HudShell.setMode), quando não se usa o selo próprio */
  onLabel: ((text: string) => void) | null = null;

  private constructor(readonly cam: SpectatorCamera, canvas: HTMLCanvasElement, private input: InputManager) {
    this.switcher.onSelect = (m) => this.select(m);
    this.switcher.setActive(cam.mode);
    // arrastar com o mouse gira a câmera: rodada 11 — o InputManager faz isso para todos (botão direito, ou esquerdo
    // passando do limiar de clique; src/input/mouseGesture.ts); no toque, o TouchControls
    void canvas;
  }

  /** monta o modo: âncoras das zonas (public/world/zones.json) e dos marcos/palco do manifesto */
  static async create(o: {
    base: string; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; input: InputManager; bounds: Bounds;
    manifest: Omit<AnchorInputs, 'zones'>; ground: (x: number, z: number) => number; follow: () => { x: number; z: number; heading: number } | null;
  }): Promise<SpectatorMode> {
    let zones: ZoneDefinition[] = [];
    try {
      const r = await fetch(`${o.base}zones.json`);
      if (r.ok) zones = ((await r.json()) as { zones?: ZoneDefinition[] }).zones ?? [];
    } catch { /* sem zonas: âncoras pelos marcos */ }
    const anchors = buildAnchors({ ...o.manifest, zones });
    const cam = new SpectatorCamera(o.camera, o.bounds, o.ground, anchors, o.follow);
    cam.snap();
    return new SpectatorMode(cam, o.canvas, o.input);
  }

  private camLabel = 'assistindo ao vivo';
  private layer = '';

  select(m: SpecCamMode) {
    this.cam.setMode(m);
    this.switcher.setActive(m);
    this.camLabel = SPEC_CAMS.find((c) => c.id === m)?.label.toLowerCase() ?? 'assistindo ao vivo';
    this.emitLabel();
  }

  /** camada de representação (rodada 8.1, decidida pelo servidor): "avenida inteira · N jogadores + M ambiente" */
  setLayer(text: string) { if (text !== this.layer) { this.layer = text; this.emitLabel(); } }

  private emitLabel() {
    const sub = this.layer ? `${this.camLabel} · ${this.layer}` : this.camLabel;
    this.badge.set(sub);
    this.onLabel?.(`MODO ESPECTADOR · ${sub}`);
  }

  /** monta sozinho no HUD: selo + seletor flutuante (embaixo, ao centro) */
  mount(hud: HTMLElement) {
    hud.appendChild(this.badge.el);
    this.switcher.el.classList.add('floating');
    this.switcher.mount(hud);
  }

  /** monta o seletor num encaixe do HUD geral (ex.: HudShell.mountSpectator) — o estado vai por `onLabel` */
  mountInSlot(slot: (el: HTMLElement) => void) {
    slot(this.switcher.el);
    this.switcher.bindKeys();
    this.select(this.cam.mode);
  }

  /** por quadro: entrada → câmera; devolve o foco (no chão) */
  frame(dt: number): { x: number; y: number; z: number } {
    const look = this.input.consumeLook();
    const zoom = this.input.consumeZoom();
    this.input.consumeJump();
    const before = this.cam.mode;
    this.cam.input(this.input.moveAxis(), look, zoom, this.input.running(), dt);
    if (this.cam.mode !== before) this.select(this.cam.mode); // mexeu: virou câmera livre
    this.cam.update(dt);
    return this.cam.focus;
  }
}
