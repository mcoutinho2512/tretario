/**
 * Roteador HTTP mínimo da API (/api/*) — no MESMO servidor HTTP do Colyseus (mesma porta). Sem framework: rotas
 * registradas por módulos (auth, perfil, eventos, métricas…) com `router.add(método, caminho, handler)`.
 * Corpo JSON limitado; cookies lidos aqui; respostas sempre JSON com `Cache-Control: no-store`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ApiRequest {
  method: string;
  path: string;
  /** parâmetros de caminho (":nick") */
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  cookies: Record<string, string>;
  headers: IncomingMessage['headers'];
  /** endereço do cliente — SÓ para limitação de taxa em memória; nunca gravado em claro (ver PRIVACY_ARCHITECTURE) */
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
    if (!url.pathname.startsWith('/api/')) return false;
    const m = this.match(req.method ?? 'GET', url.pathname);
    const send = (status: number, body: unknown, cookies: string[] = []) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
      res.end(JSON.stringify(body ?? {}));
    };
    if (!m) { send(404, { error: 'nao_encontrado' }); return true; }
    let raw = '';
    try {
      for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) { send(413, { error: 'grande_demais' }); return true; } }
    } catch { send(400, { error: 'corpo_invalido' }); return true; }
    let body: unknown = {};
    if (raw) { try { body = JSON.parse(raw); } catch { send(400, { error: 'json_invalido' }); return true; } }
    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    try {
      const out = await m.r.handler({
        method: req.method ?? 'GET', path: url.pathname, params: m.params, query: url.searchParams, body,
        cookies: parseCookies(req.headers.cookie), headers: req.headers, ip: fwd || req.socket.remoteAddress || '',
      });
      send(out.status ?? 200, out.body, out.cookies);
    } catch (e) {
      console.error('[api] erro', req.method, url.pathname, e);
      send(500, { error: 'erro_interno' });
    }
    return true;
  }
}

/** rotas da aplicação: cada módulo registra as suas (server/src/http/*.ts) */
export const router = new Router();
