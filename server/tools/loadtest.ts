/**
 * Teste de carga: sobe um servidor dedicado (porta 2620) e roda N bots por cenário,
 * coletando métricas do cliente (bytes/s, mensagens/s, jogadores visíveis) e do servidor
 * (tick, CPU do processo, memória, bytes/s totais).
 *
 * uso: npx tsx tools/loadtest.ts [segundos por cenário=20]
 */
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const SECS = Number(process.argv[2] ?? 20);
const PORT = 2620;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));

try { await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); console.error(`porta ${PORT} ocupada — abortando`); process.exit(2); } catch { /* livre */ }
const srv = spawn('npx', ['tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), PV_METRICS: '0', PV_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let ready = false;
srv.stdout.on('data', (d) => { if (d.toString().includes('[pv3d-server]')) ready = true; });
for (let i = 0; i < 100 && !ready; i++) await w(200);
const pid = () => {
  // processo node real do servidor (filho do npx)
  try { return execFileSync('pgrep', ['-f', `PORT=${PORT}`]).toString().trim().split('\n')[0]; } catch { return ''; }
};
const metrics = async () => (await (await fetch(`http://127.0.0.1:${PORT + 1}/metrics`)).json()) as Record<string, number>;

const scenarios: { n: number; spread: boolean }[] = [
  { n: 2, spread: false }, { n: 5, spread: false }, { n: 10, spread: false }, { n: 20, spread: false },
  { n: 20, spread: true }, { n: 50, spread: true },
];
const rows: Record<string, unknown>[] = [];
for (const sc of scenarios) {
  await metrics(); // zera a janela
  const cpu0 = process.cpuUsage();
  const t0 = Date.now();
  const out = await new Promise<string>((res) => {
    const p = spawn('npx', ['tsx', 'tools/bots.ts', String(sc.n), String(SECS), `ws://127.0.0.1:${PORT}`, sc.spread ? '1' : '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
    let s = '';
    p.stdout.on('data', (d) => { s += d.toString(); });
    p.on('exit', () => res(s));
    // amostra do servidor no meio do cenário
    setTimeout(async () => { (sc as Record<string, unknown>).server = await metrics(); }, (SECS * 1000) / 2 + 3000);
  });
  void cpu0; void t0;
  const bot = JSON.parse(out.trim().split('\n').pop()!);
  const s = (sc as Record<string, unknown>).server as Record<string, number> | undefined;
  rows.push({
    bots: sc.n, espalhados: sc.spread,
    cliente_KBps_recebe: +(bot.perClient.bytesInPerSec / 1024).toFixed(2), cliente_KBps_envia: +(bot.perClient.bytesOutPerSec / 1024).toFixed(2),
    cliente_msgs_s_recebe: bot.perClient.msgsInPerSec, cliente_msgs_s_envia: bot.perClient.msgsOutPerSec,
    visiveis_medio: bot.visiblePlayers.avg, visiveis_min: bot.visiblePlayers.min, visiveis_max: bot.visiblePlayers.max,
    servidor_KBps_total_out: s ? +(s.bytesOutPerSec / 1024).toFixed(1) : null, servidor_tick_ms: s?.tickAvgMs ?? null, servidor_tick_max_ms: s?.tickMaxMs ?? null,
    servidor_heap_MB: s?.heapMB ?? null, servidor_rss_MB: s?.rssMB ?? null,
  });
  console.log(JSON.stringify(rows[rows.length - 1]));
  await w(1500);
}
mkdirSync('../screenshots', { recursive: true });
writeFileSync('../screenshots/loadtest.json', JSON.stringify(rows, null, 2));
process.kill(-(srv.pid as number), 'SIGTERM');
void pid;
process.exit(0);
