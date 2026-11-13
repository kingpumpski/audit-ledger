import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, TrendingUp, TrendingDown, CircleAlert, CircleCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type JournalLine = {
  debit: number;
  credit: number;
  account: { code: string; account_type: string } | null;
};

type JournalEntry = {
  entry_date: string;
  source_type: string;
  lines: JournalLine[];
};

type UncostedInvoiceLine = {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  product_id: string | null;
  invoice_number: string;
  issue_date: string;
  product_name: string | null;
  is_service: boolean;
  direct_cost_amount: number | null;
};

type CostInput = { unitCost: string; reference: string; notes: string; incurredOn: string; paymentMethod: 'cash' | 'bank_transfer' };

export function ProfitAndLossReport({ currencySymbol }: { currencySymbol: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [costInputs, setCostInputs] = useState<Record<string, CostInput>>({});

  const journalQuery = useQuery({
    queryKey: ['profit-loss-journal'],
    queryFn: async (): Promise<JournalEntry[]> => {
      const allEntries: JournalEntry[] = [];
      let offset = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('journal_entries')
          .select('entry_date, source_type, lines:journal_lines(debit, credit, account:chart_of_accounts(code, account_type))')
          .order('entry_date', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        allEntries.push(...((data || []) as unknown as JournalEntry[]));
        if (!data || data.length < pageSize) break;
        offset += pageSize;
      }
      return allEntries;
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const costCoverageQuery = useQuery({
    queryKey: ['profit-loss-cost-coverage'],
    queryFn: async () => {
      const pageSize = 1000;
      const invoices: Array<{ id: string; invoice_number: string; issue_date: string | null }> = [];
      const missingItems: Array<{ id: string; invoice_id: string; description: string; quantity: number; unit_price: number; product_id: string | null }> = [];
      const products: Array<{ id: string; name: string; is_service: boolean }> = [];
      const { data: directCosts, error: directCostsError } = await (supabase as any)
        .from('invoice_item_direct_costs')
        .select('invoice_item_id, amount');
      if (directCostsError) throw directCostsError;
      const directCostMap = new Map<string, number>(
        (directCosts || []).map((cost: { invoice_item_id: string; amount: number }) => [cost.invoice_item_id, Number(cost.amount)])
      );

      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('invoices')
          .select('id, invoice_number, issue_date')
          .in('status', ['issued', 'partially_paid', 'paid', 'overdue'])
          .is('deleted_at', null)
          .order('id')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        invoices.push(...(data || []));
        if (!data || data.length < pageSize) break;
        offset += pageSize;
      }

      offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('invoice_items')
          .select('id, invoice_id, description, quantity, unit_price, product_id')
          .is('unit_cost', null)
          .order('id')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        missingItems.push(...(data || []));
        if (!data || data.length < pageSize) break;
        offset += pageSize;
      }

      offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, is_service')
          .order('id')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        products.push(...(data || []));
        if (!data || data.length < pageSize) break;
        offset += pageSize;
      }

      const invoiceMap = new Map(invoices.map(invoice => [invoice.id, invoice]));
      const productMap = new Map(products.map(product => [product.id, product]));
      const uncostedItems: UncostedInvoiceLine[] = missingItems.flatMap(item => {
        const invoice = invoiceMap.get(item.invoice_id);
        if (!invoice) return [];
        const isService = !item.product_id || productMap.get(item.product_id)?.is_service === true;
        const directCostAmount = directCostMap.get(item.id) ?? null;
        if (isService && directCostAmount !== null) return [];
        return [{
          ...item,
          invoice_number: invoice.invoice_number,
          issue_date: invoice.issue_date || '',
          product_name: item.product_id ? productMap.get(item.product_id)?.name || null : null,
          is_service: isService,
          direct_cost_amount: directCostAmount,
        }];
      });
      return {
        soldLineCount: invoices.length,
        uncostedLineCount: uncostedItems.length,
        uncostedItems,
      };
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const verifyHistoricalCost = useMutation({
    mutationFn: async ({ itemId, unitCost, reference, notes }: { itemId: string; unitCost: number; reference: string; notes: string }) => {
      const { error } = await supabase.rpc('set_historical_invoice_item_cost', {
        p_invoice_item_id: itemId,
        p_unit_cost: unitCost,
        p_reference: reference,
        p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profit-loss-cost-coverage'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
      void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      toast({ title: 'Historical cost verified', description: 'The source reference was saved and cost of sales was posted when the invoice became fully costed.' });
    },
    onError: error => toast({ title: 'Could not verify historical cost', description: error.message, variant: 'destructive' }),
  });

  const recordServiceDirectCost = useMutation({
    mutationFn: async ({ itemId, amount, reference, notes, incurredOn, paymentMethod }: {
      itemId: string; amount: number; reference: string; notes: string; incurredOn: string; paymentMethod: 'cash' | 'bank_transfer';
    }) => {
      const { error } = await (supabase as any).rpc('record_invoice_item_direct_cost', {
        p_invoice_item_id: itemId,
        p_amount: amount,
        p_reference: reference,
        p_incurred_on: incurredOn,
        p_payment_method: paymentMethod,
        p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profit-loss-cost-coverage'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-loss-journal'] });
      void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      toast({ title: 'Direct service cost recorded', description: 'The evidenced cost was posted to Cost of Goods Sold without affecting Inventory.' });
    },
    onError: error => toast({ title: 'Could not record direct service cost', description: error.message, variant: 'destructive' }),
  });

  const totals = useMemo(() => {
    let revenue = 0;
    let costOfGoodsSold = 0;
    let operatingExpenses = 0;
    for (const entry of journalQuery.data || []) {
      for (const line of entry.lines || []) {
        if (!line.account) continue;
        const debit = Number(line.debit || 0);
        const credit = Number(line.credit || 0);
        if (line.account.code === '4000') revenue += credit - debit;
        else if (line.account.code === '5000') costOfGoodsSold += debit - credit;
        else if (line.account.account_type === 'expense') operatingExpenses += debit - credit;
      }
    }
    return { revenue, costOfGoodsSold, operatingExpenses };
  }, [journalQuery.data]);

  const uncostedItems = costCoverageQuery.data?.uncostedItems || [];
  const uncosted = costCoverageQuery.data?.uncostedLineCount || 0;
  const costCoverageComplete = costCoverageQuery.isSuccess && uncosted === 0;
  const grossProfit = totals.revenue - totals.costOfGoodsSold;
  const netProfit = grossProfit - totals.operatingExpenses;
  const formatAmount = (amount: number) =>
    `${currencySymbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (journalQuery.isLoading || costCoverageQuery.isLoading) {
    return <Card><CardContent className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>;
  }

  if (journalQuery.isError || costCoverageQuery.isError) {
    return <Card><CardContent className="py-8 text-sm text-destructive">The profit and loss report could not be loaded. Check finance-role access and refresh the report.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profit &amp; Loss — All Recorded Time</CardTitle>
        <CardDescription>
          Accrual-basis totals from posted invoices, verified cost of goods sold and recorded operating expenses.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {costCoverageComplete ? (
            <Badge variant="secondary" className="gap-1"><CircleCheck className="h-3.5 w-3.5" />Product cost coverage complete</Badge>
          ) : (
            <Badge variant="destructive" className="gap-1"><CircleAlert className="h-3.5 w-3.5" />Profit withheld — {uncosted} sold line(s) without verified cost</Badge>
          )}
          <span className="text-xs text-muted-foreground">{costCoverageQuery.data?.soldLineCount || 0} issued invoice(s) checked</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Net Sales (excl. tax)</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatAmount(totals.revenue)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Cost of Goods Sold</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatAmount(totals.costOfGoodsSold)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Recorded Operating Expenses</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatAmount(totals.operatingExpenses)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Gross Profit</p>
            {costCoverageComplete
              ? <p className={`mt-1 text-xl font-semibold tabular-nums ${grossProfit < 0 ? 'text-destructive' : 'text-success'}`}>{formatAmount(grossProfit)}</p>
              : <p className="mt-1 text-sm font-medium text-warning">Not available</p>}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">Net Profit / (Loss)</p>
              <p className="text-xs text-muted-foreground">Gross profit less operating expenses recorded in the system</p>
            </div>
            {costCoverageComplete ? (
              <div className={`flex items-center gap-2 text-right text-xl font-semibold tabular-nums ${netProfit < 0 ? 'text-destructive' : 'text-success'}`}>
                {netProfit < 0 ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
                {formatAmount(netProfit)}
              </div>
            ) : (
              <span className="text-sm font-semibold text-warning">Withheld until costs are verified</span>
            )}
          </div>
        </div>

        {uncostedItems.length > 0 && (
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold">Complete missing invoice costs</h3>
              <p className="text-sm text-muted-foreground">For physical products, enter the actual historical unit cost with supplier evidence. For service/manual lines, enter the total direct cost, supporting reference, cost date and payment method. Service costs post directly to Cost of Goods Sold, never Inventory.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[900px]">
                <thead><tr><th>Invoice / Date</th><th>Product / Description</th><th>Qty</th><th>Actual Unit Cost / Direct Cost</th><th>Source Reference *</th><th>Cost Date</th><th>Payment Method</th><th>Notes</th><th>Action</th></tr></thead>
                <tbody>
                  {uncostedItems.map(item => {
                    const input = costInputs[item.id] || { unitCost: '', reference: '', notes: '', incurredOn: new Date().toISOString().slice(0, 10), paymentMethod: 'cash' as const };
                    return (
                      <tr key={item.id}>
                        <td><span className="font-medium">{item.invoice_number}</span><span className="block text-xs text-muted-foreground">{item.issue_date}</span></td>
                        <td><span className="font-medium">{item.product_name || item.description}</span>{item.product_name && <span className="block text-xs text-muted-foreground">{item.description}</span>}</td>
                        <td>{Number(item.quantity).toLocaleString()}</td>
                        <td><Input type="number" min="0" step={item.is_service ? "0.01" : "0.0001"} className="w-32" value={input.unitCost} onChange={e => setCostInputs(current => ({ ...current, [item.id]: { ...input, unitCost: e.target.value } }))} /><span className="text-xs text-muted-foreground">{item.is_service ? 'Total direct cost' : 'Per unit'}</span></td>
                        <td><Input className="w-40" value={input.reference} placeholder="Supplier ref" onChange={e => setCostInputs(current => ({ ...current, [item.id]: { ...input, reference: e.target.value } }))} /></td>
                        <td><Input type="date" className="w-36" value={input.incurredOn} onChange={e => setCostInputs(current => ({ ...current, [item.id]: { ...input, incurredOn: e.target.value } }))} /></td>
                        <td>
                          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={input.paymentMethod} onChange={e => setCostInputs(current => ({ ...current, [item.id]: { ...input, paymentMethod: e.target.value as CostInput['paymentMethod'] } }))}>
                            <option value="cash">Cash</option><option value="bank_transfer">Bank / Mobile Money</option>
                          </select>
                        </td>
                        <td><Input className="w-40" value={input.notes} placeholder="Optional" onChange={e => setCostInputs(current => ({ ...current, [item.id]: { ...input, notes: e.target.value } }))} /></td>
                        <td>
                          {item.is_service ? (
                            <Button size="sm" disabled={recordServiceDirectCost.isPending || input.unitCost.trim() === '' || Number(input.unitCost) <= 0 || !input.reference.trim() || !input.incurredOn} onClick={() => recordServiceDirectCost.mutate({ itemId: item.id, amount: Number(input.unitCost), reference: input.reference, notes: input.notes, incurredOn: input.incurredOn, paymentMethod: input.paymentMethod })}>
                              {recordServiceDirectCost.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Record Direct Cost
                            </Button>
                          ) : (
                            <Button size="sm" disabled={verifyHistoricalCost.isPending || input.unitCost.trim() === '' || Number(input.unitCost) < 0 || !input.reference.trim()} onClick={() => verifyHistoricalCost.mutate({ itemId: item.id, unitCost: Number(input.unitCost), reference: input.reference, notes: input.notes })}>
                              {verifyHistoricalCost.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Verify
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!costCoverageComplete && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Why profit is not displayed</p>
            <p className="mt-1 text-muted-foreground">
              Historical physical-product lines must be verified against original purchase evidence; today's product price is never substituted. Service and manual invoice lines need a separately evidenced direct cost, posted to Cost of Goods Sold without crediting Inventory. Future physical-product invoices automatically snapshot the verified purchase-weighted average cost.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Stock purchases are recorded as Inventory assets, not immediate expenses. Their cost moves to Cost of Goods Sold when the related verified-cost products are sold. Net profit reflects expenses entered in Petty Cash; expenses that have not been recorded cannot be included. Tax collected is excluded from sales revenue.
        </p>
      </CardContent>
    </Card>
  );
}
