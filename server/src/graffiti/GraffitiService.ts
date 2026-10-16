/**
 * Pichação/grafite no SERVIDOR (autoridade + distribuição + moderação + persistência). Independente do Colyseus:
 * a sala só repassa mensagens, posições e o envio (`GfViewer.send`) — testável sem rede (tests/graffitiService.test.ts).
 *
 *  criar      gf_new validado aqui: superfície existe, autor perto (≤ 3 m) e do lado pintável, de pé e fora de veículo,
 *             conteúdo (formato, tamanhos, texto filtrado), cooldown + cota por sessão E por id anônimo, máximo por
 *             superfície (temporária: sai o mais antigo dela; autorizada: recusa) e total (sai o temporário mais antigo)
 *  interesse  cada cliente recebe só os grafites das superfícies a ≤ GF_RADIUS (grade espacial estática das superfícies,
 *             histerese), em lotes com orçamento de bytes; ao sair do raio o cliente descarta (gf_del 'aoi')
 *  moderação  denúncia (N denunciantes distintos → HIDDEN), admin (remover/ocultar/restaurar), expiração por TTL
 *  persistência GraffitiStore (JSON local em dev; banco depois)
 */
// imports SEM extensão: este módulo também é compilado pelo tsconfig da raiz (testes em tests/graffitiService.test.ts)
import { SpatialGrid } from '../../../src/net/spatialGrid';
import { surfaceCenter, surfaceRadius, type GraffitiSurface } from '../../../src/graffiti/surfaces';
import {
  GF_RULES, GF_STATE, GF_STATE_NAME, checkQuota, checkReportRate, expiresAtFor, isVisibleState, moderate, newAuthorLimits, recordCreation,
  validateContent, validateReach, type AuthorLimits, type GraffitiRules, type GraffitiState,
} from '../../../src/graffiti/rules';
import type { GfDelReason, GfRes, GfWire } from '../../../src/graffiti/protocol';
import type { GraffitiStore, StoredGraffiti } from './store';

export interface GfViewer { send(type: string, msg: unknown): void }
export interface GfAuthorPos { x: number; z: number; ok: boolean }

interface Rec extends StoredGraffiti { bytes: Uint8Array }
interface ViewerRT {
  sid: string; cid: string; name: string; out: GfViewer;
  /** superfícies (índice) dentro do raio */
  surfIn: Set<number>;
  /** grafites que este cliente tem */
  known: Set<number>;
  /** a enviar (entraram na área; respeitam o orçamento por atualização) */
  pending: number[];
  idx: number;
}

export interface GraffitiServiceOptions {
  radius?: number;
  hysteresis?: number;
  /** bytes máximos de gf_add por cliente por atualização (o resto vai na seguinte) */
  sendBudget?: number;
  /** cada cliente é atualizado a cada `slices` chamadas de update() */
  slices?: number;
  rules?: GraffitiRules;
  adminToken?: string;
  log?: (m: string) => void;
}

const toB64 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
/** id anônimo estável do aparelho (UUID no localStorage); inválido → derivado da sessão */
export const sanitizeClientId = (cid: unknown, sessionId: string) => (typeof cid === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(cid) ? cid : `anon-${sessionId}`);

export class GraffitiService {
  readonly surfaces = new Map<string, GraffitiSurface>();
  private surfList: GraffitiSurface[] = [];
  private surfIndex = new Map<string, number>();
  private sgrid: SpatialGrid;
  private maxSurfR = 0;
  private recs = new Map<number, Rec>();
  /** ids não-terminais por superfície, mais antigo primeiro */
  private bySurface = new Map<string, number[]>();
  private viewers = new Map<string, ViewerRT>();
  private limits = new Map<string, AuthorLimits>();
  private nextId = 1;
  private nextViewerIdx = 0;
  private updates = 0;
  private lastExpiry = 0;
  ready = false;
  readonly radius: number;
  private hyst: number;
  private budget: number;
  private slices: number;
  readonly rules: GraffitiRules;
  private adminToken: string;
  private log: (m: string) => void;
  /** métricas (QA / docs) */
  stats = { created: 0, denied: 0, reports: 0, hidden: 0, removed: 0, expired: 0, evicted: 0, addMsgs: 0, addBytes: 0, delMsgs: 0 };

