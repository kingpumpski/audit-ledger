export interface CashPayment {
  amount: number | null;
  payment_date: string | null;
  created_at?: string | null;
}

export interface CashReceipt {
  amount: number | null;
  issue_date: string | null;
  status: string;
  payment_id: string | null;
}

/**
 * Count invoice payments and standalone issued receipts once.
 * Invoice-linked receipts evidence a payment and must not be added a second time.
 */
export function sumCashReceivedInPeriod(
  payments: readonly CashPayment[],
  receipts: readonly CashReceipt[],
  start: Date,
  end: Date,
): number {
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) return 0;

  const isInPeriod = (value: string | null | undefined) => {
    if (!value) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= startTime && timestamp <= endTime;
  };
  const validAmount = (value: number | null) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };

  const paymentTotal = payments.reduce((sum, payment) =>
    sum + (isInPeriod(payment.payment_date || payment.created_at) ? validAmount(payment.amount) : 0), 0);

  const standaloneReceiptTotal = receipts.reduce((sum, receipt) =>
    sum + (receipt.status === 'issued' && receipt.payment_id === null && isInPeriod(receipt.issue_date)
      ? validAmount(receipt.amount)
      : 0), 0);

  return paymentTotal + standaloneReceiptTotal;
}
