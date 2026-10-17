/**
 * Chat no SERVIDOR (rodada 8) — autoridade, destinatários, anti-flood, mutar e denúncias. Independente do Colyseus:
 * a sala só repassa mensagens e dá ganchos (posição, vizinhos pela grade espacial, envio) — testável sem rede
 * (tests/chatService.test.ts). Regras e formatos: src/chat/protocol.ts · docs/CHAT.md.
 *
 *  escrever     capacidade `chat.write` (src/access/policy.ts): espectador, visitante e suspenso NÃO escrevem
 *  texto        moderação central (src/moderation/text.ts, contexto 'chat') + caracteres inválidos (zalgo, bidi)
 *  anti-flood   floodCheck (src/chat/protocol.ts) por CONTA (userId) ou por conexão (jogador de teste); texto
 *               bloqueado também gera cooldown adaptativo; teto global do GERAL (mensagens/s na sala)
 *  destinos     decididos AQUI, nunca pelo cliente:
 *                 GERAL        todas as conexões do evento (jogadores + espectadores leem) — 1 codificação (broadcast)
 *                 PROXIMIDADE  jogadores a ≤ CHAT_RULES.proximityRadius da posição AUTORITATIVA do autor no envio,
 *                              pela grade espacial da sala (nada de laço global); espectadores não recebem
 *                 GRUPO        conexões com o mesmo identity.groupKey (índice por grupo); sem grupo → 'sem_grupo'
 *  mutar        por IDENTIDADE (rodada 8.1), nunca por apelido: o alvo é resolvido AQUI — id de mensagem que o pedinte
 *               recebeu (cópia de 15 min), nid de entidade no mundo, ou `ref` da própria lista — para a chave de autor
 *               (`u:<userId>`; sem conta, `s:<conexão>`). O cliente nunca manda userId. Com conta: MuteRelationship no
 *               DataStore (carregada na entrada, compartilhada entre as conexões da mesma conta); sem conta: só nesta
 *               conexão. Filtro no servidor em GERAL, PROXIMIDADE, GRUPO e no histórico da entrada. `ref` = HMAC
 *               opaco do par (dono, alvo) com o segredo do servidor
 *  denúncia     cópia da mensagem guardada no servidor (anel de memória, 15 min) vira evidência do Report no DataStore;
 *               ids de conta nunca vão a clientes
 * Nada disso roda por tick: custo só por mensagem.
 */
// imports SEM extensão: este módulo também é compilado pelo tsconfig da raiz (testes)
import { CHAT_CHANNELS, CHAT_RULES, REPORT_CATEGORIES, floodCheck, newFloodState, type ChatChannel, type ChatMessage, type ChatRejection, type FloodState, type ReportCategory } from '../../../src/chat/protocol';
import { textModeration } from '../../../src/moderation/text';
import { can, type Capability } from '../../../src/access/policy';
import type { PlayerIdentity } from '../../../src/identity/types';
import { CHAT_MUTE_MAX, type ChatMuteEntry, type ChatMuteRejection } from '../../../src/chat/protocol';
import type { DataStore } from '../data/types';
import { createHmac } from 'node:crypto';

export interface ChatOut { send(type: string, msg: unknown): void }

/** o que a sala fornece (posições autoritativas e a grade espacial dela) */
export interface ChatRoomHooks {
  /** id curto da entidade do autor no mundo (0 = sem corpo: espectador) */
  nidOf(sid: string): number;
  /** posição autoritativa do jogador (undefined = sem corpo) */
  posOf(sid: string): { x: number; z: number } | undefined;
  /** conexões de JOGADORES a ≤ r de (x, z) — consulta na grade espacial (só as células próximas) */
  near(x: number, z: number, r: number, fn: (sid: string) => void): void;
  /** envia a TODAS as conexões da sala, exceto `except` (codifica uma vez) */
  broadcast(type: string, msg: unknown, except: string[]): void;
  /** entidade no mundo pelo nid → conexão + conta (mutar por nome/entidade); undefined = não existe */
  identityOfNid?(nid: number): { sid: string; userId: string | null; nickname: string } | undefined;
}

export type ChatIdentity = Pick<PlayerIdentity, 'userId' | 'nickname' | 'state' | 'role' | 'groupKey'> & { test?: boolean };

