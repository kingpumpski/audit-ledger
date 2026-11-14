import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, Wallet } from 'lucide-react';

type ClearingBalance = { account_code: string; account_name: string; clearing_balance: number };

const today = () => format(new Date(), 'yyyy-MM-dd');
const money = (value: number, currency: string) =>
  `${currency}${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PaymentClearingSettlement({ currencySymbol }: { currencySymbol: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { roles } = useAuth();
  const canSettle = roles.includes('admin') || roles.includes('accountant');
  // Reuse the same key until the server confirms success. If the response is
  // lost after the database commits, retrying the same form is idempotent.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    accountCode: '1020',
    grossAmount: '',
    feeAmount: '0',
    settledOn: today(),
    providerReference: '',
    bankReference: '',
    notes: '',
  });

  const balancesQuery = useQuery({
    queryKey: ['payment-clearing-balances'],
    queryFn: async (): Promise<ClearingBalance[]> => {
      const { data, error } = await supabase.rpc('get_payment_clearing_balances');
      if (error) throw error;
      return (data || []) as ClearingBalance[];
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const settlementsQuery = useQuery({
    queryKey: ['payment-clearing-settlements'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_payment_clearing_settlements');
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const balances = balancesQuery.data || [];
  const settlements = settlementsQuery.data || [];
  const selectedBalance = balances.find(account => account.account_code === form.accountCode)?.clearing_balance ?? 0;

  const settlement = useMutation({
    mutationFn: async () => {
      const gross = Number(form.grossAmount);
      const fees = Number(form.feeAmount || 0);
      if (!Number.isFinite(gross) || gross <= 0 || !Number.isFinite(fees) || fees < 0 || fees >= gross) {
        throw new Error('Enter a valid gross settlement amount and fees lower than the gross amount so a positive bank receipt remains.');
      }
      if (gross > selectedBalance) {
        throw new Error('The gross settlement cannot exceed the available clearing balance.');
      }
      if (!form.providerReference.trim() || !form.bankReference.trim()) {
        throw new Error('Both provider/processor and receiving-bank references are required.');
      }
      const { error } = await supabase.rpc('settle_payment_clearing_account', {
        p_clearing_account_code: form.accountCode,
        p_gross_amount: gross,
        p_fee_amount: fees,
        p_settled_on: form.settledOn,
        p_provider_reference: form.providerReference.trim(),
        p_bank_reference: form.bankReference.trim(),
        p_idempotency_key: idempotencyKey,
        p_notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payment-clearing-balances'] });
      void queryClient.invalidateQueries({ queryKey: ['payment-clearing-settlements'] });
      void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
      toast({ title: 'Clearing settlement posted', description: 'The net bank receipt, processing fees and clearing-account release were journalled together.' });
      setIdempotencyKey(crypto.randomUUID());
      setForm({ accountCode: '1020', grossAmount: '', feeAmount: '0', settledOn: today(), providerReference: '', bankReference: '', notes: '' });
    },
    onError: error => toast({ title: 'Settlement was not posted', description: error.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      {balancesQuery.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Clearing balances could not be loaded: {balancesQuery.error.message}. Do not post a settlement until the balances are available.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {['1020', '1030', '1040'].map(code => {
          const account = balances.find(item => item.account_code === code);
          const label = code === '1020' ? 'Card settlements' : code === '1030' ? 'Mobile money' : 'Undeposited cheques';
          return (
            <Card key={code}>
              <CardHeader className="pb-2">
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-xl tabular-nums">
                  {balancesQuery.isLoading ? 'Loading…' : money(account?.clearing_balance ?? 0, currencySymbol)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{account?.account_name || 'Clearing account'}</CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Record settlement</CardTitle>
          <CardDescription>
            Reconcile processor or cheque-clearing funds into Bank Operating. Enter the gross cleared amount and any deducted fees; the system posts the net bank receipt and fees separately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canSettle ? (
            <p className="text-sm text-muted-foreground">Only admins and accountants can post clearing settlements. Auditors can view balances.</p>
          ) : (
            <form className="grid gap-4 md:grid-cols-2" onSubmit={event => { event.preventDefault(); settlement.mutate(); }}>
              <div className="space-y-2">
                <Label>Clearing account</Label>
                <Select value={form.accountCode} onValueChange={value => setForm(current => ({ ...current, accountCode: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1020">Card Settlement Clearing</SelectItem>
                    <SelectItem value="1030">Mobile Money Clearing</SelectItem>
                    <SelectItem value="1040">Undeposited Cheques</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Available: {money(selectedBalance, currencySymbol)}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearing-settlement-date">Settlement date</Label>
                <Input id="clearing-settlement-date" type="date" max={today()} value={form.settledOn} onChange={event => setForm(current => ({ ...current, settledOn: event.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearing-gross">Gross amount ({currencySymbol})</Label>
                <Input id="clearing-gross" type="number" min="0.01" step="0.01" value={form.grossAmount} onChange={event => setForm(current => ({ ...current, grossAmount: event.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearing-fees">Fees deducted ({currencySymbol})</Label>
                <Input id="clearing-fees" type="number" min="0" step="0.01" value={form.feeAmount} onChange={event => setForm(current => ({ ...current, feeAmount: event.target.value }))} required />
                <p className="text-xs text-muted-foreground">Net bank receipt: {money(Math.max(0, Number(form.grossAmount || 0) - Number(form.feeAmount || 0)), currencySymbol)}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearing-provider-reference">Processor / deposit reference</Label>
                <Input id="clearing-provider-reference" value={form.providerReference} onChange={event => setForm(current => ({ ...current, providerReference: event.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearing-bank-reference">Bank statement reference</Label>
                <Input id="clearing-bank-reference" value={form.bankReference} onChange={event => setForm(current => ({ ...current, bankReference: event.target.value }))} required />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="clearing-notes">Notes</Label>
                <Textarea id="clearing-notes" rows={2} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} />
              </div>
              <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                <Button type="submit" disabled={settlement.isPending || balancesQuery.isLoading || Boolean(balancesQuery.error) || Number(form.grossAmount) > selectedBalance}>
                  {settlement.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Post settlement
                </Button>
                <Button type="button" variant="outline" onClick={() => void balancesQuery.refetch()} disabled={balancesQuery.isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${balancesQuery.isFetching ? 'animate-spin' : ''}`} /> Refresh balances
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlement history</CardTitle>
          <CardDescription>Recent immutable settlement records with processor and bank references.</CardDescription>
        </CardHeader>
        <CardContent>
          {settlementsQuery.isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : settlementsQuery.error ? (
            <p className="text-sm text-destructive">{settlementsQuery.error.message}</p>
          ) : settlements.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No clearing settlements have been recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Date</th><th>Clearing account</th><th>Provider reference</th><th>Bank reference</th>
                    <th className="text-right">Gross</th><th className="text-right">Fees</th><th className="text-right">Net received</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map(item => (
                    <tr key={item.settlement_id}>
                      <td>{format(new Date(item.settled_on), 'dd MMM yyyy')}</td>
                      <td><div className="font-medium">{item.account_name}</div><div className="text-xs text-muted-foreground">{item.account_code}</div></td>
                      <td>{item.provider_reference}</td>
                      <td>{item.bank_reference}</td>
                      <td className="text-right tabular-nums">{money(item.gross_amount, currencySymbol)}</td>
                      <td className="text-right tabular-nums">{money(item.fee_amount, currencySymbol)}</td>
                      <td className="text-right font-medium tabular-nums">{money(item.net_amount, currencySymbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
