/**
 * Agenda do evento do mundo (rodada 9): `agenda` do EventDef (public/events/<evento>.json), saneada. Servidor de
 * TESTE (PV_TEST=1) pode trocar a agenda por um arquivo (PV_AGENDA_FILE) — QA com horários curtos; PV_AGENDA_EPOCH
 * (ms ou "now") desloca a origem da recorrência para a ocorrência 0 começar agora.
 */
import { readFileSync } from 'node:fs';
import type { ScheduledEventDef } from '../../../src/events/schedule';

const num = (v: unknown, d: number, lo = 0, hi = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** só entra o que tem id, formato e recorrência válidos; números presos a faixas razoáveis */
export function sanitizeAgenda(list: unknown): ScheduledEventDef[] {
  if (!Array.isArray(list)) return [];
  const out: ScheduledEventDef[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const d = raw as ScheduledEventDef;
    if (!d || typeof d.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(d.id) || seen.has(d.id) || typeof d.format !== 'string') continue;
    const r = d.recurrence;
    if (!r || !(num(r.everyMin, 0) > 0)) continue;
    seen.add(d.id);
    out.push({
      ...d,
      name: typeof d.name === 'string' ? d.name.slice(0, 60) : d.id,
      description: typeof d.description === 'string' ? d.description.slice(0, 400) : '',
      zones: Array.isArray(d.zones) ? d.zones.filter((z) => typeof z === 'string') : [],
      recurrence: { everyMin: num(r.everyMin, 60, 0.1, 7 * 24 * 60), offsetMin: num(r.offsetMin, 0, 0, 7 * 24 * 60), registrationMin: num(r.registrationMin, 0, 0, 24 * 60), startingS: num(r.startingS, 0, 0, 600), durationMin: num(r.durationMin, 10, 0.05, 24 * 60) },
      capacity: Math.round(num(d.capacity, 50, 1, 1000)),
      minParticipants: Math.round(num(d.minParticipants, 0, 0, 1000)),
      rewards: Array.isArray(d.rewards) ? d.rewards : [],
      npcCrowd: Math.round(num(d.npcCrowd, 0, 0, 400)),
    });
  }
  return out;
}

export function loadAgenda(fromEvent: unknown, env: Record<string, string | undefined> = process.env): { defs: ScheduledEventDef[]; epoch: number; source: string } {
  let list = fromEvent, source = 'evento';
  if (env.PV_TEST === '1' && env.PV_AGENDA_FILE) {
    const j = JSON.parse(readFileSync(env.PV_AGENDA_FILE, 'utf8')) as unknown;
    list = Array.isArray(j) ? j : (j as { agenda?: unknown })?.agenda;
    source = env.PV_AGENDA_FILE;
  }
  const e = env.PV_TEST === '1' ? env.PV_AGENDA_EPOCH : undefined;
  const epoch = e === 'now' ? Math.floor(Date.now() / 1000) * 1000 : Number.isFinite(Number(e)) && e ? Number(e) : 0;
  return { defs: sanitizeAgenda(list), epoch, source };
}