/** item mutado: chave de autor (`u:`/`s:`), ref opaco, apelido no momento (só exibição) */
interface MuteItem { key: string; ref: string; nick: string; since: number }
/** lista de um DONO (conta ou conexão) — compartilhada pelas conexões da mesma conta */
interface MuteSet { byKey: Map<string, MuteItem>; byRef: Map<string, string>; ready: boolean; peers: number; io: Promise<unknown>; times: number[] }

interface Peer {
  sid: string; ident: ChatIdentity; out: ChatOut;
  /** chave de autor (anti-flood, mutar, denúncia): conta ou conexão */
  key: string;
  mutes: MuteSet;
  /** mutes da conta ainda carregando: chat_hello adiado e PROXIMIDADE/GRUPO guardados aqui (null = pronto) */
  pending: { wire: ChatMessage; authorKey: string }[] | null;
}

/** cópia INTERNA da mensagem (evidência de denúncia) — nunca enviada a clientes */
interface Kept {
  wire: ChatMessage;
  authorKey: string; authorUserId: string | null; authorSid: string;
  /** quem recebeu (PROXIMIDADE/GRUPO); null = GERAL (público) */
  to: Set<string> | null;
  reporters: Set<string>;
}

export interface ChatServiceOptions {
  store?: Pick<DataStore, 'reports' | 'mutes'> | null;
  eventId?: string;
  /** máximo de mensagens GERAL por segundo na sala inteira (teto de leitura) */
  generalPerSec?: number;
  /** tempo que a cópia da mensagem fica disponível para denúncia (ms) */
  keepMs?: number;
  log?: (m: string) => void;
  /** segredo do servidor para o `ref` opaco do mute (padrão: PV_SESSION_SECRET) */
  secret?: string;
}

export const CHAT_SERVER = {
  generalPerSec: 8,
  keepMs: 15 * 60_000,
  keepMax: 2000,
  /** mudanças de mute por dono por minuto (cada uma pode escrever no banco) */
  muteChangesPerMin: 30,
  /** denúncias por denunciante */
  reportMax: 6,
  reportWindowMs: 10 * 60_000,
  reportDetailsMax: 300,
} as const;

export type ChatSendResult = { ok: true; id: string; recipients: number } | { ok: false; reason: ChatRejection; retryMs: number };

/** caracteres que não são conteúdo: marcas combinantes em excesso ("zalgo") e controles bidi/invisíveis */
export function invalidChatChars(raw: string): boolean {
  if (/[‪-‮⁦-⁩​-‏⁠-⁤﻿]/.test(raw)) return true;
  if (/\p{M}{4,}/u.test(raw)) return true;
  const marks = raw.match(/\p{M}/gu)?.length ?? 0;
  return marks > 8 && marks > raw.length / 3;
}

/** texto bloqueado pela moderação também conta como infração (cooldown adaptativo do mesmo estado anti-flood) */
export function penalize(s: FloodState, now: number): number {
  s.strikes++;
  const ms = Math.min(CHAT_RULES.cooldownMaxMs, CHAT_RULES.cooldownBaseMs * 2 ** (s.strikes - 1));
  s.blockedUntil = now + ms;
  return ms;
}

/** chave de autor: conta (`u:`) ou, sem conta, a conexão (`s:`) */
export const authorKeyOf = (sid: string, userId: string | null) => (userId ? `u:${userId}` : `s:${sid}`);
/** ref OPACO e estável do par (dono, alvo): HMAC-SHA256 truncado (96 bits, base64url) — não revela nem deriva ids */
export const muteRef = (secret: string, ownerKey: string, targetKey: string) => createHmac('sha256', secret).update(`mute|${ownerKey}|${targetKey}`).digest('base64url').slice(0, 16);
/** userId persistível (contas fictícias `test:` de QA ficam só na memória) */
const realUser = (key: string) => (key.startsWith('u:') && !key.startsWith('u:test:') ? key.slice(2) : null);

