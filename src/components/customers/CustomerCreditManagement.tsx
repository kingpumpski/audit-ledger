import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowRightLeft, Loader2, RefreshCw, Wallet } from 'lucide-react';
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
  currencySymbol: string;
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

export function CustomerCreditManagement({ customerId, currencySymbol }: CustomerCreditManagementProps) {
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
              Record an actual cash or bank refund against the customer-credit liability. A reference is required for audit evidence.
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
                  <SelectItem value="other">Other</SelectItem>
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
