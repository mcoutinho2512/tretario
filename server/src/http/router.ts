/**
 * Roteador HTTP mínimo da API (/api/*) — no MESMO servidor HTTP do Colyseus (mesma porta). Sem framework: rotas
 * registradas por módulos (auth, perfil, eventos, métricas…) com `router.add(método, caminho, handler)`.
 * Corpo JSON limitado; cookies lidos aqui; respostas sempre JSON com `Cache-Control: no-store`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientIp, originAllowed, publicOrigin } from './clientIp';
import { log } from '../log';

export interface ApiRequest {
  method: string;
  path: string;
  /** parâmetros de caminho (":nick") */
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  cookies: Record<string, string>;
  headers: IncomingMessage['headers'];
  /** endereço do cliente — SÓ para limitação de taxa em memória; nunca gravado em claro (ver PRIVACY_ARCHITECTURE).
   *  Cabeçalhos do proxy só com PV_TRUST_PROXY=loopback e conexão de 127.0.0.1 (server/src/http/clientIp.ts) */
  ip: string;
}

export interface ApiResponse {
  status?: number;
  body?: unknown;
  /** Set-Cookie já formatados */
  cookies?: string[];
}

export type Handler = (req: ApiRequest) => Promise<ApiResponse> | ApiResponse;

const MAX_BODY = 32 * 1024;
/** prefixos tratados aqui (rodada 9.1: health e o diagnóstico interno também; o Nginx nega /internal/ e /metrics) */
const PREFIXES = ['/api/', '/health/', '/internal/'];

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Set-Cookie seguro: HttpOnly sempre; Secure fora de desenvolvimento; SameSite=Lax */
export function cookie(name: string, value: string, maxAgeS: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeS))}${secure}`;
}

export class Router {
  private routes: { method: string; parts: string[]; handler: Handler }[] = [];

  add(method: string, path: string, handler: Handler) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
  }

  private match(method: string, path: string) {
    const parts = path.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      if (r.parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) return { r, params };
    }
    return null;
  }

  /** trata a requisição se for da API; devolve false para deixar outro tratador seguir */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!PREFIXES.some((p) => url.pathname.startsWith(p))) return false;
    const method = req.method ?? 'GET';
    const m = this.match(method, url.pathname);
    // CORS: nunca `*`; só a origem pública (e a mesma origem pelo Nginx/Vite nem precisa) — credenciais só para ela
    const origin = req.headers.origin, allowed = publicOrigin();
    const cors = allowed && origin === allowed ? { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {};
    const send = (status: number, body: unknown, cookies: string[] = []) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
      res.end(JSON.stringify(body ?? {}));
    };
    if (!m) { send(404, { error: 'nao_encontrado' }); return true; }
    // CSRF (cookie de sessão): rota que muda estado vinda de outra origem → 403 antes de ler o corpo
    if (!originAllowed(method, req.headers)) { log.rate(`origem:/${m.r.parts.join('/')}`); send(403, { error: 'origem_invalida' }); return true; }
    let raw = '';
    try {
      for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) { send(413, { error: 'grande_demais' }); return true; } }
    } catch { send(400, { error: 'corpo_invalido' }); return true; }
    let body: unknown = {};
    if (raw) { try { body = JSON.parse(raw); } catch { send(400, { error: 'json_invalido' }); return true; } }
    try {
      const out = await m.r.handler({
        method: req.method ?? 'GET', path: url.pathname, params: m.params, query: url.searchParams, body,
        cookies: parseCookies(req.headers.cookie), headers: req.headers, ip: clientIp(req.headers, req.socket.remoteAddress),
      });
      send(out.status ?? 200, out.body, out.cookies);
    } catch (e) {
      log.error('error', 'erro na API', { route: `/${m.r.parts.join('/')}`, method, err: e as Error, ...(log.json ? { stack: (e as Error)?.stack?.split('\n').slice(1, 6).join(' | ') } : {}) });
      if (!log.json) console.error(e); // desenvolvimento: pilha completa
      send(500, { error: 'erro_interno' });
    }
    return true;
  }
}

/** rotas da aplicação: cada módulo registra as suas (server/src/http/*.ts) */
export const router = new Router();
