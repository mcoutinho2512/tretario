/** registro das rotas da API (cada módulo adiciona as suas ao `router`). Importado uma vez por server/src/index.ts. */
import { router } from './router.ts';

router.add('GET', '/api/health', () => ({ body: { ok: true } }));

import '../auth/routes.ts'; // contas, sessão, ticket de entrada (docs/AUTH.md)
import './profile.ts'; // perfil, aparência, preferências, evento atual e grupo (rodada 8)
import './publicMetricsRoute.ts'; // GET /api/metrics/public (rodada 8 — presença/espectador)
import './progress.ts'; // GET /api/me/progress (rodada 9 — nível e itens liberados, só da própria conta)
import './supporter.ts'; // rodada 10 — GET/PUT /api/me/supporter (torcida da própria conta)
import './health.ts'; // rodada 9.1 — /health/live, /health/ready, /api/status, /internal/health (deploy/CONTRACT.md)
