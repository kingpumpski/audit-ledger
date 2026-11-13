import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, TrendingDown, CircleAlert, CircleCheck } from 'lucide-react';

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

export function ProfitAndLossReport({ currencySymbol }: { currencySymbol: string }) {
  const journalQuery = useQuery({
    queryKey: ['profit-loss-journal'],
    queryFn: async (): Promise<JournalEntry[]> => {
      const { data, error } = await supabase
        .from('journal_entries')
        .select('entry_date, source_type, lines:journal_lines(debit, credit, account:chart_of_accounts(code, account_type))')
        .order('entry_date', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as JournalEntry[];
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const costCoverageQuery = useQuery({
    queryKey: ['profit-loss-cost-coverage'],
    queryFn: async () => {
      const [invoiceResult, itemResult] = await Promise.all([
        supabase.from('invoices').select('id').in('status', ['issued', 'partially_paid', 'paid', 'overdue']).is('deleted_at', null),
        supabase.from('invoice_items').select('invoice_id, unit_cost'),
      ]);
      if (invoiceResult.error) throw invoiceResult.error;
      if (itemResult.error) throw itemResult.error;
      const issuedInvoiceIds = new Set((invoiceResult.data || []).map(invoice => invoice.id));
      const soldLines = (itemResult.data || []).filter(item => issuedInvoiceIds.has(item.invoice_id));
      return {
        soldLineCount: soldLines.length,
        uncostedLineCount: soldLines.filter(item => item.unit_cost === null).length,
      };
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
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
          <span className="text-xs text-muted-foreground">{costCoverageQuery.data?.soldLineCount || 0} issued invoice line(s) checked</span>
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

        {!costCoverageComplete && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Why profit is not displayed</p>
            <p className="mt-1 text-muted-foreground">
              At least one issued invoice line has no purchase-verified cost. Record the actual purchase or opening-stock valuation for each affected product, then create a new invoice for future sales. Historical sales are not assigned today's cost because that would invent past costs.
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
