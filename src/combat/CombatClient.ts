/**
 * Confronto no CLIENTE (rodada 9) — só intenção + animação prevista; o resultado SEMPRE vem do servidor.
 *
 *  entrada     teclas/mouse/toque → buffer curto (inputBufferMs): o golpe sai assim que a recuperação local termina
 *  pedido      `cbt {a, h, seq}`: a ação BASE (soco/chute/esquiva; com item de confronto na mão, o golpe do item) e a
 *              orientação — o combo é decidido no servidor (a previsão local usa a mesma tabela)
 *  previsão    animação local (e o deslocamento da esquiva) SÓ com contexto de confronto (zona COMBAT/CONTESTED,
 *              área de treino, evento): em zona de paz não se prevê nada e o servidor responde 'zona_paz'
 *  rede        `cbt_act` (todos animam igual), `cbt_hit` (resultado: cambaleio + empurrão no próprio, reação dos
 *              remotos e bonecos), `cbt_self` (fôlego/condição/fx ≤ 5 Hz), `cbt_denied`, `cbt_dummy`, `jump_denied`
 *  pulo        cooldown local igual ao do servidor (JUMP), `jump {seq}` junto com o impulso previsto
 */
import * as THREE from 'three';
import type { NetworkClient } from '../net/NetworkClient';
import type { AvatarVisual } from '../player/AvatarVisual';
import type { PlayerState } from '../player/PlayerState';
import type { InputManager } from '../input/InputManager';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { ZoneDefinition } from '../world/zones';
import { PROP_BY_ID } from '../social/props';
import { CombatTable, JUMP, inDummyArea } from './data';
import { inPeaceArea, type ZoneCombatPolicy } from './policy';
import { FX, PHYS, type CombatActEvent, type CombatActionDefinition, type CombatDenied, type CombatDummyWire, type CombatHitEvent, type CombatSelf, type JumpDenied } from './types';
import { CombatHud } from './CombatHud';
import { DummyVisual } from './DummyVisual';
import { RateGate } from '../ui/hud/throttle';

export type CombatInput = 'cbt_punch' | 'cbt_kick' | 'cbt_dodge';
const INPUTS: CombatInput[] = ['cbt_punch', 'cbt_kick', 'cbt_dodge'];
/** recente: o HUD fica visível este tempo depois do último golpe/acerto */
const RECENT_MS = 8000;

export interface CombatClientDeps {
  net: NetworkClient;
  table: CombatTable;
  avatar: AvatarVisual;
  input: InputManager;
  collision: CollisionWorld;
  scene: THREE.Object3D;
  /** zona atual do HUD (rastreador com histerese) */
  zone: () => ZoneDefinition | null;
  flash: (msg: string) => void;
  touch: { setCombatVisible(v: boolean): void } | null;
  hud: CombatHud;
}

export class CombatClient {
  private buf: { k: CombatInput; at: number } | null = null;
  private busyUntil = 0;
  private last: { id: number; activeEnd: number } | null = null;
  private cd = new Map<number, number>();
  private stamina: number;
  private condition: number;
  private fx = 0;
  private lockUntil = 0;
  private dash: { dx: number; dz: number; left: number } | null = null;
  private recentAt = -1e9;
  private wasGrounded = true;
  private landedAt = -1e9;
  private hudGate = new RateGate(10);
  private dummies = new Map<number, DummyVisual>();
  /** evento de confronto ativo (agente D liga; até lá só zona/área/modo) */
  eventActive = false;
  /** QA */
  readonly stats = { sent: 0, predicted: 0, acts: 0, hitsOut: 0, hitsIn: 0, dodgedIn: 0, dodgedOut: 0, blocked: 0, denied: [] as string[], jumps: 0, jumpDenied: [] as string[], dummyHits: 0, lastHit: null as CombatHitEvent | null };

