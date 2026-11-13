import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Tables, TablesInsert } from '@/integrations/supabase/types';

type Payment = Tables<'payments'>;
type Customer = Tables<'customers'>;
type Invoice = Tables<'invoices'>;

export interface PaymentWithRelations extends Payment {
  customer?: Customer;
  invoice?: Invoice;
}

interface CreatePaymentData {
  invoice_id: string;
  customer_id: string;
  amount: number;
  payment_method: 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer' | 'check' | 'mobile_payment' | 'other';
  reference_number?: string;
  notes?: string;
}

export function usePayments() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const paymentsQuery = useQuery({
    queryKey: ['payments'],
    queryFn: async (): Promise<PaymentWithRelations[]> => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          *,
          customer:customers(*),
          invoice:invoices(*)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as PaymentWithRelations[];
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: async (paymentData: CreatePaymentData) => {
      // Payment, invoice balance update and journal posting are committed atomically by Postgres.
      const { data: paymentId, error: paymentError } = await supabase.rpc('record_invoice_payment', {
        p_invoice_id: paymentData.invoice_id,
        p_customer_id: paymentData.customer_id,
        p_amount: paymentData.amount,
        p_payment_method: paymentData.payment_method,
        p_reference_number: paymentData.reference_number || null,
        p_notes: paymentData.notes || null,
      });

      if (paymentError) throw paymentError;
      if (!paymentId) throw new Error('Payment was not created');

      const { data: payment, error: fetchError } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (fetchError) throw fetchError;

      // Email is secondary; a delivery failure must not undo a successfully recorded payment.
      try {
        await supabase.functions.invoke('send-payment-confirmation', {
          body: { paymentId: payment.id },
        });
      } catch (emailError) {
        console.error('Failed to send payment confirmation email:', emailError);
      }

      return payment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast({ title: 'Payment recorded successfully', description: 'Confirmation email sent to customer.' });
    },
    onError: (error) => {
      toast({ title: 'Failed to record payment', description: error.message, variant: 'destructive' });
    },
  });

  return {
    payments: paymentsQuery.data || [],
    isLoading: paymentsQuery.isLoading,
    error: paymentsQuery.error,
    createPayment: createPaymentMutation.mutateAsync,
    isCreating: createPaymentMutation.isPending,
  };
}

export function usePayment(id: string) {
  return useQuery({
    queryKey: ['payment', id],
    queryFn: async (): Promise<PaymentWithRelations | null> => {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          *,
          customer:customers(*),
          invoice:invoices(*)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as PaymentWithRelations;
    },
    enabled: !!id,
  });
}
