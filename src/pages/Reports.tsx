import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { format, subMonths, startOfMonth } from 'date-fns';
import { QueryDiagnostics, type QueryError } from '@/components/diagnostics/QueryDiagnostics';
import { Loader2 } from 'lucide-react';

export default function Reports() {
  const [revenue, setRevenue] = useState<{ month: string; total: number }[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<{ name: string; value: number }[]>([]);
  const [stats, setStats] = useState({ invoices: 0, paid: 0, outstanding: 0, customers: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<QueryError>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setLoadError(null);
      const since = subMonths(startOfMonth(new Date()), 5).toISOString();
      const [{ data: inv, error: e1 }, { data: cust }] = await Promise.all([
        supabase.from('invoices').select('total,status,issue_date,balance_due').gte('issue_date', since),
        supabase.from('customers').select('id', { count: 'exact', head: true }),
      ]);
      console.debug('[Reports] fetch', { invoices: inv?.length ?? 0, error: e1 });
      if (e1) { setLoadError(e1 as any); toast.error(e1.message); setLoading(false); return; }
      const map = new Map<string, number>();
      (inv || []).forEach((r: any) => {
        const k = format(new Date(r.issue_date), 'MMM yy');
        map.set(k, (map.get(k) || 0) + Number(r.total || 0));
      });
      setRevenue(Array.from(map, ([month, total]) => ({ month, total })));

      const sMap = new Map<string, number>();
      (inv || []).forEach((r: any) => sMap.set(r.status, (sMap.get(r.status) || 0) + 1));
      setStatusBreakdown(Array.from(sMap, ([name, value]) => ({ name, value })));

      const paid = (inv || []).filter((i: any) => i.status === 'paid').reduce((s: number, i: any) => s + Number(i.total || 0), 0);
      const outstanding = (inv || []).reduce((s: number, i: any) => s + Number(i.balance_due || 0), 0);
      setStats({ invoices: inv?.length || 0, paid, outstanding, customers: (cust as any)?.length ?? 0 });
      setLoading(false);
    })();
  }, []);

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--destructive))'];

  return (
    <AppLayout title="Reports" subtitle="Performance & financial overview">
      <QueryDiagnostics label="reports data" error={loadError} count={stats.invoices} />
      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground mb-4"><Loader2 className="h-4 w-4 animate-spin" />Loading reports…</div>
      )}
      {!loading && !loadError && stats.invoices === 0 && (
        <Card className="mb-4"><CardContent className="p-6 text-sm text-muted-foreground text-center">No invoices in the last 6 months — create an invoice to see reports populate.</CardContent></Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Invoices (6m)', value: stats.invoices },
          { label: 'Paid', value: stats.paid.toFixed(2) },
          { label: 'Outstanding', value: stats.outstanding.toFixed(2) },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold">{s.value}</p>
          </CardContent></Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Revenue trend</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer>
              <BarChart data={revenue}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="month" fontSize={12} /><YAxis fontSize={12} />
                <Tooltip /><Bar dataKey="total" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Invoice status</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={statusBreakdown} dataKey="value" nameKey="name" outerRadius={100} label>
                  {statusBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}