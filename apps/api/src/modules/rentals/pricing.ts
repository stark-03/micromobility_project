import type { FareBreakdownDto, PricingPlanDto } from '@mm/shared-types';

/**
 * Fare arithmetic. Pure: no clock, no database.
 *
 * Integer paise throughout. A fare built from floating-point rupees drifts by
 * a paisa here and there, and a receipt that does not add up is worse than no
 * receipt.
 */

/**
 * Minutes billed for a ride of `durationS` seconds.
 *
 * Rounded UP to the next whole minute, which is how shared-mobility operators
 * bill — but a ride of zero seconds is zero minutes, not one: an unlock
 * immediately followed by a lock (wrong vehicle, flat tyre) should cost only
 * the unlock fee.
 */
export function billedMinutes(durationS: number): number {
  if (durationS <= 0) return 0;
  return Math.ceil(durationS / 60);
}

export function computeFare(plan: PricingPlanDto, durationS: number): FareBreakdownDto {
  const minutes = billedMinutes(durationS);
  const timeFee = minutes * plan.perMinuteMinor;
  const subtotal = plan.unlockFeeMinor + timeFee;
  const topUp = Math.max(0, plan.minimumFareMinor - subtotal);

  return {
    currency: plan.currency,
    unlockFeeMinor: plan.unlockFeeMinor,
    timeFeeMinor: timeFee,
    minutes,
    minimumTopUpMinor: topUp,
    totalMinor: subtotal + topUp,
  };
}

/** DECIMAL(12,4) rupees as stored → integer paise as the API speaks. */
export function toMinor(decimal: string | number): number {
  return Math.round(Number(decimal) * 100);
}

/** Integer paise → the DECIMAL string MySQL stores, without float rounding. */
export function fromMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}00`;
}
