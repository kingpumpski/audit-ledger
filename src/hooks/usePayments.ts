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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get next payment number
      const { data: paymentNumber, error: seqError } = await supabase
        .rpc('get_next_sequence', { seq_name: 'payment' });

      if (seqError) throw seqError;

      // Create payment
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .insert({
          payment_number: paymentNumber,
          invoice_id: paymentData.invoice_id,
          customer_id: paymentData.customer_id,
          amount: paymentData.amount,
          payment_method: paymentData.payment_method,
          reference_number: paymentData.reference_number || null,
          notes: paymentData.notes || null,
          processed_by: user.id,
          payment_date: new Date().toISOString(),
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      // Update invoice balance
      const { data: invoice } = await supabase
        .from('invoices')
        .select('total_amount, amount_paid, balance_due')
        .eq('id', paymentData.invoice_id)
        .single();

      if (invoice) {
        const newAmountPaid = (invoice.amount_paid || 0) + paymentData.amount;
        const newBalanceDue = (invoice.total_amount || 0) - newAmountPaid;
        const newStatus = newBalanceDue <= 0 ? 'paid' : 'partially_paid';

        await supabase
          .from('invoices')
          .update({
            amount_paid: newAmountPaid,
            balance_due: Math.max(0, newBalanceDue),
            status: newStatus,
          })
          .eq('id', paymentData.invoice_id);
      }

      // Send payment confirmation email
      try {
        await supabase.functions.invoke('send-payment-confirmation', {
          body: { paymentId: payment.id },
        });
      } catch (emailError) {
        console.error('Failed to send payment confirmation email:', emailError);
        // Don't throw - payment was recorded successfully, email is secondary
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