export class ChatService {
  private peers = new Map<string, Peer>();
  private groups = new Map<string, Set<string>>();
  private flood = new Map<string, FloodState>();
  private kept = new Map<string, Kept>();
  private history: { wire: ChatMessage; authorKey: string }[] = [];
  private owners = new Map<string, MuteSet>();
  private secret: string;
  private reportTimes = new Map<string, number[]>();
  private nextId = 1;
  private gen = { windowStart: 0, n: 0 };
  private store: ChatServiceOptions['store'];
  private eventId: string;
  private generalPerSec: number;
  private keepMs: number;
  private log: (m: string) => void;
  /** métricas (QA / docs): mensagens, entregas, bytes aproximados (JSON do ChatMessage), custo do envio */
  stats = { sent: { geral: 0, proximidade: 0, grupo: 0 }, denied: 0, deliveries: 0, bytes: 0, maxBytes: 0, costMs: 0, maxCostMs: 0, reports: 0 };

  constructor(private hooks: ChatRoomHooks, o: ChatServiceOptions = {}) {
    this.store = o.store ?? null;
    this.eventId = o.eventId ?? '';
    this.generalPerSec = o.generalPerSec ?? CHAT_SERVER.generalPerSec;
    this.keepMs = o.keepMs ?? CHAT_SERVER.keepMs;
    this.log = o.log ?? ((m) => console.log(`[chat] ${m}`));
    this.secret = o.secret ?? (process.env.PV_SESSION_SECRET || 'dev-only-change-me');
  }

  // ------------------------------------------------------------------ conexões
  join(sid: string, ident: ChatIdentity, out: ChatOut) {
    if (!can(ident.state, 'chat.read', ident.role)) return;
    const key = authorKeyOf(sid, ident.userId);
    let mutes = this.owners.get(key);
    const fresh = !mutes;
    if (!mutes) this.owners.set(key, (mutes = { byKey: new Map(), byRef: new Map(), ready: true, peers: 0, io: Promise.resolve(), times: [] }));
    mutes.peers++;
    const p: Peer = { sid, ident, out, key, mutes, pending: null };
    this.peers.set(sid, p);
    if (ident.groupKey) { let g = this.groups.get(ident.groupKey); if (!g) this.groups.set(ident.groupKey, (g = new Set())); g.add(sid); }
    const uid = realUser(key);
    if (fresh && uid && this.store) {
      // mutes da CONTA: carrega antes do chat_hello (o histórico já sai filtrado); até lá nada é entregue a ela
      mutes.ready = false;
      const ms = mutes;
      ms.io = this.store.mutes.list(uid).then((list) => {
        for (const r of list.slice(0, CHAT_MUTE_MAX)) this.addItem(ms, key, `u:${r.mutedUserId}`, r.mutedNicknameAtTime ?? '—', +r.createdAt, false);
      }).catch((e) => this.log(`falha ao carregar mutes: ${(e as Error).message}`)).finally(() => {
        ms.ready = true;
        for (const q of this.peers.values()) if (q.mutes === ms && q.pending) this.greet(q);
      });
    }
    if (mutes.ready) this.greet(p); else p.pending = [];
  }

  /** chat_hello (histórico do GERAL sem os mutados) + lista de mutados; entrega o que ficou guardado na carga */
  private greet(p: Peer) {
    const ident = p.ident, pend = p.pending;
    p.pending = null;
    const write = can(ident.state, 'chat.write', ident.role);
    p.out.send('chat_hello', {
      canWrite: write,
      ...(write ? {} : { why: ident.role === 'spectator' && ident.state === 'VISITOR' ? 'visitante' : ident.state === 'SUSPENDED' ? 'suspenso' : 'sem_licenca' }),
      nick: ident.nickname,
      group: ident.groupKey,
      canReport: can(ident.state, 'report.create', ident.role),
      radius: CHAT_RULES.proximityRadius,
      history: this.history.filter((h) => !p.mutes.byKey.has(h.authorKey)).map((h) => h.wire),
    });
    this.sendMutes(p);
    for (const m of pend ?? []) if (!p.mutes.byKey.has(m.authorKey)) p.out.send('chat', m.wire);
  }

  leave(sid: string) {
    const p = this.peers.get(sid);
    if (!p) return;
    this.peers.delete(sid);
    if (--p.mutes.peers <= 0 && this.owners.get(p.key) === p.mutes) this.owners.delete(p.key); // a conta recarrega do banco na próxima entrada
    if (p.ident.groupKey) { const g = this.groups.get(p.ident.groupKey); g?.delete(sid); if (g && !g.size) this.groups.delete(p.ident.groupKey); }
    // anti-flood por conexão some com ela; por conta continua (reconectar não zera o cooldown)
    if (p.key.startsWith('s:')) this.flood.delete(p.key);
  }

