/**
 * Rodada 9 — formatação da agenda ("Acontecendo agora", tela AGENDA, telões): contagem regressiva, inscritos n/cap,
 * escolha dos 3 itens relevantes, seções agora/a seguir/encerrados, botão entrar/sair.
 */
import { describe, expect, it } from 'vitest';
import { AGENDA_SOON_MS, agendaSections, entryLine, entryStatus, entryTitle, headcount, joinAction, pickNow } from '../src/events/agendaFormat';
import type { AgendaEntry } from '../src/events/schedule';

const T = 1_800_000_000_000;
const e = (o: Partial<AgendaEntry>): AgendaEntry => ({ id: 'x', inst: `x@${Math.random()}`, format: 'caminhada', name: 'Caminhada', zone: 'CENTRO', state: 'SCHEDULED', startsAt: T + 60_000, endsAt: T + 600_000, count: 0, capacity: 0, ...o });

describe('agenda — formatação', () => {
  it('estado legível: acontecendo, começa em mm:ss, inscrições n/cap, encerrado', () => {
    expect(entryStatus(e({ state: 'ACTIVE', capacity: 0 }), T)).toBe('acontecendo');
    expect(entryStatus(e({ state: 'SCHEDULED', startsAt: T + 222_000 }), T)).toBe('começa em 03:42');
    expect(entryStatus(e({ state: 'STARTING', startsAt: T + 9_400 }), T)).toBe('começa em 00:10');
    expect(entryStatus(e({ state: 'REGISTRATION', count: 9, capacity: 20 }), T)).toBe('inscrições 9/20');
    expect(entryStatus(e({ state: 'ACTIVE', count: 4, capacity: 20 }), T)).toBe('acontecendo · 4/20');
    expect(entryStatus(e({ state: 'FINISHED' }), T)).toBe('encerrado');
    expect(entryStatus(e({ state: 'CANCELLED' }), T)).toBe('cancelado');
    expect(headcount({ count: 3, capacity: 0 })).toBe('3');
    expect(entryStatus(e({ state: 'SCHEDULED', startsAt: T + 3 * 3600_000 }), T)).toMatch(/^às \d\d:\d\d$/);
  });

  it('título em caixa alta pelos dados (ou o formato) e zona pelo nome', () => {
    expect(entryTitle({ name: 'Corrida de bicicleta', format: 'corrida' })).toBe('CORRIDA DE BICICLETA');
    expect(entryTitle({ name: '', format: 'debate' })).toBe('DEBATE');
    expect(entryLine(e({ name: 'Debate na Candelária', format: 'debate', state: 'ACTIVE', zone: 'CANDELARIA' }), T, (id) => (id === 'CANDELARIA' ? 'Candelária' : undefined)))
      .toEqual({ title: 'DEBATE NA CANDELÁRIA', status: 'acontecendo', zone: 'Candelária' });
  });

  it('"Acontecendo agora": até 3, acontecendo primeiro, depois inscrições, depois o que começa logo; nada encerrado', () => {
    const list = [
      e({ inst: 'far', state: 'SCHEDULED', startsAt: T + 3 * 3600_000 }),
      e({ inst: 'reg', state: 'REGISTRATION', startsAt: T + 300_000, count: 9, capacity: 20 }),
      e({ inst: 'fin', state: 'FINISHED' }),
      e({ inst: 'soon', state: 'SCHEDULED', startsAt: T + 222_000 }),
      e({ inst: 'live', state: 'ACTIVE', startsAt: T - 60_000 }),
      e({ inst: 'live2', state: 'ACTIVE', startsAt: T - 120_000, joined: true }),
    ];
    expect(pickNow(list, T).map((x) => x.inst)).toEqual(['live2', 'live', 'reg']);
    expect(pickNow(list, T, 5).map((x) => x.inst)).toEqual(['live2', 'live', 'reg', 'soon']);
  });

  it('tela AGENDA: AGORA / EM BREVE (≤ 15 min) / MAIS TARDE / ENCERRADOS RECENTEMENTE (janela do servidor); botão entrar/sair', () => {
    const s = agendaSections([
      e({ inst: 'a', state: 'ACTIVE' }), e({ inst: 'b', state: 'REGISTRATION', startsAt: T + 5 }), e({ inst: 'st', state: 'STARTING', startsAt: T + 3 }),
      e({ inst: 'c', state: 'SCHEDULED', startsAt: T + 1 }), e({ inst: 'c15', state: 'SCHEDULED', startsAt: T + AGENDA_SOON_MS }), e({ inst: 'late', state: 'SCHEDULED', startsAt: T + AGENDA_SOON_MS + 1 }),
      e({ inst: 'd', state: 'FINISHED', endsAt: T - 60_000 }), e({ inst: 'x', state: 'CANCELLED', endsAt: T - 30_000 }), e({ inst: 'old', state: 'FINISHED', endsAt: T - 3 * 3600_000 }),
    ], T);
    expect(AGENDA_SOON_MS).toBe(15 * 60_000);
    expect(s.now.map((x) => x.inst)).toEqual(['st', 'b', 'a']);
    expect(s.soon.map((x) => x.inst)).toEqual(['c', 'c15']);
    expect(s.later.map((x) => x.inst)).toEqual(['late']);
    // o cliente não corta por tempo: o servidor só manda o que ainda está na janela recente
    expect(s.recent.map((x) => x.inst)).toEqual(['x', 'd', 'old']);
    expect(joinAction(e({ state: 'REGISTRATION', count: 2, capacity: 20 }))).toBe('join');
    expect(joinAction(e({ state: 'REGISTRATION', count: 20, capacity: 20 }))).toBeNull();
    expect(joinAction(e({ state: 'ACTIVE', format: 'debate', count: 2, capacity: 20 }))).toBeNull(); // debate: fila do palco, não inscrição
    expect(joinAction(e({ state: 'ACTIVE', joined: true }))).toBe('leave');
    expect(joinAction(e({ state: 'FINISHED', joined: true }))).toBeNull();
    expect(joinAction(e({ state: 'SCHEDULED' }))).toBeNull();
  });
});
