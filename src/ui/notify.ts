/**
 * Rodada 11 — CONTRATO: feedback curto de AÇÃO BLOQUEADA ("Sem fôlego", "Mãos ocupadas", "Inventário cheio").
 * Um toast de ~1,8 s no canal de avisos do HUD (alto ao centro, abaixo do indicador de zona), sem modal, sem roubar o
 * foco nem soltar o mouse. Qualquer sistema chama `notifyBlocked(texto)`; o HudShell é quem desenha (`setBlockedSink`).
 * A mesma frase repetida em menos de 1,5 s é ignorada (tecla segurada / clique repetido não empilha).
 */
type Sink = (text: string) => void;

let sink: Sink | null = null;
let pending: string | null = null;
let lastText = '';
let lastAt = -Infinity;
const DEDUPE_MS = 1500;

/** avisa que a ação foi recusada — texto curto, sem ponto final de preferência */
export function notifyBlocked(text: string, now = typeof performance !== 'undefined' ? performance.now() : Date.now()): boolean {
  const t = String(text ?? '').trim().slice(0, 120);
  if (!t) return false;
  if (t === lastText && now - lastAt < DEDUPE_MS) return false;
  lastText = t; lastAt = now;
  if (sink) sink(t); else pending = t; // antes do HUD montar: guarda só o último
  return true;
}

/** o HUD registra quem desenha o toast (null ao desmontar) */
export function setBlockedSink(fn: Sink | null) {
  sink = fn;
  if (fn && pending) { const p = pending; pending = null; fn(p); }
}

/** testes */
export function _resetNotify() { sink = null; pending = null; lastText = ''; lastAt = -Infinity; }