  constructor(private d: CombatClientDeps) {
    const t = d.table.tuning;
    this.stamina = t.staminaMax; this.condition = t.conditionMax;
    const net = d.net;
    net.on('cbt_act', (m: CombatActEvent) => this.onAct(m));
    net.on('cbt_hit', (m: CombatHitEvent) => this.onHit(m));
    net.on('cbt_self', (m: CombatSelf) => { this.stamina = m.st; this.condition = m.cd; this.fx = m.fx; if (m.fx & FX.ENGAGED) this.recentAt = performance.now(); });
    net.on('cbt_denied', (m: CombatDenied) => this.onDenied(m));
    net.on('cbt_dummy', (w: CombatDummyWire) => this.onDummy(w));
    net.on('jump_denied', (m: JumpDenied) => { this.stats.jumpDenied.push(m.reason); this.jumpDenied = true; });
  }
  /** o servidor negou o pulo: o jogo corta a subida (lido e zerado em `tryJump`/`update`) */
  jumpDenied = false;

  get tuning() { return this.d.table.tuning; }

  // ---------------------------------------------------------------- contexto
  /** política onde o jogador está (zona do HUD + área de treino de boneco + área de paz) */
  policyAt(x: number, z: number): ZoneCombatPolicy | 'TRAINING' {
    const zn = this.d.zone();
    if (zn && inPeaceArea(zn.peaceAreas ?? [], x, z)) return 'PEACE';
    const pol = zn?.combatPolicy ?? 'PEACE';
    if (pol === 'PEACE' && inDummyArea(this.d.table.dummies, x, z)) return 'TRAINING';
    return pol;
  }

  /** há confronto possível aqui (mostrar botões de toque, prever animação)? */
  context(p: PlayerState): boolean {
    const pol = this.policyAt(p.x, p.z);
    return pol !== 'PEACE' || this.eventActive || this.d.net.self.interaction === 'interacao';
  }

  /** o jogador não controla o movimento (cambaleando) */
  get locked() { return performance.now() < this.lockUntil; }

  // ---------------------------------------------------------------- por quadro
  update(dt: number, p: PlayerState, blocked: boolean) {
    const now = performance.now();
    const inp = this.d.input;
    for (const k of INPUTS) if (inp.consumeToggle(k)) { this.buf = { k, at: now }; this.recentAt = now; }
    if (this.buf && now - this.buf.at > this.tuning.inputBufferMs) this.buf = null;
    if (this.buf && !blocked) this.tryFire(p, now);
    if (blocked) this.buf = null;
    // esquiva prevista: desloca com colisão (o servidor fez o mesmo; correções pequenas reconciliam)
    if (this.dash) {
      const step = Math.min(this.dash.left, 11 * dt);
      const q = { x: p.x + this.dash.dx * step, y: p.y, z: p.z + this.dash.dz * step };
      this.d.collision.resolveCircle(q, 0.32, 1.78);
      p.x = q.x; p.z = q.z;
      this.dash.left -= step;
      if (this.dash.left <= 1e-3) this.dash = null;
    }
    if (this.knock) {
      // empurrão do golpe sofrido: mesmo deslocamento que o servidor aplicou (já contra paredes)
      const q = { x: p.x + this.knock.dx, y: p.y, z: p.z + this.knock.dz };
      this.d.collision.resolveCircle(q, 0.32, 1.78);
      p.x = q.x; p.z = q.z;
      this.knock = null;
    }
    if (!this.wasGrounded && p.grounded) this.landedAt = now;
    this.wasGrounded = p.grounded;
    for (const dm of this.dummies.values()) dm.update(dt);
    if (this.hudGate.due(now)) this.updateHud(p, now);
  }

  private updateHud(p: PlayerState, now: number) {
    const t = this.tuning;
    const pol = this.policyAt(p.x, p.z);
    const ctx = this.context(p);
    this.d.touch?.setCombatVisible(ctx);
    const recent = now - this.recentAt < RECENT_MS || (this.fx & FX.ENGAGED) !== 0;
    const low = this.stamina < t.staminaMax - 0.5 || this.condition < t.conditionMax - 0.5;
    const held = this.heldKind();
    const item = held && this.d.table.itemAction(held) ? PROP_BY_ID.get(this.d.net.self.social.prop)?.label.replace(/\s*\(.*\)$/, '') ?? '' : '';
    this.d.hud.set({
      stamina: this.stamina, staminaMax: t.staminaMax, condition: this.condition, conditionMax: t.conditionMax, item,
      zone: pol === 'TRAINING' ? 'ÁREA DE TREINO' : pol === 'COMBAT' ? 'ZONA DE COMBATE' : pol === 'CONTESTED' ? (this.eventActive ? 'DISPUTA · EVENTO' : 'ZONA DE DISPUTA') : 'ZONA DE PAZ',
      combatZone: pol !== 'PEACE', protectedFx: (this.fx & FX.PROTECTED) !== 0,
      visible: recent || (low && ctx) || (ctx && pol !== 'PEACE' && !!item),
    });
  }

