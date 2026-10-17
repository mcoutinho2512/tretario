/**
 * `npm run test:db` — testes de integração no PostgreSQL LOCAL (docker compose up -d db).
 * Usa um schema SÓ de teste (nunca `public`): DATABASE_URL_TEST de server/.env, ou DATABASE_URL com o schema
 * trocado por PV_TEST_DB_SCHEMA (padrão "test"). Recria o schema do zero, aplica as migrations e roda
 * server/test/*.dbtest.ts (contrato do DataStore + fluxo de conta).
 */
import 'dotenv/config';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { parseDatabaseUrl } from '../src/data/prisma.ts';

const base = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
if (!base) { console.error('[test:db] defina DATABASE_URL_TEST (ou DATABASE_URL) em server/.env'); process.exit(1); }
const u = new URL(base);
if (process.env.PV_TEST_DB_SCHEMA) u.searchParams.set('schema', process.env.PV_TEST_DB_SCHEMA);
if (!u.searchParams.get('schema')) u.searchParams.set('schema', 'test');
const url = u.toString();
const { connectionString, schema } = parseDatabaseUrl(url);
if (schema === 'public' || !/^[a-z_][a-z0-9_]*$/.test(schema)) { console.error(`[test:db] schema "${schema}" recusado (use um schema só de teste)`); process.exit(1); }

const c = new pg.Client({ connectionString });
try { await c.connect(); } catch (e) { console.error(`[test:db] PostgreSQL inacessível (${(e as Error).message}). Suba com: docker compose up -d db`); process.exit(1); }
await c.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
await c.query(`CREATE SCHEMA "${schema}"`);
await c.end();
console.log(`[test:db] schema "${schema}" recriado; aplicando migrations…`);

const env = { ...process.env, DATABASE_URL: url, PV_STORE: 'prisma' };
execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
execSync('npx vitest run --config vitest.db.config.ts', { stdio: 'inherit', env });
