import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Wallet, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

type PaymentMethod = 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer' | 'check' | 'mobile_payment' | 'other';
type ExpenseAccount = { id: string; code: string; name: string };
type ExpenseRow = {
  id: string; expense_number: string; description: string; vendor_name: string;
  reference_number: string; incurred_on: string; due_on: string | null;
  amount: number | string; amount_paid: number | string; notes: string | null;
  expense_account: { code: string; name: string } | null;
  reversal: { id: string; reason: string; reference_number: string } | null;
  refunds: { id: string; amount: number | string; refunded_on: string; reference_number: string }[];
};

type ExpenseQuery = {
  eq: (column: string, value: unknown) => ExpenseQuery;
  order: (column: string, options?: { ascending?: boolean }) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};
type ExpenseApi = {
  from: (table: string) => { select: (columns: string) => ExpenseQuery };
  rpc: (name: 'record_operating_expense' | 'pay_operating_expense' | 'reverse_unpaid_operating_expense' | 'record_operating_expense_refund', args: Record<string, unknown>) =>
    PromiseLike<{ data: string | null; error: { message: string } | null }>;
};

const expenseApi = supabase as unknown as ExpenseApi;
const today = () => format(new Date(), 'yyyy-MM-dd');
const money = (value: number | string, currency: string) =>
  `${currency}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function OperatingExpenseRegister({ currencySymbol }: { currencySymbol: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [settlement, setSettlement] = useState<ExpenseRow | null>(null);
  const [reversal, setReversal] = useState<ExpenseRow | null>(null);
  const [reversalForm, setReversalForm] = useState({ reason: '', reference: '' });
  const [refund, setRefund] = useState<ExpenseRow | null>(null);
  const [refundForm, setRefundForm] = useState({ amount: '', refundedOn: today(), method: 'cash' as PaymentMethod, reference: '' });
  const [form, setForm] = useState({
    description: '', vendor: '', reference: '', accountId: '', incurredOn: today(),
    dueOn: '', amount: '', amountPaid: '0', paymentMethod: 'cash' as PaymentMethod,
    paymentReference: '', notes: '',
  });
  const [payment, setPayment] = useState({ amount: '', paidOn: today(), method: 'cash' as PaymentMethod, reference: '' });

  const accountsQuery = useQuery({
    queryKey: ['operating-expense-accounts'],
    queryFn: async (): Promise<ExpenseAccount[]> => {
      const { data, error } = await expenseApi.from('chart_of_accounts')
        .select('id, code, name')
        .eq('account_type', 'expense')
        .eq('is_active', true)
        .order('code');
      if (error) throw error;
      return (data || []) as ExpenseAccount[];
    },
  });

  const expensesQuery = useQuery({
    queryKey: ['operating-expenses'],
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await expenseApi.from('operating_expenses')
        .select('id, expense_number, description, vendor_name, reference_number, incurred_on, due_on, amount, amount_paid, notes, expense_account:chart_of_accounts(code, name), reversal:operating_expense_reversals(id, reason, reference_number), refunds:operating_expense_refunds(id, amount, refunded_on, reference_number)')
        .order('incurred_on', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ExpenseRow[];
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const channel = supabase.channel('operating-expense-register-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operating_expenses' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['operating-expenses'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operating_expense_refunds' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['operating-expenses'] });
        void queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
        void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operating_expense_payments' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['operating-expenses'] });
        void queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
        void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  const refreshAccounting = () => {
    void queryClient.invalidateQueries({ queryKey: ['operating-expenses'] });
    void queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
    void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
  };

  const createExpense = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount);
      const amountPaid = Number(form.amountPaid || 0);
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > amount) {
        throw new Error('Enter a valid total amount and an amount paid between zero and the total.');
      }
      if (!form.description.trim() || !form.vendor.trim() || !form.reference.trim() || !form.accountId || !form.incurredOn) {
        throw new Error('Complete the description, supplier, source reference, expense account and incurred date.');
      }
      if (amountPaid > 0 && !form.paymentReference.trim()) {
        throw new Error('A payment reference is required when an amount has already been paid.');
      }
      const { error } = await expenseApi.rpc('record_operating_expense', {
        p_description: form.description.trim(),
        p_vendor_name: form.vendor.trim(),
        p_reference_number: form.reference.trim(),
        p_expense_account_id: form.accountId,
        p_incurred_on: form.incurredOn,
        p_due_on: form.dueOn || null,
        p_amount: amount,
        p_amount_paid: amountPaid,
        p_payment_method: form.paymentMethod,
        p_payment_reference: form.paymentReference.trim() || null,
        p_notes: form.notes.trim() || null,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAccounting();
      toast({ title: 'Operating expense recorded', description: 'The expense and supplier payable have been posted. Any initial payment is recorded separately.' });
      setOpen(false);
      setForm({ description: '', vendor: '', reference: '', accountId: '', incurredOn: today(), dueOn: '', amount: '', amountPaid: '0', paymentMethod: 'cash', paymentReference: '', notes: '' });
    },
    onError: error => toast({ title: 'Could not record expense', description: error.message, variant: 'destructive' }),
  });

  const settleExpense = useMutation({
    mutationFn: async () => {
      if (!settlement) throw new Error('Select an expense to settle.');
      const amount = Number(payment.amount);
      if (!Number.isFinite(amount) || amount <= 0 || !payment.reference.trim()) {
        throw new Error('Enter a positive payment amount and a payment reference.');
      }
      const { error } = await expenseApi.rpc('pay_operating_expense', {
        p_expense_id: settlement.id,
        p_amount: amount,
        p_paid_on: payment.paidOn,
        p_payment_method: payment.method,
        p_reference_number: payment.reference.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAccounting();
      toast({ title: 'Expense payment recorded', description: 'The supplier payable and cash/bank balance have been updated.' });
      setSettlement(null);
      setPayment({ amount: '', paidOn: today(), method: 'cash', reference: '' });
    },
    onError: error => toast({ title: 'Could not record payment', description: error.message, variant: 'destructive' }),
  });

  const reverseExpense = useMutation({
    mutationFn: async () => {
      if (!reversal) throw new Error('Select an expense to reverse.');
      if (!reversalForm.reason.trim() || !reversalForm.reference.trim()) {
        throw new Error('A reason and supporting reference are required.');
      }
      const { error } = await expenseApi.rpc('reverse_unpaid_operating_expense', {
        p_expense_id: reversal.id,
        p_reason: reversalForm.reason.trim(),
        p_reference_number: reversalForm.reference.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAccounting();
      toast({ title: 'Unpaid expense reversed', description: 'The original expense remains in history and an auditable reversing journal has been posted.' });
      setReversal(null);
      setReversalForm({ reason: '', reference: '' });
    },
    onError: error => toast({ title: 'Could not reverse expense', description: error.message, variant: 'destructive' }),
  });

  const recordRefund = useMutation({
    mutationFn: async () => {
      if (!refund) throw new Error('Select a reversed expense.');
      const amount = Number(refundForm.amount);
      const refunded = (refund.refunds || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const refundable = Math.max(0, Number(refund.amount_paid || 0) - refunded);
      if (!Number.isFinite(amount) || amount <= 0 || amount > refundable || !refundForm.reference.trim()) {
        throw new Error('Enter a positive refund within the unrefunded amount actually paid, with a supporting reference.');
      }
      const { error } = await expenseApi.rpc('record_operating_expense_refund', {
        p_expense_id: refund.id,
        p_amount: amount,
        p_refunded_on: refundForm.refundedOn,
        p_payment_method: refundForm.method,
        p_reference_number: refundForm.reference.trim(),
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshAccounting();
      toast({ title: 'Supplier refund recorded', description: 'The actual cash/bank receipt and Accounts Payable clearing have been posted.' });
      setRefund(null);
      setRefundForm({ amount: '', refundedOn: today(), method: 'cash', reference: '' });
    },
    onError: error => toast({ title: 'Could not record supplier refund', description: error.message, variant: 'destructive' }),
  });

  const totals = useMemo(() => (expensesQuery.data || []).reduce((result, expense) => {
    result.incurred += Number(expense.amount || 0);
    result.paid += Number(expense.amount_paid || 0);
    return result;
  }, { incurred: 0, paid: 0 }), [expensesQuery.data]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" />Operating Expense Register</CardTitle>
            <CardDescription>Record supplier and business expenses, track settlements, and process evidenced reversals and supplier refunds without deleting original ledger history.</CardDescription>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Record Expense</Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Expenses incurred</p><p className="text-xl font-semibold">{money(totals.incurred, currencySymbol)}</p></div>
            <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Paid to date</p><p className="text-xl font-semibold">{money(totals.paid, currencySymbol)}</p></div>
            <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Outstanding suppliers</p><p className="text-xl font-semibold">{money(totals.incurred - totals.paid, currencySymbol)}</p></div>
          </div>
          {expensesQuery.isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> :
            expensesQuery.isError ? <div className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">Could not load operating expenses. Check finance-role access and refresh.</div> :
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="p-2">Date / Reference</th><th className="p-2">Supplier / Description</th><th className="p-2">Account</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Refunded</th><th className="p-2 text-right">Balance</th><th className="p-2">Status</th><th className="p-2"></th>
                </tr></thead>
                <tbody>
                  {(expensesQuery.data || []).map(expense => {
                    const amount = Number(expense.amount || 0);
                    const paid = Number(expense.amount_paid || 0);
                    const refunded = (expense.refunds || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
                    const refundDue = expense.reversal ? Math.max(0, paid - refunded) : 0;
                    const outstanding = expense.reversal ? 0 : Math.max(0, amount - paid);
                    return <tr key={expense.id} className="border-b">
                      <td className="p-2"><div>{format(new Date(expense.incurred_on), 'dd MMM yyyy')}</div><div className="text-xs text-muted-foreground">{expense.expense_number} · {expense.reference_number}</div></td>
                      <td className="p-2"><div className="font-medium">{expense.vendor_name}</div><div className="text-muted-foreground">{expense.description}</div></td>
                      <td className="p-2">{expense.expense_account?.code} · {expense.expense_account?.name}</td>
                      <td className="p-2 text-right">{money(amount, currencySymbol)}</td>
                      <td className="p-2 text-right">{money(paid, currencySymbol)}</td>
                      <td className="p-2 text-right">{money(refunded, currencySymbol)}</td>
                      <td className="p-2 text-right font-medium">{money(outstanding, currencySymbol)}</td>
                      <td className="p-2">{expense.reversal ? <Badge variant="destructive">Reversed</Badge> : outstanding <= 0 ? <Badge>Paid</Badge> : paid > 0 ? <Badge variant="secondary">Part paid</Badge> : <Badge variant="outline">Unpaid</Badge>}</td>
                      <td className="p-2 text-right"><div className="flex justify-end gap-2">{outstanding > 0 && <Button size="sm" variant="outline" onClick={() => { setSettlement(expense); setPayment({ amount: outstanding.toFixed(2), paidOn: today(), method: 'cash', reference: '' }); }}>Settle</Button>}{!expense.reversal && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setReversal(expense); setReversalForm({ reason: '', reference: '' }); }}>Reverse</Button>}{refundDue > 0 && <Button size="sm" variant="outline" onClick={() => { setRefund(expense); setRefundForm({ amount: refundDue.toFixed(2), refundedOn: today(), method: 'cash', reference: '' }); }}>Record refund</Button>}</div></td>
                    </tr>;
                  })}
                </tbody>
              </table>
              {(expensesQuery.data || []).length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No operating expenses have been recorded.</p>}
            </div>}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Posted expenses and payments cannot be edited or deleted. Corrections require an audited reversal.</span>
            <Button variant="ghost" size="sm" onClick={refreshAccounting}><RefreshCw className="mr-2 h-3 w-3" />Refresh</Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Record Operating Expense</DialogTitle><DialogDescription>The expense is recognized on the incurred date. Any unpaid amount is posted to Accounts Payable.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Office rent for November" /></div>
            <div className="space-y-2"><Label>Supplier / Payee</Label><Input value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /></div>
            <div className="space-y-2"><Label>Supplier invoice / reference</Label><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Expense account</Label>
              <Select value={form.accountId} onValueChange={value => setForm({ ...form, accountId: value })}>
                <SelectTrigger><SelectValue placeholder="Choose an expense account" /></SelectTrigger>
                <SelectContent>{(accountsQuery.data || []).filter(account => !['5000', '6500'].includes(account.code)).map(account => <SelectItem key={account.id} value={account.id}>{account.code} · {account.name}</SelectItem>)}</SelectContent>
              </Select>
              {accountsQuery.isError && <p className="text-xs text-destructive">Expense accounts could not be loaded.</p>}
            </div>
            <div className="space-y-2"><Label>Incurred date</Label><Input type="date" value={form.incurredOn} onChange={e => setForm({ ...form, incurredOn: e.target.value })} /></div>
            <div className="space-y-2"><Label>Due date (optional)</Label><Input type="date" min={form.incurredOn} value={form.dueOn} onChange={e => setForm({ ...form, dueOn: e.target.value })} /></div>
            <div className="space-y-2"><Label>Total expense amount</Label><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="space-y-2"><Label>Amount already paid</Label><Input type="number" min="0" step="0.01" max={form.amount || undefined} value={form.amountPaid} onChange={e => setForm({ ...form, amountPaid: e.target.value })} /></div>
            {Number(form.amountPaid) > 0 && <>
              <div className="space-y-2"><Label>Payment method</Label><Select value={form.paymentMethod} onValueChange={value => setForm({ ...form, paymentMethod: value as PaymentMethod })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="mobile_payment">Mobile Money</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Payment reference</Label><Input value={form.paymentReference} onChange={e => setForm({ ...form, paymentReference: e.target.value })} /></div>
            </>}
            <div className="space-y-2 sm:col-span-2"><Label>Notes (optional)</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={createExpense.isPending || accountsQuery.isLoading} onClick={() => createExpense.mutate()}>{createExpense.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Post Expense</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reversal} onOpenChange={value => { if (!value) setReversal(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reverse Supplier Expense</DialogTitle><DialogDescription>{reversal?.expense_number} · {reversal ? money(Number(reversal.amount), currencySymbol) : ''}. The full expense is reversed against Accounts Payable; amounts already paid remain due from the supplier until actually refunded.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-3">
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">This does not fabricate a refund or erase payments. Record each supplier refund separately only after funds are received, using its actual cash/bank method and reference.</div>
            <div className="space-y-2"><Label>Reason for reversal *</Label><Textarea value={reversalForm.reason} onChange={e => setReversalForm({ ...reversalForm, reason: e.target.value })} placeholder="Explain why this expense is being reversed" /></div>
            <div className="space-y-2"><Label>Supporting document / approval reference *</Label><Input value={reversalForm.reference} onChange={e => setReversalForm({ ...reversalForm, reference: e.target.value })} placeholder="Credit note, cancellation or approval reference" /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReversal(null)}>Cancel</Button><Button variant="destructive" disabled={reverseExpense.isPending || !reversalForm.reason.trim() || !reversalForm.reference.trim()} onClick={() => reverseExpense.mutate()}>{reverseExpense.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Post Reversal</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refund} onOpenChange={value => { if (!value) setRefund(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Supplier Refund</DialogTitle><DialogDescription>{refund?.expense_number} · Maximum refundable {refund ? money(Math.max(0, Number(refund.amount_paid) - (refund.refunds || []).reduce((sum, item) => sum + Number(item.amount || 0), 0)), currencySymbol) : ''}. Record only funds actually received.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2"><Label>Refund amount</Label><Input type="number" min="0.01" step="0.01" value={refundForm.amount} onChange={e => setRefundForm({ ...refundForm, amount: e.target.value })} /></div>
            <div className="space-y-2"><Label>Funds received date</Label><Input type="date" min={refund?.incurred_on} value={refundForm.refundedOn} onChange={e => setRefundForm({ ...refundForm, refundedOn: e.target.value })} /></div>
            <div className="space-y-2"><Label>Received into</Label><Select value={refundForm.method} onValueChange={value => setRefundForm({ ...refundForm, method: value as PaymentMethod })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="bank_transfer">Bank</SelectItem><SelectItem value="mobile_payment">Mobile Money</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Supplier refund / bank reference</Label><Input value={refundForm.reference} onChange={e => setRefundForm({ ...refundForm, reference: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRefund(null)}>Cancel</Button><Button disabled={recordRefund.isPending} onClick={() => recordRefund.mutate()}>{recordRefund.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Post Refund</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!settlement} onOpenChange={value => { if (!value) setSettlement(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Settle Supplier Expense</DialogTitle><DialogDescription>{settlement?.expense_number} · Outstanding {settlement ? money(Number(settlement.amount) - Number(settlement.amount_paid), currencySymbol) : ''}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2"><Label>Payment amount</Label><Input type="number" min="0.01" step="0.01" value={payment.amount} onChange={e => setPayment({ ...payment, amount: e.target.value })} /></div>
            <div className="space-y-2"><Label>Payment date</Label><Input type="date" min={settlement?.incurred_on} value={payment.paidOn} onChange={e => setPayment({ ...payment, paidOn: e.target.value })} /></div>
            <div className="space-y-2"><Label>Payment method</Label><Select value={payment.method} onValueChange={value => setPayment({ ...payment, method: value as PaymentMethod })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="bank_transfer">Bank transfer</SelectItem><SelectItem value="mobile_payment">Mobile Money</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Payment reference</Label><Input value={payment.reference} onChange={e => setPayment({ ...payment, reference: e.target.value })} /></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSettlement(null)}>Cancel</Button><Button disabled={settleExpense.isPending} onClick={() => settleExpense.mutate()}>{settleExpense.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record Payment</Button></div>
        </DialogContent>
      </Dialog>
    </>
  );
}
