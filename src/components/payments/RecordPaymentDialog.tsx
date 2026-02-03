import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePayments } from '@/hooks/usePayments';
import { useReceipts } from '@/hooks/useReceipts';
import { Loader2, CreditCard } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface RecordPaymentDialogProps {
  invoiceId: string;
  customerId: string;
  invoiceNumber: string;
  balanceDue: number;
  currencySymbol?: string;
  trigger?: React.ReactNode;
  onPaymentRecorded?: () => void;
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'check', label: 'Check' },
  { value: 'mobile_payment', label: 'Mobile Payment' },
  { value: 'other', label: 'Other' },
];

export function RecordPaymentDialog({
  invoiceId,
  customerId,
  invoiceNumber,
  balanceDue,
  currencySymbol = '$',
  trigger,
  onPaymentRecorded,
}: RecordPaymentDialogProps) {
  const { toast } = useToast();
  const { createPayment, isCreating } = usePayments();
  const { createReceipt, isCreating: isCreatingReceipt } = useReceipts();
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    amount: balanceDue.toString(),
    payment_method: 'cash' as const,
    reference_number: '',
    notes: '',
    generate_receipt: true,
  });

  const isPending = isCreating || isCreatingReceipt;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid payment amount',
        variant: 'destructive',
      });
      return;
    }

    if (amount > balanceDue) {
      toast({
        title: 'Amount exceeds balance',
        description: `Payment amount cannot exceed the balance due (${currencySymbol}${balanceDue.toFixed(2)})`,
        variant: 'destructive',
      });
      return;
    }

    try {
      // Record the payment
      const payment = await createPayment({
        invoice_id: invoiceId,
        customer_id: customerId,
        amount,
        payment_method: formData.payment_method,
        reference_number: formData.reference_number || undefined,
        notes: formData.notes || undefined,
      });

      // Auto-generate receipt if enabled
      if (formData.generate_receipt) {
        await createReceipt({
          customer_id: customerId,
          invoice_id: invoiceId,
          payment_id: payment.id,
          amount,
          payment_method: formData.payment_method,
          notes: `Payment for invoice ${invoiceNumber}`,
        });
        toast({
          title: 'Payment recorded & receipt generated',
          description: `Payment of ${currencySymbol}${amount.toFixed(2)} has been recorded with receipt`,
        });
      }

      setIsOpen(false);
      setFormData({
        amount: balanceDue.toString(),
        payment_method: 'cash',
        reference_number: '',
        notes: '',
        generate_receipt: true,
      });
      onPaymentRecorded?.();
    } catch (error) {
      console.error('Payment error:', error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <CreditCard className="mr-2 h-4 w-4" />
            Record Payment
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Record a payment for invoice {invoiceNumber}. Balance due: {currencySymbol}{balanceDue.toFixed(2)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Payment Amount ({currencySymbol}) *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={balanceDue}
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              placeholder="0.00"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment_method">Payment Method *</Label>
            <Select
              value={formData.payment_method}
              onValueChange={(v: any) => setFormData({ ...formData, payment_method: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reference">Reference Number</Label>
            <Input
              id="reference"
              value={formData.reference_number}
              onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
              placeholder="e.g. Transaction ID, Check Number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Optional payment notes..."
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="generate_receipt"
              checked={formData.generate_receipt}
              onChange={(e) => setFormData({ ...formData, generate_receipt: e.target.checked })}
              className="rounded border-border"
            />
            <Label htmlFor="generate_receipt" className="text-sm font-normal cursor-pointer">
              Automatically generate receipt
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Record Payment
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
