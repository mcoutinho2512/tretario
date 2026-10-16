/**
 * Servidor estático de QA que imita a hospedagem de produção: serve dist/ seguindo public/_headers
 * (Cache-Control por padrão de caminho), ETag + 304, compressão gzip/brotli para tipos comprimíveis.
 * uso: node tools/qa/static_server.mjs [porta=4180] [pasta=dist]
 */
import http from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

const PORT = Number(process.argv[2] ?? 4180);
const ROOT = process.argv[3] ?? 'dist';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.bin', '.txt', '.svg', '.wasm']);

// regras do _headers: "/caminho/*" seguido de linhas "  Cabeçalho: valor"
const rules = [];
try {
  let cur = null;
  for (const line of readFileSync(join(ROOT, '_headers'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), headers: {} }; rules.push(cur); }
    else if (cur) { const i = line.indexOf(':'); cur.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
} catch { /* sem _headers */ }

const cache = new Map();
function load(file) {
  const st = statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const body = readFileSync(file);
  const ext = extname(file);
  const entry = { mtime: st.mtimeMs, body, etag: '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"', ext,
    br: COMPRESS.has(ext) ? zlib.brotliCompressSync(body) : null, gz: COMPRESS.has(ext) ? zlib.gzipSync(body, { level: 6 }) : null };
  cache.set(file, entry);
  return entry;
}

http.createServer((req, res) => {
  let path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const e = load(file);
  const headers = { 'Content-Type': TYPES[e.ext] ?? 'application/octet-stream', ETag: e.etag, Vary: 'Accept-Encoding', 'Cache-Control': 'public, max-age=0, must-revalidate' };
  for (const r of rules) if (r.re.test(path)) Object.assign(headers, r.headers);
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); res.end(); return; }
  const ae = String(req.headers['accept-encoding'] ?? '');
  let body = e.body;
  if (e.br && ae.includes('br')) { body = e.br; headers['Content-Encoding'] = 'br'; }
  else if (e.gz && ae.includes('gzip')) { body = e.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`[static] http://127.0.0.1:${PORT} (${ROOT}, ${rules.length} regras de cache)`));
