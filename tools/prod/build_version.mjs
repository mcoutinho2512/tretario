/**
 * `npm run build:version` (rodada 9.1) — grava `version.json` `{commit, buildTime}` na raiz (o release do deploy;
 * deploy/CONTRACT.md). O servidor lê em server/src/buildInfo.ts (/api/status, /internal/health). Sem segredo nenhum.
 * Commit: PV_BUILD_COMMIT ou `git rev-parse HEAD`; árvore suja → recusa (build de produção é de um commit exato),
 * exceto com --allow-dirty (desenvolvimento).
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (c) => execSync(`git ${c}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
let commit = process.env.PV_BUILD_COMMIT ?? '';
if (!commit) {
  try { commit = git('rev-parse HEAD'); } catch { console.error('[build:version] sem git e sem PV_BUILD_COMMIT'); process.exit(1); }
  let dirty = '';
  try { dirty = git('status --porcelain --untracked-files=no'); } catch { /* */ }
  if (dirty && !process.argv.includes('--allow-dirty')) { console.error('[build:version] árvore com alterações não commitadas — recusado (use --allow-dirty só em desenvolvimento)'); process.exit(1); }
}
if (!/^[0-9a-f]{7,40}$/i.test(commit)) { console.error(`[build:version] commit inválido: ${commit}`); process.exit(1); }
const out = { commit, buildTime: new Date().toISOString() };
writeFileSync(`${root}version.json`, `${JSON.stringify(out)}\n`);
console.log(`[build:version] version.json ${out.commit.slice(0, 7)} ${out.buildTime}`);
