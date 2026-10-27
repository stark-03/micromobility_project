import crypto from 'node:crypto';
import { env } from '../../config/env.ts';

/**
 * M14 payment adapter.
 *
 * The rest of the app talks to this interface and never to a provider SDK, so
 * wiring in a real gateway is a new class and an env value — nothing else
 * moves. Whatever the provider, the contract is the same: we send an amount
 * and a reference, we get back the provider's id for the charge and keep only
 * that. No card number, CVV or token ever reaches this process (CLAUDE.md).
 */
export interface ChargeRequest {
  amountMinor: number;
  currency: string;
  /** Our reference for idempotency — the trip's public ref. */
  reference: string;
}

export interface ChargeResult {
  status: 'succeeded' | 'failed';
  providerRef: string | null;
  failureReason: string | null;
}

export interface PaymentGateway {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

/**
 * Approves every charge. For development, tests and the demo.
 *
 * A zero or negative amount is refused, as a real gateway would refuse it: a
 * mock that accepts what production rejects hides bugs until production.
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock';

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
      return {
        status: 'failed',
        providerRef: null,
        failureReason: 'Amount must be a positive whole number of paise',
      };
    }
    return {
      status: 'succeeded',
      providerRef: `mock_pay_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
      failureReason: null,
    };
  }
}

let override: PaymentGateway | null = null;

/** Tests swap in a failing gateway to exercise the retry path. */
export function setPaymentGatewayForTests(gateway: PaymentGateway | null): void {
  override = gateway;
}

export function paymentGateway(): PaymentGateway {
  if (override) return override;
  switch (env.paymentGateway) {
    case 'mock':
      return new MockGateway();
    default:
      throw new Error(
        `PAYMENT_GATEWAY="${env.paymentGateway}" has no adapter. Only "mock" is implemented.`,
      );
  }
}