  constructor(surfaces: GraffitiSurface[], private store: GraffitiStore, o: GraffitiServiceOptions = {}) {
    this.radius = o.radius ?? 120;
    this.hyst = o.hysteresis ?? 1.15;
    this.budget = o.sendBudget ?? 24_000;
    this.slices = Math.max(1, o.slices ?? 5);
    this.rules = o.rules ?? GF_RULES;
    this.adminToken = o.adminToken ?? '';
    this.log = o.log ?? ((m) => console.log(`[graffiti] ${m}`));
    this.sgrid = new SpatialGrid(Math.max(20, this.radius / 2));
    surfaces.forEach((sf) => {
      const i = this.surfList.length;
      this.surfList.push(sf);
      this.surfaces.set(sf.id, sf);
      this.surfIndex.set(sf.id, i);
      const c = surfaceCenter(sf);
      this.sgrid.insert(i, c.x, c.z);
      this.maxSurfR = Math.max(this.maxSurfR, surfaceRadius(sf));
    });
  }

  async init(now = Date.now()) {
    const { records, nextId } = await this.store.load();
    this.nextId = Math.max(1, nextId);
    let dropped = 0;
    for (const r of records) {
      // superfície que deixou de existir (mundo regenerado) ou estado terminal: não volta
      if (!this.surfaces.has(r.surface) || r.state === GF_STATE.REMOVED || r.state === GF_STATE.EXPIRED) { this.store.delete(r.id); dropped++; continue; }
      const rec: Rec = { ...r, bytes: fromB64(r.content) };
      this.recs.set(r.id, rec);
      this.listFor(r.surface).push(r.id);
      this.nextId = Math.max(this.nextId, r.id + 1);
    }
    for (const l of this.bySurface.values()) l.sort((a, b) => this.recs.get(a)!.createdAt - this.recs.get(b)!.createdAt);
    this.ready = true;
    this.expire(now);
    this.log(`${this.recs.size} grafites carregados (${dropped} descartados) · ${this.surfList.length} superfícies`);
  }

  private listFor(sid: string) { let l = this.bySurface.get(sid); if (!l) this.bySurface.set(sid, (l = [])); return l; }
  private lim(key: string) { let l = this.limits.get(key); if (!l) this.limits.set(key, (l = newAuthorLimits())); return l; }

  get count() { return this.recs.size; }
  get visibleCount() { let n = 0; for (const r of this.recs.values()) if (isVisibleState(r.state)) n++; return n; }

  // ------------------------------------------------------------------ clientes
  join(sessionId: string, name: string, clientId: string, out: GfViewer) {
    this.viewers.set(sessionId, { sid: sessionId, cid: clientId, name, out, surfIn: new Set(), known: new Set(), pending: [], idx: this.nextViewerIdx++ });
  }
  leave(sessionId: string) { this.viewers.delete(sessionId); }
  rename(sessionId: string, name: string) { const v = this.viewers.get(sessionId); if (v) v.name = name; }

  /**
   * Área de interesse (fatiada: cada cliente a cada `slices` chamadas). `pos(sid)` dá a posição autoritativa.
   * `only` força um cliente (entrada na sala: recebe já os grafites próximos).
   */
  update(now: number, pos: (sid: string) => { x: number; z: number } | undefined, only?: string) {
    if (!this.ready) return;
    if (!only) {
      this.updates++;
      if (now - this.lastExpiry >= 1000) this.expire(now);
    }
    const phase = this.updates % this.slices;
    for (const v of this.viewers.values()) {
      if (only ? v.sid !== only : v.idx % this.slices !== phase) continue;
      const p = pos(v.sid);
      if (p) this.updateViewer(v, p.x, p.z);
    }
  }

