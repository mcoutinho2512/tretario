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
 *  mutar        por apelido (chave normalizada): o servidor nem envia ao cliente que mutou; persistido por conta em
 *               preferences.chatMuted (quando há conta)
 *  denúncia     cópia da mensagem guardada no servidor (anel de memória, 15 min) vira evidência do Report no DataStore;
 *               ids de conta nunca vão a clientes
 * Nada disso roda por tick: custo só por mensagem.
 */
// imports SEM extensão: este módulo também é compilado pelo tsconfig da raiz (testes)
import { CHAT_CHANNELS, CHAT_RULES, REPORT_CATEGORIES, floodCheck, newFloodState, type ChatChannel, type ChatMessage, type ChatRejection, type FloodState, type ReportCategory } from '../../../src/chat/protocol';
import { textModeration } from '../../../src/moderation/text';
import { can } from '../../../src/access/policy';
import type { PlayerIdentity } from '../../../src/identity/types';
import type { DataStore } from '../data/types';

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
}

export type ChatIdentity = Pick<PlayerIdentity, 'userId' | 'nickname' | 'state' | 'role' | 'groupKey'> & { test?: boolean };

interface Peer {
  sid: string; ident: ChatIdentity; out: ChatOut;
  /** chave de autor (anti-flood, mutar, denúncia): conta ou conexão */
  key: string;
  nickKey: string;
  /** chaves de apelido mutadas por esta conexão */
  muted: Set<string>;
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
  store?: Pick<DataStore, 'reports' | 'profiles'> | null;
  eventId?: string;
  /** máximo de mensagens GERAL por segundo na sala inteira (teto de leitura) */
  generalPerSec?: number;
  /** tempo que a cópia da mensagem fica disponível para denúncia (ms) */
  keepMs?: number;
  log?: (m: string) => void;
}

