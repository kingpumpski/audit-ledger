export interface ReceiptPeriodAmount {
  status: string;
  amount: number | null;
  created_at: string | null;
}

/**
 * Sum money evidenced by issued receipts within an inclusive date range.
 * This is a cash-received measure; invoice creation dates are not payment dates.
 */
export function sumIssuedReceiptsInPeriod(
  receipts: readonly ReceiptPeriodAmount[],
  start: Date,
  end: Date,
): number {
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) return 0;

  return receipts.reduce((total, receipt) => {
    if (receipt.status !== 'issued' || !receipt.created_at) return total;

    const createdAt = Date.parse(receipt.created_at);
    const amount = Number(receipt.amount);
    if (!Number.isFinite(createdAt) || createdAt < startTime || createdAt > endTime) return total;
    if (!Number.isFinite(amount)) return total;

    return total + amount;
  }, 0);
}
