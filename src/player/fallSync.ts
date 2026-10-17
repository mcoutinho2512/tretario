/**
 * Quando um personagem (remoto ou o próprio) ENTRA na queda (rodada 9). Duas fontes, sem duplicar:
 *  - a mensagem `knock` (empurrão/impacto: traz direção, força e posição de repouso) — chega primeiro em geral;
 *  - a mudança de NetPlayer.status para DOWN/RAGDOLL (vale para quedas sem `knock`, p.ex. do sistema de confronto,
 *    ou quando a mensagem se perdeu/chegou antes da entidade entrar na área de interesse).
 * Regra: a primeira fonte dispara; a outra, dentro de `windowMs`, não reinicia a queda (o `knock` posterior só
 * corrige a direção/repouso). Uma queda nova exige ter voltado a OK/levantando antes. Puro (testável).
 */
import { STATUS } from '../net/rules';

export const FALL_DEDUP_MS = 1500;

export type FallDecision = 'start' | 'refine' | 'ignore';

const isDown = (st: number) => st === STATUS.DOWN || st === STATUS.RAGDOLL;

export class FallSync {
  private status: number = STATUS.OK;
  /** quando a queda atual começou (ms; -∞ = de pé) e por qual fonte */
  private startedAt = -Infinity;
  private by: 'knock' | 'status' | null = null;
  private knockAt = -Infinity;

  constructor(private windowMs = FALL_DEDUP_MS) {}

  /** chegou `knock` para este personagem */
  onKnock(now: number): FallDecision {
    this.knockAt = now;
    // a queda já começou pelo status há pouco: só refina (direção/força/repouso), não recomeça
    if (this.by === 'status' && now - this.startedAt < this.windowMs) { this.by = 'knock'; return 'refine'; }
    if (this.by === 'knock' && now - this.startedAt < this.windowMs) return 'ignore';
    this.startedAt = now; this.by = 'knock';
    return 'start';
  }

  /** NetPlayer.status mudou (ou chegou o primeiro valor) */
  onStatus(st: number, now: number): FallDecision {
    const prev = this.status;
    this.status = st;
    if (!isDown(st)) {
      // de pé de novo: a próxima queda é nova (o `knock` recente ainda vale enquanto a janela não passar)
      if (st === STATUS.OK) { this.by = null; this.startedAt = -Infinity; }
      return 'ignore';
    }
    if (isDown(prev)) return 'ignore'; // DOWN → RAGDOLL etc.: mesma queda
    if (now - this.knockAt < this.windowMs) return 'ignore'; // o `knock` já disparou esta queda
    this.startedAt = now; this.by = 'status';
    return 'start';
  }

  get current() { return this.status; }
}
