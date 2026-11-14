import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileMinus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/error-message';
import { supabase } from '@/integrations/supabase/client';
import type { InvoiceWithItems } from '@/hooks/useInvoices';

interface CreateCreditNoteDialogProps {
  invoice: InvoiceWithItems;
  currencySymbol: string;
}

function localDateValue() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function CreateCreditNoteDialog({ invoice, currencySymbol }: CreateCreditNoteDialogProps) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [creditDate, setCreditDate] = useState(localDateValue);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const selectedLines = useMemo(
    () => (invoice.items || [])
      .map((item) => ({ item, quantity: Number(quantities[item.id] || 0) }))
      .filter(({ quantity }) => Number.isFinite(quantity) && quantity > 0),
    [invoice.items, quantities],
  );

  const resetForm = () => {
    setQuantities({});
    setCreditDate(localDateValue());
    setReason('');
    setReference('');
    setIdempotencyKey(crypto.randomUUID());
  };

  const handleSubmit = async () => {
    if (!selectedLines.length) {
      toast({ title: 'Select at least one line', description: 'Enter a quantity to credit for one or more invoice lines.', variant: 'destructive' });
      return;
    }
    if (!creditDate || !reason.trim() || !reference.trim()) {
      toast({ title: 'Complete the credit-note details', description: 'The credit date, reason and supporting reference are required.', variant: 'destructive' });
      return;
    }
    if (selectedLines.some(({ item, quantity }) => quantity > item.quantity || quantity !== Number(quantity.toFixed(3)))) {
      toast({ title: 'Check the quantities', description: 'Credit quantities must be positive, use no more than three decimal places, and cannot exceed the original line quantity.', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const rpc = supabase.rpc as unknown as (
        functionName: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { message: string } | null }>;

      const { data, error } = await rpc('record_invoice_credit_note', {
        p_invoice_id: invoice.id,
        p_lines: selectedLines.map(({ item, quantity }) => ({
          invoice_item_id: item.id,
          quantity,
        })),
        p_credit_note_date: creditDate,
        p_reason: reason.trim(),
        p_reference_number: reference.trim(),
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;
      if (!data) throw new Error('The credit-note service did not return a credit note reference.');

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-account-balances'] }),
        queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] }),
      ]);

      toast({
        title: 'Credit note issued',
        description: 'The credit note was recorded. Any customer credit or stock return is posted separately in the accounting records.',
      });
      setOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: 'Credit note could not be issued',
        description: getErrorMessage(error, 'Review the selected quantities and original invoice evidence, then try again.'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen && !isSubmitting) resetForm();
    }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileMinus className="mr-2 h-4 w-4" />
          Issue Credit Note
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Issue credit note</DialogTitle>
          <DialogDescription>
            This creates a separate, auditable credit document. The original invoice and its payment history remain unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">{invoice.invoice_number}</div>
            <div className="text-muted-foreground">
              {invoice.customer?.name || 'Customer'} · Original total {currencySymbol}{Number(invoice.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Lines to credit</div>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
              {(invoice.items || []).map((item) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.description}</div>
                    <div className="text-xs text-muted-foreground">
                      Invoiced {item.quantity} · {currencySymbol}{Number(item.line_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <Input
                    aria-label={`Quantity to credit for ${item.description}`}
                    type="number"
                    min="0"
                    max={item.quantity}
                    step="0.001"
                    inputMode="decimal"
                    placeholder="0"
                    value={quantities[item.id] ?? ''}
                    onChange={(event) => {
                      setIdempotencyKey(crypto.randomUUID());
                      setQuantities((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }));
                    }}
                  />
                </div>
              ))}
              {(!invoice.items || invoice.items.length === 0) && (
                <p className="text-sm text-muted-foreground">This invoice has no line items available to credit.</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Physical stock returns require a verified original unit cost and whole-unit quantities. Historical taxed lines without per-line tax evidence cannot be credited.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Credit date</span>
              <Input type="date" value={creditDate} min={invoice.issue_date || undefined} onChange={(event) => { setIdempotencyKey(crypto.randomUUID()); setCreditDate(event.target.value); }} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Supporting reference</span>
              <Input value={reference} onChange={(event) => { setIdempotencyKey(crypto.randomUUID()); setReference(event.target.value); }} placeholder="Return note / customer reference" maxLength={120} />
            </label>
          </div>

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Reason for credit</span>
            <Textarea value={reason} onChange={(event) => { setIdempotencyKey(crypto.randomUUID()); setReason(event.target.value); }} placeholder="Explain the return, pricing correction or service adjustment..." rows={3} maxLength={1000} />
          </label>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            The database calculates the exact credit and tax reversal from the original invoice evidence. Any amount exceeding the open receivable becomes a customer-credit liability; it is not treated as cash refunded.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !selectedLines.length}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileMinus className="mr-2 h-4 w-4" />}
            Issue Credit Note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
