import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

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

export default defineConfig({
  plugins: [ezTreeNoTextures()],
  resolve: { alias: [{ find: /^@dgreenheck\/ez-tree$/, replacement: EZ_TREE_SRC }] },
  server: { port: 5173, host: true },
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
