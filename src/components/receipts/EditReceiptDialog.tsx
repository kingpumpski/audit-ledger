import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Mail, MessageSquare } from 'lucide-react';
import { ReceiptWithRelations } from '@/hooks/useReceipts';

const editReceiptSchema = z.object({
  notes: z.string().optional(),
  payment_method: z.enum(['cash', 'credit_card', 'debit_card', 'bank_transfer', 'check', 'mobile_payment', 'other']),
});

type EditReceiptFormData = z.infer<typeof editReceiptSchema>;

interface EditReceiptDialogProps {
  receipt: ReceiptWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: EditReceiptFormData, notifyCustomer: boolean) => Promise<void>;
  isUpdating: boolean;
}

export function EditReceiptDialog({
  receipt,
  open,
  onOpenChange,
  onSave,
  isUpdating,
}: EditReceiptDialogProps) {
  const [notifyCustomer, setNotifyCustomer] = useState(false);

  const form = useForm<EditReceiptFormData>({
    resolver: zodResolver(editReceiptSchema),
    defaultValues: {
      notes: '',
      payment_method: 'cash',
    },
  });

  useEffect(() => {
    if (receipt) {
      form.reset({
        notes: receipt.notes || '',
        payment_method: receipt.payment_method,
      });
    }
  }, [receipt, form]);

  const handleSubmit = async (data: EditReceiptFormData) => {
    if (!receipt) return;
    await onSave(receipt.id, data, notifyCustomer);
    onOpenChange(false);
  };

  const paymentMethods = [
    { value: 'cash', label: 'Cash' },
    { value: 'credit_card', label: 'Credit Card' },
    { value: 'debit_card', label: 'Debit Card' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'check', label: 'Check' },
    { value: 'mobile_payment', label: 'Mobile Payment' },
    { value: 'other', label: 'Other' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Receipt</DialogTitle>
          <DialogDescription>
            Update receipt details. Receipt #{receipt?.receipt_number}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="payment_method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Method</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {paymentMethods.map((method) => (
                        <SelectItem key={method.value} value={method.value}>
                          {method.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes..."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
              <div className="space-y-0.5">
                <Label htmlFor="notify-customer" className="text-base">
                  Notify Customer
                </Label>
                <p className="text-sm text-muted-foreground">
                  Send email/SMS notification about the update
                </p>
              </div>
              <Switch
                id="notify-customer"
                checked={notifyCustomer}
                onCheckedChange={setNotifyCustomer}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Changes
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
