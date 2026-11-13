import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Download, RefreshCw } from 'lucide-react';

type LedgerEntry = {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  source_type: string;
  currency: string;
  lines: Array<{
    id: string;
    account_id: string;
    debit: number;
    credit: number;
    account: { id: string; code: string; name: string; account_type: string } | null;
  }>;
};

type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  debit: number;
  credit: number;
  netBalance: number;
};

export function GeneralLedgerReport({ currencySymbol }: { currencySymbol: string }) {
  const queryClient = useQueryClient();
  const journalQuery = useQuery({
    queryKey: ['journal-ledger-entries'],
    queryFn: async (): Promise<LedgerEntry[]> => {
      const pageSize = 1000;
      let offset = 0;
      const allEntries: LedgerEntry[] = [];
      while (true) {
        const { data, error } = await supabase
          .from('journal_entries')
          .select('id, entry_number, entry_date, description, source_type, currency, lines:journal_lines(id, account_id, debit, credit, account:chart_of_accounts(id, code, name, account_type))')
          .order('entry_date', { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        allEntries.push(...((data || []) as unknown as LedgerEntry[]));
        if (!data || data.length < pageSize) break;
        offset += pageSize;
      }
      return allEntries;
    },
    // Realtime events are the primary refresh path; polling is a safety net
    // for browsers/networks where a Realtime connection is unavailable.
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const channel = supabase
      .channel('journal-ledger-live-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'journal_entries' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const trialBalance = useMemo<TrialBalanceRow[]>(() => {
    const balances = new Map<string, TrialBalanceRow>();
    for (const entry of journalQuery.data || []) {
      for (const line of entry.lines || []) {
        if (!line.account) continue;
        const existing = balances.get(line.account_id) || {
          accountId: line.account_id,
          code: line.account.code,
          name: line.account.name,
          accountType: line.account.account_type,
          debit: 0,
          credit: 0,
          netBalance: 0,
        };
        existing.debit += Number(line.debit || 0);
        existing.credit += Number(line.credit || 0);
        balances.set(line.account_id, existing);
      }
    }
    return Array.from(balances.values()).map(row => {
      const normalDebit = ['asset', 'expense'].includes(row.accountType);
      const net = normalDebit ? row.debit - row.credit : row.credit - row.debit;
      return {
        ...row,
        debit: normalDebit ? Math.max(0, net) : 0,
        credit: normalDebit ? 0 : Math.max(0, net),
        netBalance: net,
      };
    }).sort((a, b) => a.code.localeCompare(b.code));
  }, [journalQuery.data]);

  const totalDebits = trialBalance.reduce((sum, row) => sum + row.debit, 0);
  const totalCredits = trialBalance.reduce((sum, row) => sum + row.credit, 0);

  const downloadTrialBalance = () => {
    const headers = ['Account Code', 'Account', 'Type', 'Debit Balance', 'Credit Balance', 'Net Balance'];
    const rows = trialBalance.map(row => [
      row.code, row.name, row.accountType, row.debit.toFixed(2), row.credit.toFixed(2), row.netBalance.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'audit-ledger-trial-balance.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const formatAmount = (amount: number) => `${currencySymbol}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Posted Trial Balance</CardTitle>
          <CardDescription>Live posted balances from invoices, received payments and unapplied receipts.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void journalQuery.refetch()} disabled={journalQuery.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${journalQuery.isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadTrialBalance} disabled={trialBalance.length === 0}>
            <Download className="mr-2 h-4 w-4" />Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">Posted entries</p>
            <p className="text-xl font-semibold">{journalQuery.data?.length || 0}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">Debit balances</p>
            <p className="text-xl font-semibold">{formatAmount(totalDebits)}</p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">Credit balances</p>
            <p className="text-xl font-semibold">{formatAmount(totalCredits)}</p>
          </div>
        </div>
        {journalQuery.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : journalQuery.isError ? (
          <p className="text-sm text-destructive">The general ledger could not be loaded. Check your finance-role access and try again.</p>
        ) : trialBalance.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No journal entries have been posted yet. Issued invoices and recorded payments will appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
              <tbody>
                {trialBalance.map(row => (
                  <tr key={row.accountId}>
                    <td className="font-medium">{row.code}</td>
                    <td>{row.name}</td>
                    <td className="capitalize">{row.accountType}</td>
                    <td className="text-right tabular-nums">{row.debit > 0 ? formatAmount(row.debit) : '—'}</td>
                    <td className="text-right tabular-nums">{row.credit > 0 ? formatAmount(row.credit) : '—'}</td>
                  </tr>
                ))}
                <tr className="font-semibold border-t-2">
                  <td colSpan={3}>Total</td>
                  <td className="text-right tabular-nums">{formatAmount(totalDebits)}</td>
                  <td className="text-right tabular-nums">{formatAmount(totalCredits)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          This is a partial ledger view for invoice, payment and unapplied-receipt postings. Petty cash expenses, stock purchases, cost of goods sold, opening balances and bank reconciliations are not yet journalised here, so this is not a complete set of financial statements.
        </p>
      </CardContent>
    </Card>
  );
}
