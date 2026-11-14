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
  reference_number?: string;
  signature_data?: string;
  idempotency_key: string;
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
        // Keep voided receipts visible for audit history while excluding other soft-deleted rows.
        .or('deleted_at.is.null,status.eq.void')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ReceiptWithRelations[];
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const createReceiptMutation = useMutation({
    mutationFn: async (receiptData: CreateReceiptData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Prepare the integrity values before the RPC. The database creates any
      // invoice payment and the receipt together, so a failed receipt cannot
      // leave behind an unreceipted payment.
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      const issuedAt = new Date().toISOString();
      const checksumData = JSON.stringify({
        amount: receiptData.amount,
        customerId: receiptData.customer_id,
        paymentMethod: receiptData.payment_method,
        issuedBy: user.id,
        timestamp: issuedAt,
      });
      const checksum = await generateChecksum(checksumData);

      let signatureHash: string | null = null;
      if (receiptData.signature_data) {
        signatureHash = await generateChecksum(receiptData.signature_data + user.id);
      }

      const { data: receiptId, error: createError } = await supabase.rpc('create_receipt_with_payment', {
        p_customer_id: receiptData.customer_id,
        p_invoice_id: receiptData.invoice_id || null,
        p_payment_id: receiptData.payment_id || null,
        p_amount: receiptData.amount,
        p_payment_method: receiptData.payment_method,
        p_idempotency_key: receiptData.idempotency_key,
        p_notes: receiptData.notes || null,
        p_signature_data: receiptData.signature_data || null,
        p_reference_number: receiptData.reference_number || null,
        p_signature_hash: signatureHash,
        p_checksum: checksum,
        p_issuer_name: profile?.full_name || user.email || 'Unknown',
      });

      if (createError) throw createError;
      if (!receiptId) throw new Error('Receipt was not created');

      const { data: receipt, error: fetchError } = await supabase
        .from('receipts')
        .select('*')
        .eq('id', receiptId)
        .single();

      if (fetchError) throw fetchError;
      return receipt;
    },
    onSuccess: (receipt) => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (receipt.invoice_id) {
        queryClient.invalidateQueries({ queryKey: ['invoice', receipt.invoice_id] });
      }
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      toast({ title: 'Receipt issued successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to issue receipt', description: error.message, variant: 'destructive' });
    },
  });

  const updateReceiptMutation = useMutation({
    mutationFn: async ({ id, data }: { 
      id: string; 
      data: { notes?: string };
    }) => {
      const { data: updatedReceipt, error } = await supabase
        .from('receipts')
        .update({
          notes: data.notes,
        })
        .eq('id', id)
        .eq('status', 'issued') // Only allow editing issued receipts
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!updatedReceipt) {
        throw new Error('This receipt could not be updated. It may have been voided, deleted or is no longer available for editing.');
      }

    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt'] });
      toast({ title: 'Receipt updated successfully' });
    },
    onError: (error) => {
      toast({ title: 'Failed to update receipt', description: error.message, variant: 'destructive' });
    },
  });

  const voidReceiptMutation = useMutation({
    mutationFn: async (receiptId: string) => {
      const { error } = await supabase.rpc('void_receipt_and_reconcile', {
        receipt_id: receiptId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      queryClient.invalidateQueries({ queryKey: ['receipt'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['journal-ledger-entries'] });
      toast({ title: 'Receipt voided', description: 'Any standalone receipt payment has been reversed from its linked invoice.' });
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
    updateReceipt: updateReceiptMutation.mutateAsync,
    voidReceipt: voidReceiptMutation.mutate,
    isCreating: createReceiptMutation.isPending,
    isUpdating: updateReceiptMutation.isPending,
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
