/**
 * Versão do build (rodada 9.1): `version.json` `{commit, buildTime}` na raiz do release (gerado por
 * `npm run build:version` no deploy — deploy/CONTRACT.md) ou ao lado do servidor (server/version.json).
 * Sem arquivo: PV_BUILD_COMMIT / PV_BUILD_TIME; em desenvolvimento, `git rev-parse`. Lido UMA vez.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export interface BuildInfo { commit: string; buildTime: string | null; source: 'version.json' | 'env' | 'git' | 'none' }

let cached: BuildInfo | null = null;

export function buildInfo(): BuildInfo {
  if (cached) return cached;
  for (const rel of ['../../version.json', '../version.json']) {
    try {
      const j = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as { commit?: unknown; buildTime?: unknown };
      if (typeof j.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(j.commit)) return (cached = { commit: j.commit, buildTime: typeof j.buildTime === 'string' ? j.buildTime : null, source: 'version.json' });
    } catch { /* sem arquivo */ }
  }
  const env = process.env.PV_BUILD_COMMIT;
  if (env && /^[0-9a-f]{7,40}$/i.test(env)) return (cached = { commit: env, buildTime: process.env.PV_BUILD_TIME ?? null, source: 'env' });
  if (process.env.NODE_ENV !== 'production') {
    try {
      const c = execSync('git rev-parse HEAD', { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).toString().trim();
      if (/^[0-9a-f]{40}$/.test(c)) return (cached = { commit: c, buildTime: null, source: 'git' });
    } catch { /* sem git */ }
  }
  return (cached = { commit: 'desconhecido', buildTime: null, source: 'none' });
}

/** commit curto (/api/status) */
export const shortCommit = (): string => { const c = buildInfo().commit; return /^[0-9a-f]+$/i.test(c) ? c.slice(0, 7) : c; };
