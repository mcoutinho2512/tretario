/** GET /api/metrics/public — métricas públicas semânticas (server/src/presence/publicMetrics.ts). Sem dado pessoal. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { router } from './router.ts';
import { environmentCrowdFor, publicMetrics, type EventCrowdData } from '../presence/publicMetrics.ts';

/** evento padrão (quando ainda não há sala viva): lido uma vez dos DADOS do evento */
let fallback: { eventId: string; eventName: string; environmentCrowd: number } | null = null;
function defaultEvent() {
  if (fallback) return fallback;
  try {
    const dir = fileURLToPath(new URL('../../../public/events/', import.meta.url));
    const idx = JSON.parse(readFileSync(`${dir}index.json`, 'utf8')) as { default: string };
    const id = process.env.PV_EVENT ?? idx.default;
    const ev = JSON.parse(readFileSync(`${dir}${id}.json`, 'utf8')) as EventCrowdData & { id: string; name: string };
    fallback = { eventId: ev.id ?? id, eventName: ev.name ?? id, environmentCrowd: environmentCrowdFor(ev) };
  } catch { fallback = { eventId: '', eventName: '', environmentCrowd: 0 }; }
  return fallback;
}

router.add('GET', '/api/metrics/public', () => ({ body: publicMetrics(Date.now(), defaultEvent()) }));
