/**
 * Adaptador FINO (rodada 9) entre a agenda e os runners de debate, sem Colyseus. Enquanto o agendador de eventos
 * (server/src/events — outro agente) não está ligado nesta árvore, este host faz o papel mínimo dele para o formato
 * 'debate': lê as definições (agenda do evento atual; senão public/gameplay/debates.json), calcula a janela da
 * recorrência no relógio do servidor e chama start/end/tick do runner. Com o agendador ligado, ele passa a chamar o
 * runner diretamente e este arquivo se reduz a `createDebateRunners`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgendaEntry, EventRecurrence, ScheduledEventDef } from '../../../src/events/schedule';
import type { WorldManifest } from '../../../src/world/types';
import { DebateRunner, type DebateHooks, type DebateRunnerOptions } from './DebateRunner';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');

/** definições de debate: agenda do evento (formato 'debate') ou o arquivo de dados (PV_DEBATE_FILE em teste) */
export function loadDebateDefs(agenda: ScheduledEventDef[] | undefined, file?: string): ScheduledEventDef[] {
  const testFile = process.env.PV_TEST === '1' ? process.env.PV_DEBATE_FILE : undefined; // QA: dados de teste valem sobre tudo
  const fromEvent = (agenda ?? []).filter((d) => d.format === 'debate' && d.debate);
  if (fromEvent.length && !file && !testFile) return fromEvent;
  file ??= testFile ?? `${PUBLIC}/gameplay/debates.json`;
  if (!existsSync(file)) return [];
  const j = JSON.parse(readFileSync(file, 'utf8')) as { debates?: ScheduledEventDef[] };
  return (j.debates ?? []).filter((d) => d.format === 'debate' && d.debate && validDebate(d));
}

/** dados mínimos coerentes (turno em segundos razoáveis, lugares ≥ 1, temas) */
export function validDebate(d: ScheduledEventDef): boolean {
  const s = d.debate;
  return !!s && s.turnSeconds >= 5 && s.turnSeconds <= 600 && s.seats >= 1 && s.seats <= 12 && s.turns >= 1 && s.reactionsPerMin >= 1 && Array.isArray(s.topics) && s.topics.length > 0 && s.topics.every((t) => typeof t === 'string' && t.length <= 160);
}

/** janela atual/próxima da recorrência: instância = id@início (ms) */
export function debateWindow(id: string, rec: EventRecurrence, now: number): { inst: string; startsAt: number; endsAt: number; active: boolean; nextAt: number } {
  const every = Math.max(1, rec.everyMin) * 60_000, off = (rec.offsetMin % Math.max(1, rec.everyMin)) * 60_000, dur = Math.min(rec.durationMin * 60_000, every);
  const k = Math.floor((now - off) / every);
  const startsAt = k * every + off, endsAt = startsAt + dur;
  const active = now >= startsAt && now < endsAt;
  return { inst: `${id}@${startsAt}`, startsAt, endsAt, active, nextAt: active ? startsAt + every : (now < startsAt ? startsAt : startsAt + every) };
}

export class DebateHost {
  readonly runners: DebateRunner[] = [];

  constructor(defs: ScheduledEventDef[], manifest: Pick<WorldManifest, 'eventSpots'>, hooks: DebateHooks, o: DebateRunnerOptions = {}) {
    for (const d of defs) {
      const spot = manifest.eventSpots?.find((s) => s.id === d.debate!.stageSpot);
      if (!spot) { hooks.log?.(`debate ${d.id}: palco ${d.debate!.stageSpot} não existe no manifest`); continue; }
      this.runners.push(new DebateRunner(d, spot, hooks, o));
    }
  }

  tick(now = Date.now()) {
    for (const r of this.runners) {
      const w = debateWindow(r.def.id, r.def.recurrence, now);
      if (w.active && r.inst !== w.inst) r.start(w.inst, now);
      else if (!w.active && r.inst) r.end(now, w.nextAt);
      r.setNext(w.nextAt);
      r.tick(now);
    }
  }

  /** runner da instância (ou o único, se `inst` vier vazio) */
  runner(inst?: unknown): DebateRunner | undefined {
    if (typeof inst === 'string' && inst) return this.runners.find((r) => r.inst === inst || inst.startsWith(`${r.def.id}@`));
    return this.runners[0];
  }

  onLeave(sid: string, now = Date.now()) { for (const r of this.runners) r.onLeave(sid, now); }
  muted(ownerSids: string[], key: string, on: boolean) { for (const r of this.runners) r.muted(ownerSids, key, on); }
  sweep(now = Date.now()) { let n = 0; for (const r of this.runners) n += r.sweep(now); return n; }

  /** itens de agenda dos debates (telões; e para o agendador comparar) — contagem = fila + orador */
  agenda(now = Date.now()): AgendaEntry[] {
    return this.runners.map((r) => {
      const w = debateWindow(r.def.id, r.def.recurrence, now);
      const live = w.active && r.inst === w.inst;
      return {
        id: r.def.id, inst: w.active ? w.inst : `${r.def.id}@${w.nextAt}`, format: 'debate', name: r.def.name, zone: r.def.zones[0] ?? '',
        state: live ? 'ACTIVE' : 'SCHEDULED', startsAt: w.active ? w.startsAt : w.nextAt, endsAt: w.active ? w.endsAt : w.nextAt + r.def.recurrence.durationMin * 60_000,
        count: live ? r.queueSids.length + (r.speakerSid ? 1 : 0) : 0, capacity: r.def.capacity,
      };
    });
  }
}
