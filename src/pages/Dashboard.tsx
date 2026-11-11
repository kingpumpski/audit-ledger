import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Receipt,
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Users,
  Package,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useInvoices } from '@/hooks/useInvoices';
import { useReceipts } from '@/hooks/useReceipts';
import { useCustomers } from '@/hooks/useCustomers';
import { useProducts } from '@/hooks/useProducts';
import { useSettings } from '@/hooks/useSettings';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';

const DashboardCharts = lazy(() => import('@/components/dashboard/DashboardCharts'));

export default function Dashboard() {
  const [chartsVisible, setChartsVisible] = useState(false);
  const chartsRef = useRef<HTMLDivElement>(null);
  const { invoices, isLoading: invoicesLoading } = useInvoices();
  const { receipts, isLoading: receiptsLoading } = useReceipts();
  const { customers, isLoading: customersLoading } = useCustomers();
  const { products, isLoading: productsLoading } = useProducts();
  const { settings } = useSettings();

  const currencySymbol = settings?.currency_symbol || '$';
  const isLoading = invoicesLoading || receiptsLoading || customersLoading || productsLoading;

  useEffect(() => {
    if (isLoading) return;
    const element = chartsRef.current;
    if (!element) return;
    if (!('IntersectionObserver' in window)) {
      setChartsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setChartsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isLoading]);

  // Calculate real statistics
  const stats = useMemo(() => {
    const totalRevenue = invoices
      .filter(inv => inv.status === 'paid')
      .reduce((sum, inv) => sum + (inv.total_amount || 0), 0);

    const totalReceived = receipts.reduce((sum, r) => sum + (r.amount || 0), 0);

    const pendingPayments = invoices
      .filter(inv => ['issued', 'partially_paid'].includes(inv.status))
      .reduce((sum, inv) => sum + (inv.balance_due || 0), 0);

    const overdueInvoices = invoices.filter(inv => inv.status === 'overdue');
    const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.balance_due || 0), 0);

    const activeCustomers = customers.filter(c => c.is_active).length;

    const lowStockProducts = products.filter(p => 
      p.stock_quantity !== null && 
      p.min_stock_level !== null && 
      p.stock_quantity <= p.min_stock_level
    ).length;

    // Get last month stats for comparison
    const lastMonth = subMonths(new Date(), 1);
    const lastMonthStart = startOfMonth(lastMonth);
    const lastMonthEnd = endOfMonth(lastMonth);
    
    const lastMonthRevenue = invoices
      .filter(inv => {
        if (inv.status !== 'paid' || !inv.created_at) return false;
        const date = parseISO(inv.created_at);
        return isWithinInterval(date, { start: lastMonthStart, end: lastMonthEnd });
      })
      .reduce((sum, inv) => sum + (inv.total_amount || 0), 0);

    const revenueChange = lastMonthRevenue > 0 
      ? ((totalRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
      : totalRevenue > 0 ? '100' : '0';

    return {
      totalRevenue,
      totalReceived,
      pendingPayments,
      overdueAmount,
      overdueCount: overdueInvoices.length,
      activeCustomers,
      lowStockProducts,
      totalInvoices: invoices.length,
      totalReceipts: receipts.length,
      revenueChange,
    };
  }, [invoices, receipts, customers, products]);

  // Revenue chart data (last 6 months)
  const revenueChartData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const month = subMonths(now, i);
      months.push({
        key: format(month, 'yyyy-MM'),
        month: format(month, 'MMM'),
        invoiced: 0,
        received: 0,
      });
    }

    const monthByKey = new Map(months.map((month) => [month.key, month]));
    for (const invoice of invoices) {
      if (!invoice.created_at || !['paid', 'issued', 'partially_paid'].includes(invoice.status)) continue;
      const month = monthByKey.get(format(parseISO(invoice.created_at), 'yyyy-MM'));
      if (month) month.invoiced += invoice.total_amount || 0;
    }
    for (const receipt of receipts) {
      if (!receipt.created_at) continue;
      const month = monthByKey.get(format(parseISO(receipt.created_at), 'yyyy-MM'));
      if (month) month.received += receipt.amount || 0;
    }

    return months.map(({ month, invoiced, received }) => ({ month, invoiced, received }));
  }, [invoices, receipts]);

  // Invoice status distribution
  const invoiceStatusData = useMemo(() => {
    const statusCounts = {
      paid: invoices.filter(i => i.status === 'paid').length,
      issued: invoices.filter(i => i.status === 'issued').length,
      overdue: invoices.filter(i => i.status === 'overdue').length,
      draft: invoices.filter(i => i.status === 'draft').length,
      partially_paid: invoices.filter(i => i.status === 'partially_paid').length,
    };

    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    if (total === 0) return [];

    return [
      { name: 'Paid', value: statusCounts.paid, color: 'hsl(var(--success))' },
      { name: 'Issued', value: statusCounts.issued, color: 'hsl(var(--info))' },
      { name: 'Overdue', value: statusCounts.overdue, color: 'hsl(var(--destructive))' },
      { name: 'Partial', value: statusCounts.partially_paid, color: 'hsl(var(--warning))' },
      { name: 'Draft', value: statusCounts.draft, color: 'hsl(var(--muted-foreground))' },
    ].filter(item => item.value > 0);
  }, [invoices]);

  // Recent invoices
  const recentInvoices = useMemo(() => {
    return invoices
      .slice(0, 5)
      .map(inv => ({
        id: inv.invoice_number,
        customer: inv.customer?.name || 'Unknown',
        amount: inv.total_amount || 0,
        status: inv.status,
        date: inv.created_at,
      }));
  }, [invoices]);

  // Top products by category
  const categoryData = useMemo(() => {
    const categoryCounts: Record<string, number> = {};
    products.forEach(p => {
      const cat = p.category || 'Uncategorized';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    
    return Object.entries(categoryCounts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [products]);

  const statsCards = [
    {
      title: 'Total Revenue',
      value: `${currencySymbol}${stats.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      change: `${parseFloat(stats.revenueChange) >= 0 ? '+' : ''}${stats.revenueChange}%`,
      trend: parseFloat(stats.revenueChange) >= 0 ? 'up' : 'down',
      icon: DollarSign,
      description: 'from paid invoices',
      gradient: 'from-primary to-info',
    },
    {
      title: 'Invoices Sent',
      value: stats.totalInvoices.toString(),
      change: `${invoices.filter(i => i.status === 'issued').length} pending`,
      trend: 'up',
      icon: FileText,
      description: `${stats.totalReceipts} receipts issued`,
      gradient: 'from-accent to-purple-500',
    },
    {
      title: 'Pending Payments',
      value: `${currencySymbol}${stats.pendingPayments.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      change: stats.overdueCount > 0 ? `${stats.overdueCount} overdue` : 'All on time',
      trend: stats.overdueCount > 0 ? 'down' : 'up',
      icon: Clock,
      description: 'awaiting payment',
      gradient: 'from-warning to-orange-500',
    },
    {
      title: 'Active Customers',
      value: stats.activeCustomers.toString(),
      change: `${products.length} products`,
      trend: 'up',
      icon: Users,
      description: `${stats.lowStockProducts} low stock`,
      gradient: 'from-success to-emerald-500',
    },
  ];

  if (isLoading) {
    return (
      <AppLayout title="Dashboard" subtitle="Loading your business overview...">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Dashboard"
      subtitle="Welcome back! Here's what's happening with your business."
      actions={
        <Button asChild>
          <Link to="/invoices/new">
            <Plus className="mr-2 h-4 w-4" />
            New Invoice
          </Link>
        </Button>
      }
    >
      <div className="space-y-6 animate-in">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statsCards.map((stat, index) => (
            <Card key={stat.title} className={cn('stat-card overflow-hidden', `stagger-${index + 1}`)}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                    <h3 className="text-2xl font-bold mt-1 font-display">{stat.value}</h3>
                    <div className="flex items-center gap-1 mt-2">
                      {stat.trend === 'up' ? (
                        <ArrowUpRight className="h-4 w-4 text-success" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-destructive" />
                      )}
                      <span className={cn(
                        'text-sm font-medium',
                        stat.trend === 'up' ? 'text-success' : 'text-destructive'
                      )}>
                        {stat.change}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{stat.description}</span>
                  </div>
                  <div className={cn(
                    'flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br',
                    stat.gradient
                  )}>
                    <stat.icon className="h-6 w-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Overdue Alert */}
        {stats.overdueCount > 0 && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <p className="font-medium text-destructive">
                      {stats.overdueCount} Overdue Invoice{stats.overdueCount > 1 ? 's' : ''}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Total overdue: {currencySymbol}{stats.overdueAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/invoices?status=overdue">View Overdue</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div ref={chartsRef} className="space-y-6">
          {chartsVisible ? (
            <Suspense fallback={
              <div className="space-y-6" aria-hidden="true">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  <div className="h-[400px] rounded-lg bg-muted/30 lg:col-span-2" />
                  <div className="h-[400px] rounded-lg bg-muted/30" />
                </div>
                {categoryData.length > 0 && <div className="h-72 rounded-lg bg-muted/30" />}
              </div>
            }>
              <DashboardCharts
                revenueData={revenueChartData}
                invoiceStatusData={invoiceStatusData}
                categoryData={categoryData}
                currencySymbol={currencySymbol}
              />
            </Suspense>
          ) : (
            <div className="space-y-6" aria-hidden="true">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="h-[400px] rounded-lg bg-muted/30 lg:col-span-2" />
                <div className="h-[400px] rounded-lg bg-muted/30" />
              </div>
              {categoryData.length > 0 && <div className="h-72 rounded-lg bg-muted/30" />}
            </div>
          )}
        </div>

        {/* Recent Invoices & Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Invoices */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-display">Recent Invoices</CardTitle>
                <CardDescription>Latest invoice activity</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/invoices">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recentInvoices.length > 0 ? (
                <div className="space-y-4">
                  {recentInvoices.map((invoice) => (
                    <div 
                      key={invoice.id}
                      className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center',
                          invoice.status === 'paid' && 'bg-success/10',
                          invoice.status === 'issued' && 'bg-info/10',
                          invoice.status === 'overdue' && 'bg-destructive/10',
                          invoice.status === 'draft' && 'bg-muted',
                          invoice.status === 'partially_paid' && 'bg-warning/10'
                        )}>
                          {invoice.status === 'paid' && <CheckCircle2 className="h-5 w-5 text-success" />}
                          {invoice.status === 'issued' && <FileText className="h-5 w-5 text-info" />}
                          {invoice.status === 'overdue' && <AlertTriangle className="h-5 w-5 text-destructive" />}
                          {invoice.status === 'draft' && <FileText className="h-5 w-5 text-muted-foreground" />}
                          {invoice.status === 'partially_paid' && <Clock className="h-5 w-5 text-warning" />}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{invoice.id}</p>
                          <p className="text-xs text-muted-foreground">{invoice.customer}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{currencySymbol}{invoice.amount.toLocaleString()}</p>
                        <Badge 
                          variant="secondary"
                          className={cn(
                            'text-[10px] capitalize',
                            invoice.status === 'paid' && 'bg-success/10 text-success',
                            invoice.status === 'issued' && 'bg-info/10 text-info',
                            invoice.status === 'overdue' && 'bg-destructive/10 text-destructive',
                            invoice.status === 'draft' && 'bg-muted text-muted-foreground',
                            invoice.status === 'partially_paid' && 'bg-warning/10 text-warning'
                          )}
                        >
                          {invoice.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No invoices yet</p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link to="/invoices/new">Create your first invoice</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Quick Actions</CardTitle>
              <CardDescription>Common tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/invoices/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Invoice
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/receipts/new">
                  <Receipt className="mr-2 h-4 w-4" />
                  Issue Receipt
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/customers">
                  <Users className="mr-2 h-4 w-4" />
                  Manage Customers
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/products">
                  <Package className="mr-2 h-4 w-4" />
                  Manage Products
                </Link>
              </Button>
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link to="/reports">
                  <TrendingUp className="mr-2 h-4 w-4" />
                  View Reports
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
