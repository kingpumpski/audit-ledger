import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useInvoices } from '@/hooks/useInvoices';
import { useReceipts } from '@/hooks/useReceipts';
import { useSettings } from '@/hooks/useSettings';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  DollarSign, TrendingUp, TrendingDown, FileText,
  Plus, Loader2, Download, Wallet, Receipt, Calculator
} from 'lucide-react';
import { format, subDays, subMonths, subWeeks, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { cn } from '@/lib/utils';
import { ChartOfAccounts } from '@/components/accounting/ChartOfAccounts';

const COLORS = ['hsl(161, 93%, 30%)', 'hsl(199, 89%, 48%)', 'hsl(38, 92%, 50%)', 'hsl(0, 72%, 50%)', 'hsl(142, 76%, 36%)', 'hsl(280, 85%, 65%)'];

type TimeFrame = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannual' | 'yearly';

export default function Accounting() {
  const { invoices } = useInvoices();
  const { receipts } = useReceipts();
  const { settings } = useSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('monthly');
  const [isPettyCashOpen, setIsPettyCashOpen] = useState(false);
  const [pettyCashForm, setPettyCashForm] = useState({
    description: '', amount: 0, type: 'expense' as string, category: '', reference_number: '',
  });

  const currencySymbol = settings?.currency_symbol || '$';

  // Fetch petty cash
  const { data: pettyCash = [] } = useQuery({
    queryKey: ['petty-cash'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('petty_cash_transactions')
        .select('*')
        .order('date', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const createPettyCash = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('petty_cash_transactions')
        .insert({
          description: pettyCashForm.description,
          amount: pettyCashForm.amount,
          type: pettyCashForm.type,
          category: pettyCashForm.category || null,
          reference_number: pettyCashForm.reference_number || null,
          recorded_by: user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['petty-cash'] });
      toast({ title: 'Petty cash transaction recorded' });
      setIsPettyCashOpen(false);
      setPettyCashForm({ description: '', amount: 0, type: 'expense', category: '', reference_number: '' });
    },
    onError: (error) => {
      toast({ title: 'Failed to record transaction', description: error.message, variant: 'destructive' });
    },
  });

  // Financial calculations
  const financials = useMemo(() => {
    const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.total_amount || 0), 0);
    const totalInvoiced = invoices.reduce((s, i) => s + (i.total_amount || 0), 0);
    const totalTax = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.tax_amount || 0), 0);
    const totalDiscounts = invoices.reduce((s, i) => s + (i.discount_amount || 0), 0);
    const totalReceived = receipts.filter(r => r.status === 'issued').reduce((s, r) => s + r.amount, 0);
    const outstanding = invoices.filter(i => ['issued', 'overdue', 'partially_paid'].includes(i.status))
      .reduce((s, i) => s + (i.balance_due || 0), 0);
    const costOfGoods = totalRevenue * 0.6; // Estimate - could be improved with actual cost data
    const grossProfit = totalRevenue - costOfGoods;
    const operatingExpenses = pettyCash.filter(p => p.type === 'expense').reduce((s, p) => s + Number(p.amount), 0);
    const pettyCashIncome = pettyCash.filter(p => p.type === 'income').reduce((s, p) => s + Number(p.amount), 0);
    const netProfit = grossProfit - operatingExpenses;

    return { totalRevenue, totalInvoiced, totalTax, totalDiscounts, totalReceived, outstanding, costOfGoods, grossProfit, operatingExpenses, pettyCashIncome, netProfit };
  }, [invoices, receipts, pettyCash]);

  // Revenue trend data
  const trendData = useMemo(() => {
    const now = new Date();
    const periods: { label: string; start: Date; end: Date }[] = [];
    const count = timeFrame === 'daily' ? 30 : timeFrame === 'weekly' ? 12 : timeFrame === 'monthly' ? 12 : timeFrame === 'quarterly' ? 8 : timeFrame === 'biannual' ? 4 : 3;

    for (let i = count - 1; i >= 0; i--) {
      let start: Date, end: Date, label: string;
      if (timeFrame === 'daily') {
        start = startOfDay(subDays(now, i));
        end = startOfDay(subDays(now, i - 1));
        label = format(start, 'MMM d');
      } else if (timeFrame === 'weekly') {
        start = startOfWeek(subWeeks(now, i));
        end = startOfWeek(subWeeks(now, i - 1));
        label = format(start, 'MMM d');
      } else if (timeFrame === 'monthly') {
        start = startOfMonth(subMonths(now, i));
        end = startOfMonth(subMonths(now, i - 1));
        label = format(start, 'MMM yyyy');
      } else if (timeFrame === 'quarterly') {
        start = startOfQuarter(subMonths(now, i * 3));
        end = startOfQuarter(subMonths(now, (i - 1) * 3));
        label = `Q${Math.ceil((start.getMonth() + 1) / 3)} ${start.getFullYear()}`;
      } else {
        start = startOfYear(subMonths(now, i * (timeFrame === 'biannual' ? 6 : 12)));
        end = startOfYear(subMonths(now, (i - 1) * (timeFrame === 'biannual' ? 6 : 12)));
        label = format(start, timeFrame === 'biannual' ? 'MMM yyyy' : 'yyyy');
      }
      periods.push({ label, start, end });
    }

    return periods.map(p => {
      const revenue = invoices
        .filter(i => i.status === 'paid' && new Date(i.created_at) >= p.start && new Date(i.created_at) < p.end)
        .reduce((s, i) => s + (i.total_amount || 0), 0);
      const expenses = pettyCash
        .filter(pc => pc.type === 'expense' && new Date(pc.date) >= p.start && new Date(pc.date) < p.end)
        .reduce((s, pc) => s + Number(pc.amount), 0);
      return { name: p.label, revenue, expenses, profit: revenue - expenses };
    });
  }, [invoices, pettyCash, timeFrame]);

  const paymentMethodData = useMemo(() => {
    const methods: Record<string, number> = {};
    receipts.filter(r => r.status === 'issued').forEach(r => {
      const m = r.payment_method.replace(/_/g, ' ');
      methods[m] = (methods[m] || 0) + r.amount;
    });
    return Object.entries(methods).map(([name, value]) => ({ name, value }));
  }, [receipts]);

  const exportReport = (type: string) => {
    let csv = '';
    if (type === 'pl') {
      csv = `Income Statement\nRevenue,${financials.totalRevenue}\nCost of Goods,${financials.costOfGoods}\nGross Profit,${financials.grossProfit}\nOperating Expenses,${financials.operatingExpenses}\nNet Profit,${financials.netProfit}`;
    } else if (type === 'petty') {
      csv = `Date,Description,Type,Amount,Category\n` + pettyCash.map(p => `${p.date},${p.description},${p.type},${p.amount},${p.category || ''}`).join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${type}_report.csv`;
    link.click();
  };

  return (
    <AppLayout title="Accounting" subtitle="Financial overview and accounting reports">
      {/* Time Frame Selector */}
      <div className="flex items-center justify-between mb-6">
        <Select value={timeFrame} onValueChange={v => setTimeFrame(v as TimeFrame)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="quarterly">Quarterly</SelectItem>
            <SelectItem value="biannual">Bi-Annual</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportReport('pl')}>
            <Download className="mr-2 h-4 w-4" />Export P&L
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportReport('petty')}>
            <Download className="mr-2 h-4 w-4" />Export Petty Cash
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10"><TrendingUp className="h-5 w-5 text-success" /></div>
            <div><p className="text-sm text-muted-foreground">Total Revenue</p><p className="text-2xl font-bold">{currencySymbol}{financials.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10"><DollarSign className="h-5 w-5 text-primary" /></div>
            <div><p className="text-sm text-muted-foreground">Net Profit</p><p className={cn('text-2xl font-bold', financials.netProfit >= 0 ? 'text-success' : 'text-destructive')}>{currencySymbol}{financials.netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10"><Calculator className="h-5 w-5 text-warning" /></div>
            <div><p className="text-sm text-muted-foreground">Tax Collected</p><p className="text-2xl font-bold">{currencySymbol}{financials.totalTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10"><TrendingDown className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-sm text-muted-foreground">Outstanding</p><p className="text-2xl font-bold">{currencySymbol}{financials.outstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p></div>
          </div>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="pl" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
          <TabsTrigger value="pl">P&L / Income Statement</TabsTrigger>
          <TabsTrigger value="balance">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tax">Tax Returns</TabsTrigger>
          <TabsTrigger value="petty">Petty Cash</TabsTrigger>
          <TabsTrigger value="income-exp">Income & Expenditure</TabsTrigger>
        </TabsList>

        <TabsContent value="coa">
          <ChartOfAccounts />
        </TabsContent>
        {/* P&L / Income Statement */}
        <TabsContent value="pl">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Income Statement</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b"><span className="font-medium">Revenue</span><span className="font-bold">{currencySymbol}{financials.totalRevenue.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 border-b text-muted-foreground"><span>Cost of Goods Sold</span><span>-{currencySymbol}{financials.costOfGoods.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 border-b font-medium"><span>Gross Profit</span><span className="text-success">{currencySymbol}{financials.grossProfit.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 border-b text-muted-foreground"><span>Operating Expenses</span><span>-{currencySymbol}{financials.operatingExpenses.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 border-b text-muted-foreground"><span>Discounts Given</span><span>-{currencySymbol}{financials.totalDiscounts.toLocaleString()}</span></div>
                  <div className="flex justify-between py-3 text-lg font-bold border-t-2"><span>Net Profit</span><span className={financials.netProfit >= 0 ? 'text-success' : 'text-destructive'}>{currencySymbol}{financials.netProfit.toLocaleString()}</span></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Revenue vs Expenses Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => `${currencySymbol}${value.toLocaleString()}`} />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" stroke="hsl(161, 93%, 30%)" fill="hsl(161, 93%, 30%)" fillOpacity={0.2} name="Revenue" />
                    <Area type="monotone" dataKey="expenses" stroke="hsl(0, 72%, 50%)" fill="hsl(0, 72%, 50%)" fillOpacity={0.1} name="Expenses" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Balance Sheet */}
        <TabsContent value="balance">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Statement of Financial Position</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-sm uppercase text-muted-foreground mb-2">Assets</h4>
                    <div className="space-y-2 pl-4">
                      <div className="flex justify-between py-1"><span>Cash Received</span><span>{currencySymbol}{financials.totalReceived.toLocaleString()}</span></div>
                      <div className="flex justify-between py-1"><span>Accounts Receivable</span><span>{currencySymbol}{financials.outstanding.toLocaleString()}</span></div>
                      <div className="flex justify-between py-1"><span>Petty Cash Balance</span><span>{currencySymbol}{(financials.pettyCashIncome - financials.operatingExpenses).toLocaleString()}</span></div>
                      <div className="flex justify-between py-1 font-bold border-t"><span>Total Assets</span><span>{currencySymbol}{(financials.totalReceived + financials.outstanding + financials.pettyCashIncome - financials.operatingExpenses).toLocaleString()}</span></div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm uppercase text-muted-foreground mb-2">Liabilities</h4>
                    <div className="space-y-2 pl-4">
                      <div className="flex justify-between py-1"><span>Tax Payable</span><span>{currencySymbol}{financials.totalTax.toLocaleString()}</span></div>
                      <div className="flex justify-between py-1 font-bold border-t"><span>Total Liabilities</span><span>{currencySymbol}{financials.totalTax.toLocaleString()}</span></div>
                    </div>
                  </div>
                  <div className="border-t-2 pt-2">
                    <div className="flex justify-between font-bold text-lg">
                      <span>Equity</span>
                      <span className="text-primary">{currencySymbol}{(financials.totalReceived + financials.outstanding + financials.pettyCashIncome - financials.operatingExpenses - financials.totalTax).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Payment Methods Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={paymentMethodData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {paymentMethodData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${currencySymbol}${value.toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tax Returns */}
        <TabsContent value="tax">
          <Card>
            <CardHeader><CardTitle>Tax Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-6">
                <div className="p-4 rounded-lg bg-primary/5 border">
                  <p className="text-sm text-muted-foreground">Total Tax Collected</p>
                  <p className="text-2xl font-bold">{currencySymbol}{financials.totalTax.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-success/5 border">
                  <p className="text-sm text-muted-foreground">Taxable Revenue</p>
                  <p className="text-2xl font-bold">{currencySymbol}{financials.totalRevenue.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-warning/5 border">
                  <p className="text-sm text-muted-foreground">Effective Tax Rate</p>
                  <p className="text-2xl font-bold">{financials.totalRevenue > 0 ? ((financials.totalTax / financials.totalRevenue) * 100).toFixed(1) : '0'}%</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => `${currencySymbol}${value.toLocaleString()}`} />
                  <Bar dataKey="revenue" fill="hsl(161, 93%, 30%)" name="Revenue" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Petty Cash */}
        <TabsContent value="petty">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" />Petty Cash</CardTitle>
                <CardDescription>Track small cash transactions</CardDescription>
              </div>
              <Button onClick={() => setIsPettyCashOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />Record Transaction
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3 mb-6">
                <div className="p-4 rounded-lg bg-success/5 border">
                  <p className="text-sm text-muted-foreground">Income</p>
                  <p className="text-xl font-bold text-success">{currencySymbol}{financials.pettyCashIncome.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-destructive/5 border">
                  <p className="text-sm text-muted-foreground">Expenses</p>
                  <p className="text-xl font-bold text-destructive">{currencySymbol}{financials.operatingExpenses.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-primary/5 border">
                  <p className="text-sm text-muted-foreground">Balance</p>
                  <p className="text-xl font-bold">{currencySymbol}{(financials.pettyCashIncome - financials.operatingExpenses).toLocaleString()}</p>
                </div>
              </div>
              <table className="data-table">
                <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th>Amount</th></tr></thead>
                <tbody>
                  {pettyCash.slice(0, 20).map(tx => (
                    <tr key={tx.id}>
                      <td className="text-muted-foreground">{format(new Date(tx.date), 'MMM d, yyyy')}</td>
                      <td className="font-medium">{tx.description}</td>
                      <td><Badge variant="secondary">{tx.category || 'General'}</Badge></td>
                      <td><Badge className={tx.type === 'income' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'}>{tx.type}</Badge></td>
                      <td className={cn('font-medium', tx.type === 'income' ? 'text-success' : 'text-destructive')}>
                        {tx.type === 'income' ? '+' : '-'}{currencySymbol}{Number(tx.amount).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pettyCash.length === 0 && <p className="text-center py-8 text-muted-foreground">No petty cash transactions recorded</p>}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Income & Expenditure */}
        <TabsContent value="income-exp">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Profit Trend</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => `${currencySymbol}${value.toLocaleString()}`} />
                    <Legend />
                    <Bar dataKey="revenue" fill="hsl(161, 93%, 30%)" name="Revenue" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" fill="hsl(0, 72%, 50%)" name="Expenses" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="profit" fill="hsl(199, 89%, 48%)" name="Profit" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Income & Expenditure Summary</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm uppercase text-muted-foreground">Income</h4>
                  <div className="flex justify-between py-2 pl-4 border-b"><span>Invoice Revenue</span><span className="text-success">{currencySymbol}{financials.totalRevenue.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 pl-4 border-b"><span>Petty Cash Income</span><span className="text-success">{currencySymbol}{financials.pettyCashIncome.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 font-bold"><span>Total Income</span><span>{currencySymbol}{(financials.totalRevenue + financials.pettyCashIncome).toLocaleString()}</span></div>
                  
                  <h4 className="font-semibold text-sm uppercase text-muted-foreground pt-2">Expenditure</h4>
                  <div className="flex justify-between py-2 pl-4 border-b"><span>Operating Expenses</span><span className="text-destructive">{currencySymbol}{financials.operatingExpenses.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 pl-4 border-b"><span>Discounts Given</span><span className="text-destructive">{currencySymbol}{financials.totalDiscounts.toLocaleString()}</span></div>
                  <div className="flex justify-between py-2 font-bold"><span>Total Expenditure</span><span>{currencySymbol}{(financials.operatingExpenses + financials.totalDiscounts).toLocaleString()}</span></div>
                  
                  <div className="flex justify-between py-3 text-lg font-bold border-t-2">
                    <span>Net Income</span>
                    <span className={cn((financials.totalRevenue + financials.pettyCashIncome - financials.operatingExpenses - financials.totalDiscounts) >= 0 ? 'text-success' : 'text-destructive')}>
                      {currencySymbol}{(financials.totalRevenue + financials.pettyCashIncome - financials.operatingExpenses - financials.totalDiscounts).toLocaleString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Petty Cash Dialog */}
      <Dialog open={isPettyCashOpen} onOpenChange={setIsPettyCashOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Petty Cash Transaction</DialogTitle>
            <DialogDescription>Add a new petty cash income or expense entry</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={pettyCashForm.type} onValueChange={v => setPettyCashForm({ ...pettyCashForm, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount ({currencySymbol})</Label>
                <Input type="number" min="0" step="0.01" value={pettyCashForm.amount || ''} onChange={e => setPettyCashForm({ ...pettyCashForm, amount: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description *</Label>
              <Input value={pettyCashForm.description} onChange={e => setPettyCashForm({ ...pettyCashForm, description: e.target.value })} placeholder="What was this for?" />
            </div>
            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={pettyCashForm.category} onValueChange={v => setPettyCashForm({ ...pettyCashForm, category: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="office_supplies">Office Supplies</SelectItem>
                    <SelectItem value="transport">Transport</SelectItem>
                    <SelectItem value="food">Food & Refreshments</SelectItem>
                    <SelectItem value="utilities">Utilities</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="miscellaneous">Miscellaneous</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reference #</Label>
                <Input value={pettyCashForm.reference_number} onChange={e => setPettyCashForm({ ...pettyCashForm, reference_number: e.target.value })} placeholder="Optional" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setIsPettyCashOpen(false)}>Cancel</Button>
              <Button onClick={() => createPettyCash.mutate()} disabled={createPettyCash.isPending || !pettyCashForm.description || !pettyCashForm.amount}>
                {createPettyCash.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Transaction
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
