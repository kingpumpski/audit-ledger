import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowRightLeft, Loader2, Printer, RefreshCw, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/error-message';
import { supabase } from '@/integrations/supabase/client';

interface CustomerCreditBalance {
  credit_note_id: string;
  credit_note_number: string;
  original_invoice_id: string;
  original_invoice_number: string;
  credit_note_date: string;
  reason: string;
  credit_amount: number;
  applied_amount: number;
  refunded_amount: number;
  remaining_amount: number;
  can_manage: boolean;
}

interface OutstandingInvoice {
  id: string;
  invoice_number: string;
  issue_date: string;
  balance_due: number;
  status: string;
}

interface CustomerCreditManagementProps {
  customerId: string;
  customerName?: string;
  currencySymbol: string;
}

interface CreditNoteHistoryLine {
  id: string;
  description: string;
  quantity: number;
  net_amount: number;
  tax_amount: number;
  total_amount: number;
  credit_note_line_taxes?: Array<{ tax_name: string; tax_code: string; tax_rate: number; taxable_amount: number; tax_amount: number }>;
}
interface CreditNoteHistory {
  id: string;
  credit_note_number: string;
  invoice_id: string;
  invoices?: { invoice_number: string };
  credit_note_date: string;
  reason: string;
  reference_number: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  receivable_applied: number;
  customer_credit_amount: number;
  credit_note_lines?: CreditNoteHistoryLine[];
  customer_credit_applications?: Array<{ amount: number; applied_on: string; reference_number: string; applied_to_invoice_id: string; invoices?: { invoice_number: string } }>;
  customer_credit_refunds?: Array<{ amount: number; refunded_on: string; payment_method: string; reference_number: string }>;
}
type CreditHistoryQuery = {
  select(columns: string): CreditHistoryQuery;
  eq(column: string, value: string): CreditHistoryQuery;
  order(column: string, options: { ascending: boolean }): CreditHistoryQuery;
  then<TResult1 = { data: unknown[] | null; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
};
function escapePrintText(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] || character);
}
function printCreditNote(note: CreditNoteHistory, currencySymbol: string, originalInvoiceNumber: string, customerName = '') {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  const money = (value: number) => `${escapePrintText(currencySymbol)}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lineRows = (note.credit_note_lines || []).map((line) => {
    const taxes = (line.credit_note_line_taxes || []).map((tax) =>
      `<div class="muted">${escapePrintText(tax.tax_name)} (${escapePrintText(tax.tax_code)}) · ${Number(tax.tax_rate).toFixed(2)}% · ${money(tax.tax_amount)}</div>`
    ).join('');
    return `<tr><td>${escapePrintText(line.description)}${taxes}</td><td class="num">${Number(line.quantity).toLocaleString()}</td><td class="num">${money(line.net_amount)}</td><td class="num">${money(line.tax_amount)}</td><td class="num">${money(line.total_amount)}</td></tr>`;
  }).join('');
  const applications = (note.customer_credit_applications || []).map((entry) =>
    `<tr><td>Applied to invoice ${escapePrintText(entry.invoices?.invoice_number || entry.applied_to_invoice_id)}</td><td>${escapePrintText(entry.applied_on)}</td><td>${escapePrintText(entry.reference_number)}</td><td class="num">${money(entry.amount)}</td></tr>`
  ).join('');
  const refunds = (note.customer_credit_refunds || []).map((entry) =>
    `<tr><td>Customer refund · ${escapePrintText(entry.payment_method.replace(/_/g, ' '))}</td><td>${escapePrintText(entry.refunded_on)}</td><td>${escapePrintText(entry.reference_number)}</td><td class="num">${money(entry.amount)}</td></tr>`
  ).join('');
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapePrintText(note.credit_note_number)}</title><style>
    body{font:14px Arial,sans-serif;color:#172033;margin:36px}h1{font-size:24px;margin:0 0 6px}.muted{color:#667085;font-size:12px;margin-top:4px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:24px 0}.meta div{padding:10px;background:#f6f7f9}
    table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:9px;border-bottom:1px solid #d9dee7;text-align:left;vertical-align:top}th{background:#f6f7f9}
    .num{text-align:right;white-space:nowrap}.totals{margin:18px 0 0 auto;width:320px}.totals div{display:flex;justify-content:space-between;padding:5px}
    @media print{body{margin:14mm}}
  </style></head><body><h1>Credit Note</h1><div class="muted">${escapePrintText(note.credit_note_number)}</div>
  <div class="meta"><div><b>Customer</b><br>${escapePrintText(customerName)}</div><div><b>Original invoice</b><br>${escapePrintText(originalInvoiceNumber)}</div><div><b>Credit date</b><br>${escapePrintText(note.credit_note_date)}</div>
  <div><b>Supporting reference</b><br>${escapePrintText(note.reference_number)}</div><div><b>Reason</b><br>${escapePrintText(note.reason)}</div></div>
  <table><thead><tr><th>Description / tax evidence</th><th class="num">Qty</th><th class="num">Net</th><th class="num">Tax</th><th class="num">Total</th></tr></thead><tbody>${lineRows || '<tr><td colspan="5">No credit lines recorded</td></tr>'}</tbody></table>
  <div class="totals"><div><span>Subtotal</span><b>${money(note.subtotal)}</b></div><div><span>Tax credited</span><b>${money(note.tax_amount)}</b></div><div><span>Total credit</span><b>${money(note.total_amount)}</b></div><div><span>Applied to receivable</span><b>${money(note.receivable_applied)}</b></div><div><span>Customer credit created</span><b>${money(note.customer_credit_amount)}</b></div></div>
  <h3>Customer credit settlement history</h3><table><thead><tr><th>Type</th><th>Date</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${applications}${refunds}${applications || refunds ? '' : '<tr><td colspan="4">No customer-credit settlement recorded</td></tr>'}</tbody></table>
  <script>window.addEventListener('load',()=>{window.focus();window.print();});</script></body></html>`);
  printWindow.document.close();
  return true;
}


