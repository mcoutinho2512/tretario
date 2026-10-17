// testes de integração com PostgreSQL real (npm run test:db → server/tools/test-db.ts). Fora do `npm run verify`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.dbtest.ts'], testTimeout: 30_000, hookTimeout: 30_000, fileParallelism: false },
});
