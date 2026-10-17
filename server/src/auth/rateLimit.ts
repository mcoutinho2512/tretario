/**
 * Limitação de taxa EM MEMÓRIA (rodada 8): nada vai para o banco — em especial o IP, que só entra aqui como HMAC
 * com uma chave aleatória do processo (some ao reiniciar; nunca é gravado). Ver docs/PRIVACY_ARCHITECTURE.md.
 *
 *  - Backoff: falhas consecutivas além de `free` bloqueiam a chave por base·2^(n−free), até `maxMs`. Sucesso zera.
 *  - Janela: no máximo `max` eventos por `windowMs` (reenvio de código, esqueci a senha, cadastro…).
 */
import { createHmac, randomBytes } from 'node:crypto';

const PROCESS_KEY = randomBytes(32);

/** identificador opaco do IP (só memória, só para limitar taxa) */
export function ipKey(ip: string): string {
  return createHmac('sha256', PROCESS_KEY).update(ip || 'desconhecido').digest('base64url').slice(0, 22);
}

export class Backoff {
  private m = new Map<string, { fails: number; until: number; last: number }>();
  constructor(private o: { free: number; baseMs: number; maxMs: number; forgetMs: number }) {}

  /** ms até poder tentar de novo (0 = liberado) */
  wait(key: string, now = Date.now()): number {
    const e = this.m.get(key);
    if (!e) return 0;
    if (now - e.last > this.o.forgetMs) { this.m.delete(key); return 0; }
    return Math.max(0, e.until - now);
  }

  fail(key: string, now = Date.now()) {
    this.sweep(now, false);
    const e = this.m.get(key) ?? { fails: 0, until: 0, last: now };
    e.fails++; e.last = now;
    if (e.fails > this.o.free) e.until = now + Math.min(this.o.maxMs, this.o.baseMs * 2 ** (e.fails - this.o.free - 1));
    this.m.set(key, e);
  }

  reset(key: string) { this.m.delete(key); }

  /** remove chaves esquecidas (CleanupService; `fail` também chama acima de 5000 chaves); devolve quantas */
  sweep(now = Date.now(), force = true): number {
    if (!force && this.m.size < 5000) return 0;
    let n = 0;
    for (const [k, e] of this.m) if (now - e.last > this.o.forgetMs) { this.m.delete(k); n++; }
    return n;
  }

  get size() { return this.m.size; }
}

export class Window {
  private m = new Map<string, number[]>();
  constructor(private o: { max: number; windowMs: number }) {}

  /** registra e diz se ainda cabe na janela */
  hit(key: string, now = Date.now()): boolean {
    if (this.m.size > 5000) this.sweep(now);
    const v = (this.m.get(key) ?? []).filter((t) => now - t < this.o.windowMs);
    if (v.length >= this.o.max) { this.m.set(key, v); return false; }
    v.push(now);
    this.m.set(key, v);
    return true;
  }

  /** remove chaves sem evento dentro da janela (CleanupService); devolve quantas */
  sweep(now = Date.now()): number {
    let n = 0;
    for (const [k, v] of this.m) if (!v.length || now - v[v.length - 1] >= this.o.windowMs) { this.m.delete(k); n++; }
    return n;
  }

  get size() { return this.m.size; }

  /** ms até a próxima vaga */
  retryIn(key: string, now = Date.now()): number {
    const v = this.m.get(key) ?? [];
    return v.length < this.o.max ? 0 : Math.max(0, v[0] + this.o.windowMs - now);
  }
}