function todayValue() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

type RpcResult<T> = { data: T | null; error: { message: string } | null };
const rpc = supabase.rpc as unknown as (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<RpcResult<string>>;

export function CustomerCreditManagement({ customerId, customerName = '', currencySymbol }: CustomerCreditManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCredit, setSelectedCredit] = useState<CustomerCreditBalance | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [targetInvoiceId, setTargetInvoiceId] = useState('');
  const [applyAmount, setApplyAmount] = useState('');
  const [applyDate, setApplyDate] = useState(todayValue);
  const [applyReference, setApplyReference] = useState('');
  const [applyKey, setApplyKey] = useState(() => crypto.randomUUID());
  const [refundAmount, setRefundAmount] = useState('');
  const [refundDate, setRefundDate] = useState(todayValue);
  const [refundMethod, setRefundMethod] = useState('bank_transfer');
  const [refundReference, setRefundReference] = useState('');
  const [refundKey, setRefundKey] = useState(() => crypto.randomUUID());
  const [isApplying, setIsApplying] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);

  const historyQuery = useQuery({
    queryKey: ['customer-credit-note-history', customerId],
    queryFn: async () => {
      const db = supabase as unknown as { from: (table: string) => CreditHistoryQuery };
      const { data, error } = await db.from('credit_notes')
        .select('id, credit_note_number, invoice_id, invoices(invoice_number), credit_note_date, reason, reference_number, subtotal, tax_amount, total_amount, receivable_applied, customer_credit_amount, credit_note_lines(id, description, quantity, net_amount, tax_amount, total_amount, credit_note_line_taxes(tax_name, tax_code, tax_rate, taxable_amount, tax_amount)), customer_credit_applications(amount, applied_on, reference_number, applied_to_invoice_id, invoices(invoice_number)), customer_credit_refunds(amount, refunded_on, payment_method, reference_number)')
        .eq('customer_id', customerId)
        .order('credit_note_date', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as unknown as CreditNoteHistory[];
    },
    enabled: !!customerId,
  });


  const balancesQuery = useQuery({
    queryKey: ['customer-credit-balances', customerId],
    queryFn: async () => {
      const { data, error } = await rpc('get_customer_credit_balances', { p_customer_id: customerId });
      if (error) throw new Error(error.message);
      return (data || []) as unknown as CustomerCreditBalance[];
    },
    enabled: !!customerId,
  });

  const invoicesQuery = useQuery({
    queryKey: ['customer-credit-outstanding-invoices', customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, issue_date, balance_due, status')
        .eq('customer_id', customerId)
        .is('deleted_at', null)
        .in('status', ['issued', 'partially_paid', 'overdue'])
        .gt('balance_due', 0)
        .order('issue_date', { ascending: false });
      if (error) throw error;
      return (data || []) as OutstandingInvoice[];
    },
    enabled: !!customerId,
  });

  const refreshFinancialViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['customer-credit-balances', customerId] }),
      queryClient.invalidateQueries({ queryKey: ['customer-credit-outstanding-invoices', customerId] }),
      queryClient.invalidateQueries({ queryKey: ['customer-invoices', customerId] }),
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
      queryClient.invalidateQueries({ queryKey: ['customer-account-balances'] }),
      queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] }),
    ]);
  };

  const openApply = (credit: CustomerCreditBalance) => {
    setSelectedCredit(credit);
    setApplyAmount(credit.remaining_amount.toFixed(2));
    setApplyDate(todayValue());
    setApplyReference('');
    setTargetInvoiceId(invoicesQuery.data?.[0]?.id || '');
    setApplyKey(crypto.randomUUID());
    setApplyOpen(true);
  };

  const openRefund = (credit: CustomerCreditBalance) => {
    setSelectedCredit(credit);
    setRefundAmount(credit.remaining_amount.toFixed(2));
    setRefundDate(todayValue());
    setRefundMethod('bank_transfer');
    setRefundReference('');
    setRefundKey(crypto.randomUUID());
    setRefundOpen(true);
  };

  const handleApply = async () => {
    if (!selectedCredit || !targetInvoiceId || !applyReference.trim()) {
      toast({ title: 'Complete the credit application', description: 'Select an outstanding invoice and enter a reference.', variant: 'destructive' });
      return;
    }
    const amount = Number(applyAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedCredit.remaining_amount || amount !== Number(amount.toFixed(2))) {
      toast({ title: 'Invalid application amount', description: 'Enter a positive amount in two-decimal currency precision, not exceeding the available credit.', variant: 'destructive' });
      return;
    }

    setIsApplying(true);
    try {
      const { error } = await rpc('apply_customer_credit', {
        p_credit_note_id: selectedCredit.credit_note_id,
        p_invoice_id: targetInvoiceId,
        p_amount: amount,
        p_applied_on: applyDate,
        p_reference_number: applyReference.trim(),
        p_idempotency_key: applyKey,
      });
      if (error) throw new Error(error.message);
      await refreshFinancialViews();
      toast({ title: 'Customer credit applied', description: 'The target invoice receivable and customer-credit liability have been updated.' });
      setApplyOpen(false);
      setSelectedCredit(null);
    } catch (error) {
      toast({ title: 'Credit could not be applied', description: getErrorMessage(error, 'Check the invoice balance and available customer credit.'), variant: 'destructive' });
    } finally {
      setIsApplying(false);
    }
  };

  const handleRefund = async () => {
    if (!selectedCredit || !refundReference.trim()) {
      toast({ title: 'Complete the refund details', description: 'A supporting refund reference is required.', variant: 'destructive' });
      return;
    }
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedCredit.remaining_amount || amount !== Number(amount.toFixed(2))) {
      toast({ title: 'Invalid refund amount', description: 'Enter a positive amount in two-decimal currency precision, not exceeding the available credit.', variant: 'destructive' });
      return;
    }

    setIsRefunding(true);
    try {
      const { error } = await rpc('refund_customer_credit', {
        p_credit_note_id: selectedCredit.credit_note_id,
        p_amount: amount,
        p_refunded_on: refundDate,
        p_payment_method: refundMethod,
        p_reference_number: refundReference.trim(),
        p_idempotency_key: refundKey,
      });
      if (error) throw new Error(error.message);
      await refreshFinancialViews();
      toast({ title: 'Customer refund recorded', description: 'The customer-credit liability and cash/bank journal have been updated.' });
      setRefundOpen(false);
      setSelectedCredit(null);
    } catch (error) {
      toast({ title: 'Refund could not be recorded', description: getErrorMessage(error, 'Check the available credit and refund details.'), variant: 'destructive' });
    } finally {
      setIsRefunding(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Customer Credit Balances
          </CardTitle>
          <CardDescription>
            Review credit notes, apply available credit to outstanding invoices, or record an actual refund to the customer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {balancesQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : balancesQuery.error ? (
            <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
              {getErrorMessage(balancesQuery.error, 'Customer credit balances are available to finance roles only.')}
              <Button className="mt-3" variant="outline" size="sm" onClick={() => balancesQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          ) : !balancesQuery.data?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No customer credit notes have been issued.</p>
          ) : (
            <div className="space-y-3">
              {balancesQuery.data.map((credit) => (
                <div key={credit.credit_note_id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{credit.credit_note_number}</span>
                        <Badge variant={credit.remaining_amount > 0 ? 'default' : 'secondary'}>
                          {credit.remaining_amount > 0 ? 'Credit available' : 'Fully settled'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Against {credit.original_invoice_number} · {format(new Date(credit.credit_note_date), 'MMM d, yyyy')}
                      </p>
                      <p className="mt-1 text-sm">{credit.reason}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-xs text-muted-foreground">Available credit</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {currencySymbol}{Number(credit.remaining_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>Customer credit created: {currencySymbol}{Number(credit.credit_amount).toFixed(2)}</div>
                    <div>Applied: {currencySymbol}{Number(credit.applied_amount).toFixed(2)}</div>
                    <div>Refunded: {currencySymbol}{Number(credit.refunded_amount).toFixed(2)}</div>
                  </div>
                  {credit.remaining_amount > 0 && credit.can_manage && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => openApply(credit)} disabled={!invoicesQuery.data?.length}>
                        <ArrowRightLeft className="mr-2 h-4 w-4" /> Apply to invoice
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openRefund(credit)}>
                        Refund customer
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credit Note History</CardTitle>
          <CardDescription>All issued credit notes, including credits fully applied to receivables, with original tax evidence and settlement references.</CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : historyQuery.error ? (
            <div className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">
              {getErrorMessage(historyQuery.error, 'Credit-note history could not be loaded.')}
              <Button className="mt-2" size="sm" variant="outline" onClick={() => historyQuery.refetch()}>Retry</Button>
            </div>
          ) : !historyQuery.data?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No credit notes have been issued for this customer.</p>
          ) : (
            <div className="space-y-3">
              {historyQuery.data.map((note) => (
                <div key={note.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-semibold">{note.credit_note_number}</div>
                      <div className="text-sm text-muted-foreground">{format(new Date(note.credit_note_date), 'MMM d, yyyy')} · Invoice {note.invoices?.invoice_number || note.invoice_id}</div>
                      <p className="mt-1 text-sm">{note.reason}</p>
                      <p className="text-xs text-muted-foreground">Reference: {note.reference_number}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right font-semibold tabular-nums">{currencySymbol}{Number(note.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <Button size="sm" variant="outline" onClick={() => {
                        const printed = printCreditNote(note, currencySymbol, note.invoices?.invoice_number || note.invoice_id, customerName);
                        if (!printed) toast({ title: 'Pop-up blocked', description: 'Allow pop-ups for this site, then print the credit note again.', variant: 'destructive' });
                      }}><Printer className="mr-2 h-4 w-4" /> Print</Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>Lines: {note.credit_note_lines?.length || 0}</div>
                    <div>Applied to A/R: {currencySymbol}{Number(note.receivable_applied).toFixed(2)}</div>
                    <div>Customer credit: {currencySymbol}{Number(note.customer_credit_amount).toFixed(2)}</div>
                  </div>
                  {(note.customer_credit_applications?.length || note.customer_credit_refunds?.length) ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Settlements: {(note.customer_credit_applications?.length || 0)} applications · {(note.customer_credit_refunds?.length || 0)} refunds
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply customer credit</DialogTitle>
            <DialogDescription>
              This transfers an existing customer-credit liability against an outstanding receivable. It does not record cash received.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Outstanding invoice</span>
              <Select value={targetInvoiceId} onValueChange={(value) => { setApplyKey(crypto.randomUUID()); setTargetInvoiceId(value); }}>
                <SelectTrigger><SelectValue placeholder="Select invoice" /></SelectTrigger>
                <SelectContent>
                  {(invoicesQuery.data || []).map((invoice) => (
                    <SelectItem key={invoice.id} value={invoice.id}>
                      {invoice.invoice_number} · Due {currencySymbol}{Number(invoice.balance_due).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Amount to apply</span>
              <Input type="number" min="0.01" max={selectedCredit?.remaining_amount} step="0.01" value={applyAmount} onChange={(event) => { setApplyKey(crypto.randomUUID()); setApplyAmount(event.target.value); }} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Application date</span>
              <Input type="date" min={selectedCredit?.credit_note_date} value={applyDate} onChange={(event) => { setApplyKey(crypto.randomUUID()); setApplyDate(event.target.value); }} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Reference</span>
              <Input value={applyReference} onChange={(event) => { setApplyKey(crypto.randomUUID()); setApplyReference(event.target.value); }} placeholder="Credit allocation reference" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)} disabled={isApplying}>Cancel</Button>
            <Button onClick={handleApply} disabled={isApplying || !targetInvoiceId}>
              {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Apply credit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund customer credit</DialogTitle>
            <DialogDescription>
              Record an actual cash, bank-transfer or mobile-payment refund against the customer-credit liability. A reference is required for audit evidence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Refund amount</span>
              <Input type="number" min="0.01" max={selectedCredit?.remaining_amount} step="0.01" value={refundAmount} onChange={(event) => { setRefundKey(crypto.randomUUID()); setRefundAmount(event.target.value); }} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Refund date</span>
              <Input type="date" min={selectedCredit?.credit_note_date} value={refundDate} onChange={(event) => { setRefundKey(crypto.randomUUID()); setRefundDate(event.target.value); }} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Payment method</span>
              <Select value={refundMethod} onValueChange={(value) => { setRefundKey(crypto.randomUUID()); setRefundMethod(value); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="mobile_payment">Mobile payment</SelectItem>
                  <SelectItem value="credit_card">Credit card</SelectItem>
                  <SelectItem value="debit_card">Debit card</SelectItem>
                  <SelectItem value="check">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Refund reference</span>
              <Input value={refundReference} onChange={(event) => { setRefundKey(crypto.randomUUID()); setRefundReference(event.target.value); }} placeholder="Bank transfer / cash voucher reference" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)} disabled={isRefunding}>Cancel</Button>
            <Button onClick={handleRefund} disabled={isRefunding}>
              {isRefunding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Record refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
