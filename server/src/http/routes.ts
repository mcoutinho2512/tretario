/** registro das rotas da API (cada módulo adiciona as suas ao `router`). Importado uma vez por server/src/index.ts. */
import { router } from './router.ts';

router.add('GET', '/api/health', () => ({ body: { ok: true } }));

import '../auth/routes.ts'; // contas, sessão, ticket de entrada (docs/AUTH.md)
import '../profile/appearanceMinimal.ts'; // PUT /api/me/appearance mínimo (o módulo de perfil pode substituir)
