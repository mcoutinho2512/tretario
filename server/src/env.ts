/**
 * Carrega server/.env (DATABASE_URL, PV_SESSION_SECRET…) — importado PRIMEIRO por server/src/index.ts, pois vários
 * módulos leem process.env ao serem carregados. Variáveis já definidas no ambiente têm precedência (não sobrescreve).
 */
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
