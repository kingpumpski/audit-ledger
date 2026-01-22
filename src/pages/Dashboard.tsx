import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Receipt,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Users,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

// Mock data
const revenueData = [
  { month: 'Jan', revenue: 4200, expenses: 2400 },
  { month: 'Feb', revenue: 5100, expenses: 2800 },
  { month: 'Mar', revenue: 4800, expenses: 2600 },
  { month: 'Apr', revenue: 6200, expenses: 3100 },
  { month: 'May', revenue: 7500, expenses: 3400 },
  { month: 'Jun', revenue: 8100, expenses: 3800 },
  { month: 'Jul', revenue: 7800, expenses: 3600 },
];

const invoiceStatusData = [
  { name: 'Paid', value: 45, color: 'hsl(var(--success))' },
  { name: 'Pending', value: 25, color: 'hsl(var(--info))' },
  { name: 'Overdue', value: 15, color: 'hsl(var(--destructive))' },
  { name: 'Draft', value: 15, color: 'hsl(var(--muted-foreground))' },
];

const recentInvoices = [
  { id: 'INV-000056', customer: 'Acme Corp', amount: 2500, status: 'paid', date: '2026-01-20' },
  { id: 'INV-000055', customer: 'TechStart Inc', amount: 1800, status: 'issued', date: '2026-01-19' },
  { id: 'INV-000054', customer: 'Global Services', amount: 3200, status: 'overdue', date: '2026-01-15' },
  { id: 'INV-000053', customer: 'Startup Labs', amount: 950, status: 'paid', date: '2026-01-14' },
  { id: 'INV-000052', customer: 'Metro Solutions', amount: 4100, status: 'draft', date: '2026-01-13' },
];

const statsCards = [
  {
    title: 'Total Revenue',
    value: '$45,231.89',
    change: '+20.1%',
    trend: 'up',
    icon: DollarSign,
    description: 'from last month',
    gradient: 'from-primary to-info',
  },
  {
    title: 'Invoices Sent',
    value: '156',
    change: '+12.5%',
    trend: 'up',
    icon: FileText,
    description: 'this month',
    gradient: 'from-accent to-purple-500',
  },
  {
    title: 'Pending Payments',
    value: '$12,450.00',
    change: '-4.3%',
    trend: 'down',
    icon: Clock,
    description: '23 invoices',
    gradient: 'from-warning to-orange-500',
  },
  {
    title: 'Active Customers',
    value: '89',
    change: '+8.2%',
    trend: 'up',
    icon: Users,
    description: 'new this month: 12',
    gradient: 'from-success to-emerald-500',
  },
];

export default function Dashboard() {
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
                      <span className="text-xs text-muted-foreground">{stat.description}</span>
                    </div>
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

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg font-display">Revenue Overview</CardTitle>
              <CardDescription>Monthly revenue and expenses comparison</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="month" 
                      className="text-xs fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      className="text-xs fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) => `$${value / 1000}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 'var(--radius)',
                      }}
                      formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorRevenue)"
                      name="Revenue"
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      stroke="hsl(var(--accent))"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorExpenses)"
                      name="Expenses"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Invoice Status Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-display">Invoice Status</CardTitle>
              <CardDescription>Distribution by status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={invoiceStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {invoiceStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 'var(--radius)',
                      }}
                      formatter={(value: number) => [`${value}%`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-4 mt-4">
                {invoiceStatusData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-muted-foreground">{item.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
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
                        invoice.status === 'draft' && 'bg-muted'
                      )}>
                        {invoice.status === 'paid' && <CheckCircle2 className="h-5 w-5 text-success" />}
                        {invoice.status === 'issued' && <FileText className="h-5 w-5 text-info" />}
                        {invoice.status === 'overdue' && <AlertTriangle className="h-5 w-5 text-destructive" />}
                        {invoice.status === 'draft' && <FileText className="h-5 w-5 text-muted-foreground" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{invoice.id}</p>
                        <p className="text-xs text-muted-foreground">{invoice.customer}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">${invoice.amount.toLocaleString()}</p>
                      <Badge 
                        variant="secondary"
                        className={cn(
                          'text-[10px] capitalize',
                          invoice.status === 'paid' && 'bg-success/10 text-success',
                          invoice.status === 'issued' && 'bg-info/10 text-info',
                          invoice.status === 'overdue' && 'bg-destructive/10 text-destructive',
                          invoice.status === 'draft' && 'bg-muted text-muted-foreground'
                        )}
                      >
                        {invoice.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
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
                <Link to="/customers/new">
                  <Users className="mr-2 h-4 w-4" />
                  Add Customer
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
