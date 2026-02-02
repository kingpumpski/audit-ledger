import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { useReceipts } from '@/hooks/useReceipts';
import { useCustomers } from '@/hooks/useCustomers';
import { useInvoices } from '@/hooks/useInvoices';
import { SignaturePad } from '@/components/SignaturePad';
import { 
  Loader2,
  ArrowLeft,
  CheckCircle,
  Receipt,
  Printer
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

const paymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'check', label: 'Check' },
  { value: 'mobile_payment', label: 'Mobile Payment' },
  { value: 'other', label: 'Other' },
] as const;

export default function ReceiptNew() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { createReceipt, isCreating } = useReceipts();
  const { customers } = useCustomers();
  const { invoices } = useInvoices();

  const [customerId, setCustomerId] = useState<string>('');
  const [invoiceId, setInvoiceId] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<typeof paymentMethods[number]['value']>('cash');
  const [notes, setNotes] = useState('');
  const [signatureData, setSignatureData] = useState<string>('');
  const [isIssued, setIsIssued] = useState(false);
  const [issuedReceipt, setIssuedReceipt] = useState<any>(null);

  // Filter unpaid invoices for selected customer
  const customerInvoices = invoices.filter(inv => 
    inv.customer_id === customerId && 
    inv.status !== 'paid' && 
    inv.status !== 'canceled'
  );

  const selectedInvoice = invoices.find(inv => inv.id === invoiceId);
  const selectedCustomer = customers.find(c => c.id === customerId);

  const handleInvoiceSelect = (invId: string) => {
    const actualId = invId === 'none' ? '' : invId;
    setInvoiceId(actualId);
    const invoice = invoices.find(inv => inv.id === actualId);
    if (invoice) {
      setAmount(invoice.balance_due || invoice.total_amount || 0);
    }
  };

  const handleSubmit = async () => {
    if (!customerId || amount <= 0) return;

    try {
      const receipt = await createReceipt({
        customer_id: customerId,
        invoice_id: invoiceId || undefined,
        amount,
        payment_method: paymentMethod,
        notes,
        signature_data: signatureData || undefined,
      });

      setIssuedReceipt(receipt);
      setIsIssued(true);
    } catch (error) {
      console.error('Failed to create receipt:', error);
    }
  };

  const handlePrintReceipt = async () => {
    if (!issuedReceipt) return;

    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke('generate-receipt-pdf', {
        body: { receiptId: issuedReceipt.id },
      });

      if (response.data) {
        // Open in new window for printing
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

  if (isIssued && issuedReceipt) {
    return (
      <AppLayout
        title="Receipt Issued"
        subtitle={`Receipt ${issuedReceipt.receipt_number} has been created`}
      >
        <Card className="max-w-lg mx-auto">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">{issuedReceipt.receipt_number}</h2>
              <p className="text-muted-foreground">
                ${Number(issuedReceipt.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="flex gap-3 justify-center pt-4">
              <Button variant="outline" onClick={() => navigate('/receipts')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Receipts
              </Button>
              <Button onClick={handlePrintReceipt}>
                <Printer className="mr-2 h-4 w-4" />
                Print Receipt
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Issue Receipt"
      subtitle="Create a payment receipt with digital signature"
      actions={
        <Button variant="outline" onClick={() => navigate('/receipts')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Cancel
        </Button>
      }
    >
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Payment Details */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Customer *</Label>
                <Select value={customerId} onValueChange={(v) => {
                  setCustomerId(v);
                  setInvoiceId('');
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map(customer => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Link to Invoice (Optional)</Label>
                <Select 
                  value={invoiceId} 
                  onValueChange={handleInvoiceSelect}
                  disabled={!customerId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select invoice" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No invoice</SelectItem>
                    {customerInvoices.map(invoice => (
                      <SelectItem key={invoice.id} value={invoice.id}>
                        {invoice.invoice_number} - ${invoice.balance_due?.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Amount *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount || ''}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="pl-7"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Payment Method *</Label>
                <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map(method => (
                      <SelectItem key={method.value} value={method.value}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional notes..."
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Digital Signature */}
        <Card>
          <CardHeader>
            <CardTitle>Digital Signature</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign below to authorize this receipt. Your signature will be embedded in the document.
            </p>

            <SignaturePad
              onSave={(data) => setSignatureData(data)}
              onClear={() => setSignatureData('')}
            />

            {signatureData && (
              <div className="pt-4 border-t">
                <div className="flex items-center gap-3">
                  <img 
                    src={signatureData} 
                    alt="Signature" 
                    className="h-12 border rounded"
                  />
                  <div>
                    <p className="font-medium">{profile?.full_name || 'Unknown'}</p>
                    <p className="text-sm text-muted-foreground">Authorized Signatory</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Preview & Submit */}
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Receipt Preview</p>
                <p className="font-medium">{selectedCustomer?.name || 'Select customer'}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">
                  ${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-sm text-muted-foreground capitalize">
                  {paymentMethod.replace('_', ' ')}
                </p>
              </div>
            </div>

            {selectedInvoice && (
              <div className="p-3 bg-background rounded-lg text-sm mb-4">
                <span className="text-muted-foreground">For Invoice: </span>
                <span className="font-medium">{selectedInvoice.invoice_number}</span>
              </div>
            )}

            <Button 
              className="w-full" 
              size="lg"
              onClick={handleSubmit}
              disabled={isCreating || !customerId || amount <= 0}
            >
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  Issue Receipt
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
