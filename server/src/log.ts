/**
 * Logs (rodada 9.1). PV_LOG_FORMAT=json → uma linha JSON por evento (journald/jq): `{t, level, evt, msg?, ...campos}`.
 * Sem isso, saída legível de desenvolvimento (`[evt] msg {campos}`), como antes. Sem dependência.
 *
 * NUNCA registrar senha, token, cookie, código (OTP), ticket nem e-mail: campos com esses nomes são DESCARTADOS e
 * qualquer coisa com cara de e-mail dentro de texto vira `[email]`. Ids: só o id CURTO da conexão (sessionId).
 * Eventos (`evt`): startup · shutdown · error · auth.suspicious · ratelimit · ws.join/ws.leave · migration · cleanup ·
 * backup · event.* · health.degraded — tabela em docs/SECURITY_PRODUCTION.md.
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

/** nomes de campo proibidos (exatos) e trechos proibidos dentro do nome */
const DROP_EXACT = new Set(['code', 'codigo', 'otp', 'ip', 'ticket', 'authorization', 'userid', 'user', 'nickname']);
const DROP_PART = ['pass', 'senha', 'token', 'secret', 'cookie', 'email', 'otp'];
const EMAIL_RE = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;

const jsonMode = () => process.env.PV_LOG_FORMAT === 'json';

function cleanStr(s: string): string { return (s.length > 500 ? `${s.slice(0, 500)}…` : s).replace(EMAIL_RE, '[email]'); }

/** campos seguros para log (pura; testada em tests/logger.test.ts) */
export function scrub(f: LogFields | undefined): LogFields {
  const out: LogFields = {};
  if (!f) return out;
  for (const [k, v] of Object.entries(f)) {
    const lk = k.toLowerCase();
    if (DROP_EXACT.has(lk) || DROP_PART.some((p) => lk.includes(p))) continue;
    if (v instanceof Error) out[k] = cleanStr(v.message);
    else if (typeof v === 'string') out[k] = cleanStr(v);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (v !== undefined) { try { out[k] = JSON.parse(cleanStr(JSON.stringify(v) ?? 'null')); } catch { /* descarta */ } }
  }
  return out;
}

/** linha JSON (exportada para os testes) */
export function formatJson(level: LogLevel, evt: string, msg: string | undefined, f?: LogFields): string {
  return JSON.stringify({ t: new Date().toISOString(), level, evt, ...(msg ? { msg: cleanStr(msg) } : {}), ...scrub(f) });
}

function emit(level: LogLevel, evt: string, msg?: string, f?: LogFields) {
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (jsonMode()) { sink(formatJson(level, evt, msg, f)); return; }
  const s = scrub(f);
  sink(`[${evt}]${msg ? ` ${msg}` : ''}${Object.keys(s).length ? ` ${JSON.stringify(s)}` : ''}`);
}

/** limites de taxa atingidos: UMA linha por rota a cada 60 s com a contagem (não inunda o journald num ataque) */
const rateHits = new Map<string, { n: number; since: number }>();
function rateHit(route: string, now = Date.now()) {
  const e = rateHits.get(route);
  if (!e) { rateHits.set(route, { n: 0, since: now }); emit('warn', 'ratelimit', undefined, { route, hits: 1 }); return; }
  e.n++;
  if (now - e.since >= 60_000) { emit('warn', 'ratelimit', undefined, { route, hits: e.n, windowS: Math.round((now - e.since) / 1000) }); e.n = 0; e.since = now; }
}

export const log = {
  info: (evt: string, msg?: string, f?: LogFields) => emit('info', evt, msg, f),
  warn: (evt: string, msg?: string, f?: LogFields) => emit('warn', evt, msg, f),
  error: (evt: string, msg?: string, f?: LogFields) => emit('error', evt, msg, f),
  /** conversa de jogo (entrou no carro, queda, empurrão…): só na saída de DESENVOLVIMENTO; nunca no JSON de produção */
  debug: (line: string) => { if (!jsonMode() && process.env.PV_LOG_QUIET !== '1') console.log(line); },
  /** limite de taxa atingido (agregado por rota) */
  rate: rateHit,
  get json() { return jsonMode(); },
};
