import { describe, expect, it } from 'vitest';
import { sumIssuedReceiptsInPeriod } from './dashboard-metrics';

describe('sumIssuedReceiptsInPeriod', () => {
  const start = new Date('2026-11-01T00:00:00.000Z');
  const end = new Date('2026-11-30T23:59:59.999Z');

  it('sums issued receipts by receipt date, not invoice creation date', () => {
    const receipts = [
      { status: 'issued', amount: 120, created_at: '2026-11-01T00:00:00.000Z' },
      { status: 'issued', amount: 80.5, created_at: '2026-11-30T23:59:59.999Z' },
      { status: 'void', amount: 40, created_at: '2026-11-15T12:00:00.000Z' },
      { status: 'issued', amount: 200, created_at: '2026-10-31T23:59:59.999Z' },
      { status: 'issued', amount: 300, created_at: '2026-12-01T00:00:00.000Z' },
    ];

    expect(sumIssuedReceiptsInPeriod(receipts, start, end)).toBe(200.5);
  });

  it('ignores missing or invalid dates and non-finite amounts', () => {
    const receipts = [
      { status: 'issued', amount: 10, created_at: null },
      { status: 'issued', amount: 10, created_at: 'not-a-date' },
      { status: 'issued', amount: Number.NaN, created_at: '2026-11-10T00:00:00.000Z' },
    ];

    expect(sumIssuedReceiptsInPeriod(receipts, start, end)).toBe(0);
  });

  it('returns zero for an invalid or reversed date range', () => {
    expect(sumIssuedReceiptsInPeriod([], new Date('invalid'), end)).toBe(0);
    expect(sumIssuedReceiptsInPeriod([], end, start)).toBe(0);
  });
});
