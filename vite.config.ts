import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * ez-tree (gerador de árvores, MIT): usamos o código-fonte do pacote em vez do build publicado, que embute
 * ~4 MB de texturas em base64. O módulo de texturas é trocado por um stub (as texturas do jogo ficam em
 * public/vegetation/). Ver src/world/vegetationGen.ts.
 */
const EZ_TREE_SRC = fileURLToPath(new URL('./node_modules/@dgreenheck/ez-tree/src/lib/index.js', import.meta.url));
function ezTreeNoTextures(): Plugin {
  const STUB = '\0ez-tree-textures-stub';
  return {
    name: 'ez-tree-sem-texturas',
    enforce: 'pre',
    resolveId(source, importer) {
      if ((source === './textures' || source === './textures.js') && importer?.includes('ez-tree')) return STUB;
      return null;
    },
    load(id) {
      if (id === STUB) return 'export const getBarkTexture = () => null; export const getLeafTexture = () => null;';
      return null;
    },
  };
}

/**
 * Desenvolvimento apenas: o benchmark (?bench=1) envia o resultado para POST /__bench e ele é gravado em
 * screenshots/bench_results/ — assim testes em iPhone/notebook na rede local chegam ao repositório sem copiar à mão.
 */
function benchCollector(): Plugin {
  return {
    name: 'pv-bench-collector',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bench', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            mkdirSync('screenshots/bench_results', { recursive: true });
            const tag = String(data.aparelho ?? 'aparelho').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
            writeFileSync(`screenshots/bench_results/${Date.now()}_${tag}.json`, JSON.stringify({ ...data, ip: req.socket.remoteAddress }, null, 1));
            res.statusCode = 204;
          } catch { res.statusCode = 400; }
          res.end();
        });
      });
    },
  };
}

/**
 * Rodada 9.1 — build de produção sem endereço de desenvolvimento (npm run check:bundle): o SDK do Colyseus traz dois
 * valores-padrão INERTES no navegador (endpoint quando não há `window.location` e o hostname do construtor de URL do
 * Discord). O jogo sempre passa o endpoint (src/net/endpoint.ts); os literais são trocados por '' só no build.
 */
function colyseusNoDevDefaults(): Plugin {
  return {
    name: 'pv-colyseus-sem-padroes-de-dev',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('@colyseus/sdk')) return null;
      const out = code.replace(/"ws:\/\/127\.0\.0\.1:2567"/g, '""').replace(/\|\| "localhost"/g, '|| ""');
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [ezTreeNoTextures(), benchCollector(), colyseusNoDevDefaults()],
  resolve: { alias: [{ find: /^@dgreenheck\/ez-tree$/, replacement: EZ_TREE_SRC }] },
  // API da rodada 8 (contas/sessão): proxy para o servidor de jogo (porta da API = PORT + 1). Mesma origem → cookie
  // HttpOnly da sessão funciona sem CORS. PV_API = outro destino (testes de QA com servidor em outra porta).
  server: { port: 5173, host: true, proxy: { '/api': { target: process.env.PV_API ?? 'http://127.0.0.1:2568', changeOrigin: false } } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // three.js isolado: cache longo independente do código do jogo
        manualChunks: { three: ['three'] },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  // ez-tree é ESM sem extensões nos imports: precisa passar pelo pipeline do Vite também nos testes
  test: { environment: 'node', include: ['tests/**/*.test.ts'], server: { deps: { inline: [/ez-tree/] } } },
} as any);
