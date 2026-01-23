import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tables } from '@/integrations/supabase/types';

type Receipt = Tables<'receipts'>;
type Customer = Tables<'customers'>;
type Invoice = Tables<'invoices'>;

export interface ReceiptWithRelations extends Receipt {
  customer?: Customer;
  invoice?: Invoice;
}

interface CreateReceiptData {
  customer_id: string;
  invoice_id?: string;
  payment_id?: string;
  amount: number;
  payment_method: 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer' | 'check' | 'mobile_payment' | 'other';
  notes?: string;
  signature_data?: string;
}

// Simple hash function for verification
async function generateChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function useReceipts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const receiptsQuery = useQuery({
    queryKey: ['receipts'],
    queryFn: async (): Promise<ReceiptWithRelations[]> => {
      const { data, error } = await supabase
        .from('receipts')
        .select(`
          *,
          customer:customers(*),
          invoice:invoices(*)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ReceiptWithRelations[];
    },
  });

  const createReceiptMutation = useMutation({
    mutationFn: async (receiptData: CreateReceiptData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get user profile for issuer name
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      // Get next receipt number
      const { data: receiptNumber, error: seqError } = await supabase
        .rpc('get_next_sequence', { seq_name: 'receipt' });

      if (seqError) throw seqError;

      // Generate checksum for immutability verification
      const checksumData = JSON.stringify({
        receiptNumber,
        amount: receiptData.amount,
        customerId: receiptData.customer_id,
        paymentMethod: receiptData.payment_method,
        issuedBy: user.id,
        timestamp: new Date().toISOString(),
      });
      const checksum = await generateChecksum(checksumData);

      // Generate signature hash if signature provided
      let signatureHash: string | null = null;
      if (receiptData.signature_data) {
        signatureHash = await generateChecksum(receiptData.signature_data + user.id);
      }

      // Create receipt
      const { data: receipt, error: receiptError } = await supabase
        .from('receipts')
        .insert({
          receipt_number: receiptNumber,
          customer_id: receiptData.customer_id,
          invoice_id: receiptData.invoice_id || null,
          payment_id: receiptData.payment_id || null,
          amount: receiptData.amount,
          payment_method: receiptData.payment_method,
          notes: receiptData.notes,
          signature_data: receiptData.signature_data,
          signature_hash: signatureHash,
          checksum,
          issued_by: user.id,
          issuer_name: profile?.full_name || user.email || 'Unknown',
          status: 'issued',
          is_locked: true,
        })
        .select()
        .single();

      if (receiptError) throw receiptError;

      // If linked to invoice, update invoice payment status
      if (receiptData.invoice_id) {
        const { data: invoice } = await supabase
          .from('invoices')
          .select('total_amount, amount_paid')
          .eq('id', receiptData.invoice_id)
          .single();

        if (invoice) {
          const newAmountPaid = (invoice.amount_paid || 0) + receiptData.amount;
          const newBalanceDue = (invoice.total_amount || 0) - newAmountPaid;
          const newStatus = newBalanceDue <= 0 ? 'paid' : 'partially_paid';

          await supabase
            .from('invoices')
            .update({
              amount_paid: newAmountPaid,
              balance_due: Math.max(0, newBalanceDue),
              status: newStatus,
            })
            .eq('id', receiptData.invoice_id);
        }
      }

      return receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast({ title: 'Receipt issued successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to issue receipt', description: error.message, variant: 'destructive' });
    },
  });

  const voidReceiptMutation = useMutation({
    mutationFn: async (receiptId: string) => {
      const { error } = await supabase
        .from('receipts')
        .update({ status: 'void', deleted_at: new Date().toISOString() })
        .eq('id', receiptId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      toast({ title: 'Receipt voided' });
    },
    onError: (error) => {
      toast({ title: 'Failed to void receipt', description: error.message, variant: 'destructive' });
    },
  });

  return {
    receipts: receiptsQuery.data || [],
    isLoading: receiptsQuery.isLoading,
    error: receiptsQuery.error,
    createReceipt: createReceiptMutation.mutateAsync,
    voidReceipt: voidReceiptMutation.mutate,
    isCreating: createReceiptMutation.isPending,
    isVoiding: voidReceiptMutation.isPending,
  };
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: async (): Promise<ReceiptWithRelations | null> => {
      const { data, error } = await supabase
        .from('receipts')
        .select(`
          *,
          customer:customers(*),
          invoice:invoices(*)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as ReceiptWithRelations;
    },
    enabled: !!id,
  });
}

// Verify receipt signature
export async function verifyReceiptSignature(
  signatureData: string,
  signatureHash: string,
  issuerId: string
): Promise<boolean> {
  const computedHash = await generateChecksum(signatureData + issuerId);
  return computedHash === signatureHash;
}
