import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Search, Filter, Receipt, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';

const mockReceipts = [
  { id: 'RCP-000023', customer: 'Acme Corp', amount: 2500, method: 'Bank Transfer', date: '2026-01-20', invoice: 'INV-000056' },
  { id: 'RCP-000022', customer: 'Startup Labs', amount: 950, method: 'Credit Card', date: '2026-01-14', invoice: 'INV-000053' },
  { id: 'RCP-000021', customer: 'TechStart Inc', amount: 1200, method: 'Cash', date: '2026-01-10', invoice: 'INV-000051' },
];

export default function Receipts() {
  return (
    <AppLayout
      title="Receipts"
      subtitle="View and issue payment receipts"
      actions={
        <Button asChild>
          <Link to="/receipts/new">
            <Plus className="mr-2 h-4 w-4" />
            Issue Receipt
          </Link>
        </Button>
      }
    >
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search receipts..." className="pl-9" />
            </div>
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Filters
            </Button>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Payment Method</th>
                <th>Date</th>
                <th>Invoice</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {mockReceipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{receipt.id}</span>
                    </div>
                  </td>
                  <td>{receipt.customer}</td>
                  <td className="font-medium">${receipt.amount.toLocaleString()}</td>
                  <td><Badge variant="secondary">{receipt.method}</Badge></td>
                  <td className="text-muted-foreground">{receipt.date}</td>
                  <td className="text-primary">{receipt.invoice}</td>
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