  // ------------------------------------------------------------------ enviar
  send(sid: string, raw: unknown, now = Date.now()): ChatSendResult {
    const t0 = performance.now();
    const p = this.peers.get(sid);
    const deny = (reason: ChatRejection, retryMs = 0): ChatSendResult => {
      this.stats.denied++;
      p?.out.send('chat_denied', { reason, retryMs });
      return { ok: false, reason, retryMs };
    };
    if (!p || !can(p.ident.state, 'chat.write', p.ident.role)) return deny('sem_permissao');
    const m = (raw ?? {}) as { ch?: unknown; text?: unknown };
    const ch = CHAT_CHANNELS.includes(m.ch as ChatChannel) ? (m.ch as ChatChannel) : null;
    if (!ch || typeof m.text !== 'string') return deny('vazio');
    if (ch === 'grupo' && !p.ident.groupKey) return deny('sem_grupo');
    if (ch === 'proximidade' && !this.hooks.posOf(sid)) return deny('sem_permissao');
    const v = this.pipeline(p, m.text, now);
    if (!v.ok) return deny(v.reason, v.retryMs);
    if (ch === 'geral') {
      if (now - this.gen.windowStart >= 1000) { this.gen.windowStart = now; this.gen.n = 0; }
      if (this.gen.n >= this.generalPerSec) return deny('flood', 1000 - (now - this.gen.windowStart));
      this.gen.n++;
    }

    const wire: ChatMessage = { id: (this.nextId++).toString(36), ch, nick: p.ident.nickname, nid: this.hooks.nidOf(sid), text: v.text, t: now, ...(ch === 'grupo' ? { group: p.ident.groupKey! } : {}) };
    // mutou o autor (por identidade) → o servidor nem envia; mutes ainda carregando → não entrega agora
    const muters = (q: Peer) => q.sid !== sid && (q.pending !== null || q.mutes.byKey.has(p.key));
    let to: Set<string> | null = null;
    let n = 0;
    if (ch === 'geral') {
      const except: string[] = [];
      for (const q of this.peers.values()) if (muters(q)) except.push(q.sid);
      this.hooks.broadcast('chat', wire, except);
      n = this.peers.size - except.length;
      this.history.push({ wire, authorKey: p.key }); // quem ainda carrega recebe pelo histórico do chat_hello
      if (this.history.length > CHAT_RULES.historyGeneral) this.history.shift();
    } else {
      to = new Set<string>();
      if (ch === 'proximidade') {
        const pos = this.hooks.posOf(sid)!;
        to.add(sid);
        this.hooks.near(pos.x, pos.z, CHAT_RULES.proximityRadius, (s) => to!.add(s));
      } else {
        for (const s of this.groups.get(p.ident.groupKey!) ?? []) to.add(s);
      }
      for (const s of to) {
        const q = this.peers.get(s);
        if (!q) continue;
        if (q.pending && q.sid !== sid) { q.pending.push({ wire, authorKey: p.key }); continue; }
        if (muters(q)) continue;
        q.out.send('chat', wire);
        n++;
      }
    }
    this.keep(wire, p, to, now);
    const bytes = Buffer.byteLength(JSON.stringify(wire));
    const cost = performance.now() - t0;
    const st = this.stats;
    st.sent[ch]++; st.deliveries += n; st.bytes += bytes; st.maxBytes = Math.max(st.maxBytes, bytes); st.costMs += cost; st.maxCostMs = Math.max(st.maxCostMs, cost);
    return { ok: true, id: wire.id, recipients: n };
  }

