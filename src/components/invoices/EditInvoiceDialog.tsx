import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { InvoiceWithItems } from '@/hooks/useInvoices';

interface EditInvoiceDialogProps {
  invoice: InvoiceWithItems | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: { notes?: string; terms?: string; due_date?: string }) => Promise<void>;
  isSaving: boolean;
}

export function EditInvoiceDialog({ invoice, open, onOpenChange, onSave, isSaving }: EditInvoiceDialogProps) {
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>();

  useEffect(() => {
    if (invoice) {
      setNotes(invoice.notes || '');
      setTerms(invoice.terms || '');
      setDueDate(invoice.due_date ? new Date(invoice.due_date) : undefined);
    }
  }, [invoice]);

  const handleSave = async () => {
    if (!invoice) return;
    await onSave(invoice.id, {
      notes,
      terms,
      due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Invoice {invoice?.invoice_number}</DialogTitle>
          <DialogDescription>Modify invoice details</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={dueDate} onSelect={setDueDate} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label>Terms</Label>
            <Input value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
