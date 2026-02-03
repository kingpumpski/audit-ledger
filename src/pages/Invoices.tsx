import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Plus, 
  Search, 
  Filter, 
  FileText, 
  MoreHorizontal,
  Loader2,
  CreditCard,
  Eye,
  Send
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useInvoices } from '@/hooks/useInvoices';
import { useSettings } from '@/hooks/useSettings';
import { RecordPaymentDialog } from '@/components/payments/RecordPaymentDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';

const statusColors: Record<string, string> = {
  paid: 'bg-success/10 text-success border-success/20',
  issued: 'bg-info/10 text-info border-info/20',
  overdue: 'bg-destructive/10 text-destructive border-destructive/20',
  draft: 'bg-muted text-muted-foreground',
  partially_paid: 'bg-warning/10 text-warning border-warning/20',
  canceled: 'bg-muted text-muted-foreground line-through',
};

export default function Invoices() {
  const { invoices, isLoading, issueInvoice, isIssuing } = useInvoices();
  const { settings } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const currencySymbol = settings?.currency_symbol || '$';

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = 
      invoice.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.customer?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const handleIssueInvoice = (invoiceId: string) => {
    issueInvoice(invoiceId);
  };

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
              <Input 
                placeholder="Search invoices..." 
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partially_paid">Partially Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="canceled">Canceled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No invoices found</h3>
              <p className="text-muted-foreground">
                {searchQuery || statusFilter !== 'all' 
                  ? 'Try adjusting your filters' 
                  : 'Create your first invoice to get started'}
              </p>
              {!searchQuery && statusFilter === 'all' && (
                <Button className="mt-4" asChild>
                  <Link to="/invoices/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Invoice
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Balance Due</th>
                  <th>Status</th>
                  <th>Issue Date</th>
                  <th>Due Date</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{invoice.invoice_number}</span>
                      </div>
                    </td>
                    <td>{invoice.customer?.name || 'Unknown'}</td>
                    <td className="font-medium">
                      {currencySymbol}{(invoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className={cn(
                      "font-medium",
                      (invoice.balance_due || 0) > 0 && "text-warning"
                    )}>
                      {currencySymbol}{(invoice.balance_due || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td>
                      <Badge className={cn(
                        'capitalize',
                        statusColors[invoice.status] || statusColors.draft
                      )}>
                        {invoice.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground">
                      {invoice.issue_date ? format(new Date(invoice.issue_date), 'MMM d, yyyy') : '-'}
                    </td>
                    <td className="text-muted-foreground">
                      {invoice.due_date ? format(new Date(invoice.due_date), 'MMM d, yyyy') : '-'}
                    </td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/invoices/${invoice.id}`} className="flex items-center">
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          
                          {invoice.status === 'draft' && (
                            <DropdownMenuItem 
                              onClick={() => handleIssueInvoice(invoice.id)}
                              disabled={isIssuing}
                            >
                              <Send className="mr-2 h-4 w-4" />
                              Issue Invoice
                            </DropdownMenuItem>
                          )}
                          
                          {(invoice.status === 'issued' || invoice.status === 'partially_paid' || invoice.status === 'overdue') && (
                            <DropdownMenuItem asChild>
                              <RecordPaymentDialog
                                invoiceId={invoice.id}
                                customerId={invoice.customer_id}
                                invoiceNumber={invoice.invoice_number}
                                balanceDue={invoice.balance_due || 0}
                                currencySymbol={currencySymbol}
                                trigger={
                                  <button className="flex items-center w-full px-2 py-1.5 text-sm">
                                    <CreditCard className="mr-2 h-4 w-4" />
                                    Record Payment
                                  </button>
                                }
                              />
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
