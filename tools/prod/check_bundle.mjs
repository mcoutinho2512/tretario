/**
 * `npm run check:bundle` (rodada 9.1) — confere o build de produção (`dist/`, gere com `npm run build`) ANTES do deploy:
 *  - nada de endereço de desenvolvimento: localhost, 127.0.0.1, 0.0.0.0, :2567/:2568 (o jogo é `wss://<host>/game`)
 *  - nada de segredo: nomes/valores de PV_SESSION_SECRET, PV_ADMIN_TOKEN, DATABASE_URL (inclusive os VALORES atuais do
 *    ambiente e de server/.env, se existirem), `postgresql://`, chave privada, o segredo de desenvolvimento
 *  - nada de rota/ajuda de desenvolvimento (`/api/dev/outbox`)
 *  - sem source maps (`.map` nem `sourceMappingURL`); /assets com hash no nome (cache longo no Nginx)
 *  - index.html com `noindex,nofollow` e robots.txt `Disallow: /` (beta)
 * Sai com 1 e lista os achados se algo falhar. `--dir=<pasta>` confere outra pasta.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const dist = dirArg ? dirArg.slice(6) : join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) { console.error(`[check:bundle] ${dist}/index.html não existe — rode \`npm run build\` antes`); process.exit(1); }

const TEXT = /\.(js|mjs|css|html|json|txt|svg|webmanifest)$/i;
const files = [];
(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } })(dist);

// valores reais de segredo (ambiente e server/.env) — só para PROCURAR; nunca impressos
const secretValues = new Set();
const addSecret = (v) => { if (typeof v === 'string' && v.length >= 12) secretValues.add(v); };
for (const k of ['PV_SESSION_SECRET', 'PV_ADMIN_TOKEN', 'DATABASE_URL', 'DATABASE_URL_TEST']) addSecret(process.env[k]);
try {
  for (const line of readFileSync(join(root, 'server/.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(PV_SESSION_SECRET|PV_ADMIN_TOKEN|DATABASE_URL(?:_TEST)?)\s*=\s*"?([^"\n]*)"?/);
    if (m) { addSecret(m[2]); const pw = m[2].match(/:\/\/[^:]+:([^@]+)@/); if (pw) addSecret(pw[1].length >= 6 ? pw[1] : ''); }
  }
} catch { /* sem server/.env */ }

const RULES = [
  [/\blocalhost\b/i, 'endereço de desenvolvimento (localhost)'],
  [/\b127\.0\.0\.1\b/, 'endereço de desenvolvimento (127.0.0.1)'],
  [/\b0\.0\.0\.0\b/, 'endereço 0.0.0.0'],
  [/:256[78]\b/, 'porta de desenvolvimento (:2567/:2568)'],
  [/PV_SESSION_SECRET|PV_ADMIN_TOKEN|DATABASE_URL/, 'nome de variável secreta do servidor'],
  [/postgres(ql)?:\/\//i, 'URL de banco'],
  [/dev-only-change-me/, 'segredo de desenvolvimento'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/\/api\/dev\/outbox/, 'rota de desenvolvimento (/api/dev/outbox)'],
  [/sourceMappingURL=/, 'referência a source map'],
];

const problems = [];
let scanned = 0;
for (const f of files) {
  const rel = relative(dist, f);
  if (/\.map$/i.test(f)) { problems.push(`${rel}: source map publicado`); continue; }
  if (!TEXT.test(f)) continue;
  const s = readFileSync(f, 'utf8');
  scanned++;
  for (const [re, what] of RULES) { const m = s.match(re); if (m) { const i = m.index ?? 0; problems.push(`${rel}: ${what} — …${s.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ')}…`); } }
  for (const v of secretValues) if (s.includes(v)) problems.push(`${rel}: VALOR de segredo do ambiente/server/.env presente`);
}
const assets = existsSync(join(dist, 'assets')) ? readdirSync(join(dist, 'assets')) : [];
const unhashed = assets.filter((n) => /\.(js|css)$/.test(n) && !/-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(n));
if (!assets.length) problems.push('dist/assets vazio');
for (const n of unhashed) problems.push(`assets/${n}: sem hash no nome (cache longo quebraria atualizações)`);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (!/<meta name="robots" content="noindex,nofollow"/.test(html)) problems.push('index.html sem <meta name="robots" content="noindex,nofollow"> (beta)');
const robots = existsSync(join(dist, 'robots.txt')) ? readFileSync(join(dist, 'robots.txt'), 'utf8') : '';
if (!/User-agent: \*\s*\nDisallow: \/\s*$/m.test(robots)) problems.push('robots.txt ausente ou sem "Disallow: /" (beta)');

if (problems.length) {
  console.error(`[check:bundle] ${problems.length} problema(s) em ${dist}:`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`[check:bundle] ok — ${files.length} arquivos (${scanned} de texto), ${assets.length} em assets/ com hash, ${secretValues.size} valor(es) de segredo procurado(s), sem source map, noindex + robots.txt`);
