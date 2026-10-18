/**
 * Travas de PRODUÇÃO (rodada 9.1, deploy/CONTRACT.md). Com NODE_ENV=production o servidor RECUSA subir se:
 *  - houver chave de teste/desenvolvimento: PV_TEST, PV_ALLOW_ANON_PLAYERS, PV_DEV_MAIL (qualquer valor), PV_STORE=memory;
 *  - PV_SESSION_SECRET ou PV_ADMIN_TOKEN tiverem < 32 caracteres, forem o valor de desenvolvimento ou repetitivos;
 *  - faltar DATABASE_URL, PV_PUBLIC_ORIGIN (origem exata, sem barra) ou PV_REGISTRATION=beta (não há SMTP: `open`/`dev`
 *    dependem do provedor de e-mail de desenvolvimento, que recusa produção).
 * Avisos (sobe, mas registra): PV_TRUST_PROXY ≠ loopback, PV_GRAFFITI_STORE=memory, origem http://.
 * Pura (recebe o env): testada em tests/prodGuard.test.ts.
 */
export interface GuardResult { errors: string[]; warnings: string[] }

const isSet = (v: string | undefined) => v !== undefined && v !== '';

/** segredo forte: ≥ 32 caracteres, não é o de desenvolvimento, não é um caractere repetido/sequência trivial */
export function weakSecret(s: string | undefined): string | null {
  if (!s) return 'ausente';
  if (s.length < 32) return 'curto (< 32 caracteres)';
  if (/^dev-only|change-?me|example|exemplo|secret|senha|password/i.test(s)) return 'valor de desenvolvimento/exemplo';
  if (new Set(s).size < 8) return 'pouca variedade de caracteres';
  return null;
}

export function productionProblems(env: NodeJS.ProcessEnv = process.env): GuardResult {
  const errors: string[] = [], warnings: string[] = [];
  if (env.NODE_ENV !== 'production') return { errors, warnings };
  for (const k of ['PV_TEST', 'PV_ALLOW_ANON_PLAYERS', 'PV_DEV_MAIL'] as const) if (isSet(env[k])) errors.push(`${k} é proibido em produção`);
  if (env.PV_STORE === 'memory') errors.push('PV_STORE=memory é proibido em produção (dados reais vão para o PostgreSQL)');
  for (const k of ['PV_SESSION_SECRET', 'PV_ADMIN_TOKEN'] as const) { const w = weakSecret(env[k]); if (w) errors.push(`${k} ${w}`); }
  if (isSet(env.PV_SESSION_SECRET) && env.PV_SESSION_SECRET === env.PV_ADMIN_TOKEN) errors.push('PV_SESSION_SECRET e PV_ADMIN_TOKEN devem ser diferentes');
  if (!isSet(env.DATABASE_URL)) errors.push('DATABASE_URL ausente');
  const o = env.PV_PUBLIC_ORIGIN ?? '';
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o)) errors.push('PV_PUBLIC_ORIGIN ausente ou inválido (ex.: https://exemplo.com.br, sem barra no fim)');
  else if (o.startsWith('http://')) warnings.push('PV_PUBLIC_ORIGIN em http:// — cookies Secure exigem HTTPS');
  if (env.PV_REGISTRATION !== 'beta') errors.push('PV_REGISTRATION=beta obrigatório em produção (sem provedor de e-mail real)');
  if (env.PV_TRUST_PROXY !== 'loopback') warnings.push('PV_TRUST_PROXY≠loopback: atrás do Nginx todo mundo vira 127.0.0.1 nos limites de taxa');
  if (env.PV_GRAFFITI_STORE === 'memory') warnings.push('PV_GRAFFITI_STORE=memory: grafites somem a cada reinício');
  return { errors, warnings };
}
