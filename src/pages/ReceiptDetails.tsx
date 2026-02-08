import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useReceipts, ReceiptWithRelations } from '@/hooks/useReceipts';
import { useSettings } from '@/hooks/useSettings';
import { EditReceiptDialog } from '@/components/receipts/EditReceiptDialog';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { 
  ArrowLeft, 
  Receipt, 
  Loader2, 
  Printer,
  Pencil,
  Ban,
  User,
  Calendar,
  CreditCard,
  FileText,
  Building
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const paymentMethodLabels: Record<string, string> = {
  cash: 'Cash',
  credit_card: 'Credit Card',
  debit_card: 'Debit Card',
  bank_transfer: 'Bank Transfer',
  check: 'Check',
  mobile_payment: 'Mobile Payment',
  other: 'Other',
};

export default function ReceiptDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { updateReceipt, voidReceipt, isUpdating, isVoiding } = useReceipts();
  const { settings } = useSettings();
  const [isPrinting, setIsPrinting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const currencySymbol = settings?.currency_symbol || '$';

  const { data: receipt, isLoading, error } = useQuery({
    queryKey: ['receipt', id],
    queryFn: async (): Promise<ReceiptWithRelations | null> => {
      const { data, error } = await supabase
        .from('receipts')
        .select(`
          *,
          customer:customers(*),
          invoice:invoices(*)
        `)
        .eq('id', id!)
        .single();

      if (error) throw error;
      return data as ReceiptWithRelations;
    },
    enabled: !!id,
  });

  const handlePrintReceipt = async () => {
    if (!receipt) return;
    setIsPrinting(true);
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
    } finally {
      setIsPrinting(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout title="Receipt Details">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (error || !receipt) {
    return (
      <AppLayout title="Receipt Details">
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-medium">Receipt not found</h3>
            <p className="text-muted-foreground">
              The receipt you're looking for doesn't exist or has been deleted.
            </p>
            <Button className="mt-4" onClick={() => navigate('/receipts')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Receipts
            </Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title={receipt.receipt_number}
      subtitle="Receipt Details"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/receipts')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button variant="outline" onClick={handlePrintReceipt} disabled={isPrinting}>
            {isPrinting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            Print
          </Button>
          {receipt.status === 'issued' && (
            <>
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => voidReceipt(receipt.id)}
                disabled={isVoiding}
              >
                {isVoiding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Ban className="mr-2 h-4 w-4" />
                )}
                Void
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Receipt Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status Card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-lg bg-primary/10">
                    <Receipt className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{receipt.receipt_number}</h2>
                    <p className="text-muted-foreground">
                      Issued {format(new Date(receipt.issue_date), 'PPP')}
                    </p>
                  </div>
                </div>
                <Badge 
                  variant={receipt.status === 'issued' ? 'default' : 'destructive'}
                  className={cn(
                    'text-sm px-3 py-1',
                    receipt.status === 'issued' && 'bg-success/10 text-success border-success/20'
                  )}
                >
                  {receipt.status === 'issued' ? 'Issued' : 'Void'}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Payment Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Payment Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="text-2xl font-bold">
                    {currencySymbol}{receipt.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Payment Method</p>
                  <Badge variant="secondary" className="mt-1">
                    {paymentMethodLabels[receipt.payment_method] || receipt.payment_method}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Issued By</p>
                  <p className="font-medium">{receipt.issuer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Issue Date</p>
                  <p className="font-medium">{format(new Date(receipt.issue_date), 'PPP')}</p>
                </div>
              </div>

              {receipt.invoice && (
                <div>
                  <p className="text-sm text-muted-foreground">Linked Invoice</p>
                  <Button variant="link" asChild className="p-0 h-auto">
                    <Link to={`/invoices/${receipt.invoice.id}`} className="text-primary">
                      {receipt.invoice.invoice_number}
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          {receipt.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">{receipt.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Signature */}
          {receipt.signature_data && (
            <Card>
              <CardHeader>
                <CardTitle>Signature</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg p-4 bg-muted/50">
                  <img 
                    src={receipt.signature_data} 
                    alt="Signature" 
                    className="max-h-24"
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {receipt.customer ? (
                <>
                  <div>
                    <p className="font-medium">{receipt.customer.name}</p>
                    <p className="text-sm text-muted-foreground">{receipt.customer.code}</p>
                  </div>
                  {receipt.customer.email && (
                    <p className="text-sm">{receipt.customer.email}</p>
                  )}
                  {receipt.customer.phone && (
                    <p className="text-sm">{receipt.customer.phone}</p>
                  )}
                  <Button variant="outline" size="sm" asChild className="w-full mt-2">
                    <Link to={`/customers/${receipt.customer.id}`}>
                      View Customer Profile
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground">Customer not found</p>
              )}
            </CardContent>
          </Card>

          {/* Linked Invoice */}
          {receipt.invoice && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Invoice
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="font-medium">{receipt.invoice.invoice_number}</p>
                  <p className="text-sm text-muted-foreground">
                    Total: {currencySymbol}{(receipt.invoice.total_amount || 0).toLocaleString()}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild className="w-full">
                  <Link to={`/invoices/${receipt.invoice.id}`}>
                    View Invoice
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Company Info */}
          {settings && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  From
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{settings.company_name}</p>
                {settings.company_email && <p>{settings.company_email}</p>}
                {settings.company_phone && <p>{settings.company_phone}</p>}
                {settings.company_address && <p>{settings.company_address}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Edit Receipt Dialog */}
      <EditReceiptDialog
        receipt={receipt}
        open={isEditing}
        onOpenChange={setIsEditing}
        onSave={async (id, data, notifyCustomer) => {
          await updateReceipt({ id, data, notifyCustomer });
        }}
        isUpdating={isUpdating}
      />
    </AppLayout>
  );
}
