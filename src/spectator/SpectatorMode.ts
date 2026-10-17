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
  private drag: { x: number; y: number; id: number } | null = null;

  private constructor(readonly cam: SpectatorCamera, canvas: HTMLCanvasElement, private input: InputManager) {
    this.switcher.onSelect = (m) => this.select(m);
    this.switcher.setActive(cam.mode);
    // arrastar com o mouse gira a câmera (sem precisar travar o ponteiro); no toque, o TouchControls já faz isso
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && !input.pointerLocked) this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id || input.pointerLocked) return;
      input.addLook(e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX; d.y = e.clientY;
    });
    window.addEventListener('pointerup', () => { this.drag = null; });
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

  select(m: SpecCamMode) {
    this.cam.setMode(m);
    this.switcher.setActive(m);
    this.badge.set(SPEC_CAMS.find((c) => c.id === m)?.label.toLowerCase() ?? 'assistindo ao vivo');
  }

  mount(hud: HTMLElement) {
    hud.appendChild(this.badge.el);
    this.switcher.mount(hud);
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