  /**
   * O pipeline de TEXTO do chat (anti-flood por autor, caracteres inválidos, moderação central, penalidade adaptativa) —
   * o MESMO para o chat e para as falas do debate (server/src/debate): um filtro só, um estado anti-flood por autor.
   */
  private pipeline(p: Peer, text: string, now: number): { ok: true; text: string } | { ok: false; reason: ChatRejection; retryMs: number } {
    let fs = this.flood.get(p.key);
    if (!fs) this.flood.set(p.key, (fs = newFloodState()));
    const no = (reason: ChatRejection, retryMs = 0) => ({ ok: false as const, reason, retryMs });
    if (now < fs.blockedUntil) return no('cooldown', fs.blockedUntil - now);
    if (text.length > CHAT_RULES.maxChars * 4) return no('longo');
    if (invalidChatChars(text)) return no('caracteres');
    const v = textModeration.check(text, 'chat');
    if (!v.ok) {
      if (v.reason === 'bloqueado' || v.reason === 'spam') return no(v.reason, penalize(fs, now));
      return no(v.reason === 'longo' ? 'longo' : v.reason === 'caracteres' ? 'caracteres' : 'vazio');
    }
    const f = floodCheck(fs, v.text, now);
    if (!f.ok) return no(f.reason, f.retryMs);
    return { ok: true, text: v.text };
  }

  /**
   * rodada 9 — texto de OUTRO canal (fala do debate) pelo mesmo pipeline do chat, com a capacidade daquele canal
   * (`debate.speak`). Devolve o texto moderado e a chave de autor (mutar/denunciar por identidade).
   */
  screen(sid: string, text: unknown, cap: Capability, now = Date.now()): { ok: true; text: string; key: string } | { ok: false; reason: ChatRejection; retryMs: number } {
    const p = this.peers.get(sid);
    if (!p || !can(p.ident.state, cap, p.ident.role)) { this.stats.denied++; return { ok: false, reason: 'sem_permissao', retryMs: 0 }; }
    if (typeof text !== 'string') return { ok: false, reason: 'vazio', retryMs: 0 };
    const v = this.pipeline(p, text, now);
    if (!v.ok) this.stats.denied++;
    return v.ok ? { ...v, key: p.key } : v;
  }

  private muteListeners = new Set<(ownerSids: string[], authorKey: string, on: boolean) => void>();
  /** avisa mudanças de mute (conexões do dono, chave do alvo) — o debate esconde as falas do alvo na hora */
  onMute(fn: (ownerSids: string[], authorKey: string, on: boolean) => void) { this.muteListeners.add(fn); return () => this.muteListeners.delete(fn); }

  /** chave de autor da conexão (null = não está no chat) */
  keyOf(sid: string): string | null { return this.peers.get(sid)?.key ?? null; }
  /** `viewer` mutou (por identidade) o autor `authorKey`? Mutes ainda carregando contam como mutado (não entrega agora) */
  mutes(viewer: string, authorKey: string): boolean {
    const q = this.peers.get(viewer);
    return !!q && q.key !== authorKey && (q.pending !== null || q.mutes.byKey.has(authorKey));
  }

  private keep(wire: ChatMessage, p: Peer, to: Set<string> | null, now: number) {
    this.kept.set(wire.id, { wire, authorKey: p.key, authorUserId: p.ident.userId, authorSid: p.sid, to, reporters: new Set() });
    // poda: por idade e por quantidade (Map mantém a ordem de inserção)
    for (const [id, k] of this.kept) {
      if (this.kept.size <= CHAT_SERVER.keepMax && now - k.wire.t <= this.keepMs) break;
      this.kept.delete(id);
    }
  }

  // ------------------------------------------------------------------ mutar
  private addItem(ms: MuteSet, ownerKey: string, key: string, nick: string, since: number, check = true): boolean {
    if (ms.byKey.has(key)) return true;
    if (check && ms.byKey.size >= CHAT_MUTE_MAX) return false;
    const ref = muteRef(this.secret, ownerKey, key);
    ms.byKey.set(key, { key, ref, nick: nick.slice(0, 40), since });
    ms.byRef.set(ref, key);
    return true;
  }

  private sendMutes(p: Peer, hide?: string[]) {
    const list: ChatMuteEntry[] = [...p.mutes.byKey.values()].map(({ ref, nick, since }) => ({ ref, nick, since }));
    p.out.send('chat_mutes', { list, ...(hide?.length ? { hide } : {}) });
  }