  private updateViewer(v: ViewerRT, x: number, z: number) {
    const R = this.radius + this.maxSurfR;
    const seen = new Set<number>();
    this.sgrid.forEachInRadius(x, z, R * this.hyst, (i, d) => {
      if (v.surfIn.has(i)) { seen.add(i); return; }
      if (d > R) return;
      seen.add(i);
      v.surfIn.add(i);
      for (const id of this.bySurface.get(this.surfList[i].id) ?? []) if (isVisibleState(this.recs.get(id)!.state) && !v.known.has(id)) v.pending.push(id);
    });
    // saíram do raio (com histerese): o cliente descarta
    const gone: number[] = [];
    for (const i of v.surfIn) {
      if (seen.has(i)) continue;
      v.surfIn.delete(i);
      for (const id of this.bySurface.get(this.surfList[i].id) ?? []) if (v.known.delete(id)) gone.push(id);
    }
    if (gone.length) { v.pending = v.pending.filter((id) => !gone.includes(id)); this.sendDel(v, gone, 'aoi'); }
    this.flush(v);
  }

  /** envia pendentes até o orçamento de bytes (o resto na próxima atualização) */
  private flush(v: ViewerRT) {
    if (!v.pending.length) return;
    const batch: GfWire[] = [];
    let bytes = 0;
    while (v.pending.length && (bytes < this.budget || !batch.length)) {
      const id = v.pending.shift()!;
      const r = this.recs.get(id);
      if (!r || !isVisibleState(r.state) || v.known.has(id) || !v.surfIn.has(this.surfIndex.get(r.surface)!)) continue;
      batch.push(this.wire(r, v));
      bytes += r.bytes.length + 40;
      v.known.add(id);
    }
    if (batch.length) { v.out.send('gf_add', batch); this.stats.addMsgs++; this.stats.addBytes += bytes; }
  }

  private wire(r: Rec, v: ViewerRT): GfWire {
    return { i: r.id, s: r.surface, d: r.bytes, a: r.author.name, t: r.createdAt, e: r.expiresAt, st: r.state, ...(r.author.clientId === v.cid ? { m: 1 as const } : {}) };
  }

  private sendDel(v: ViewerRT, ids: number[], r: GfDelReason) { v.out.send('gf_del', { i: ids, r }); this.stats.delMsgs++; }

  // ------------------------------------------------------------------ criar
  create(sessionId: string, msg: unknown, author: GfAuthorPos, now = Date.now()): GfRes {
    const m = (msg ?? {}) as { s?: unknown; d?: unknown; n?: unknown };
    const n = typeof m.n === 'number' && Number.isFinite(m.n) ? m.n : 0;
    const deny = (r: string): GfRes => { this.stats.denied++; return { op: 'new', ok: false, n, r }; };
    const v = this.viewers.get(sessionId);
    if (!v || !this.ready) return deny('estado');
    if (!author.ok) return deny('estado');
    const sf = typeof m.s === 'string' ? this.surfaces.get(m.s) : undefined;
    if (!sf) return deny('superficie');
    // msgpack entrega Uint8Array/Buffer; qualquer outra coisa é formato inválido
    const bytes = m.d instanceof Uint8Array ? new Uint8Array(m.d.buffer, m.d.byteOffset, m.d.byteLength) : null;
    const c = validateContent(bytes, sf, this.rules);
    if (!c.ok) return deny(c.reason);
    const reach = validateReach(sf, c.content, author.x, author.z, this.rules);
    if (reach) return deny(reach);
    // cota/cooldown pelos DOIS: sessão (trocar o id anônimo não zera) e id anônimo (reconectar não zera)
    const active = this.activeBy(v.cid);
    const q = checkQuota(this.lim(`c:${v.cid}`), active, now, this.rules) ?? checkQuota(this.lim(`s:${sessionId}`), active, now, this.rules);
    if (q) return deny(q);
    // máximo por superfície: temporária recicla o mais antigo dela; autorizada (permanente) recusa
    const list = this.listFor(sf.id);
    if (list.length >= sf.max) {
      if (sf.persistence === 'permanent') return deny('superficie_cheia');
      this.drop(list[0], 'evicted');
    }
    // total no mundo: sai o temporário mais antigo
    if (this.recs.size >= this.rules.maxTotal) {
      let oldest: Rec | null = null;
      for (const r of this.recs.values()) if (r.persistence === 'temporary' && (!oldest || r.createdAt < oldest.createdAt)) oldest = r;
      if (!oldest) return deny('mundo_cheio');
      this.drop(oldest.id, 'evicted');
    }
    recordCreation(this.lim(`c:${v.cid}`), now);
    recordCreation(this.lim(`s:${sessionId}`), now);
    const rec: Rec = {
      id: this.nextId++, surface: sf.id, author: { sessionId, name: v.name, clientId: v.cid }, rect: c.content.rect,
      content: toB64(bytes!), bytes: bytes!.slice(), createdAt: now, expiresAt: expiresAtFor(sf, now, this.rules),
      state: GF_STATE.ACTIVE, reports: [], persistence: sf.persistence, ...(c.hasText ? { hasText: true } : {}),
    };
    this.recs.set(rec.id, rec);
    list.push(rec.id);
    this.persist(rec);
    this.stats.created++;
    // distribuição: o autor (com a área atualizada já — está a ≤ 3 m) e quem tem a superfície na área recebem já
    this.updateViewer(v, author.x, author.z);
    const si = this.surfIndex.get(sf.id)!;
    for (const w of this.viewers.values()) {
      if (!w.surfIn.has(si) || w.known.has(rec.id)) continue;
      w.known.add(rec.id);
      w.out.send('gf_add', [this.wire(rec, w)]);
      this.stats.addMsgs++; this.stats.addBytes += rec.bytes.length + 40;
    }
    this.log(`#${rec.id} em ${sf.id} por ${v.name} (${v.cid.slice(0, 8)}…) ${bytes!.length} B${c.hasText ? ' [texto]' : ''}`);
    return { op: 'new', ok: true, n, i: rec.id };
  }

