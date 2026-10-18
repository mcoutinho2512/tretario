/**
 * PROTEÇÃO DE RETORNO (rodada 9): quem acabou de entrar, reconectar, levantar ou voltar num ponto de retorno não sofre
 * impacto por alguns segundos — bit FX.PROTECTED em NetPlayer.fx (os clientes mostram um brilho sutil) e
 * `protectedUntil` para a política (src/combat/policy.ts CombatParty). Sem Colyseus.
 *
 * Duração: CombatTuning.protectMs de public/gameplay/combat.json (`tuning.protectMs`) quando existe; senão 4000 ms.
 * Quem chama: a sala (entrar/reconectar/retorno de evento) e o CombatSystem (depois de levantar).
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FX } from '../../../src/combat/types';
import { log } from '../log';

export const DEFAULT_PROTECT_MS = 4000;

const COMBAT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/gameplay/combat.json');

/** tuning.protectMs de um arquivo de confronto (ou o padrão) */
export function readProtectMs(file: string): number {
  try {
    if (!existsSync(file)) return DEFAULT_PROTECT_MS;
    const v = (JSON.parse(readFileSync(file, 'utf8')) as { tuning?: { protectMs?: unknown } }).tuning?.protectMs;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 60_000 ? v : DEFAULT_PROTECT_MS;
  } catch (e) { log.warn('error', 'combat.json ilegível, proteção padrão', { err: e as Error }); return DEFAULT_PROTECT_MS; }
}

/** public/gameplay/combat.json `tuning.protectMs` (lido uma vez) ou 4000 ms */
let cached: number | null = null;
export function protectMsFromData(): number { return (cached ??= readProtectMs(COMBAT_FILE)); }

/** quem carrega o bit (NetPlayer) */
export interface FxHolder { fx: number }
/** registro mínimo de proteção */
export interface Protectable extends FxHolder { protectedUntil: number }

/** liga a proteção por `ms` a partir de `now` (nunca encurta uma proteção maior em curso); devolve o fim (ms) */
export function applyProtection(p: Protectable, now: number, ms: number = protectMsFromData()): number {
  p.protectedUntil = Math.max(p.protectedUntil, now + Math.max(0, ms));
  if (p.protectedUntil > now) p.fx |= FX.PROTECTED;
  return p.protectedUntil;
}

/** venceu? desliga o bit (devolve true quando acabou de expirar) */
export function expireProtection(p: Protectable, now: number): boolean {
  if (!(p.fx & FX.PROTECTED) || now < p.protectedUntil) return false;
  p.fx &= ~FX.PROTECTED;
  return true;
}

/** proteção por conexão (sessionId) — a sala guarda um só destes */
export class ProtectionService {
  private until = new Map<string, number>();
  constructor(readonly ms = protectMsFromData()) {}

  /** liga para `sid`, escrevendo o bit em `p` (NetPlayer); devolve o fim (ms) */
  apply(sid: string, p: FxHolder, now: number, ms = this.ms): number {
    const rec: Protectable = { fx: p.fx, protectedUntil: this.until.get(sid) ?? 0 };
    const end = applyProtection(rec, now, ms);
    p.fx = rec.fx;
    this.until.set(sid, end);
    return end;
  }

  /** fim da proteção (0 = nenhuma) — CombatParty.protectedUntil */
  protectedUntil(sid: string): number { return this.until.get(sid) ?? 0; }
  isProtected(sid: string, now: number): boolean { return (this.until.get(sid) ?? 0) > now; }

  /** encerra já (golpe dado pelo protegido, saída) */
  clear(sid: string, p?: FxHolder) {
    this.until.delete(sid);
    if (p) p.fx &= ~FX.PROTECTED;
  }

  /** expiração (chamar no tick): desliga o bit de quem venceu; devolve quantos expiraram */
  tick(now: number, get: (sid: string) => FxHolder | undefined): number {
    let n = 0;
    for (const [sid, end] of this.until) {
      if (now < end) continue;
      this.until.delete(sid);
      const p = get(sid);
      if (p) { p.fx &= ~FX.PROTECTED; n++; }
    }
    return n;
  }

  get size() { return this.until.size; }
}
