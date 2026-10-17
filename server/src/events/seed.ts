/**
 * Eventos no banco (rodada 8): as definições continuam em public/events/*.json (fonte única, a mesma do cliente);
 * na partida do servidor elas são espelhadas em Event/EventGroup (`store.events.upsert`) para que EventMembership
 * sempre aponte para um grupo válido ("<evento>:<chave do grupo>"). Idempotente.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataStore } from '../data/types';
import type { EventDef } from '../../../src/events/types';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');

export function readEventDefs(dir = PUBLIC): { defaultEvent: string; events: EventDef[] } {
  const idx = JSON.parse(readFileSync(`${dir}/events/index.json`, 'utf8')) as { default: string; events: string[] };
  const events: EventDef[] = [];
  for (const id of idx.events) {
    const f = `${dir}/events/${id}.json`;
    if (existsSync(f)) events.push({ ...(JSON.parse(readFileSync(f, 'utf8')) as EventDef), id });
  }
  return { defaultEvent: idx.default, events };
}

/** evento atual do servidor (mesma regra da sala: PV_EVENT ou o padrão do índice) */
let cached: string | null = null;
export function currentEventId(): string {
  if (process.env.PV_EVENT) return process.env.PV_EVENT;
  cached ??= readEventDefs().defaultEvent;
  return cached;
}

export const groupId = (eventId: string, key: string) => `${eventId}:${key}`;

export async function seedEvents(store: DataStore, defs = readEventDefs().events): Promise<number> {
  for (const ev of defs) {
    await store.events.upsert({
      id: ev.id, name: ev.name ?? ev.id,
      groups: (ev.groups ?? []).map((g, i) => ({ id: groupId(ev.id, g.id), key: g.id, name: g.name, designKey: g.designKey ?? null, neutral: !!g.neutral, sort: i })),
    });
  }
  return defs.length;
}