  private activeBy(cid: string) { let n = 0; for (const r of this.recs.values()) if (r.author.clientId === cid && isVisibleState(r.state)) n++; return n; }

  private persist(r: Rec) {
    const { bytes: _b, ...stored } = r;
    void _b;
    this.store.put(stored, this.nextId);
  }

  /** tira do mundo (terminal ou despejo): avisa quem tinha e apaga do armazenamento */
  private drop(id: number, why: GfDelReason) {
    const r = this.recs.get(id);
    if (!r) return;
    this.recs.delete(id);
    const l = this.bySurface.get(r.surface);
    if (l) { const k = l.indexOf(id); if (k >= 0) l.splice(k, 1); }
    this.store.delete(id);
    this.retract(id, why);
    if (why === 'evicted') this.stats.evicted++;
  }

  private retract(id: number, why: GfDelReason) {
    for (const w of this.viewers.values()) if (w.known.delete(id)) this.sendDel(w, [id], why);
  }

  // ------------------------------------------------------------------ moderação
  report(sessionId: string, id: unknown, now = Date.now()): GfRes {
    const v = this.viewers.get(sessionId);
    const r = typeof id === 'number' ? this.recs.get(id) : undefined;
    if (!v || !r) return { op: 'report', ok: false, r: 'inexistente' };
    if (!v.known.has(r.id)) return { op: 'report', ok: false, i: r.id, r: 'longe' };
    if (!checkReportRate(this.lim(`c:${v.cid}`), now, this.rules)) return { op: 'report', ok: false, i: r.id, r: 'spam' };
    const before = r.state;
    const res = moderate(r, { k: 'report', by: v.cid }, this.rules);
    if (!res.changed) return { op: 'report', ok: false, i: r.id, r: res.reason };
    this.stats.reports++;
    this.afterStateChange(r, before);
    this.log(`#${r.id} denunciado por ${v.name} (${r.reports.length}/${this.rules.reportThreshold}) → ${GF_STATE_NAME[r.state]}`);
    return { op: 'report', ok: true, i: r.id };
  }

