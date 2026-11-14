import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from '@/components/ui/select';
import { useReceipts } from '@/hooks/useReceipts';
import { type ReceiptWithRelations } from '@/hooks/useReceipts';
import { useCustomers } from '@/hooks/useCustomers';
import { useCustomerAccountBalances } from '@/hooks/useCustomerBalances';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useInvoices } from '@/hooks/useInvoices';
import { useProfile } from '@/hooks/useProfile';
import { SignaturePad } from '@/components/SignaturePad';
import { 
  Loader2, ArrowLeft, CheckCircle, Receipt, Printer, AlertTriangle
} from 'lucide-react';
import { useReceiptPrint } from '@/hooks/useReceiptPrint';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

const paymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'check', label: 'Check' },
  { value: 'mobile_payment', label: 'Mobile Payment' },
] as const;
type PaymentMethod = (typeof paymentMethods)[number]['value'];

function isPaymentMethod(value: string): value is PaymentMethod {
  return paymentMethods.some(method => method.value === value);
}

export default function ReceiptNew() {
  const navigate = useNavigate();
  const { profile: authProfile } = useAuth();
  const { profile } = useProfile();
  const { createReceipt, isCreating } = useReceipts();
  const { printReceipt } = useReceiptPrint();
  const { customers } = useCustomers();
  const { invoices } = useInvoices();
  const { formatCurrency } = useCurrency();

  const [customerId, setCustomerId] = useState('');
  const { balances: selectedCustomerBalances, isLoading: isCustomerBalanceLoading, error: selectedCustomerBalanceError } = useCustomerAccountBalances(format(new Date(), 'yyyy-MM-dd'), customerId || undefined, Boolean(customerId));
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [signatureData, setSignatureData] = useState('');
  const [idempotencyKey] = useState(() => {
    const storageKey = 'audit-ledger:receipt-new:idempotency-key';
    const existingKey = window.sessionStorage.getItem(storageKey);
    if (existingKey) return existingKey;
    const nextKey = crypto.randomUUID();
    window.sessionStorage.setItem(storageKey, nextKey);
    return nextKey;
  });
  const [isIssued, setIsIssued] = useState(false);
  const [issuedReceipt, setIssuedReceipt] = useState<ReceiptWithRelations | null>(null);
  const [showManualSign, setShowManualSign] = useState(false);

  // Auto-load profile signature
  useEffect(() => {
    if (profile?.signature_data && !signatureData) {
      setSignatureData(profile.signature_data);
    }
  }, [profile, signatureData]);

  const hasProfileSignature = !!profile?.signature_data;
  const hasSignature = !!signatureData;

  const customerInvoices = invoices.filter(inv => 
    inv.customer_id === customerId && inv.status !== 'paid' && inv.status !== 'canceled'
  );

  const selectedInvoice = invoices.find(inv => inv.id === invoiceId);
  const selectedCustomer = customers.find(c => c.id === customerId);

  const handleInvoiceSelect = (invId: string) => {
    const actualId = invId === 'none' ? '' : invId;
    setInvoiceId(actualId);
    const invoice = invoices.find(inv => inv.id === actualId);
    if (invoice) setAmount(invoice.balance_due || invoice.total_amount || 0);
  };

  const handleSubmit = async () => {
    if (!customerId || amount <= 0 || !hasSignature) return;
    try {
      const receipt = await createReceipt({
        customer_id: customerId,
        invoice_id: invoiceId || undefined,
        amount,
        payment_method: paymentMethod,
        notes,
        signature_data: signatureData,
        idempotency_key: idempotencyKey,
      });
      setIssuedReceipt(receipt);
      window.sessionStorage.removeItem('audit-ledger:receipt-new:idempotency-key');
      setIsIssued(true);
    } catch (error) {
      console.error('Failed to create receipt:', error);
    }
  };

  const handlePrintReceipt = () => {
    if (issuedReceipt) void printReceipt(issuedReceipt.id);
  };

  if (isIssued && issuedReceipt) {
    return (
      <AppLayout title="Receipt Issued" subtitle={`Receipt ${issuedReceipt.receipt_number} has been created`}>
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
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Receipts
              </Button>
              <Button onClick={handlePrintReceipt}>
                <Printer className="mr-2 h-4 w-4" /> Print Receipt
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
          <ArrowLeft className="mr-2 h-4 w-4" /> Cancel
        </Button>
      }
    >
      <div className="mx-auto w-full max-w-2xl space-y-6 pb-10">
        <Card>
          <CardHeader><CardTitle>Payment Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Customer *</Label>
                <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setInvoiceId(''); }}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>
                    {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {customerId && (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Current outstanding balance</span>
                    <span className="font-semibold tabular-nums">
                      {isCustomerBalanceLoading ? 'Calculating…' : selectedCustomerBalanceError ? 'Unavailable' : formatCurrency(selectedCustomerBalances[0]?.outstanding_balance ?? 0)}
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Link to Invoice (Optional)</Label>
                <Select value={invoiceId} onValueChange={handleInvoiceSelect} disabled={!customerId}>
                  <SelectTrigger><SelectValue placeholder="Select invoice" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No invoice</SelectItem>
                    {customerInvoices.map(inv => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.invoice_number} - ${inv.balance_due?.toFixed(2)}
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
                  <Input type="number" min="0.01" step="0.01" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} className="pl-7" placeholder="0.00" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Payment Method *</Label>
                <Select value={paymentMethod} onValueChange={(value) => {
                  if (isPaymentMethod(value)) setPaymentMethod(value);
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." rows={2} />
            </div>
          </CardContent>
        </Card>

        {/* Digital Signature */}
        <Card>
          <CardHeader><CardTitle>Digital Signature</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {hasProfileSignature && !showManualSign ? (
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  Your saved signature from your profile will be used.
                </p>
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                  <img src={profile!.signature_data!} alt="Profile Signature" className="h-12 border rounded" />
                  <div>
                    <p className="font-medium">{authProfile?.full_name || 'Unknown'}</p>
                    <p className="text-sm text-muted-foreground">Authorized Signatory</p>
                  </div>
                </div>
                <Button variant="link" size="sm" className="mt-2 p-0" onClick={() => setShowManualSign(true)}>
                  Use a different signature
                </Button>
              </div>
            ) : !hasProfileSignature && !showManualSign ? (
              <div className="text-center py-4">
                <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                <p className="text-sm font-medium">No saved signature found</p>
                <p className="text-sm text-muted-foreground mb-3">
                  You must sign below before issuing a receipt. You can also save a signature in your Profile.
                </p>
                <Button variant="outline" onClick={() => setShowManualSign(true)}>
                  Sign Now
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Sign below to authorize this receipt.
                </p>
                <SignaturePad
                  onSave={(data) => setSignatureData(data)}
                  onClear={() => setSignatureData('')}
                />
                {hasProfileSignature && (
                  <Button variant="link" size="sm" className="mt-2 p-0" onClick={() => {
                    setSignatureData(profile!.signature_data!);
                    setShowManualSign(false);
                  }}>
                    Use profile signature instead
                  </Button>
                )}
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
                <p className="text-2xl font-bold">${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                <p className="text-sm text-muted-foreground capitalize">{paymentMethod.replace('_', ' ')}</p>
              </div>
            </div>
            {selectedInvoice && (
              <div className="p-3 bg-background rounded-lg text-sm mb-4">
                <span className="text-muted-foreground">For Invoice: </span>
                <span className="font-medium">{selectedInvoice.invoice_number}</span>
              </div>
            )}
            <div className="mb-4 flex items-end justify-between gap-4 border-t pt-4">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Authorized by</p>
                <p className="font-medium">{authProfile?.full_name || profile?.full_name || 'Authorized Signatory'}</p>
                <p className="text-xs text-muted-foreground">Digital signature</p>
              </div>
              {hasSignature ? (
                <img
                  src={signatureData}
                  alt="Receipt authorization signature"
                  className="max-h-16 max-w-[180px] object-contain"
                />
              ) : (
                <p className="text-xs text-warning">Signature required</p>
              )}
            </div>
            {!hasSignature && (
              <p className="text-sm text-warning mb-3 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> A digital signature is required to issue a receipt.
              </p>
            )}
            <Button 
              className="w-full" size="lg"
              onClick={handleSubmit}
              disabled={isCreating || !customerId || amount <= 0 || !hasSignature}
            >
              {isCreating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
              ) : (
                <><Receipt className="mr-2 h-4 w-4" /> Issue Receipt</>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
