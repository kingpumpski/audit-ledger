import { useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Loader2, Save } from 'lucide-react';
import { ReceiptWithRelations } from '@/hooks/useReceipts';

const editReceiptSchema = z.object({
  notes: z.string().optional(),
});

type EditReceiptFormData = z.infer<typeof editReceiptSchema>;

interface EditReceiptDialogProps {
  receipt: ReceiptWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, data: EditReceiptFormData) => Promise<void>;
  isUpdating: boolean;
}

export function EditReceiptDialog({
  receipt,
  open,
  onOpenChange,
  onSave,
  isUpdating,
}: EditReceiptDialogProps) {

  const form = useForm<EditReceiptFormData>({
    resolver: zodResolver(editReceiptSchema),
    defaultValues: {
      notes: '',
    },
  });

  useEffect(() => {
    if (receipt) {
      form.reset({
        notes: receipt.notes || '',
      });
    }
  }, [receipt, form]);

  const handleSubmit = async (data: EditReceiptFormData) => {
    if (!receipt) return;
    await onSave(receipt.id, data);
    onOpenChange(false);
  };

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

            <p className="text-xs text-muted-foreground">
              Amount and payment method are locked after issue because they affect the accounting ledger. If either is incorrect, void the receipt and issue a corrected one.
            </p>

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
