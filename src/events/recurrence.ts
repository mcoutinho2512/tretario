/**
 * Recorrência da agenda (rodada 9) — pura, sem relógio próprio: horários das ocorrências de um ScheduledEventDef no
 * relógio do SERVIDOR (o cliente só exibe o que a mensagem `agenda` traz). Ocorrência k começa (ACTIVE) em
 *   epoch + (offsetMin + k × everyMin) min
 * com a contagem (STARTING) `startingS` antes e a inscrição (REGISTRATION) `registrationMin` antes da contagem.
 * `epoch` padrão 0 (meia-noite UTC de 1970): a agenda cai em horários "redondos" e é a mesma em qualquer processo.
 */
import type { EventRecurrence, EventState, ScheduledEventDef } from './schedule';

const MIN = 60_000;

export interface OccurrenceTimes {
  k: number;
  opensAt: number;
  countdownAt: number;
  startsAt: number;
  endsAt: number;
}

export function occurrence(rec: EventRecurrence, k: number, epoch = 0): OccurrenceTimes {
  const startsAt = epoch + (rec.offsetMin + k * rec.everyMin) * MIN;
  const countdownAt = startsAt - Math.max(0, rec.startingS) * 1000;
  const opensAt = countdownAt - Math.max(0, rec.registrationMin) * MIN;
  return { k, opensAt, countdownAt, startsAt, endsAt: startsAt + Math.max(0, rec.durationMin) * MIN };
}

/** estado pelo horário (sem cancelamento/encerramento antecipado — esses o runtime decide) */
export function timeState(o: OccurrenceTimes, now: number): EventState {
  if (now >= o.endsAt) return 'FINISHED';
  if (now >= o.startsAt) return 'ACTIVE';
  if (now >= o.countdownAt) return 'STARTING';
  if (now >= o.opensAt) return 'REGISTRATION';
  return 'SCHEDULED';
}

/** a ocorrência está dentro da janela absoluta do evento (startAt/endAt ISO)? */
export function inWindow(def: Pick<ScheduledEventDef, 'startAt' | 'endAt'>, o: OccurrenceTimes): boolean {
  const a = def.startAt ? Date.parse(def.startAt) : -Infinity, b = def.endAt ? Date.parse(def.endAt) : Infinity;
  return o.startsAt >= (Number.isFinite(a) ? a : -Infinity) && o.startsAt < (Number.isFinite(b) ? b : Infinity);
}

/**
 * ocorrências relevantes em `now`: as que ainda não terminaram há mais de `recentMs` e a PRÓXIMA ainda não aberta
 * (agenda "agora / próximo / recém-terminado"). No máximo `cap` (recorrência mais curta que a duração = sobreposição).
 */
export function occurrencesAround(def: Pick<ScheduledEventDef, 'recurrence' | 'startAt' | 'endAt'>, now: number, epoch = 0, recentMs = 10 * MIN, cap = 6): OccurrenceTimes[] {
  const rec = def.recurrence;
  if (!rec || !(rec.everyMin > 0)) return [];
  const every = rec.everyMin * MIN;
  // menor k cuja ocorrência termina depois de now − recentMs
  const span = (Math.max(0, rec.durationMin) * MIN) + recentMs;
  let k = Math.ceil((now - span - epoch - rec.offsetMin * MIN) / every);
  const out: OccurrenceTimes[] = [];
  for (let i = 0; i < 64 && out.length < cap; i++, k++) {
    const o = occurrence(rec, k, epoch);
    if (o.endsAt + recentMs < now) continue;
    if (inWindow(def, o)) out.push(o);
    if (o.opensAt > now) break; // a próxima (ainda fechada) já entrou: basta
  }
  return out;
}

/** id da instância (estável entre processos com o mesmo epoch) */
export const instanceId = (defId: string, startsAt: number) => `${defId}@${startsAt}`;
