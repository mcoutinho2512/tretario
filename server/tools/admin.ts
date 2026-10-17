/**
 * CLI do OPERADOR (rodada 8) — concessão de acesso e moderação, direto no banco (DATABASE_URL de server/.env).
 * Não existe botão no site para isso. Recusa rodar com NODE_ENV=production sem --operador-confirmado.
 * Toda ação grava AuditLog (+ ModerationAction quando é concessão/sanção). Ver docs/ACCESS_CONTROL.md.
 *
 *   npm run dev:grant-access -- <email> [--event=<id>] [--hours=N]
 *   npm run dev:revoke-access -- <email> [--event=<id>]
 *   npm run dev:suspend -- <email> --hours=N --reason="..."
 *   npm run dev:unsuspend -- <email>
 *   npm run dev:ban -- <email> --reason="..."
 *   npm run dev:unban -- <email>
 *   npm run dev:reports [-- --status=OPEN] [--limit=50]
 *   npm run dev:remove-graffiti -- <id> [--reason="..."]
 */
import 'dotenv/config';
import { userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { createPrismaStore } from '../src/data/prisma.ts';
import { AdminError, ban, grantAccess, listReports, recordGraffitiRemoval, revokeAccess, suspend, unban, unsuspend, type AdminCtx } from '../src/access/admin.ts';
import { JsonFileGraffitiStore } from '../src/graffiti/store.ts';
import { ROOM_NAME } from '../../src/net/protocol.ts';
import type { ReportStatus } from '../src/data/types.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a) => !a.startsWith('--'));
const flag = (k: string) => { const a = argv.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a === undefined ? undefined : a.includes('=') ? a.slice(a.indexOf('=') + 1) : 'true'; };

function die(msg: string): never { console.error(`[admin] ${msg}`); process.exit(1); }

if (process.env.NODE_ENV === 'production' && flag('operador-confirmado') !== 'true') {
  die('NODE_ENV=production: recusado. Use --operador-confirmado se você é o operador e sabe o que está fazendo.');
}
if (!process.env.DATABASE_URL || process.env.PV_STORE === 'memory') die('DATABASE_URL ausente (server/.env) — a CLI só atua no PostgreSQL');

const num = (k: string) => { const v = flag(k); if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n)) die(`--${k} inválido`); return n; };

/** remove na sala em execução (mensagem gf_admin com PV_ADMIN_TOKEN); null se o servidor não está no ar */
async function removeLive(id: number): Promise<boolean | null> {
  const port = Number(process.env.PORT ?? 2567);
  const client = new Client(`ws://127.0.0.1:${port}`);
  let room;
  try { room = await client.joinOrCreate(ROOM_NAME, { role: 'spectator', name: 'operador' }); } catch { return null; }
  try {
    const token = process.env.PV_ADMIN_TOKEN;
    if (!token) die('servidor no ar: defina o mesmo PV_ADMIN_TOKEN no servidor e na CLI para remover pela sala');
    const res = await new Promise<{ ok?: boolean; r?: string }>((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, r: 'sem_resposta' }), 5000);
      room.onMessage('gf_res', (m: { op?: string; ok?: boolean; r?: string }) => { if (m?.op === 'admin') { clearTimeout(t); resolve(m); } });
      room.onMessage('*', () => {});
      room.send('gf_admin', { token, op: 'remove', i: id });
    });
    if (!res.ok) console.error(`[admin] a sala recusou: ${res.r ?? '?'}`);
    return !!res.ok;
  } finally { await room.leave().catch(() => {}); }
}

/** servidor fora do ar: remove direto do arquivo local de grafites */
async function removeOffline(id: number): Promise<boolean> {
  const file = process.env.PV_GRAFFITI_FILE ?? fileURLToPath(new URL('../data/graffiti.json', import.meta.url));
  const st = new JsonFileGraffitiStore(file, 0);
  const { records } = await st.load();
  if (!records.some((r) => r.id === id)) return false;
  st.delete(id);
  await st.flush();
  return true;
}

async function main() {
  const store = await createPrismaStore();
  const ctx: AdminCtx = { store, actor: `cli:${userInfo().username}` };
  const email = pos[0];
  const needEmail = () => { if (!email) die(`uso: ${cmd} <email> …`); return email; };
  try {
    switch (cmd) {
      case 'grant-access': {
        const g = await grantAccess(ctx, needEmail(), { eventId: flag('event') ?? null, hours: num('hours') ?? null });
        console.log(`[admin] acesso DEV_GRANTED concedido (${g.eventId ? `evento ${g.eventId}` : 'global'}${g.expiresAt ? `, até ${g.expiresAt.toISOString()}` : ''})`);
        break;
      }
      case 'revoke-access': console.log(`[admin] ${await revokeAccess(ctx, needEmail(), { eventId: flag('event') ?? null })} concessão(ões) revogada(s)`); break;
      case 'suspend': {
        const until = await suspend(ctx, needEmail(), num('hours') ?? 0, flag('reason') ?? '');
        console.log(`[admin] suspensa até ${until.toISOString()} (a sala rebaixa a espectador em até ~15 s)`);
        break;
      }
      case 'unsuspend': await unsuspend(ctx, needEmail()); console.log('[admin] suspensão retirada'); break;
      case 'ban': await ban(ctx, needEmail(), flag('reason') ?? ''); console.log('[admin] conta banida; sessões revogadas (a sala desconecta em até ~15 s)'); break;
      case 'unban': await unban(ctx, needEmail()); console.log('[admin] banimento retirado'); break;
      case 'reports': {
        const st = flag('status') as ReportStatus | undefined;
        if (st && !['OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED'].includes(st)) die('--status=OPEN|REVIEWED|DISMISSED|ACTIONED');
        const list = await listReports(ctx, st, num('limit') ?? 50);
        if (!list.length) console.log('[admin] nenhuma denúncia');
        for (const r of list) console.log(`${r.createdAt.toISOString()}  ${r.status.padEnd(9)} ${r.category.padEnd(15)} ${r.targetType}:${r.targetRef}  denunciado=${r.targetUserId ?? '-'} apelido_na_hora=${r.reportedNicknameAtTime ?? '-'}  ${r.details ?? ''}  ${JSON.stringify(r.evidence)}  [${r.id}]`);
        break;
      }
      case 'remove-graffiti': {
        const id = Number(pos[0]);
        if (!Number.isInteger(id) || id <= 0) die('uso: remove-graffiti <id numérico>');
        let via = 'sala';
        let ok = await removeLive(id);
        if (ok === null) { via = 'arquivo'; ok = await removeOffline(id); }
        if (!ok) die(`grafite #${id} não encontrado (ou já removido)`);
        await recordGraffitiRemoval(ctx, id, flag('reason') ?? null, via);
        console.log(`[admin] grafite #${id} removido (${via})`);
        break;
      }
      default:
        die('comandos: grant-access | revoke-access | suspend | unsuspend | ban | unban | reports | remove-graffiti');
    }
  } catch (e) {
    if (e instanceof AdminError) die(e.message);
    throw e;
  } finally { await store.close(); }
  process.exit(0);
}

await main();
