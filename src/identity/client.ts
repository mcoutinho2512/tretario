/**
 * Cliente da API de contas/perfil (rodada 8) — mesma origem (/api, proxy do Vite em dev). A sessão vive num cookie
 * HttpOnly: nenhum token passa pelo JavaScript nem pelo localStorage. Rotas em `API` (src/identity/types.ts).
 * Erros viram mensagens curtas em português (`errorText`).
 */
import { API, type MeResponse, type PlayerPreferences, type PublicMetrics } from './types';
import type { CharacterAppearance } from '../characters/bodyTypes';
import type { CurrentEventResponse } from '../events/groups';

export interface ApiResult<T> { ok: boolean; status: number; data: T | null; error: string | null }

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<ApiResult<T>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(path, {
      method, credentials: 'same-origin', signal: ctl.signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data: any = null;
    try { data = await r.json(); } catch { /* sem corpo */ }
    return { ok: r.ok, status: r.status, data: r.ok ? data : null, error: r.ok ? null : (typeof data?.error === 'string' ? data.error : `http_${r.status}`) };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error)?.name === 'AbortError' ? 'tempo_esgotado' : 'sem_conexao' };
  } finally {
    clearTimeout(timer);
  }
}

export const accountApi = {
  me: () => call<MeResponse>('GET', API.me),
  register: (email: string, password: string, nickname: string) => call<unknown>('POST', API.register, { email, password, nickname }),
  verifyEmail: (email: string, code: string) => call<unknown>('POST', API.verifyEmail, { email, code }),
  resendCode: (email: string) => call<unknown>('POST', API.resendCode, { email }),
  login: (email: string, password: string) => call<unknown>('POST', API.login, { email, password }),
  logout: () => call<unknown>('POST', API.logout, {}),
  forgot: (email: string) => call<unknown>('POST', API.forgot, { email }),
  reset: (email: string, code: string, password: string) => call<unknown>('POST', API.reset, { email, code, password }),
  nicknameAvailable: (nickname: string) => call<{ available: boolean; reason?: string }>('GET', `${API.nicknameAvailable}?nickname=${encodeURIComponent(nickname)}`),
  getAppearance: () => call<{ appearance: CharacterAppearance | null }>('GET', API.appearance),
  putAppearance: (appearance: CharacterAppearance) => call<{ appearance: CharacterAppearance }>('PUT', API.appearance, { appearance }),
  putPreferences: (preferences: PlayerPreferences) => call<{ preferences: PlayerPreferences }>('PUT', API.preferences, { preferences }),
  currentEvent: () => call<CurrentEventResponse>('GET', API.event),
  setMembership: (groupKey: string) => call<{ membership: { eventId: string; groupKey: string } }>('PUT', API.membership, { groupKey }),
  clearMembership: () => call<unknown>('DELETE', API.membership),
  joinTicket: (role: 'player' | 'spectator' = 'player') => call<{ ticket: string }>('POST', API.joinTicket, { role }),
  metrics: () => call<PublicMetrics>('GET', API.metrics, undefined, 4000),
};

/** mensagens de erro (códigos da API → texto para a pessoa) */
const ERRORS: Record<string, string> = {
  sem_conexao: 'Sem conexão com o servidor. Tente de novo em instantes.',
  tempo_esgotado: 'O servidor demorou para responder. Tente de novo.',
  sem_sessao: 'Sua sessão terminou. Entre de novo.',
  sem_permissao: 'Sua conta não pode fazer isso agora.',
  muitas_alteracoes: 'Muitas alterações seguidas. Aguarde um minuto.',
  muitas_tentativas: 'Muitas tentativas. Aguarde alguns minutos.',
  credenciais_invalidas: 'E-mail ou senha incorretos.',
  email_invalido: 'Informe um e-mail válido.',
  email_em_uso: 'Este e-mail já tem conta. Use ENTRAR ou ESQUECI MINHA SENHA.',
  email_nao_verificado: 'Confirme seu e-mail com o código enviado antes de entrar.',
  senha_fraca: 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.',
  senha_curta: 'A senha precisa ter pelo menos 8 caracteres.',
  apelido_em_uso: 'Este apelido já está em uso.',
  apelido_reservado: 'Este apelido é reservado. Escolha outro.',
  apelido_invalido: 'Apelido inválido: 3 a 20 letras, números, ponto, hífen ou sublinhado.',
  codigo_invalido: 'Código incorreto. Confira os 6 dígitos.',
  codigo_expirado: 'Código expirado. Peça um novo.',
  conta_suspensa: 'Conta suspensa no momento.',
  conta_banida: 'Esta conta não pode entrar.',
  aparencia_invalida: 'Visual inválido. Tente outra combinação.',
  grupo_invalido: 'Grupo indisponível neste evento.',
  perfil_inexistente: 'Perfil ainda não criado.',
};
export function errorText(code: string | null | undefined): string {
  if (!code) return 'Algo deu errado. Tente de novo.';
  return ERRORS[code] ?? (code.startsWith('http_5') ? 'Erro no servidor. Tente de novo.' : 'Não foi possível concluir. Tente de novo.');
}