  private heldKind(): string | undefined {
    const id = this.d.net.self.social.prop;
    return id ? PROP_BY_ID.get(id)?.kind : undefined;
  }

  /** ação base pedida para a entrada (com item de confronto na mão, o soco vira o golpe do item) */
  private baseFor(k: CombatInput): CombatActionDefinition | undefined {
    const T = this.d.table;
    if (k === 'cbt_dodge') return T.byKey.get('esquiva');
    if (k === 'cbt_kick') return T.byKey.get('chute');
    return T.itemAction(this.heldKind()) ?? T.byKey.get('soco');
  }

  private tryFire(p: PlayerState, now: number) {
    const k = this.buf!.k;
    const base = this.baseFor(k);
    if (!base) { this.buf = null; return; }
    if (this.d.avatar.isDown || this.d.net.self.vehicle || this.d.net.self.platform) { this.buf = null; return; }
    if (!p.grounded) return; // no ar: espera pousar (dentro do buffer)
    if (this.locked && base.kind !== 'dodge') return; // cambaleando: só a esquiva sai (o resto espera no buffer)
    const def = this.d.table.resolve(base.id, this.last, now) ?? base;
    const combo = def.comboOf !== undefined;
    // recuperação/cooldown previstos (o servidor confere de novo): mantém no buffer até liberar
    if ((now < this.busyUntil && !(combo && this.last && now >= this.last.activeEnd - 60)) || now < (this.cd.get(def.id) ?? 0)) return;
    this.buf = null;
    if (this.stamina < def.staminaCost) { this.d.flash('Sem fôlego'); return; }
    if (!this.d.table.itemOk(def, this.heldKind())) { this.d.flash('Mãos ocupadas: largue o item (G → itens)'); return; }
    // orientação: golpes na frente do corpo; esquiva na direção do movimento (parado: para trás)
    let h = p.heading;
    if (def.kind === 'dodge') h = Math.hypot(p.vx, p.vz) > 0.6 ? Math.atan2(p.vx, p.vz) : p.heading + Math.PI;
    this.d.net.send('cbt', { a: base.id, h: Math.round(h * 1000) / 1000, seq: this.d.net.moveSeq });
    this.stats.sent++;
    this.recentAt = now;
    if (!this.context(p) || this.policyAt(p.x, p.z) === 'PEACE') return; // em paz: sem previsão (o servidor nega)
    // previsão: recuperação, cooldown, combo, fôlego e animação (o servidor corrige pelo cbt_self/cbt_denied)
    this.stats.predicted++;
    const activeEnd = now + def.windupMs + def.activeMs;
    this.busyUntil = activeEnd + def.recoveryMs;
    this.cd.set(def.id, now + def.cooldownMs);
    this.last = { id: def.id, activeEnd };
    this.stamina -= def.staminaCost;
    this.predictedAt = now;
    this.d.avatar.playCombat(def.animation);
    if (def.kind === 'dodge') { this.lockUntil = 0; if (def.dashM) this.dash = { dx: Math.sin(h), dz: Math.cos(h), left: def.dashM }; }
  }
  private predictedAt = -1e9;

  // ---------------------------------------------------------------- pulo
  /** pedido de pulo (Espaço/PULAR): mesmo cooldown do servidor; devolve se o impulso local deve acontecer */
  tryJump(p: PlayerState): boolean {
    const now = performance.now();
    if (!p.grounded || this.locked || this.d.avatar.isDown) return false;
    if (now - this.landedAt < JUMP.cooldownMs + 60) return false;
    this.d.net.send('jump', { seq: this.d.net.moveSeq });
    this.stats.jumps++;
    this.jumpDenied = false;
    return true;
  }

