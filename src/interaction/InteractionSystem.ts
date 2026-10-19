/**
 * Rodada 10 — "CLICOU/TOCOU → INTERAGIU" (docs/INTERACTION_SYSTEM.md). Sistema ÚNICO de interação com o mundo:
 *
 *  - provedores (src/interaction/providers.ts) entregam candidatos perto do jogador (veículos, trio, itens, pessoas,
 *    grafite) — objetos reaproveitados, nada alocado por quadro;
 *  - UM alvo contextual (select.ts: alcance → estado → prioridade → distância/mira) para a tecla E, o botão USAR e o
 *    realce discreto (anel leve no chão + rótulo curto "CARRO · Entrar") — só nele;
 *  - clique (desktop, mouse solto: o ponto do cursor; mouse capturado: o centro da tela) e toque (celular, separado do
 *    arrasto da câmera em TouchControls) escolhem o candidato pela projeção na tela, com alvo mínimo confortável;
 *  - `activate()` do candidato só PEDE ao servidor pela mensagem já existente (enter/exit/board/unboard/item_pick…).
 *
 * Custo: coleta + escolha por quadro (dezenas de candidatos, aritmética simples); projeção só para clique/toque/hover;
 * DOM só quando o texto/posição em px muda.
 */
import * as THREE from 'three';
import type { Interactable, InteractionPlayerState, InteractionProvider } from './types';
import { COLLECT_RADIUS_M, MOUSE_MIN_PX, TOUCH_MIN_PX, chooseContext, highlightText, inReach, pickScreen, type ScreenHit } from './select';
import { TextSlot, setClass } from '../ui/hud/throttle';
import { sfx } from '../audio/bus';
import './interaction.css';

export interface InteractionHost {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  /** posição do jogador local (pés) */
  pos(): { x: number; y: number; z: number };
  state(): InteractionPlayerState;
  /** direção (unitária, no chão) para onde a câmera olha */
  aim(): { x: number; z: number };
  ground(x: number, z: number): number;
  touch: boolean;
  /** aviso curto (fora de alcance, em uso) */
  notify(msg: string): void;
}

export type ActivationVia = 'key' | 'click' | 'aim' | 'tap' | 'label' | 'type';

export class InteractionSystem {
  readonly providers: InteractionProvider[] = [];
  /** candidatos do quadro (reaproveitados pelos provedores) */
  readonly cands: Interactable[] = [];
  /** alvo contextual (E / USAR / realce) */
  current: Interactable | null = null;
  /** alvo sob o cursor (desktop com mouse solto) */
  hover: Interactable | null = null;
  readonly stats = { activations: 0, denied: 0, clicks: 0, taps: 0, misses: 0, labelWrites: 0 };
  last: { key: string; type: string; via: ActivationVia; t: number } | null = null;
  /** primeira vez que algo interativo apareceu (dica de onboarding) */
  onFirstTarget?: () => void;
  private firstSeen = false;
  private ring: THREE.Mesh;
  private label: HTMLButtonElement;
  private labelText: TextSlot;
  private labelPos = '';
  private shown: Interactable | null = null;
  private mouse: { x: number; y: number } | null = null;
  private rect: DOMRect | null = null;
  private cursor = '';
  private v = new THREE.Vector3();
  private t = 0;

