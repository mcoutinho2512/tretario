/**
 * Rodada 10 — TORCIDAS na sala (adaptador fino; a sala só chama os ganchos):
 *  - `NetPlayer.sup` (u8): 0 = neutro/sem torcida, i+1 = índice em supporters.json `groups` — carregado do banco no
 *    onAuth/reloadLook (contas) e atualizado quando uma troca é aplicada (API ou fim de evento)
 *  - política de troca: a cada 1 s informa ao serviço os formatos dos eventos VIVOS em que cada conta está inscrita;
 *    ao sair deles, aplica a troca de torcida PENDENTE (`settleSupporter`)
 *  - lacuna corrigida: troca de GRUPO DO EVENTO durante um evento vivo com regras de grupo (ex.: confronto) ficava
 *    inconsistente (placar do ClashRunner com o grupo da inscrição × fogo amigo com o grupo atual). Agora a troca é
 *    ADIADA: o grupo da identidade só muda quando o jogador sai do evento ou ele termina
 *  - jogador sem conta (servidor de teste/QA): escolha só na memória da sessão, mesma política
 * Nenhum ramo por torcida/grupo: ids só comparados por igualdade com os DADOS.
 */
import type { EventInstance } from '../events/runner';
import type { DataStore } from '../data/types';
import { decideSupporterChange, settlePending, type SupporterState } from '../../../src/supporters/data';
import { onSupporterChange, setEventKinds, setGroupLocked, settleSupporter, supporters, supWire } from './service';

const LIVE = new Set(['REGISTRATION', 'STARTING', 'ACTIVE']);

export interface SupportersHost {
  /** jogadores com corpo: sessionId → objeto com o campo de rede `sup` */
  players(): Iterable<[string, { sup: number }]>;
  /** conta real (não de teste) da sessão, ou null */
  userOf(sid: string): string | null;
  /** instância de evento em que a sessão está inscrita (EventRuntime.instanceOf) */
  instanceOf(sid: string): EventInstance | null;
  /** grupo do evento na identidade (chat, confronto) */
  setGroupKey(sid: string, key: string | null): void;
  store(): DataStore | null;
  now?(): number;
}

export class RoomSupporters {
  /** troca de grupo do evento adiada (sessão → grupo novo) */
  private deferredGroup = new Map<string, string | null>();
  /** formatos vivos por sessão (assinatura) — para detectar a saída do evento */
  private kinds = new Map<string, string>();
  /** sessões sem conta (teste/QA): estado só em memória */
  private anon = new Map<string, SupporterState>();
  private acc = 0;
  private off: () => void;
  stats = { applied: 0, deferredGroups: 0, settled: 0 };

  constructor(private host: SupportersHost) {
    supporters();
    // troca aplicada (API ou fim de evento) → campo de rede de todas as sessões da conta
    this.off = onSupporterChange((userId, current) => {
      for (const [sid, p] of host.players()) if (host.userOf(sid) === userId) { p.sup = supWire(current); this.stats.applied++; }
    });
  }

  dispose() { this.off(); }

  /** entrada: valor salvo da conta (onAuth) ou escolha local da sessão sem conta (opção de entrada `sup`) */
  join(sid: string, p: { sup: number }, saved: string | null | undefined, anonChoice?: unknown) {
    if (this.host.userOf(sid)) { p.sup = supWire(saved ?? null); return; }
    const data = supporters();
    const st: SupporterState = { current: null, pending: null, changedAt: null };
    const r = data ? decideSupporterChange(data, st, anonChoice, [], this.host.now?.() ?? Date.now()) : null;
    const cur = r && r.kind === 'applied' ? r.state : st;
    this.anon.set(sid, cur);
    p.sup = supWire(cur.current);
  }

  /** pedido de troca de quem não tem conta (mensagem `sup`): mesma política, só na memória da sessão */
  requestAnon(sid: string, p: { sup: number } | undefined, group: unknown): { ok: boolean; deferred?: boolean; r?: string; retryInS?: number } {
    const data = supporters(), st = this.anon.get(sid);
    if (!data || !st || !p || this.host.userOf(sid)) return { ok: false, r: 'conta' };
    const r = decideSupporterChange(data, st, group, this.liveKinds(sid), this.host.now?.() ?? Date.now());
    if (r.kind === 'invalid') return { ok: false, r: 'torcida_invalida' };
    if (r.kind === 'cooldown') return { ok: false, r: 'cooldown', retryInS: r.retryInS };
    this.anon.set(sid, r.state);
    p.sup = supWire(r.state.current);
    return { ok: true, deferred: r.kind === 'deferred' };
  }

  /** troca de GRUPO DO EVENTO (reloadLook): false = adiada (inscrito num evento vivo com regras de grupo) */
  groupChange(sid: string, key: string | null, current: string | null): boolean {
    if (key === current) { this.deferredGroup.delete(sid); return true; }
    if (!this.groupLockedFor(sid)) { this.deferredGroup.delete(sid); return true; }
    this.deferredGroup.set(sid, key);
    this.stats.deferredGroups++;
    return false;
  }

  /** a sessão está num evento VIVO que decide algo pelo grupo (regras de grupo / confronto)? */
  private groupLockedFor(sid: string): boolean {
    const i = this.host.instanceOf(sid);
    return !!i && LIVE.has(i.state) && !!(i.def.groupRules?.allowed?.length || i.def.clash);
  }

  private liveKinds(sid: string): string[] {
    const i = this.host.instanceOf(sid);
    return i && LIVE.has(i.state) ? [i.def.format] : [];
  }

  /** 1 Hz: formatos vivos por conta (política de troca), travas de grupo e aplicação das pendências ao sair */
  tick(dtMs: number) {
    this.acc += dtMs;
    if (this.acc < 1000) return;
    this.acc = 0;
    const data = supporters();
    const now = this.host.now?.() ?? Date.now();
    for (const [sid, p] of this.host.players()) {
      const kinds = this.liveKinds(sid), sig = kinds.join(','), before = this.kinds.get(sid) ?? '';
      const userId = this.host.userOf(sid);
      if (userId) { setEventKinds(userId, kinds); setGroupLocked(userId, this.groupLockedFor(sid)); }
      if (sig === before) continue;
      this.kinds.set(sid, sig);
      if (kinds.length) continue;
      // saiu do evento (ou ele terminou): troca de grupo adiada e torcida pendente
      if (this.deferredGroup.has(sid)) { this.host.setGroupKey(sid, this.deferredGroup.get(sid) ?? null); this.deferredGroup.delete(sid); }
      const store = this.host.store();
      if (userId && store) void settleSupporter(store, userId, now).then((s) => { if (s) this.stats.settled++; }).catch(() => {});
      const st = this.anon.get(sid);
      const next = data && st ? settlePending(data, st, kinds, now) : null;
      if (next) { this.anon.set(sid, next); p.sup = supWire(next.current); this.stats.settled++; }
    }
  }

  /** estado da sessão sem conta (QA/testes) */
  anonState(sid: string): SupporterState | null { return this.anon.get(sid) ?? null; }

  leave(sid: string) {
    const userId = this.host.userOf(sid);
    if (userId) { setEventKinds(userId, []); setGroupLocked(userId, false); }
    this.deferredGroup.delete(sid); this.kinds.delete(sid); this.anon.delete(sid);
  }
}