  /**
   * `chat_mute` { msg | nid | ref, on } — exatamente um alvo, resolvido aqui; qualquer outro campo (userId…) é ignorado.
   * Resposta: `chat_mutes` (lista nova, a TODAS as conexões do dono) ou `chat_mute_denied` { reason }.
   */
  mute(sid: string, raw: unknown, now = Date.now()): { ok: true } | { ok: false; reason: ChatMuteRejection } {
    const p = this.peers.get(sid);
    if (!p) return { ok: false, reason: 'alvo_invalido' };
    const deny = (reason: ChatMuteRejection) => { p.out.send('chat_mute_denied', { reason }); return { ok: false as const, reason }; };
    const m = (raw ?? {}) as { msg?: unknown; nid?: unknown; ref?: unknown; on?: unknown };
    const on = m.on !== false;
    const given = [m.msg, m.nid, m.ref].filter((x) => x !== undefined).length;
    if (given !== 1) return deny('alvo_invalido');
    const ms = p.mutes;
    let target: { key: string; nick: string } | null = null;
    if (typeof m.ref === 'string') {
      const key = ms.byRef.get(m.ref.slice(0, 32)); // só a PRÓPRIA lista: ref de outro dono não existe aqui
      const it = key ? ms.byKey.get(key) : undefined;
      if (it) target = { key: it.key, nick: it.nick };
    } else if (typeof m.msg === 'string') {
      const k = this.kept.get(m.msg.slice(0, 16));
      // só mensagem que esta conexão pode ter recebido (GERAL público ou destinatário dela)
      if (k && now - k.wire.t <= this.keepMs && (!k.to || k.to.has(sid))) target = { key: k.authorKey, nick: k.wire.nick };
    } else if (typeof m.nid === 'number' && Number.isInteger(m.nid) && m.nid > 0) {
      const t = this.hooks.identityOfNid?.(m.nid);
      if (t) target = { key: authorKeyOf(t.sid, t.userId), nick: t.nickname };
    }
    if (!target) return deny('alvo_invalido');
    if (target.key === p.key) return deny('proprio');
    const has = ms.byKey.has(target.key);
    if (on === has) { this.sendMutes(p); return { ok: true }; } // já está assim
    ms.times = ms.times.filter((t) => now - t < 60_000);
    if (ms.times.length >= CHAT_SERVER.muteChangesPerMin) return deny('limite');
    if (on && !this.addItem(ms, p.key, target.key, target.nick, now)) return deny('limite');
    let hide: string[] | undefined;
    if (on) {
      // mensagens do alvo que o dono já recebeu (o cliente some com elas na hora; ele não sabe quem é quem)
      hide = [];
      for (const k of this.kept.values()) if (k.authorKey === target.key && (!k.to || k.to.has(sid))) hide.push(k.wire.id);
    } else {
      const it = ms.byKey.get(target.key)!;
      ms.byKey.delete(target.key); ms.byRef.delete(it.ref);
    }
    ms.times.push(now);
    const owner = realUser(p.key), muted = realUser(target.key);
    if (owner && muted && this.store) {
      const st = this.store, nick = target.nick;
      ms.io = ms.io.then(async () => { if (on) await st.mutes.add(owner, muted, nick); else await st.mutes.remove(owner, muted); })
        .catch((e) => this.log(`falha ao gravar mute: ${(e as Error).message}`));
    }
    for (const q of this.peers.values()) if (q.mutes === ms && !q.pending) this.sendMutes(q, hide);
    // rodada 9: outros canais com texto de autor (falas do debate) escondem/voltam a mostrar o alvo para o dono
    if (this.muteListeners.size) { const owners = [...this.peers.values()].filter((q) => q.mutes === ms).map((q) => q.sid); for (const fn of this.muteListeners) fn(owners, target.key, on); }
    return { ok: true };
  }

  /** QA/testes: lista atual (ref, apelido) desta conexão */
  mutedBy(sid: string): ChatMuteEntry[] { return [...(this.peers.get(sid)?.mutes.byKey.values() ?? [])].map(({ ref, nick, since }) => ({ ref, nick, since })); }
  /** testes: espera a carga e as gravações de mute desta conexão */
  async settled(sid: string) { const ms = this.peers.get(sid)?.mutes; for (let i = 0; ms && i < 3; i++) await ms.io; }

