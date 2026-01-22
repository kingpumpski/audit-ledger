import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Search, Filter, FileText, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

const mockInvoices = [
  { id: 'INV-000056', customer: 'Acme Corp', amount: 2500, status: 'paid', date: '2026-01-20', due: '2026-02-20' },
  { id: 'INV-000055', customer: 'TechStart Inc', amount: 1800, status: 'issued', date: '2026-01-19', due: '2026-02-19' },
  { id: 'INV-000054', customer: 'Global Services', amount: 3200, status: 'overdue', date: '2026-01-05', due: '2026-01-15' },
  { id: 'INV-000053', customer: 'Startup Labs', amount: 950, status: 'paid', date: '2026-01-14', due: '2026-02-14' },
  { id: 'INV-000052', customer: 'Metro Solutions', amount: 4100, status: 'draft', date: '2026-01-13', due: '2026-02-13' },
];

export default function Invoices() {
  return (
    <AppLayout
      title="Invoices"
      subtitle="Manage and track all your invoices"
      actions={
        <Button asChild>
          <Link to="/invoices/new">
            <Plus className="mr-2 h-4 w-4" />
            New Invoice
          </Link>
        </Button>
      }
    >
      <Card>
        <CardContent className="p-0">
          {/* Filters */}
          <div className="flex items-center gap-3 p-4 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search invoices..." className="pl-9" />
            </div>
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Filters
            </Button>
          </div>

          {/* Table */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {mockInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{invoice.id}</span>
                    </div>
                  </td>
                  <td>{invoice.customer}</td>
                  <td className="font-medium">${invoice.amount.toLocaleString()}</td>
                  <td>
                    <Badge className={cn(
                      'capitalize',
                      invoice.status === 'paid' && 'bg-success/10 text-success border-success/20',
                      invoice.status === 'issued' && 'bg-info/10 text-info border-info/20',
                      invoice.status === 'overdue' && 'bg-destructive/10 text-destructive border-destructive/20',
                      invoice.status === 'draft' && 'bg-muted text-muted-foreground'
                    )}>
                      {invoice.status}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground">{invoice.date}</td>
                  <td className="text-muted-foreground">{invoice.due}</td>
                  <td>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