export const CHAT_SERVER = {
  generalPerSec: 8,
  keepMs: 15 * 60_000,
  keepMax: 2000,
  maxMuted: 200,
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

const nickKeyOf = (nick: string) => textModeration.nicknameKey(nick) || nick.toLowerCase();

export class ChatService {
  private peers = new Map<string, Peer>();
  private groups = new Map<string, Set<string>>();
  private flood = new Map<string, FloodState>();
  private kept = new Map<string, Kept>();
  private history: ChatMessage[] = [];
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
  }

  // ------------------------------------------------------------------ conexões
  join(sid: string, ident: ChatIdentity, out: ChatOut) {
    if (!can(ident.state, 'chat.read', ident.role)) return;
    const key = ident.userId ? `u:${ident.userId}` : `s:${sid}`;
    const p: Peer = { sid, ident, out, key, nickKey: nickKeyOf(ident.nickname), muted: new Set() };
    this.peers.set(sid, p);
    if (ident.groupKey) { let g = this.groups.get(ident.groupKey); if (!g) this.groups.set(ident.groupKey, (g = new Set())); g.add(sid); }
    const write = can(ident.state, 'chat.write', ident.role);
    out.send('chat_hello', {
      canWrite: write,
      ...(write ? {} : { why: ident.role === 'spectator' && ident.state === 'VISITOR' ? 'visitante' : ident.state === 'SUSPENDED' ? 'suspenso' : 'sem_licenca' }),
      nick: ident.nickname,
      group: ident.groupKey,
      canReport: can(ident.state, 'report.create', ident.role),
      radius: CHAT_RULES.proximityRadius,
      history: this.history,
    });
    // mutados da CONTA (preferências do perfil); o cliente também reenvia a lista local
    if (ident.userId && this.store) {
      void this.store.profiles.byUserId(ident.userId).then((pr) => {
        const list = (pr?.preferences as { chatMuted?: unknown } | undefined)?.chatMuted;
        if (Array.isArray(list) && this.peers.get(sid) === p) for (const k of list.slice(0, CHAT_SERVER.maxMuted)) if (typeof k === 'string') p.muted.add(k);
      }).catch(() => { /* sem perfil: só a lista local */ });
    }
  }

  leave(sid: string) {
    const p = this.peers.get(sid);
    if (!p) return;
    this.peers.delete(sid);
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
    let fs = this.flood.get(p.key);
    if (!fs) this.flood.set(p.key, (fs = newFloodState()));
    if (now < fs.blockedUntil) return deny('cooldown', fs.blockedUntil - now);
    if (m.text.length > CHAT_RULES.maxChars * 4) return deny('longo');
    if (invalidChatChars(m.text)) return deny('caracteres');
    const v = textModeration.check(m.text, 'chat');
    if (!v.ok) {
      if (v.reason === 'bloqueado' || v.reason === 'spam') return deny(v.reason, penalize(fs, now));
      return deny(v.reason === 'longo' ? 'longo' : v.reason === 'caracteres' ? 'caracteres' : 'vazio');
    }
    const f = floodCheck(fs, v.text, now);
    if (!f.ok) return deny(f.reason, f.retryMs);
    if (ch === 'geral') {
      if (now - this.gen.windowStart >= 1000) { this.gen.windowStart = now; this.gen.n = 0; }
      if (this.gen.n >= this.generalPerSec) return deny('flood', 1000 - (now - this.gen.windowStart));
      this.gen.n++;
    }

    const wire: ChatMessage = { id: (this.nextId++).toString(36), ch, nick: p.ident.nickname, nid: this.hooks.nidOf(sid), text: v.text, t: now, ...(ch === 'grupo' ? { group: p.ident.groupKey! } : {}) };
    const muters = (q: Peer) => q.muted.has(p.nickKey) && q.sid !== sid;
    let to: Set<string> | null = null;
    let n = 0;
    if (ch === 'geral') {
      const except: string[] = [];
      for (const q of this.peers.values()) if (q.muted.size && muters(q)) except.push(q.sid);
      this.hooks.broadcast('chat', wire, except);
      n = this.peers.size - except.length;
      this.history.push(wire);
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
        if (!q || muters(q)) continue;
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

  private keep(wire: ChatMessage, p: Peer, to: Set<string> | null, now: number) {
    this.kept.set(wire.id, { wire, authorKey: p.key, authorUserId: p.ident.userId, authorSid: p.sid, to, reporters: new Set() });
    // poda: por idade e por quantidade (Map mantém a ordem de inserção)
    for (const [id, k] of this.kept) {
      if (this.kept.size <= CHAT_SERVER.keepMax && now - k.wire.t <= this.keepMs) break;
      this.kept.delete(id);
    }
  }

  // ------------------------------------------------------------------ mutar
  /** `{ nick, on }` ou `{ list: nicks[] }` (sincronização da lista local na entrada) */
  mute(sid: string, raw: unknown) {
    const p = this.peers.get(sid);
    if (!p) return;
    const m = (raw ?? {}) as { nick?: unknown; on?: unknown; list?: unknown };
    const keys: [string, boolean][] = [];
    if (Array.isArray(m.list)) for (const n of m.list.slice(0, CHAT_SERVER.maxMuted)) { if (typeof n === 'string') keys.push([nickKeyOf(n.slice(0, 40)), true]); }
    else if (typeof m.nick === 'string') keys.push([nickKeyOf(m.nick.slice(0, 40)), m.on !== false]);
    let changed = false;
    for (const [k, on] of keys) {
      if (!k || k === p.nickKey) continue;
      if (on && p.muted.size >= CHAT_SERVER.maxMuted) break;
      if (on ? !p.muted.has(k) : p.muted.has(k)) { changed = true; if (on) p.muted.add(k); else p.muted.delete(k); }
    }
    if (changed && p.ident.userId && this.store) {
      const uid = p.ident.userId, list = [...p.muted];
      void this.store.profiles.byUserId(uid).then((pr) => pr && this.store!.profiles.update(uid, { preferences: { ...pr.preferences, chatMuted: list } })).catch(() => { /* sem perfil */ });
    }
  }

  mutedBy(sid: string) { return [...(this.peers.get(sid)?.muted ?? [])]; }

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
    if (this.store) {
      try {
        await this.store.reports.create({
          reporterUserId: p.ident.userId, targetUserId: k.authorUserId, targetType: 'CHAT_MESSAGE', targetRef: `chat:${this.eventId}:${id}`,
          category, details, evidence, eventId: this.eventId || null,
        });
      } catch (e) { this.log(`falha ao gravar denúncia: ${(e as Error).message}`); return res(false, 'erro'); }
    }
    this.log(`denúncia ${category} da mensagem ${id} (${k.wire.ch}) por ${p.ident.nickname}`);
    return res(true);
  }

  // ------------------------------------------------------------------ QA
  get peerCount() { return this.peers.size; }
  info() { return { peers: this.peers.size, groups: this.groups.size, kept: this.kept.size, history: this.history.length, ...this.stats }; }
}
