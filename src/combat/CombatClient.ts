/**
 * Confronto no CLIENTE (rodada 9) — só intenção + animação prevista; o resultado SEMPRE vem do servidor.
 *
 *  entrada     teclas/mouse/toque → buffer curto (inputBufferMs): o golpe sai assim que a recuperação local termina
 *  pedido      `cbt {a, h, seq}`: a ação BASE (soco/chute/esquiva; com item de confronto na mão, o golpe do item) e a
 *              orientação — o combo é decidido no servidor (a previsão local usa a mesma tabela)
 *  previsão    animação local (e o deslocamento da esquiva) com contexto de confronto (rodada 12: não há zona de
 *              paz — toda a avenida e fora dela é COMBAT; sem consentimento — zones.json `combatConsent: "none"` —
 *              SEMPRE; com a regra antiga 'both', só em modo interação, evento ou zona COMBAT)
 *  NPCs        na janela ativa do golpe LOCAL, os NPCs de ambiente à frente reagem (src/combat/npcHits.ts; só local)
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
import { normalizeZonePolicy, type CombatConsent, type ZoneCombatPolicy } from './policy';
import { FX, PHYS, type CombatActEvent, type CombatActionDefinition, type CombatDenied, type CombatDummyWire, type CombatHitEvent, type CombatSelf, type JumpDenied } from './types';
import { CombatHud } from './CombatHud';
import { DummyVisual } from './DummyVisual';
import { RateGate } from '../ui/hud/throttle';
import { sfx } from '../audio/bus'; // rodada 10 — áudio
import { combatSfx } from '../audio/catalog'; // rodada 10 — áudio
import { notifyBlocked } from '../ui/notify'; // rodada 11

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
  /** consentimento (zones.json `combatConsent`, o mesmo do servidor) */
  consent: CombatConsent;
  /** golpe local chegou à janela ativa: NPCs de ambiente à frente reagem (devolve quantos) */
  npcHit?: (x: number, z: number, h: number, def: CombatActionDefinition) => number;
  /** rodada 12 — colisão: esquiva/avanço não atravessam corpos (para no contato, ainda no alcance) */
  bodies?: (p: { x: number; z: number }, fromX: number, fromZ: number, dt: number) => void;
  /** rodada 9.1 — mira assistida: alvos (jogadores e NPCs) a até r m de (x, z) */
  aimTargets?: (x: number, z: number, r: number, out: { x: number; z: number }[]) => void;
}

