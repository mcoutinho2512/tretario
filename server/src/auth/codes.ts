/**
 * Códigos de uso único por e-mail (rodada 8): 6 dígitos, 15 min, no máximo 5 tentativas por código; vale só o mais
 * recente de cada finalidade. O banco guarda HMAC(segredo do servidor, finalidade:usuário:código): com só 10^6
 * códigos possíveis, um SHA-256 puro seria revertido por força bruta se a tabela vazasse.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { CodePurpose, DataStore } from '../data/types';

export const CODE_TTL_MS = 15 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;

export type CodeCheck = 'ok' | 'invalido' | 'expirado';

export class CodeService {
  constructor(private store: DataStore, private secret: string, private now: () => number = Date.now) {}

  private hash(userId: string, purpose: CodePurpose, code: string) {
    return createHmac('sha256', this.secret).update(`${purpose}:${userId}:${code}`).digest('hex');
  }

  /** gera e grava (hash) um código novo; devolve o código em claro SÓ para o e-mail */
  async issue(userId: string, purpose: CodePurpose): Promise<string> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.store.codes.create({ userId, purpose, codeHash: this.hash(userId, purpose, code), expiresAt: new Date(this.now() + CODE_TTL_MS) });
    return code;
  }

  async check(userId: string, purpose: CodePurpose, code: unknown): Promise<CodeCheck> {
    const rec = await this.store.codes.latest(userId, purpose);
    if (!rec || rec.consumedAt || +rec.expiresAt <= this.now() || rec.attempts >= CODE_MAX_ATTEMPTS) return 'expirado';
    await this.store.codes.attempt(rec.id);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return 'invalido';
    const a = Buffer.from(this.hash(userId, purpose, code.trim()), 'hex'), b = Buffer.from(rec.codeHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return 'invalido';
    await this.store.codes.consume(rec.id);
    return 'ok';
  }
}
