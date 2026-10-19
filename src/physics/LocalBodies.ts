/**
 * Rodada 12 — colisão do JOGADOR LOCAL contra corpos (predição; docs/CROWD_COLLISION.md). Um passo por quadro, depois
 * do movimento a pé (stepPlayer) e da colisão com veículos:
 *
 *   remotos      humanos/bots duros, autônomos macios (NetworkClient.bodiesNear — posição interpolada)
 *   NPCs locais  pedestres e multidão de concentração CEDEM (yieldBodies) e são macios: multidão densa resiste
 *   regra        constrainMove (src/physics/bodyResolve.ts): ninguém termina mais perto de um vizinho do que o
 *                contato — só a componente normal some, desliza pela tangente; parede tem a palavra final
 *   preso        StuckDetector: quer andar, não anda, encostado em ≥ 2 corpos (ou corpo + parede) por 3 s E sem
 *                saída em nenhuma de 8 direções (canEscape) → pede "unstuck" ao servidor (que confere e escolhe o ponto
 *                livre). Empurrar uma multidão que só fecha a frente nunca teleporta ninguém
 * Custo medido em `stats` (ms por quadro, vizinhos) — exposto em __pv.bodies() para QA.
 */
import { BODY, type BodyRef } from './bodies';
import { StuckDetector, canEscape, constrainMove, type MoveResult } from './bodyResolve';

export interface NpcBodySource {
  yieldBodies(x: number, z: number, selfR: number, r: number, maxStep: number, soft: number, out: BodyRef[]): number;
}

export interface LocalBodiesDeps {
  /** corpos remotos perto (já filtrados: a pé, de pé) */
  remotes?: (x: number, z: number, r: number, out: BodyRef[]) => BodyRef[];
  /** NPCs locais (pedestres, concentração) */
  npcs: () => readonly (NpcBodySource | null | undefined)[];
  /** resolve paredes no lugar; devolve true se a parede empurrou */
  walls: (p: { x: number; z: number }) => boolean;
  /** caminho do chão livre de parede entre dois pontos (teste de saída do "preso") — opcional */
  clear?: (ax: number, az: number, bx: number, bz: number) => boolean;
  /** preso de verdade por 3 s: pedir "unstuck" (servidor) ou, offline, resolver aqui */
  onStuck?: () => void;
}

/** velocidade máxima com que um NPC local cede ao jogador (m/s) — resistência da multidão */
export const NPC_YIELD_MPS = 1.1;
/** penetração que o jogador faz num NPC antes de travar (m) */
export const NPC_SOFT = 0.16;

export class LocalBodies {
  private remote: BodyRef[] = [];
  private all: BodyRef[] = [];
  private res: MoveResult = { x: 0, z: 0, contacts: 0, blocked: false, maxPen: 0 };
  readonly stuck = new StuckDetector(3);
  readonly stats = { frames: 0, ms: 0, maxMs: 0, neighbors: 0, contacts: 0, blocked: 0, stuckRequests: 0, minDist: Infinity as number };

  constructor(private d: LocalBodiesDeps) {}

  /**
   * Um passo: `p` já está na posição proposta deste quadro (de (prevX, prevZ)). Ajusta `p.x/p.z` no lugar.
   * `wantM` = deslocamento pedido pela entrada neste quadro (para o detector de "preso").
   */
  step(p: { x: number; z: number }, prevX: number, prevZ: number, dt: number, wantM: number, track = true): MoveResult {
    const t0 = performance.now();
    const all = this.all;
    all.length = 0;
    // contato + passo do quadro + folga (NPCs empurrados a ≤ 1,2 m); BODY.queryRadius é o teto
    const q = Math.min(BODY.queryRadius, 2 * BODY.radius + 0.5 + Math.hypot(p.x - prevX, p.z - prevZ));
    if (this.d.remotes) for (const b of this.d.remotes(p.x, p.z, q, this.remote)) all.push(b);
    const st = NPC_YIELD_MPS * dt;
    for (const src of this.d.npcs()) src?.yieldBodies(p.x, p.z, BODY.radius, q, st, NPC_SOFT, all);
    let wall = false;
    const r = this.res;
    if (all.length) {
      // parado: ninguém o empurra (dt 0 = sem desfazer sobreposição) — o remoto atrasado pela interpolação que o
      // invade é problema do cliente DELE/servidor; andando: não afunda e a sobreposição antiga sai devagar
      constrainMove('local', BODY.radius, prevX, prevZ, p.x, p.z, all, wantM > 0 ? dt : 0, r);
      p.x = r.x; p.z = r.z;
      wall = this.d.walls(p);
      for (const b of all) { const dd = Math.hypot(p.x - b.x, p.z - b.z); if (dd < this.stats.minDist) this.stats.minDist = dd; }
    } else { r.x = p.x; r.z = p.z; r.contacts = 0; r.blocked = false; r.maxPen = 0; }
    const moved = Math.hypot(p.x - prevX, p.z - prevZ);
    // preso por 3 s E sem saída em nenhuma das 8 direções (multidão que só bloqueia a frente não conta)
    if (track && this.stuck.update(dt, wantM, moved, r.contacts, wall) && !canEscape('local', p.x, p.z, BODY.radius, all, this.d.clear)) { this.stats.stuckRequests++; this.d.onStuck?.(); }
    const ms = performance.now() - t0;
    this.stats.frames++; this.stats.ms += ms; this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    this.stats.neighbors += all.length; this.stats.contacts += r.contacts; if (r.blocked) this.stats.blocked++;
    return r;
  }

  /** QA: médias desde o último reset */
  info() {
    const f = Math.max(1, this.stats.frames);
    return { frames: this.stats.frames, avgMs: +(this.stats.ms / f).toFixed(4), maxMs: +this.stats.maxMs.toFixed(3), avgNeighbors: +(this.stats.neighbors / f).toFixed(2), avgContacts: +(this.stats.contacts / f).toFixed(2), blockedFrames: this.stats.blocked, stuckRequests: this.stats.stuckRequests, minDist: Number.isFinite(this.stats.minDist) ? +this.stats.minDist.toFixed(3) : null, stuckS: +this.stuck.seconds.toFixed(2) };
  }
  reset() { Object.assign(this.stats, { frames: 0, ms: 0, maxMs: 0, neighbors: 0, contacts: 0, blocked: 0, stuckRequests: 0, minDist: Infinity }); }
}
