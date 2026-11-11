import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useReceipts, ReceiptWithRelations } from '@/hooks/useReceipts';
import { useSettings } from '@/hooks/useSettings';
import { EditReceiptDialog } from '@/components/receipts/EditReceiptDialog';
import { supabase } from '@/integrations/supabase/client';
import { 
  Plus, 
  Search, 
  Filter, 
  Receipt, 
  MoreHorizontal,
  Loader2,
  Eye,
  Printer,
  Ban,
  FileText,
  Pencil
} from 'lucide-react';
import { format } from 'date-fns';

export default function Receipts() {
  const navigate = useNavigate();
  const { receipts, isLoading, updateReceipt, voidReceipt, isUpdating, isVoiding } = useReceipts();
  const { settings } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptWithRelations | null>(null);
  const [editingReceipt, setEditingReceipt] = useState<ReceiptWithRelations | null>(null);

  const currencySymbol = settings?.currency_symbol || '$';

  const filteredReceipts = useMemo(() => {
    return receipts.filter(receipt => {
      const matchesSearch = 
        receipt.receipt_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        receipt.customer?.name?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || receipt.status === statusFilter;
      const matchesMethod = methodFilter === 'all' || receipt.payment_method === methodFilter;
      
      return matchesSearch && matchesStatus && matchesMethod;
    });
  }, [receipts, searchQuery, statusFilter, methodFilter]);

  const handlePrintReceipt = async (receipt: ReceiptWithRelations) => {
    try {
      const response = await supabase.functions.invoke('generate-receipt-pdf', {
        body: { receiptId: receipt.id },
      });

      if (response.data) {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(response.data);
          printWindow.document.close();
          printWindow.print();
        }
      }
    } catch (error) {
      console.error('Failed to generate PDF:', error);
    }
  };

  const paymentMethodLabels: Record<string, string> = {
    cash: 'Cash',
    credit_card: 'Credit Card',
    debit_card: 'Debit Card',
    bank_transfer: 'Bank Transfer',
    check: 'Check',
    mobile_payment: 'Mobile Payment',
    other: 'Other',
  };

  const totalAmount = receipts
    .filter(r => r.status === 'issued')
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <AppLayout
      title="Receipts"
      subtitle="View and issue payment receipts"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/receipts/documents">
              <FileText className="mr-2 h-4 w-4" />
              PDF documents
            </Link>
          </Button>
          <Button asChild>
            <Link to="/receipts/new">
              <Plus className="mr-2 h-4 w-4" />
              Issue Receipt
            </Link>
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Receipts</p>
                <p className="text-2xl font-bold">{receipts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <FileText className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Issued</p>
                <p className="text-2xl font-bold">{receipts.filter(r => r.status === 'issued').length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10">
                <Receipt className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="text-2xl font-bold">{currencySymbol}{totalAmount.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4 border-b">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search receipts..." 
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
                <SelectItem value="issued">Issued</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>
            <Select value={methodFilter} onValueChange={setMethodFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Payment Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="credit_card">Credit Card</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="mobile_payment">Mobile Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-medium">No receipts found</h3>
              <p className="text-muted-foreground">
                {searchQuery || statusFilter !== 'all' || methodFilter !== 'all'
                  ? 'Try adjusting your filters' 
                  : 'Issue your first receipt to get started'}
              </p>
              <Button asChild className="mt-4">
                <Link to="/receipts/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Issue Receipt
                </Link>
              </Button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Payment Method</th>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.map((receipt) => (
                  <tr key={receipt.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/receipts/${receipt.id}`)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{receipt.receipt_number}</span>
                      </div>
                    </td>
                    <td>{receipt.customer?.name || '—'}</td>
                    <td className="font-medium">
                      {currencySymbol}{receipt.amount.toLocaleString()}
                    </td>
                    <td>
                      <Badge variant="secondary">
                        {paymentMethodLabels[receipt.payment_method] || receipt.payment_method}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground">
                      {format(new Date(receipt.issue_date), 'MMM dd, yyyy')}
                    </td>
                    <td className="text-primary">
                      {receipt.invoice?.invoice_number || '—'}
                    </td>
                    <td>
                      <Badge 
                        variant={receipt.status === 'issued' ? 'default' : 'destructive'}
                        className={receipt.status === 'issued' ? 'bg-success/10 text-success' : ''}
                      >
                        {receipt.status === 'issued' ? 'Issued' : 'Void'}
                      </Badge>
                    </td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedReceipt(receipt)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          {receipt.status === 'issued' && (
                            <DropdownMenuItem onClick={() => setEditingReceipt(receipt)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit Receipt
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handlePrintReceipt(receipt)}>
                            <Printer className="mr-2 h-4 w-4" />
                            Print Receipt
                          </DropdownMenuItem>
                          {receipt.status === 'issued' && (
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => voidReceipt(receipt.id)}
                              disabled={isVoiding}
                            >
                              <Ban className="mr-2 h-4 w-4" />
                              Void Receipt
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

      {/* Receipt Details Dialog */}
      <Dialog open={!!selectedReceipt} onOpenChange={() => setSelectedReceipt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedReceipt?.receipt_number}</DialogTitle>
            <DialogDescription>Receipt Details</DialogDescription>
          </DialogHeader>
          {selectedReceipt && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Customer</p>
                  <p className="font-medium">{selectedReceipt.customer?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="font-medium text-lg">
                    {currencySymbol}{selectedReceipt.amount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payment Method</p>
                  <p className="font-medium">
                    {paymentMethodLabels[selectedReceipt.payment_method]}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {format(new Date(selectedReceipt.issue_date), 'PPP')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Issued By</p>
                  <p className="font-medium">{selectedReceipt.issuer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge 
                    variant={selectedReceipt.status === 'issued' ? 'default' : 'destructive'}
                  >
                    {selectedReceipt.status}
                  </Badge>
                </div>
              </div>
              {selectedReceipt.invoice && (
                <div>
                  <p className="text-sm text-muted-foreground">Linked Invoice</p>
                  <p className="font-medium text-primary">
                    {selectedReceipt.invoice.invoice_number}
                  </p>
                </div>
              )}
              {selectedReceipt.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">Notes</p>
                  <p className="text-sm">{selectedReceipt.notes}</p>
                </div>
              )}
              {selectedReceipt.signature_data && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Signature</p>
                  <img 
                    src={selectedReceipt.signature_data} 
                    alt="Signature" 
                    className="h-16 border rounded"
                  />
                </div>
              )}
              <div className="flex gap-3 pt-4 border-t">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => handlePrintReceipt(selectedReceipt)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                {selectedReceipt.status === 'issued' && (
                  <Button 
                    variant="destructive" 
                    className="flex-1"
                    onClick={() => {
                      voidReceipt(selectedReceipt.id);
                      setSelectedReceipt(null);
                    }}
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    Void
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Receipt Dialog */}
      <EditReceiptDialog
        receipt={editingReceipt}
        open={!!editingReceipt}
        onOpenChange={(open) => !open && setEditingReceipt(null)}
        onSave={async (id, data, notifyCustomer) => {
          await updateReceipt({ id, data, notifyCustomer });
        }}
        isUpdating={isUpdating}
      />
    </AppLayout>
  );
}
