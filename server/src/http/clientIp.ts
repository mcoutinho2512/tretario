/**
 * IP do cliente e Origin (rodada 9.1) — SÓ para limitar taxa em memória (nunca gravado; ver PRIVACY_ARCHITECTURE).
 *
 * PV_TRUST_PROXY=loopback: os cabeçalhos do proxy (X-Real-IP, depois o ÚLTIMO item de X-Forwarded-For — o que o
 * Nginx acrescentou; os anteriores vêm do cliente e são forjáveis) só valem quando a conexão vem de 127.0.0.1/::1.
 * Sem a variável (padrão): sempre o endereço do socket — `X-Forwarded-For` de qualquer um é ignorado.
 */
import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(addr: string | undefined): boolean { return !!addr && LOOPBACK.has(addr); }

const clean = (s: string | undefined) => (s ?? '').trim().replace(/^\[|\]$/g, '').slice(0, 64);

export function clientIp(headers: IncomingHttpHeaders, socketAddr: string | undefined, trust: string | undefined = process.env.PV_TRUST_PROXY): string {
  const peer = socketAddr ?? '';
  if (trust !== 'loopback' || !isLoopback(peer)) return peer;
  const real = clean(headers['x-real-ip'] as string | undefined);
  if (real) return real;
  const xff = (headers['x-forwarded-for'] as string | undefined)?.split(',').map((s) => clean(s)).filter(Boolean);
  return xff?.length ? xff[xff.length - 1] : peer;
}

/** origem pública permitida (CORS/Origin); '' = não configurada (desenvolvimento: só mesma origem pelo proxy do Vite) */
export const publicOrigin = (): string => (process.env.PV_PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');

/**
 * defesa de CSRF para rotas que MUDAM estado (cookie de sessão): em produção, `Origin` presente tem de ser a origem
 * pública; sem Origin, `Sec-Fetch-Site` presente tem de ser same-origin/none. Sem os dois (curl, CLI) passa — não há
 * navegador para forjar. Fora de produção só confere quando PV_PUBLIC_ORIGIN está definido.
 */
export function originAllowed(method: string, headers: IncomingHttpHeaders, env: NodeJS.ProcessEnv = process.env): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const allowed = (env.PV_PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
  if (env.NODE_ENV !== 'production' && !allowed) return true;
  const origin = headers.origin as string | undefined;
  if (origin !== undefined) return !!allowed && origin === allowed;
  const sfs = headers['sec-fetch-site'] as string | undefined;
  if (sfs !== undefined) return sfs === 'same-origin' || sfs === 'none';
  return true;
}
