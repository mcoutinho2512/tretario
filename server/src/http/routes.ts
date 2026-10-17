/** registro das rotas da API (cada módulo adiciona as suas ao `router`). Importado uma vez por server/src/index.ts. */
import { router } from './router.ts';

router.add('GET', '/api/health', () => ({ body: { ok: true } }));