  // ---------------------------------------------------------------- rede
  private onAct(m: CombatActEvent) {
    this.stats.acts++;
    const def = this.d.table.byId.get(m.a);
    if (!def) return;
    if (m.by === this.d.net.selfNid) {
      // confirmado pelo servidor; sem previsão (contexto local divergiu): anima agora
      if (performance.now() - this.predictedAt > 400) this.d.avatar.playCombat(def.animation);
      this.last = { id: def.id, activeEnd: performance.now() + def.windupMs + def.activeMs };
      return;
    }
    this.d.net.combatVisual(m.by)?.visual.playCombat(def.animation);
  }

  private onHit(m: CombatHitEvent) {
    const now = performance.now();
    const def = this.d.table.byId.get(m.a);
    this.stats.lastHit = m;
    if (m.dummy) { this.stats.dummyHits++; this.dummies.get(m.tgt)?.hit(m.dx, m.dz, m.st); if (m.by === this.d.net.selfNid) { this.recentAt = now; this.d.hud.pulse(); } return; }
    const self = this.d.net.selfNid;
    if (m.tgt === self) {
      this.recentAt = now;
      if (m.r === 'dodged') { this.stats.dodgedIn++; this.d.flash('Esquivou!'); return; }
      if (m.r !== 'hit') return;
      this.stats.hitsIn++;
      this.d.hud.pulse();
      this.dash = null;
      if (m.kb) this.knock = { dx: m.dx * m.kb, dz: m.dz * m.kb };
      // cambaleio: a animação vem da mudança de NetPlayer.status (AvatarVisual, vale para todos e para quem chega depois)
      if (m.st === PHYS.STAGGERED) this.lockUntil = now + (def?.impact.staggerMs ?? 400);
      return;
    }
    if (m.by === self) {
      this.recentAt = now;
      if (m.r === 'hit') { this.stats.hitsOut++; this.d.hud.pulse(); }
      else if (m.r === 'dodged') { this.stats.dodgedOut++; this.d.flash('Esquivou do seu golpe'); }
      else { this.stats.blocked++; this.d.flash('Sem efeito (modo pacífico, proteção ou regra do local)'); }
    }
  }
  /** empurrão sofrido, aplicado no próximo `update` */
  private knock: { dx: number; dz: number } | null = null;

  private onDenied(m: CombatDenied) {
    this.stats.denied.push(m.reason);
    if (this.stats.denied.length > 64) this.stats.denied.shift();
    if (m.reason === 'zona_paz') this.d.hud.peace();
    else if (m.reason === 'stamina') this.d.flash('Sem fôlego');
    else if (m.reason === 'sem_item') this.d.flash('Esse golpe precisa do item na mão');
    // previsão errada: libera a recuperação local (o servidor não começou nada)
    if (m.reason !== 'spam') { this.busyUntil = 0; this.last = null; this.cd.delete(m.a); }
  }

  private onDummy(w: CombatDummyWire) {
    const [id, x, z, h, st, cond] = w;
    let dm = this.dummies.get(id);
    if (!dm) {
      dm = new DummyVisual(id, x, this.d.collision.groundHeight(x, z), z, h);
      this.dummies.set(id, dm);
      this.d.scene.add(dm.root);
    }
    dm.setState(st, cond);
  }

  /** QA */
  qa() {
    return {
      stamina: Math.round(this.stamina), condition: Math.round(this.condition), fx: this.fx, locked: this.locked, busy: performance.now() < this.busyUntil,
      hud: { shown: this.d.hud.shown, peace: this.d.hud.peaceShown, writes: this.d.hud.writes },
      dummies: [...this.dummies.values()].map((d) => ({ id: d.id, st: d.st, cond: d.cond, x: +d.root.position.x.toFixed(1), z: +d.root.position.z.toFixed(1) })),
      stats: { ...this.stats, denied: [...this.stats.denied], jumpDenied: [...this.stats.jumpDenied] },
    };
  }

  /** QA: aperta uma entrada (como a tecla) */
  press(k: CombatInput) { this.d.input.queueToggle(k); }

  dispose() { for (const d of this.dummies.values()) d.dispose(); this.dummies.clear(); }
}
