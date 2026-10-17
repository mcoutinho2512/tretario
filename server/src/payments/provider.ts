/**
 * Pagamentos (rodada 8): só a INTERFACE e um provedor FALSO para testes. Nenhum PSP real, nenhum fluxo comercial
 * público, nenhuma rota HTTP nesta rodada. O caminho PAID de AccountAccess passa por aqui: só um webhook
 * confirmado pelo provedor (assinatura verificada por ele) gera a concessão — nunca o cliente.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AccessRecord, DataStore, PaymentRecord, PaymentStatus } from '../data/types';

export interface Charge { providerRef: string; status: PaymentStatus; amountCents: number; currency: string; /** ex.: QR/código copia-e-cola no futuro */ instructions?: string }

export interface WebhookEvent { providerRef: string; status: PaymentStatus }

export interface PaymentProvider {
  readonly name: string;
  createCharge(o: { amountCents: number; currency: string; description: string; reference: string }): Promise<Charge>;
  getCharge(providerRef: string): Promise<Charge | null>;
  /** valida a assinatura e interpreta o webhook; null se inválido */
  handleWebhook(rawBody: string, headers: Record<string, string | undefined>): Promise<WebhookEvent | null>;
  refund(providerRef: string): Promise<Charge>;
}

/** provedor FALSO (só testes): guarda cobranças em memória; webhook assinado com HMAC de um segredo local */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private charges = new Map<string, Charge>();
  constructor(private secret = 'mock-secret') {
    if (process.env.NODE_ENV === 'production') throw new Error('MockPaymentProvider não pode rodar em produção');
  }

  async createCharge(o: { amountCents: number; currency: string }) {
    const c: Charge = { providerRef: `mock_${randomUUID()}`, status: 'PENDING', amountCents: o.amountCents, currency: o.currency, instructions: 'pagamento simulado' };
    this.charges.set(c.providerRef, c);
    return { ...c };
  }
  async getCharge(ref: string) { const c = this.charges.get(ref); return c ? { ...c } : null; }
  async refund(ref: string) {
    const c = this.charges.get(ref);
    if (!c) throw new Error('cobrança inexistente');
    c.status = 'REFUNDED';
    return { ...c };
  }

  /** simula o PSP: marca a cobrança e devolve um webhook assinado */
  simulate(ref: string, status: PaymentStatus): { body: string; headers: Record<string, string> } {
    const c = this.charges.get(ref);
    if (c) c.status = status;
    const body = JSON.stringify({ providerRef: ref, status });
    return { body, headers: { 'x-mock-signature': createHmac('sha256', this.secret).update(body).digest('hex') } };
  }

  async handleWebhook(raw: string, headers: Record<string, string | undefined>) {
    const sig = Buffer.from(headers['x-mock-signature'] ?? '', 'hex');
    const want = createHmac('sha256', this.secret).update(raw).digest();
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
    try {
      const m = JSON.parse(raw) as WebhookEvent;
      return typeof m.providerRef === 'string' && typeof m.status === 'string' ? m : null;
    } catch { return null; }
  }
}

/** orquestra cobrança → webhook → concessão PAID (idempotente: webhook repetido não duplica a licença) */
export class PaymentService {
  constructor(private store: DataStore, private provider: PaymentProvider) {}

  async startCheckout(userId: string, o: { amountCents: number; eventId: string | null }): Promise<{ payment: PaymentRecord; charge: Charge }> {
    const charge = await this.provider.createCharge({ amountCents: o.amountCents, currency: 'BRL', description: 'Licença de participação', reference: userId });
    const payment = await this.store.payments.create({ userId, provider: this.provider.name, providerRef: charge.providerRef, amountCents: o.amountCents, currency: 'BRL', status: 'PENDING', eventId: o.eventId });
    return { payment, charge };
  }

  /** `paymentId` vem do NOSSO registro (o webhook só traz a referência do provedor) */
  async onWebhook(paymentId: string, raw: string, headers: Record<string, string | undefined>): Promise<AccessRecord | null> {
    const ev = await this.provider.handleWebhook(raw, headers);
    const pay = await this.store.payments.byId(paymentId);
    if (!ev || !pay || pay.providerRef !== ev.providerRef || pay.provider !== this.provider.name) return null;
    // confirma com o provedor (não confia só no corpo do webhook)
    const charge = await this.provider.getCharge(ev.providerRef);
    if (!charge || charge.status !== ev.status) return null;
    if (pay.status !== ev.status) await this.store.payments.update(pay.id, { status: ev.status });
    const existing = (await this.store.access.list(pay.userId)).find((a) => a.paymentId === pay.id);
    if (ev.status === 'PAID' && charge.amountCents === pay.amountCents) {
      if (existing) return existing;
      const g = await this.store.access.grant({ userId: pay.userId, grant: 'PAID', eventId: pay.eventId, source: `payment:${this.provider.name}`, paymentId: pay.id });
      await this.store.audit.append({ actor: `payment:${this.provider.name}`, action: 'GRANT_ACCESS', targetType: 'user', targetId: pay.userId, meta: { grant: 'PAID', paymentId: pay.id } });
      return g;
    }
    if ((ev.status === 'REFUNDED' || ev.status === 'CANCELED') && existing && !existing.revokedAt) {
      await this.store.access.revoke(existing.id);
      await this.store.audit.append({ actor: `payment:${this.provider.name}`, action: 'REVOKE_ACCESS', targetType: 'user', targetId: pay.userId, meta: { paymentId: pay.id, status: ev.status } });
    }
    return null;
  }
}
