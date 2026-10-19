/**
 * Rodada 12 — CORPOS na sala (autoridade; docs/CROWD_COLLISION.md). Sem Colyseus: a sala só chama
 *   rebuild(each)           uma vez por tick (O(N)): todo NetPlayer A PÉ e de pé (OK/cambaleando) vira um BodyRef
 *                           na grade — humanos, autônomos (kind 1, agente C) e bots de carga. Caído/levantando/ragdoll,
 *                           em veículo ou em cima do trio: sem corpo (queda na multidão nunca "explode")
 *   validate(...)           movimento de um HUMANO: penetração acima de BODY.serverTolerance AUMENTANDO por causa do
 *                           próprio passo → corrige para a posição deslizada (a tolerância absorve a latência:
 *                           corrige só o excesso, sem briga de predição). Quem é empurrado parado nunca é corrigido
 *   freeSpot(...)           spawn, reconexão, levantar, saída de veículo: ponto livre próximo (sem parede)
 *   unstuck(...)            pedido do cliente preso de verdade (≥ 2 corpos ou corpo + parede E sem saída em nenhuma de
 *                           8 direções — canEscape), conferido aqui, ≤ 1 a cada 4 s
 *   resolveAutonomous(...)  o agente C chama com os corpos dos autônomos (resolução progressiva; humanos são fixos)
 * Métricas (/metrics): collisionMs (ms por tick), neighborQueries (por tick), validações, correções, unstucks.
 */
import { BODY, type BodyRef } from '../../../src/physics/bodies';
import { SpatialBodyGrid, canEscape, constrainMove, findFreeSpot, penetrationOf, resolveBodies, type ResolveOptions } from '../../../src/physics/bodyResolve';
import { ENTITY_KIND } from '../../../src/world/entityKind';
import { STATUS } from '../../../src/net/rules';

export interface BodyPlayerView { x: number; z: number; status: number; vehicle: string; platform: string; kind?: number }

/** intervalo mínimo entre dois "unstuck" do mesmo jogador (ms) */
export const UNSTUCK_MIN_MS = 4000;

export class RoomBodies {
  readonly grid = new SpatialBodyGrid(BODY.queryRadius);
  private near: BodyRef[] = [];
  private pool: BodyRef[] = [];
  private unstuckAt = new Map<string, number>();
  /** acumulado desde o último `take()` (janela das métricas) */
  readonly stats = { ticks: 0, collisionMs: 0, maxCollisionMs: 0, neighborQueries: 0, validations: 0, corrections: 0, unstucks: 0, unstuckDenied: 0, freeSpots: 0, bodies: 0, resolves: 0, resolvePairs: 0 };

  /** um corpo deve existir para este jogador? (a pé, de pé) */
  static solid(p: BodyPlayerView): boolean {
    return !p.vehicle && !p.platform && (p.status === STATUS.OK || p.status === STATUS.STAGGER);
  }

  /** reconstrói a grade a partir do estado (chamado no início do tick) */
  rebuild(each: (fn: (id: string, p: BodyPlayerView) => void) => void) {
    const t0 = performance.now();
    const q0 = this.grid.queries;
    this.grid.clear();
    let i = 0;
    each((id, p) => {
      if (!RoomBodies.solid(p)) return;
      const b = this.pool[i] ?? (this.pool[i] = { id: '', x: 0, z: 0, r: BODY.radius });
      i++;
      b.id = id; b.x = p.x; b.z = p.z; b.r = BODY.radius;
      // humanos e bots de carga não são empurrados pela resolução dos autônomos (quem cede é o autônomo)
      b.fixed = (p.kind ?? ENTITY_KIND.HUMAN) !== ENTITY_KIND.AUTONOMOUS;
      b.mass = undefined; b.soft = undefined;
      this.grid.upsert(b);
    });
    this.stats.bodies = i;
    this.account(t0, q0);
  }

  /** mantém o corpo do jogador em dia entre ticks (movimento aceito, teleporte, correção) — ou o remove */
  sync(id: string, p: BodyPlayerView) {
    if (!RoomBodies.solid(p)) { this.grid.remove(id); return; }
    const b = this.grid.get(id);
    if (b) this.grid.move(id, p.x, p.z);
    else this.grid.upsert({ id, x: p.x, z: p.z, r: BODY.radius, fixed: (p.kind ?? 0) !== ENTITY_KIND.AUTONOMOUS });
  }
  remove(id: string) { this.grid.remove(id); this.unstuckAt.delete(id); }