  constructor(private host: InteractionHost, scene: THREE.Scene, hudRoot: HTMLElement) {
    const geo = new THREE.RingGeometry(0.9, 1, 48);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.5, depthWrite: false });
    this.ring = new THREE.Mesh(geo, mat);
    this.ring.name = 'ix_ring';
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    this.ring.frustumCulled = false;
    scene.add(this.ring);
    const lb = (this.label = document.createElement('button'));
    lb.type = 'button';
    lb.className = 'ix-label';
    lb.hidden = true;
    lb.setAttribute('aria-live', 'polite');
    this.labelText = new TextSlot(lb);
    // o rótulo também é alvo (toque ≥ 44 px): tocar/clicar nele faz a ação do alvo mostrado
    lb.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (this.shown) this.tryActivate(this.shown, 'label'); lb.blur(); });
    lb.addEventListener('pointerdown', (e) => e.stopPropagation());
    lb.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    hudRoot.appendChild(lb);
    window.addEventListener('resize', () => { this.rect = null; });
    if (!host.touch) {
      host.canvas.addEventListener('mousemove', (e) => { if (document.pointerLockElement) return; this.mouse = { x: e.clientX, y: e.clientY }; });
      host.canvas.addEventListener('mouseleave', () => { this.mouse = null; });
    }
  }

  register(p: InteractionProvider) { this.providers.push(p); return this; }

  /** por quadro, depois da câmera: coleta, alvo contextual, hover e realce */
  update(dt: number) {
    this.t += dt;
    const st = this.host.state(), p = this.host.pos();
    this.cands.length = 0;
    if (st !== 'spectator') for (const pr of this.providers) pr.collect(p.x, p.z, st, this.cands);
    const aim = this.host.aim();
    this.current = st === 'down' || st === 'spectator' ? null : chooseContext(this.cands, p.x, p.z, st, aim.x, aim.z);
    // mouse solto sobre o canvas: recalcula todo quadro (a câmera/objetos andam sob o cursor parado)
    this.hover = this.mouse && !document.pointerLockElement ? this.pick(this.mouse.x, this.mouse.y) : null;
    // sobre alvo válido: cursor de clique (só escreve quando muda)
    const cur = this.hover && this.hover.availability === 'available' && inReach(this.hover, p.x, p.z) ? 'pointer' : '';
    if (cur !== this.cursor) { this.cursor = cur; this.host.canvas.style.cursor = cur; }
    // o veículo em uso tem o próprio HUD (SAIR): sem anel nele
    const show = this.hover ?? (this.current && this.current.interactionType !== 'exit_vehicle' ? this.current : null);
    if (show && !this.firstSeen) { this.firstSeen = true; this.onFirstTarget?.(); }
    this.drawHighlight(show, p.x, p.z);
  }

  /** E / USAR: ativa o alvo contextual. false = nada para fazer */
  useKey(): boolean {
    return this.current ? this.tryActivate(this.current, 'key') : false;
  }

  /** atalho por tipo (T = 'pickup'): o melhor candidato daquele tipo no alcance */
  useType(type: Interactable['interactionType']): boolean {
    const st = this.host.state(), p = this.host.pos(), aim = this.host.aim();
    const c = chooseContext(this.cands, p.x, p.z, st, aim.x, aim.z, type);
    return c ? this.tryActivate(c, 'type') : false;
  }

  /**
   * clique/toque em (x, y) da tela. true = consumido (havia um objeto ali: interagiu ou explicou por que não);
   * false = nada ali (o chamador segue: capturar o mouse, soco, olhar…). `aim` = mouse capturado (centro da tela):
   * pessoas não contam — clique capturado perto de alguém continua sendo soco.
   */
  pointAt(x: number, y: number, via: 'click' | 'tap' | 'aim'): boolean {
    const st = this.host.state();
    if (st === 'down' || st === 'spectator') return false;
    if (via === 'tap') this.stats.taps++; else this.stats.clicks++;
    const c = this.pick(x, y, via === 'aim');
    if (!c) { this.stats.misses++; return false; }
    if (via === 'aim' && !inReach(c, this.host.pos().x, this.host.pos().z)) return false; // longe, capturado: soco normal
    this.tryActivate(c, via);
    return true;
  }

  /** candidato na tela (sem ativar) */
  pick(x: number, y: number, noPeople = false): Interactable | null {
    const minPx = this.host.touch ? TOUCH_MIN_PX : MOUSE_MIN_PX;
    const list = noPeople ? this.cands.filter((c) => c.interactionType !== 'person') : this.cands;
    return pickScreen(list, this.host.state(), x, y, minPx, (c) => this.project(c));
  }

  /** ativa se der; senão explica (fora de alcance / em uso). Devolve se pediu ao servidor */
  tryActivate(c: Interactable, via: ActivationVia): boolean {
    const p = this.host.pos();
    if (c.availability === 'busy') { this.deny(c.interactionType === 'enter_vehicle' || c.interactionType === 'board_platform' ? `${c.targetLabel}: em uso por outra pessoa` : `${c.targetLabel}: indisponível agora`); return false; }
    if (c.availability === 'cooldown') { this.deny('Aguarde…'); return false; }
    if (!inReach(c, p.x, p.z)) { this.deny(`Chegue mais perto ${c.interactionType === 'person' ? 'da pessoa' : `(${c.targetLabel.toLowerCase()})`}`); return false; }
    this.stats.activations++;
    this.last = { key: c.key, type: c.interactionType, via, t: performance.now() };
    sfx(c.interactionType === 'person' ? 'ui_open' : 'ui_click');
    c.activate();
    return true;
  }

  private deny(msg: string) { this.stats.denied++; sfx('ui_denied'); this.host.notify(msg); }

  /**
   * projeção de um candidato (px de cliente) + raio do objeto em px. `at = 'pick'`: o CENTRO do objeto (entre o chão
   * e a altura do realce `y`) — é onde o dedo/cursor mira; `'label'`: a altura do realce (o rótulo fica acima do
   * objeto, sem cobrir o próprio alvo).
   */
  project(c: Interactable, at: 'pick' | 'label' = 'pick'): ScreenHit | null {
    const cam = this.host.camera;
    cam.updateMatrixWorld();
    const g = at === 'pick' ? this.host.ground(c.x, c.z) : 0;
    const v = this.v.set(c.x, at === 'pick' ? g + (c.y - g) * 0.55 : c.y, c.z);
    const dist = cam.position.distanceTo(v);
    if (dist > COLLECT_RADIUS_M + 15) return null;
    v.project(cam);
    if (v.z > 1 || v.z < -1) return null;
    const r = (this.rect ??= this.host.canvas.getBoundingClientRect());
    const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
    const rPx = (c.pickRadius * (r.height / 2)) / (Math.max(0.5, dist) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    return { sx, sy, rPx };
  }

  private drawHighlight(c: Interactable | null, px: number, pz: number) {
    if (c !== this.shown) {
      this.shown = c;
      this.ring.visible = !!c;
      if (c) {
        this.ring.scale.setScalar(Math.max(0.35, c.pickRadius));
        (this.ring.material as THREE.MeshBasicMaterial).color.setHex(c.availability === 'available' ? 0xfff1b8 : 0x9aa3ab);
      }
    }
    if (!c) { if (!this.label.hidden) { this.label.hidden = true; this.labelPos = ''; } return; }
    const reach = inReach(c, px, pz);
    this.ring.position.set(c.x, this.host.ground(c.x, c.z) + 0.035, c.z);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = (reach ? 0.42 : 0.22) + 0.1 * Math.sin(this.t * 3.2);
    const keyHint = !this.host.touch && c === this.current ? 'E · ' : '';
    if (this.labelText.set(keyHint + highlightText(c, reach))) this.stats.labelWrites++;
    setClass(this.label, 'dim', !reach || c.availability !== 'available');
    const h = this.project(c, 'label');
    if (!h) { if (!this.label.hidden) this.label.hidden = true; return; }
    const pos = `translate3d(${Math.round(h.sx)}px, ${Math.round(h.sy)}px, 0) translate(-50%, -100%)`;
    if (pos !== this.labelPos) { this.labelPos = pos; this.label.style.transform = pos; }
    if (this.label.hidden) this.label.hidden = false;
  }

  /** QA (tools/qa/interaction_mp.mjs, __pv.ix()) */
  info() {
    const p = this.host.pos();
    const sh = (c: Interactable | null) => (c ? { key: c.key, type: c.interactionType, label: c.interactionLabel, target: c.targetLabel, reach: inReach(c, p.x, p.z), availability: c.availability } : null);
    return {
      state: this.host.state(), current: sh(this.current), hover: sh(this.hover), shown: sh(this.shown), label: this.label.hidden ? '' : this.labelText.value,
      cursor: this.cursor, stats: { ...this.stats }, last: this.last, count: this.cands.length,
      cands: this.cands.map((c) => ({ ...sh(c)!, screen: this.project(c) })),
    };
  }
}
