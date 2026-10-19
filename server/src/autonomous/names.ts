/**
 * Rodada 12 — APELIDOS dos personagens autônomos (docs/AUTONOMOUS_CHARACTERS.md § Nomes). Combinações variadas dos
 * pedaços de `names` (public/gameplay/autonomous.json): palavra, palavra+sufixo, palavra+número, minúsculas, sublinhado.
 * Regras anti-robô: nada de série (X01, X02…), nenhuma palavra base em excesso, nenhum número sequencial com a mesma
 * base, nenhum nome completo realista (só apelidos de 1 palavra + complemento). Todo apelido passa pela MESMA moderação
 * de apelido das contas (src/moderation/text.ts) e pela unicidade da chave normalizada.
 *
 * Reserva: as chaves em uso pelos autônomos ficam num registro do processo — o cadastro/troca de apelido de conta
 * consulta `autonomousNicknameTaken` (server/src/auth/service.ts) e os autônomos conferem o banco (`byNicknameKey`) e os
 * humanos presentes antes de aparecer. Assim um humano nunca é confundido com um autônomo (nem o contrário).
 */
import { textModeration } from '../../../src/moderation/text';
import type { AutonomousConfig } from './config';
import type { Rng } from './rng';

/** chaves (textModeration.nicknameKey) dos apelidos de autônomos vivos neste processo — todas as salas */
const reserved = new Map<string, number>();
export const autonomousNicknameTaken = (key: string) => (reserved.get(key) ?? 0) > 0;
export function reserveNickname(key: string) { reserved.set(key, (reserved.get(key) ?? 0) + 1); }
export function releaseNickname(key: string) { const n = (reserved.get(key) ?? 0) - 1; if (n > 0) reserved.set(key, n); else reserved.delete(key); }
export const nicknameKey = (n: string) => textModeration.nicknameKey(n);

/** padrões explicitamente robóticos (testes e a própria geração os rejeitam) */
export const ROBOTIC = /^(bot|npc|player|jogador|user|usuario|guest|visitante|cpu|ai|ia)[\s_.-]*\d*$/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class NameGenerator {
  private used = new Set<string>();
  private baseUse = new Map<string, number>();
  private numUse = new Map<string, Set<number>>();
  constructor(private cfg: AutonomousConfig['names'], private rng: Rng, private taken: (key: string) => boolean = () => false) {}

  /** um apelido novo (nunca repete na sessão, nunca colide com `taken`) */
  next(): string {
    for (let i = 0; i < 80; i++) {
      const c = this.candidate(i > 40);
      if (!c) continue;
      const v = textModeration.check(c.name, 'nickname');
      if (!v.ok || v.text !== c.name || ROBOTIC.test(c.name)) continue;
      const key = nicknameKey(c.name);
      if (this.used.has(key) || autonomousNicknameTaken(key) || this.taken(key)) continue;
      if (!this.okNumber(c.base, c.num) || (!(i > 40) && (this.baseUse.get(c.base) ?? 0) >= 3)) continue;
      this.used.add(key);
      this.baseUse.set(c.base, (this.baseUse.get(c.base) ?? 0) + 1);
      if (c.num !== null) { let s = this.numUse.get(c.base); if (!s) this.numUse.set(c.base, (s = new Set())); s.add(c.num); }
      return c.name;
    }
    // último recurso (lista de dados pequena demais): palavra + 3 dígitos aleatórios (nunca sequência)
    for (;;) {
      const w = this.rng.pick(this.cfg.words), n = this.rng.int(100, 989);
      const name = `${w}${n}`.slice(0, 20), key = nicknameKey(name);
      if (!this.used.has(key) && !autonomousNicknameTaken(key) && !this.taken(key) && textModeration.check(name, 'nickname').ok && this.okNumber(w.toLowerCase(), n)) {
        this.used.add(key);
        let s = this.numUse.get(w.toLowerCase()); if (!s) this.numUse.set(w.toLowerCase(), (s = new Set())); s.add(n);
        return name;
      }
    }
  }

  /** esquece um apelido (renomeado depois de conferir o banco) */
  forget(name: string) { this.used.delete(nicknameKey(name)); }

  /** número com a MESMA base nunca vizinho de um já usado (Lapa21, Lapa22 = série) */
  private okNumber(base: string, n: number | null) {
    if (n === null) return true;
    const s = this.numUse.get(base);
    if (!s) return true;
    for (const m of s) if (Math.abs(m - n) <= 1) return false;
    return true;
  }

  private candidate(relaxed: boolean): { name: string; base: string; num: number | null } | null {
    const { words, suffixWords, numbers } = this.cfg;
    const w = this.rng.pick(words);
    // nenhuma palavra base domina a população (limite cresce devagar se a lista for pequena)
    if (!relaxed && (this.baseUse.get(w.toLowerCase()) ?? 0) >= 3) return null;
    const r = this.rng.next();
    let name: string, num: number | null = null;
    if (r < 0.10) name = w; // só a palavra (raro: colide fácil)
    else if (r < 0.42 && suffixWords.length) {
      const s = this.rng.pick(suffixWords);
      if (s.toLowerCase() === w.toLowerCase()) return null;
      name = this.rng.chance(this.cfg.underscoreShare) ? `${w}_${s}` : `${w}${s}`;
      if (/^\d+$/.test(s)) num = Number(s); // sufixo numérico ("021") conta como número da base
    } else if (r < 0.80 && numbers.length) {
      const n = this.rng.pick(numbers);
      num = Number(n);
      name = this.rng.chance(this.cfg.underscoreShare) ? `${w}_${n}` : `${w}${n}`;
    } else if (r < 0.90) {
      // duas palavras curtas ("ChoppGelado"), sem formar nome e sobrenome
      const w2 = this.rng.pick(words);
      if (w2 === w || w.length + w2.length > 16) return null;
      name = `${w}${cap(w2.toLowerCase())}`;
    } else {
      // número livre de 2 dígitos (idade/camisa), nunca 00–09 em série
      num = this.rng.int(10, 99);
      name = `${w}${num}`;
    }
    if (this.rng.chance(this.cfg.lowercaseShare)) name = name.toLowerCase();
    return { name: name.slice(0, 20), base: w.toLowerCase(), num: Number.isFinite(num as number) ? num : null };
  }
}