  // ------------------------------------------------------------------ denunciar
  /** denúncia de mensagem: `{ id, category, details? }` → Report no DataStore com a CÓPIA do servidor como evidência */
  async report(sid: string, raw: unknown, now = Date.now()): Promise<{ ok: boolean; id?: string; r?: string }> {
    const p = this.peers.get(sid);
    const m = (raw ?? {}) as { id?: unknown; category?: unknown; details?: unknown };
    const id = typeof m.id === 'string' ? m.id.slice(0, 16) : '';
    const res = (ok: boolean, r?: string) => { const out = { ok, id, ...(r ? { r } : {}) }; p?.out.send('chat_report_res', out); return out; };
    if (!p || !can(p.ident.state, 'report.create', p.ident.role)) return res(false, 'sem_permissao');
    const k = this.kept.get(id);
    if (!k || now - k.wire.t > this.keepMs) return res(false, 'inexistente');
    if (k.to && !k.to.has(sid)) return res(false, 'inexistente'); // não recebeu: não denuncia
    if (k.authorKey === p.key) return res(false, 'propria');
    if (k.reporters.has(p.key)) return res(false, 'repetida');
    const times = (this.reportTimes.get(p.key) ?? []).filter((t) => now - t < CHAT_SERVER.reportWindowMs);
    if (times.length >= CHAT_SERVER.reportMax) { this.reportTimes.set(p.key, times); return res(false, 'limite'); }
    const category: ReportCategory = REPORT_CATEGORIES.includes(m.category as ReportCategory) ? (m.category as ReportCategory) : 'OUTRO';
    const details = typeof m.details === 'string' ? textModeration.sanitize(m.details, 'chat').slice(0, CHAT_SERVER.reportDetailsMax) || null : null;
    times.push(now); this.reportTimes.set(p.key, times);
    k.reporters.add(p.key);
    // contexto: até 3 mensagens anteriores do mesmo autor ainda guardadas
    const context: { ch: string; text: string; t: number }[] = [];
    for (const o of this.kept.values()) if (o.authorKey === k.authorKey && o.wire.id !== id && o.wire.t <= k.wire.t) context.push({ ch: o.wire.ch, text: o.wire.text, t: o.wire.t });
    const evidence = {
      kind: 'chat', messageId: id, channel: k.wire.ch, text: k.wire.text, at: new Date(k.wire.t).toISOString(),
      authorNick: k.wire.nick, authorUserId: k.authorUserId, ...(k.authorUserId ? {} : { authorConnection: k.authorSid }),
      ...(k.wire.group ? { group: k.wire.group } : {}), recipients: k.to ? k.to.size : 'geral', context: context.slice(-3),
    };
    this.stats.reports++;
    let reportId = '—';
    if (this.store) {
      try {
        reportId = (await this.store.reports.create({
          reporterUserId: p.ident.userId, targetUserId: k.authorUserId, targetType: 'CHAT_MESSAGE', targetRef: `chat:${this.eventId}:${id}`,
          category, details, evidence, eventId: this.eventId || null, reportedNicknameAtTime: k.wire.nick,
        })).id;
      } catch (e) { this.log(`falha ao gravar denúncia: ${(e as Error).message}`); return res(false, 'erro'); }
    }
    this.log(`denúncia ${reportId} (${category}) da mensagem ${id} (${k.wire.ch}) por ${p.ident.nickname}`);
    return res(true);
  }

  // ------------------------------------------------------------------ limpeza
  /**
   * Esquece estado ocioso que cresce por conta até reiniciar (chamado pela limpeza periódica): anti-flood já fora do
   * cooldown e sem atividade há mais que as janelas (as infrações zerariam de qualquer forma) e denúncias fora da janela.
   * Devolve quantas entradas saíram.
   */
  sweep(now = Date.now()): number {
    let n = 0;
    const idle = Math.max(CHAT_RULES.cooldownMaxMs, CHAT_RULES.repeatWindowMs, CHAT_RULES.burstWindowMs);
    for (const [k, f] of this.flood) {
      const last = Math.max(f.lastTextAt, f.recent.at(-1) ?? 0, f.blockedUntil);
      if (now >= f.blockedUntil && now - last > idle) { this.flood.delete(k); n++; }
    }
    for (const [k, ts] of this.reportTimes) if (ts.every((t) => now - t >= CHAT_SERVER.reportWindowMs)) { this.reportTimes.delete(k); n++; }
    return n;
  }

  // ------------------------------------------------------------------ QA
  get peerCount() { return this.peers.size; }
  info() { return { peers: this.peers.size, groups: this.groups.size, kept: this.kept.size, history: this.history.length, ...this.stats }; }
}
