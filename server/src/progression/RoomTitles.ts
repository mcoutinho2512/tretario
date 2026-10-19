/**
 * Rodada 11 — cola da sala para NÍVEL e TÍTULO PÚBLICOS (NetPlayer.lvl / NetPlayer.title; docs/INVENTORY.md):
 *  - nível: copiado do ProgressionService a 1 Hz (só escreve quando muda; bot/sem progressão = 0)
 *  - título: conta → salvo no perfil (Profile.titleKey) e revalidado na entrada; troca pela API (`onTitleChange`) ou
 *    pela mensagem `title {t}` (gravada na conta). Sem conta (servidor de teste): só na sessão, contra os títulos
 *    ganhos NESTA sessão. Resposta `title_res {ok, title | reason}` só a quem pediu.
 */
import type { DataStore } from '../data/types';
import type { ProgressionService } from './ProgressionService';
import { onTitleChange, requestTitle } from './titles';
import { validateTitle } from '../../../src/inventory/equipRules';

type Pub = { lvl: number; title: string };
export interface RoomTitlesHost {
  players(): Iterable<[string, Pub]>;
  /** conta real (não visitante/teste) da conexão; null = só a sessão */
  userOf(sid: string): string | null;
  progression(): ProgressionService;
  store(): DataStore | null;
  send(sid: string, type: string, msg: unknown): void;
}

export const TITLE_RATE_MS = 400;

export class RoomTitles {
  private acc = 0;
  private last = new Map<string, number>();
  private off: () => void;

  constructor(private h: RoomTitlesHost) {
    this.off = onTitleChange((userId, title) => {
      for (const [sid, p] of h.players()) if (h.userOf(sid) === userId) p.title = title ?? '';
    });
  }

  /** entrada: título salvo (já validado no onAuth) e nível atual */
  join(sid: string, p: Pub, saved?: string | null) {
    p.title = saved ?? '';
    p.lvl = Math.min(255, this.h.progression().levelOf(sid));
  }

  tick(dtMs: number) {
    this.acc += dtMs;
    if (this.acc < 1000) return;
    this.acc = 0;
    const svc = this.h.progression();
    for (const [sid, p] of this.h.players()) { const l = Math.min(255, svc.levelOf(sid)); if (p.lvl !== l) p.lvl = l; }
  }

  async request(sid: string, p: Pub | undefined, m: unknown, now = Date.now()) {
    if (!p) return;
    if (now - (this.last.get(sid) ?? -Infinity) < TITLE_RATE_MS) { this.h.send(sid, 'title_res', { ok: false, reason: 'rapido' }); return; }
    this.last.set(sid, now);
    const raw = (m as { t?: unknown } | null)?.t;
    const user = this.h.userOf(sid), store = this.h.store();
    if (user && store) {
      const r = await requestTitle(store, user, raw).catch(() => ({ ok: false as const, reason: 'invalido' as const }));
      this.h.send(sid, 'title_res', r.ok ? { ok: true, title: r.title } : { ok: false, reason: r.reason });
      return; // a troca chega à entidade pelo onTitleChange (todas as sessões da conta)
    }
    const v = validateTitle(this.h.progression().titlesOf(sid) ?? [], raw);
    if (!v.ok) { this.h.send(sid, 'title_res', { ok: false, reason: v.reason }); return; }
    p.title = v.title ?? '';
    this.h.send(sid, 'title_res', { ok: true, title: v.title });
  }

  leave(sid: string) { this.last.delete(sid); }
  dispose() { this.off(); }
}
