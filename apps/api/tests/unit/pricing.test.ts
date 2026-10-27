import { describe, expect, it } from 'vitest';
import type { PricingPlanDto } from '@mm/shared-types';
import {
  billedMinutes,
  computeFare,
  fromMinor,
  toMinor,
} from '../../src/modules/rentals/pricing.ts';

const scooter: PricingPlanDto = {
  id: '1',
  vehicleType: 'scooter',
  name: 'E-scooter',
  currency: 'INR',
  unlockFeeMinor: 1000,
  perMinuteMinor: 200,
  minimumFareMinor: 2000,
};

describe('billedMinutes', () => {
  it('rounds a started minute up', () => {
    expect(billedMinutes(1)).toBe(1);
    expect(billedMinutes(60)).toBe(1);
    expect(billedMinutes(61)).toBe(2);
  });

  it('bills nothing for an unlock that was locked again at once', () => {
    expect(billedMinutes(0)).toBe(0);
  });
});

describe('computeFare', () => {
  it('is unlock fee plus per-minute time', () => {
    const fare = computeFare(scooter, 12 * 60);
    expect(fare.unlockFeeMinor).toBe(1000);
    expect(fare.timeFeeMinor).toBe(2400);
    expect(fare.minimumTopUpMinor).toBe(0);
    expect(fare.totalMinor).toBe(3400);
  });

  it('tops a short ride up to the minimum fare, and says so', () => {
    const fare = computeFare(scooter, 90); // 2 minutes → 10 + 4 = ₹14
    expect(fare.minimumTopUpMinor).toBe(600);
    expect(fare.totalMinor).toBe(scooter.minimumFareMinor);
  });

  it('adds up: the parts always sum to the total', () => {
    for (const s of [0, 1, 59, 60, 61, 599, 3600, 7261]) {
      const f = computeFare(scooter, s);
      expect(f.unlockFeeMinor + f.timeFeeMinor + f.minimumTopUpMinor).toBe(f.totalMinor);
    }
  });
});

describe('money conversion', () => {
  it('round-trips paise through the DECIMAL string without float drift', () => {
    for (const minor of [0, 1, 99, 100, 1050, 3400, 123456789]) {
      expect(toMinor(fromMinor(minor))).toBe(minor);
    }
  });

  it('formats as MySQL DECIMAL(12,4)', () => {
    expect(fromMinor(3405)).toBe('34.0500');
    expect(fromMinor(7)).toBe('0.0700');
  });

  it('reads a DECIMAL that float arithmetic would get wrong', () => {
    // 0.1 + 0.2 territory: 10.15 * 100 is 1014.9999999999999 in floating point.
    expect(toMinor('10.1500')).toBe(1015);
  });
});
