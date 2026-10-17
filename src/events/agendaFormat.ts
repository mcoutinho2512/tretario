/**
 * Agenda da avenida (rodada 9) — formatação e escolha PURAS (testáveis: tests/agendaFormat.test.ts), usadas pelo
 * "Acontecendo agora" (HUD), pela tela AGENDA DA AVENIDA e pelos telões (slide 'event'). Fonte: mensagem `agenda`
 * do servidor (src/events/schedule.ts AgendaEntry) — o cliente nunca decide estado nem horário.
 */
import type { AgendaEntry, EventState } from './schedule';
import { clock } from './debate';

/** rótulo curto por formato (o nome do evento vem dos dados; isto só cobre a ausência dele) */
const FORMAT_LABEL: Record<string, string> = {
  debate: 'DEBATE', caminhada: 'CAMINHADA', corrida: 'CORRIDA', manifestacao: 'ATO', encontro: 'ENCONTRO', show: 'SHOW', missao: 'MISSÃO', confronto: 'CONFRONTO', trio: 'TRIO',
};

export const STATE_LABEL: Record<EventState, string> = {
  SCHEDULED: 'agendado', REGISTRATION: 'inscrições abertas', STARTING: 'começando', ACTIVE: 'acontecendo', FINISHED: 'encerrado', CANCELLED: 'cancelado',
};

/** título em caixa alta: nome dos dados (ou o formato) */
export function entryTitle(e: Pick<AgendaEntry, 'name' | 'format'>): string {
  return (e.name || FORMAT_LABEL[e.format] || String(e.format)).toLocaleUpperCase('pt-BR');
}

/** "inscritos 9/20" (capacidade 0 = sem teto: só o número) */
export function headcount(e: Pick<AgendaEntry, 'count' | 'capacity'>): string {
  return e.capacity > 0 ? `${e.count}/${e.capacity}` : String(e.count);
}

/**
 * estado legível: "acontecendo" · "começa em 03:42" · "inscrições 9/20" · "encerrado" · "cancelado". `now` no
 * relógio do servidor (worldClock).
 */
export function entryStatus(e: AgendaEntry, now: number): string {
  switch (e.state) {
    case 'ACTIVE': return e.capacity > 0 && e.count > 0 ? `acontecendo · ${headcount(e)}` : 'acontecendo';
    case 'REGISTRATION': return `inscrições ${headcount(e)}`;
    case 'STARTING': return `começa em ${clock(e.startsAt - now)}`;
    case 'SCHEDULED': return e.startsAt - now > 99 * 60_000 ? `às ${new Date(e.startsAt).toTimeString().slice(0, 5)}` : `começa em ${clock(e.startsAt - now)}`;
    case 'FINISHED': return 'encerrado';
    case 'CANCELLED': return 'cancelado';
  }
}

/** "DEBATE NO PALCO · acontecendo" (com a zona quando houver nome) */
export function entryLine(e: AgendaEntry, now: number, zoneName?: (id: string) => string | undefined): { title: string; status: string; zone: string } {
  return { title: entryTitle(e), status: entryStatus(e, now), zone: (e.zone && zoneName?.(e.zone)) || '' };
}

const LIVE: EventState[] = ['ACTIVE', 'STARTING'];
const OPEN: EventState[] = ['REGISTRATION', 'SCHEDULED'];

/**
 * até `max` itens relevantes para o "Acontecendo agora": o que está acontecendo, depois inscrições abertas e o que
 * começa logo (≤ horizonMs). Inscritos primeiro em cada grupo. Nada encerrado/cancelado.
 */
export function pickNow(list: readonly AgendaEntry[], now: number, max = 3, horizonMs = 30 * 60_000): AgendaEntry[] {
  const rank = (e: AgendaEntry) => (LIVE.includes(e.state) ? 0 : e.state === 'REGISTRATION' ? 1 : 2) * 2 + (e.joined ? 0 : 1);
  return list
    .filter((e) => LIVE.includes(e.state) || (OPEN.includes(e.state) && e.startsAt - now <= horizonMs))
    .sort((a, b) => rank(a) - rank(b) || a.startsAt - b.startsAt)
    .slice(0, max);
}

/** tela AGENDA: agora / a seguir / encerrados há pouco (≤ recentMs) */
export function agendaSections(list: readonly AgendaEntry[], now: number, recentMs = 45 * 60_000): { now: AgendaEntry[]; next: AgendaEntry[]; recent: AgendaEntry[] } {
  return {
    now: list.filter((e) => LIVE.includes(e.state)).sort((a, b) => a.startsAt - b.startsAt),
    next: list.filter((e) => OPEN.includes(e.state)).sort((a, b) => a.startsAt - b.startsAt),
    recent: list.filter((e) => (e.state === 'FINISHED' || e.state === 'CANCELLED') && now - e.endsAt <= recentMs).sort((a, b) => b.endsAt - a.endsAt),
  };
}

/** botão da agenda: entrar/sair só onde faz sentido (inscrição aberta, começando ou acontecendo com vaga) */
export function joinAction(e: AgendaEntry): 'join' | 'leave' | null {
  if (e.state === 'FINISHED' || e.state === 'CANCELLED') return null;
  if (e.joined) return 'leave';
  if (e.state === 'SCHEDULED') return null;
  if (e.capacity > 0 && e.count >= e.capacity) return null;
  return 'join';
}

/** texto do motivo de evt_res negado (src/events/schedule.ts EventJoinDenial) */
export const JOIN_DENIAL_TEXT: Record<string, string> = {
  inexistente: 'Esse evento não existe mais', fechado: 'Inscrições fechadas', lotado: 'Evento lotado', grupo: 'Evento restrito a outros grupos',
  veiculo: 'Precisa do veículo do evento', ja_inscrito: 'Você já está inscrito', sem_permissao: 'Sua conta não pode participar agora',
};
