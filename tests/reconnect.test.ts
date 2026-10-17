import { describe, expect, it } from 'vitest';
import { LinkMachine, RECONNECT, backoffDelay, nextLink, retriesForGrace } from '../src/net/reconnect';

describe('reconexão — máquina de estados', () => {
  it('cliente: CONNECTED → RECONNECTING → CONNECTED', () => {
    expect(nextLink('client', 'CONNECTED', 'drop')).toBe('RECONNECTING');
    expect(nextLink('client', 'RECONNECTING', 'reconnected')).toBe('CONNECTED');
  });
  it('servidor: CONNECTED → DISCONNECTED_GRACE → CONNECTED (mesma entidade)', () => {
    expect(nextLink('server', 'CONNECTED', 'drop')).toBe('DISCONNECTED_GRACE');
    expect(nextLink('server', 'DISCONNECTED_GRACE', 'reconnected')).toBe('CONNECTED');
  });
  it('graça vencida e sessão substituída → EXPIRED; só uma entrada nova sai de EXPIRED', () => {
    expect(nextLink('server', 'DISCONNECTED_GRACE', 'expired')).toBe('EXPIRED');
    expect(nextLink('client', 'CONNECTED', 'replaced')).toBe('EXPIRED');
    expect(nextLink('client', 'EXPIRED', 'reconnected')).toBe('EXPIRED');
    expect(nextLink('client', 'EXPIRED', 'rejoined')).toBe('CONNECTED');
  });
  it('eventos fora de hora não mudam o estado (idempotente)', () => {
    expect(nextLink('client', 'CONNECTED', 'reconnected')).toBe('CONNECTED');
    expect(nextLink('client', 'CONNECTED', 'expired')).toBe('CONNECTED');
    expect(nextLink('client', 'RECONNECTING', 'drop')).toBe('RECONNECTING');
  });
  it('tick expira a graça no prazo e informa o restante', () => {
    const m = new LinkMachine('server', 20_000);
    m.apply('drop', 1000);
    expect(m.state).toBe('DISCONNECTED_GRACE');
    expect(m.remaining(11_000)).toBe(10_000);
    expect(m.tick(20_999)).toBe('DISCONNECTED_GRACE');
    expect(m.tick(21_001)).toBe('EXPIRED');
    expect(m.remaining(22_000)).toBe(0);
  });
});

describe('reconexão — backoff', () => {
  it('exponencial limitado com jitter entre metade e o total', () => {
    const lo = () => 0, hi = () => 0.999999;
    expect(backoffDelay(1, 300, 4000, lo)).toBe(150);
    expect(backoffDelay(1, 300, 4000, hi)).toBe(300);
    expect(backoffDelay(3, 300, 4000, hi)).toBe(1200);
    expect(backoffDelay(10, 300, 4000, hi)).toBe(4000);
    expect(backoffDelay(10, 300, 4000, lo)).toBe(2000);
    for (let i = 1; i < 12; i++) { const d = backoffDelay(i); expect(d).toBeGreaterThan(0); expect(d).toBeLessThanOrEqual(RECONNECT.maxDelayMs); }
  });
  it('tentativas cobrem toda a graça mesmo com o jitter mínimo (sem entidade nova antes da antiga vencer)', () => {
    const n = retriesForGrace(20_000, 300, 4000);
    let t = 0;
    for (let i = 1; i < n; i++) t += backoffDelay(i, 300, 4000, () => 0);
    expect(t).toBeGreaterThanOrEqual(20_000);
  });
});
