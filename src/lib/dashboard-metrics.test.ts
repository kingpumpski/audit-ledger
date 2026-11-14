import { describe, expect, it } from 'vitest';
import { sumCashReceivedInPeriod } from './dashboard-metrics';

describe('sumCashReceivedInPeriod', () => {
  const start = new Date('2026-11-01T00:00:00.000Z');
  const end = new Date('2026-11-30T23:59:59.999Z');

  it('counts invoice payments once and adds standalone issued receipts', () => {
    const payments = [
      { amount: 120, payment_date: '2026-11-03T00:00:00.000Z' },
      { amount: 80.5, payment_date: '2026-11-30T23:59:59.999Z' },
      { amount: 200, payment_date: '2026-10-31T23:59:59.999Z' },
    ];
    const receipts = [
      { amount: 120, issue_date: '2026-11-03T00:00:00.000Z', status: 'issued', payment_id: 'payment-1' },
      { amount: 50, issue_date: '2026-11-10T00:00:00.000Z', status: 'issued', payment_id: null },
      { amount: 25, issue_date: '2026-11-12T00:00:00.000Z', status: 'void', payment_id: null },
      { amount: 40, issue_date: '2026-10-31T23:59:59.999Z', status: 'issued', payment_id: null },
    ];

    expect(sumCashReceivedInPeriod(payments, receipts, start, end)).toBe(250.5);
  });

  it('uses payment date and ignores invalid dates or non-positive amounts', () => {
    const payments = [
      { amount: 10, payment_date: null, created_at: '2026-11-05T00:00:00.000Z' },
      { amount: Number.NaN, payment_date: '2026-11-06T00:00:00.000Z' },
      { amount: -10, payment_date: '2026-11-07T00:00:00.000Z' },
      { amount: 20, payment_date: 'not-a-date' },
    ];
    expect(sumCashReceivedInPeriod(payments, [], start, end)).toBe(10);
  });

  it('returns zero for invalid or reversed ranges', () => {
    expect(sumCashReceivedInPeriod([], [], new Date('invalid'), end)).toBe(0);
    expect(sumCashReceivedInPeriod([], [], end, start)).toBe(0);
  });
});
