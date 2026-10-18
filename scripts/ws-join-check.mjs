// Entra na sala como ESPECTADOR (visitante, sem ticket) pelo endpoint público e sai — usado por smoke-production.sh.
// Uso: node scripts/ws-join-check.mjs wss://dominio/game [protocolo]   (CA extra p/ teste local: NODE_EXTRA_CA_CERTS)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// SDK do release (scripts/ dentro do release) ou, rodando de outro clone, do release no ar
async function loadSdk() {
  try { return await import('@colyseus/sdk'); } catch {
    const req = createRequire(`${process.env.TRETARIO_ROOT ?? '/opt/tretario'}/current/package.json`);
    return import(pathToFileURL(req.resolve('@colyseus/sdk')).href);
  }
}
const { Client } = await loadSdk();

const [endpoint, pv] = process.argv.slice(2);
if (!endpoint) { console.error('uso: ws-join-check.mjs <wss://host/game> [protocolo]'); process.exit(2); }
const t0 = Date.now();
const timer = setTimeout(() => { console.error(`timeout (10 s) entrando em ${endpoint}`); process.exit(1); }, 10_000);
try {
  const room = await new Client(endpoint).joinOrCreate('presidente_vargas', { role: 'spectator', ...(pv ? { pv: Number(pv) } : {}) });
  const role = await new Promise((resolve) => {
    room.onMessage('*', (type, m) => { if (type === 'spawn') resolve(m?.role ?? '?'); });
  });
  const ms = Date.now() - t0;
  await room.leave(true);
  clearTimeout(timer);
  console.log(JSON.stringify({ ok: true, role, joinMs: ms, roomId: room.roomId }));
  process.exit(role === 'spectator' ? 0 : 1);
} catch (e) {
  console.error(`falha ao entrar: ${e?.code ?? ''} ${e?.message ?? e}`);
  process.exit(1);
}