  /**
   * Valida o passo a pé de um humano (de prev para next, já validado contra paredes). Devolve null = aceito; senão a
   * posição corrigida (desliza pela tangente, encostado com a tolerância de latência).
   */
  validate(id: string, prevX: number, prevZ: number, x: number, z: number, dtS: number): { x: number; z: number; pen: number } | null {
    const t0 = performance.now(), q0 = this.grid.queries;
    this.stats.validations++;
    // só quem pode encostar neste passo (contato + passo + folga) — em multidão densa ~5× menos vizinhos que queryRadius
    const qr = Math.min(BODY.queryRadius, 2 * BODY.radius + 0.2 + Math.hypot(x - prevX, z - prevZ));
    const near = this.grid.near(x, z, qr, this.near);
    let out: { x: number; z: number; pen: number } | null = null;
    const { pen, other } = penetrationOf(id, x, z, BODY.radius, near);
    if (pen > BODY.serverTolerance && other) {
      // só o EXCESSO causado pelo próprio passo (o vizinho pode ter vindo até ele: aí ninguém corrige quem parou)
      const d = Math.hypot(x - other.x, z - other.z), d0 = Math.hypot(prevX - other.x, prevZ - other.z);
      if (d < d0 - 1e-3) {
        const tol = BODY.serverTolerance;
        for (const n of near) n.soft = tol; // tolerância: encosta até R − tol (correção mínima)
        const r = constrainMove(id, BODY.radius, prevX, prevZ, x, z, near, dtS);
        for (const n of near) n.soft = undefined;
        out = { x: r.x, z: r.z, pen };
        this.stats.corrections++;
      }
    }
    this.account(t0, q0);
    return out;
  }

  /** ponto livre perto de (x, z) para `id` (spawn, reconexão, levantar, saída de veículo) */
  freeSpot(id: string, x: number, z: number, clear?: (x: number, z: number) => boolean): { x: number; z: number; moved: boolean } {
    const t0 = performance.now(), q0 = this.grid.queries;
    const f = findFreeSpot(x, z, BODY.radius, this.grid, { selfId: id, clear, maxRadius: 6 });
    if (f.moved) this.stats.freeSpots++;
    this.account(t0, q0);
    return f;
  }

  /**
   * Pedido de "unstuck" do cliente: vale só se estiver preso de verdade AGORA (≥ 2 corpos encostados, ou 1 corpo e
   * uma parede a ≤ 0,5 m) e respeitando UNSTUCK_MIN_MS. Devolve o ponto livre (ou null = negado).
   */
  unstuck(id: string, x: number, z: number, now: number, wallNear: (x: number, z: number) => boolean, clear?: (x: number, z: number) => boolean): { x: number; z: number } | null {
    if (now - (this.unstuckAt.get(id) ?? -1e12) < UNSTUCK_MIN_MS) { this.stats.unstuckDenied++; return null; }
    const near = this.grid.near(x, z, BODY.queryRadius, this.near);
    let contacts = 0;
    for (const n of near) if (n.id !== id && Math.hypot(x - n.x, z - n.z) < BODY.radius + n.r + 0.12) contacts++;
    if (!(contacts >= 2 || (contacts >= 1 && wallNear(x, z)))) { this.stats.unstuckDenied++; return null; }
    // sem saída de verdade (8 direções contra corpos e parede)? Multidão que só fecha a frente: negado
    if (canEscape(id, x, z, BODY.radius, near, clear ? (_ax, _az, bx, bz) => clear(bx, bz) : undefined)) { this.stats.unstuckDenied++; return null; }
    // procura além do anel encostado (raio ≥ 1 m), para não cair de novo no mesmo aperto
    const f = findFreeSpot(x, z, BODY.radius, this.grid, { selfId: id, clear, maxRadius: 6, gap: 0.15 });
    if (!f.moved) { this.stats.unstuckDenied++; return null; }
    this.unstuckAt.set(id, now);
    this.stats.unstucks++;
    return { x: f.x, z: f.z };
  }

  /**
   * Para o agente C (personagens autônomos): resolução progressiva dos corpos `bodies` (os autônomos que andaram) contra
   * a grade da sala (humanos fixos). Os corpos passados devem ser os MESMOS objetos da grade (`grid.get(id)`) ou novos
   * corpos inseridos antes com `grid.upsert`. Conta no custo de colisão do tick.
   */
  resolveAutonomous(bodies: readonly BodyRef[], opts?: ResolveOptions) {
    const t0 = performance.now(), q0 = this.grid.queries;
    const s = resolveBodies(bodies, this.grid, opts);
    this.stats.resolves++; this.stats.resolvePairs += s.pairs;
    this.account(t0, q0);
    return s;
  }

  /** fecha um período de tick (reconstrução + validações desde o tick anterior) — a sala chama no fim do tick */
  endTick() {
    this.stats.ticks++;
    this.stats.maxCollisionMs = Math.max(this.stats.maxCollisionMs, this.tickMs);
    this.lastTickMs = this.tickMs;
    this.tickMs = 0;
  }

  private tickMs = 0;
  /** custo de colisão do último período de tick (ms) */
  lastTickMs = 0;
  private account(t0: number, q0: number) {
    const ms = performance.now() - t0;
    this.tickMs += ms;
    this.stats.collisionMs += ms;
    this.stats.neighborQueries += this.grid.queries - q0;
  }

  /** acumulado desde a criação (testes/QA) */
  readonly totals = { neighborQueries: 0, validations: 0, corrections: 0, unstucks: 0, unstuckDenied: 0, freeSpots: 0, resolves: 0 };
  /** fecha a janela (por tick, pela sala → /metrics): devolve e zera; soma nos totais */
  take() {
    const s = { ...this.stats };
    for (const k of Object.keys(this.totals) as (keyof typeof this.totals)[]) this.totals[k] += s[k];
    for (const k of Object.keys(this.stats) as (keyof typeof this.stats)[]) if (k !== 'bodies') this.stats[k] = 0;
    return s;
  }
}