  /** propaga a mudança de estado e persiste */
  private afterStateChange(r: Rec, before: number) {
    if (r.state === before) return;
    if (r.state === GF_STATE.REMOVED || r.state === GF_STATE.EXPIRED) {
      if (r.state === GF_STATE.REMOVED) this.stats.removed++; else this.stats.expired++;
      this.drop(r.id, r.state === GF_STATE.REMOVED ? 'removed' : 'expired');
      return;
    }
    this.persist(r);
    if (!isVisibleState(r.state)) {
      if (r.state === GF_STATE.HIDDEN) this.stats.hidden++;
      this.retract(r.id, 'hidden');
    } else if (!isVisibleState(before)) {
      // restaurado: volta para quem tem a superfície na área
      const si = this.surfIndex.get(r.surface)!;
      for (const w of this.viewers.values()) if (w.surfIn.has(si) && !w.known.has(r.id)) w.pending.push(r.id);
      for (const w of this.viewers.values()) this.flush(w);
    } else {
      for (const w of this.viewers.values()) if (w.known.has(r.id)) w.out.send('gf_state', { i: r.id, st: r.state });
    }
  }

  /** expiração por TTL (temporários) — chamada a ~1 Hz pelo update() */
  expire(now: number) {
    this.lastExpiry = now;
    for (const r of [...this.recs.values()]) {
      const before = r.state;
      if (moderate(r, { k: 'expire', now }, this.rules).changed) this.afterStateChange(r, before);
    }
  }

  /**
   * API de administração (servidor): remover/ocultar/restaurar. Sem painel — exposta pela mensagem de DESENVOLVIMENTO
   * gf_admin (exige PV_ADMIN_TOKEN) e chamável direto por código/ferramentas do servidor.
   */
  adminAction(op: 'remove' | 'hide' | 'restore', id: number, by = 'admin'): boolean {
    const r = this.recs.get(id);
    if (!r) return false;
    const before = r.state;
    const res = moderate(r, { k: op === 'remove' ? 'admin_remove' : op === 'hide' ? 'admin_hide' : 'admin_restore' }, this.rules);
    if (!res.changed) return false;
    this.log(`#${id} ${op} por ${by} (autor ${r.author.name}/${r.author.clientId.slice(0, 8)}…/${r.author.sessionId})`);
    this.afterStateChange(r, before);
    return true;
  }

  /** lista para moderação (inclui autor completo) */
  adminList() {
    return [...this.recs.values()].map((r) => ({ id: r.id, surface: r.surface, author: r.author, state: GF_STATE_NAME[r.state], reports: r.reports.length, createdAt: r.createdAt, expiresAt: r.expiresAt, bytes: r.bytes.length, hasText: !!r.hasText }));
  }

  /** mensagem gf_admin (desenvolvimento): desativada sem PV_ADMIN_TOKEN; comparação de token em tempo constante */
  adminMessage(sessionId: string, msg: unknown): GfRes {
    const m = (msg ?? {}) as { token?: unknown; op?: unknown; i?: unknown };
    if (!this.adminToken) return { op: 'admin', ok: false, r: 'desativado' };
    const t = typeof m.token === 'string' ? m.token : '';
    let diff = t.length ^ this.adminToken.length;
    for (let k = 0; k < this.adminToken.length; k++) diff |= (t.charCodeAt(k) || 0) ^ this.adminToken.charCodeAt(k);
    if (diff !== 0) { this.log(`gf_admin com token inválido (${sessionId})`); return { op: 'admin', ok: false, r: 'token' }; }
    if (m.op === 'list') return { op: 'admin', ok: true, list: this.adminList() };
    if ((m.op === 'remove' || m.op === 'hide' || m.op === 'restore') && typeof m.i === 'number') {
      const ok = this.adminAction(m.op, m.i, `admin:${sessionId}`);
      return { op: 'admin', ok, i: m.i, ...(ok ? {} : { r: 'estado' }) };
    }
    return { op: 'admin', ok: false, r: 'op' };
  }

  /** estado para QA/testes */
  get(id: number): { state: GraffitiState; reports: number; expiresAt: number } | undefined {
    const r = this.recs.get(id);
    return r ? { state: r.state as GraffitiState, reports: r.reports.length, expiresAt: r.expiresAt } : undefined;
  }
  knownBy(sessionId: string) { return [...(this.viewers.get(sessionId)?.known ?? [])]; }
  flushStore() { return this.store.flush(); }
}