/** mira assistida: o golpe vira para o alvo mais perto à frente (o servidor valida alcance/arco pelo `h` enviado) */
export const AIM_ASSIST = { extraM: 1.2, halfArcDeg: 80, lungeM: 0.6, lungeReachM: 0.7 } as const;
export function aimHeading(x: number, z: number, heading: number, range: number, targets: readonly { x: number; z: number }[]): number {
  return aimTarget(x, z, heading, range, targets).h;
}
/** alvo da mira assistida: rumo e distância (Infinity = nenhum à frente) — o avanço curto usa a distância */
export function aimTarget(x: number, z: number, heading: number, range: number, targets: readonly { x: number; z: number }[]): { h: number; d: number } {
  let best = Infinity, bh = heading;
  const max = range + AIM_ASSIST.extraM, half = (AIM_ASSIST.halfArcDeg * Math.PI) / 180;
  for (const t of targets) {
    const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz);
    if (d < 0.2 || d > max) continue;
    const h = Math.atan2(dx, dz);
    let dh = h - heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    if (Math.abs(dh) > half) continue;
    if (d < best) { best = d; bh = h; }
  }
  return { h: bh, d: best };
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
  /** golpe local esperando a janela ativa para os NPCs (só local; o servidor não conhece NPC) */
  private npcPending: { def: CombatActionDefinition; h: number; at: number } | null = null;
  readonly stats = { npcHits: 0, npcSwings: 0, sent: 0, predicted: 0, acts: 0, hitsOut: 0, hitsIn: 0, dodgedIn: 0, dodgedOut: 0, blocked: 0, denied: [] as string[], jumps: 0, jumpDenied: [] as string[], dummyHits: 0, lastHit: null as CombatHitEvent | null };

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
  /** política onde o jogador está (zona do HUD; fora de zona = COMBAT; área de treino de boneco = TRAINING) */
  policyAt(x: number, z: number): ZoneCombatPolicy | 'TRAINING' {
    const pol = normalizeZonePolicy(this.d.zone()?.combatPolicy);
    if (inDummyArea(this.d.table.dummies, x, z)) return 'TRAINING';
    return pol;
  }

  /** há confronto possível aqui (mostrar botões de toque, prever animação)? sem consentimento: sempre */
  context(p: PlayerState): boolean {
    if (this.d.consent === 'none') return true;
    const pol = this.policyAt(p.x, p.z);
    return pol !== 'CONTESTED' || this.eventActive || this.d.net.self.interaction === 'interacao';
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
      this.d.bodies?.(q, p.x, p.z, dt); // rodada 12 — colisão
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
    if (this.npcPending && now >= this.npcPending.at) {
      const q = this.npcPending; this.npcPending = null;
      this.stats.npcSwings++;
      this.stats.npcHits += this.d.npcHit?.(p.x, p.z, q.h, q.def) ?? 0;
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
      zone: pol === 'TRAINING' ? 'ÁREA DE TREINO' : pol === 'CONTESTED' ? (this.eventActive ? 'DISPUTA · EVENTO' : 'ZONA DE DISPUTA') : 'ZONA DE CONFRONTO',
      combatZone: ctx, protectedFx: (this.fx & FX.PROTECTED) !== 0,
      visible: recent || (low && ctx) || (ctx && !!item),
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

  private aimBuf: { x: number; z: number }[] = [];

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
    else if (this.d.aimTargets) { // mira assistida: vira o corpo para o alvo mais perto à frente
      this.aimBuf.length = 0;
      this.d.aimTargets(p.x, p.z, def.range + AIM_ASSIST.extraM, this.aimBuf);
      for (const dm of this.dummies.values()) if (dm.st !== 1) this.aimBuf.push({ x: dm.root.position.x, z: dm.root.position.z }); // boneco de treino também
      const tg = aimTarget(p.x, p.z, p.heading, def.range, this.aimBuf);
      h = tg.h;
      p.heading = h;
      // avanço curto: alvo um pouco além do alcance → passo rápido até ele (o servidor valida a posição pelos movimentos)
      if (tg.d > def.range - 0.1 && tg.d <= def.range + AIM_ASSIST.lungeReachM) {
        this.dash = { dx: Math.sin(h), dz: Math.cos(h), left: Math.min(AIM_ASSIST.lungeM, tg.d - def.range + 0.3) };
      }
    }
    this.d.net.send('cbt', { a: base.id, h: Math.round(h * 1000) / 1000, seq: this.d.net.moveSeq });
    this.stats.sent++;
    this.recentAt = now;
    // sem contexto de confronto (regra antiga 'both' fora de evento/interação): sem previsão. Sem consentimento o
    // servidor sempre aceita o golpe válido (rodada 12: não há zona de paz)
    if (!this.context(p)) return;
    // previsão: recuperação, cooldown, combo, fôlego e animação (o servidor corrige pelo cbt_self/cbt_denied)
    this.stats.predicted++;
    const activeEnd = now + def.windupMs + def.activeMs;
    this.busyUntil = activeEnd + def.recoveryMs;
    this.cd.set(def.id, now + def.cooldownMs);
    this.last = { id: def.id, activeEnd };
    this.stamina -= def.staminaCost;
    this.predictedAt = now;
    this.d.avatar.playCombat(def.animation, h); // rodada 10: rumo da ação (variante da esquiva)
    sfx(combatSfx(def).swing, { x: p.x, y: p.y + 1, z: p.z }); // rodada 10 — áudio
    if (def.kind !== 'dodge') this.npcPending = { def, h, at: now + def.windupMs };
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
      // confirmado pelo servidor; sem previsão (contexto local divergiu): anima agora (e os NPCs reagem na janela)
      if (performance.now() - this.predictedAt > 400) {
        this.d.avatar.playCombat(def.animation, m.h);
        { const q = this.d.avatar.root.position; sfx(combatSfx(def).swing, { x: q.x, y: q.y + 1, z: q.z }); } // rodada 10 — áudio
        if (def.kind !== 'dodge') this.npcPending = { def, h: m.h, at: performance.now() + def.windupMs };
      }
      this.last = { id: def.id, activeEnd: performance.now() + def.windupMs + def.activeMs };
      return;
    }
    const cv = this.d.net.combatVisual(m.by);
    cv?.visual.playCombat(def.animation, m.h);
    if (cv) sfx(combatSfx(def).swing, { x: cv.x, z: cv.z }); // rodada 10 — áudio
  }

  private onHit(m: CombatHitEvent) {
    const now = performance.now();
    const def = this.d.table.byId.get(m.a);
    this.stats.lastHit = m;
    this.hitSound(m, def); // rodada 10 — áudio
    if (m.dummy) { this.stats.dummyHits++; this.dummies.get(m.tgt)?.hit(m.dx, m.dz, m.st); if (m.by === this.d.net.selfNid) { this.recentAt = now; this.d.hud.pulse(); } return; }
    const self = this.d.net.selfNid;
    // rodada 10: sentido do golpe para o cambaleio direcional (o clipe sai pela mudança de status; vale para todos)
    if (m.r === 'hit' && m.tgt !== self) this.d.net.combatVisual(m.tgt, false)?.visual.hitFrom(m.dx, m.dz);
    if (m.tgt === self) {
      this.recentAt = now;
      if (m.r === 'dodged') { this.stats.dodgedIn++; this.d.flash('Esquivou!'); return; }
      if (m.r !== 'hit') return;
      this.d.avatar.hitFrom(m.dx, m.dz);
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
      else { this.stats.blocked++; this.d.flash(this.d.consent === 'none' ? 'Sem efeito (proteção de retorno ou regra do evento)' : 'Sem efeito (modo pacífico, proteção ou regra do local)'); }
    }
  }
  // rodada 10 — áudio: som do RESULTADO (decidido pelo servidor) na posição do alvo — arcade, sem realismo de ferimento
  private hitSound(m: CombatHitEvent, def: CombatActionDefinition | undefined) {
    const self = m.tgt === this.d.net.selfNid && !m.dummy;
    const dm = m.dummy ? this.dummies.get(m.tgt) : null;
    const pos = self ? this.d.avatar.root.position : dm ? dm.root.position : null;
    const at = pos ? { x: pos.x, y: pos.y + 1, z: pos.z } : (() => { const c = this.d.net.combatVisual(m.tgt, false) ?? this.d.net.combatVisual(m.by, false); return c ? { x: c.x, z: c.z } : null; })();
    if (!at) return;
    const gain = self || m.by === this.d.net.selfNid ? 1 : 0.8;
    if (m.r === 'dodged') sfx('dodge', { ...at, gain: gain * 0.8 });
    else if (m.r === 'blocked') sfx('blocked', { ...at, gain });
    else { const h = def ? combatSfx(def).hit : 'punch'; sfx(h, { ...at, gain }); if (h !== 'spray' && h !== 'push') sfx('impact', { ...at, gain: gain * 0.7 }); }
  }

  /** empurrão sofrido, aplicado no próximo `update` */
  private knock: { dx: number; dz: number } | null = null;

  private onDenied(m: CombatDenied) {
    this.stats.denied.push(m.reason);
    if (m.reason !== 'spam') sfx('ui_denied'); // rodada 10 — áudio
    if (this.stats.denied.length > 64) this.stats.denied.shift();
    if (m.reason === 'stamina') notifyBlocked('Sem fôlego'); // rodada 11: canal de ação bloqueada
    else if (m.reason === 'sem_item') notifyBlocked('Esse golpe precisa do item na mão');
    // previsão errada: libera a recuperação local (o servidor não começou nada) — e os NPCs não reagem
    if (m.reason !== 'spam') { this.busyUntil = 0; this.last = null; this.cd.delete(m.a); this.npcPending = null; }
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
      hud: { shown: this.d.hud.shown, writes: this.d.hud.writes },
      dummies: [...this.dummies.values()].map((d) => ({ id: d.id, st: d.st, cond: d.cond, x: +d.root.position.x.toFixed(1), z: +d.root.position.z.toFixed(1) })),
      stats: { ...this.stats, denied: [...this.stats.denied], jumpDenied: [...this.stats.jumpDenied] },
    };
  }

  /** empurrão F sem jogador ao alcance: a definição EMPURRÃO nos NPCs à frente, na hora (só local) */
  npcPush(p: PlayerState): number {
    const def = this.d.table.byKey.get('empurrao');
    const n = def ? this.d.npcHit?.(p.x, p.z, p.heading, def) ?? 0 : 0;
    this.stats.npcHits += n;
    return n;
  }

  /** QA: aperta uma entrada (como a tecla) */
  press(k: CombatInput) { this.d.input.queueToggle(k); }

  dispose() { for (const d of this.dummies.values()) d.dispose(); this.dummies.clear(); }
}
